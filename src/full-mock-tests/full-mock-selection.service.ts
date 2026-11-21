import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Exam, ExamDocument, ExamSubject } from '../exams/schemas/exam.schema';
import { Subject, SubjectDocument } from '../subjects/schemas/subject.schema';
import { Topic, TopicDocument } from '../topics/schemas/topic.schema';
import {
  Question,
  QuestionDocument,
} from '../mock-test-attempts/schemas/question.schema';
import { DraftQuestion } from './schemas/full-mock-test-draft.schema';
import { SubjectDifficultyDto } from './dto/create-draft.dto';

export type DifficultyLevel = 'easy' | 'medium' | 'hard';
const DIFFICULTY_LEVELS: DifficultyLevel[] = ['easy', 'medium', 'hard'];

const RECENCY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const USAGE_EXPONENT = 1.5;

interface EligibleQuestion {
  _id: Types.ObjectId;
  topic?: Types.ObjectId;
  difficultyLevel?: string;
  fullMockUsageCount?: number;
  lastUsedInFullMockAt?: Date;
}

interface TopicInventory {
  topicId: Types.ObjectId | null;
  inventory: number;
  quota: number;
  frac: number;
}

export interface GeneratedPaper {
  questions: DraftQuestion[];
  subjectNames: Map<string, string>;
}

@Injectable()
export class FullMockSelectionService {
  private readonly logger = new Logger(FullMockSelectionService.name);

  constructor(
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Topic.name)
    private readonly topicModel: Model<TopicDocument>,
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
  ) {}

  /**
   * Validate exam blueprint then sample a full paper.
   * Throws 400 with BLUEPRINT_INVALID or BANK_SHORTAGE — nothing is persisted here.
   */
  async generatePaper(
    exam: ExamDocument,
    difficultyDistribution?: SubjectDifficultyDto[],
  ): Promise<GeneratedPaper> {
    this.assertBlueprint(exam);

    const explicit = difficultyDistribution?.length
      ? await this.prepareExplicitDistribution(exam, difficultyDistribution)
      : null;

    const usedIds = new Set<string>();
    const questions: DraftQuestion[] = [];
    const subjectNames = new Map<string, string>();
    let position = 0;

    for (const row of exam.subjects) {
      const subjectId = row.subject as Types.ObjectId;
      if (!subjectId) {
        throw new BadRequestException({
          message: 'Exam blueprint is inconsistent',
          error: 'BLUEPRINT_INVALID',
          details: [{ rule: 'SUBJECT_REQUIRED' }],
        });
      }
      const subject = await this.subjectModel.findById(subjectId).exec();
      if (!subject) {
        throw new BadRequestException({
          message: 'Exam blueprint is inconsistent',
          error: 'BLUEPRINT_INVALID',
          details: [
            {
              rule: 'SUBJECT_MISSING',
              subjectId: subjectId.toString(),
            },
          ],
        });
      }

      subjectNames.set(subjectId.toString(), subject.name);

      const negativeMarking = row.hasNegativeMarking
        ? row.negativeMarksPerQuestion || 0
        : 0;

      const split = explicit?.get(subjectId.toString());
      const picks: EligibleQuestion[] = [];
      if (split) {
        for (const level of DIFFICULTY_LEVELS) {
          if (split[level] <= 0) {
            continue;
          }
          picks.push(
            ...(await this.sampleSubject(row, subject, usedIds, exam._id, {
              difficulty: level,
              needed: split[level],
            })),
          );
        }
      } else {
        picks.push(
          ...(await this.sampleSubject(row, subject, usedIds, exam._id)),
        );
      }

      for (const pick of picks) {
        questions.push({
          question: pick._id,
          subject: subjectId,
          topic: pick.topic,
          difficultyLevel: pick.difficultyLevel,
          position,
          marksPerQuestion: row.marksPerQuestion,
          negativeMarking,
        });
        usedIds.add(pick._id.toString());
        position += 1;
      }
    }

    if (questions.length !== exam.totalQuestions) {
      this.logger.error(
        `Generated ${questions.length} questions, expected ${exam.totalQuestions}`,
      );
      throw new BadRequestException({
        message: 'Failed to assemble a complete paper',
        error: 'BANK_SHORTAGE',
        details: {
          needed: exam.totalQuestions,
          available: questions.length,
        },
      });
    }

    const uniqueIds = new Set(questions.map(q => q.question.toString()));
    if (uniqueIds.size !== questions.length) {
      throw new BadRequestException({
        message:
          'Generated paper contained the same question more than once. Try generating again.',
        error: 'DUPLICATE_QUESTION',
      });
    }

    return { questions, subjectNames };
  }

  /**
   * Validate the admin's per-subject easy/medium/hard split against the exam
   * blueprint, then check the bank can serve every (subject, difficulty) cell.
   * Collects ALL problems so the admin can fix them in one pass.
   * Returns the split keyed by subject id. Persists nothing.
   */
  private async prepareExplicitDistribution(
    exam: ExamDocument,
    distribution: SubjectDifficultyDto[],
  ): Promise<Map<string, Record<DifficultyLevel, number>>> {
    const names = new Map<string, string>();
    for (const row of exam.subjects) {
      const id = (row.subject as Types.ObjectId).toString();
      const subject = await this.subjectModel.findById(id).exec();
      names.set(id, subject?.name || id);
    }
    const label = (id: string) => names.get(id) || id;

    const problems: Array<Record<string, unknown>> = [];
    const split = new Map<string, Record<DifficultyLevel, number>>();

    for (const entry of distribution) {
      if (!names.has(entry.subjectId)) {
        problems.push({
          rule: 'UNKNOWN_SUBJECT',
          subjectId: entry.subjectId,
          message: `Subject ${entry.subjectId} is not part of this exam`,
        });
        continue;
      }
      if (split.has(entry.subjectId)) {
        problems.push({
          rule: 'DUPLICATE_SUBJECT',
          subjectId: entry.subjectId,
          subjectName: label(entry.subjectId),
          message: `${label(entry.subjectId)} was listed more than once`,
        });
        continue;
      }
      split.set(entry.subjectId, {
        easy: entry.easy,
        medium: entry.medium,
        hard: entry.hard,
      });
    }

    for (const row of exam.subjects) {
      const id = (row.subject as Types.ObjectId).toString();
      const picked = split.get(id);
      if (!picked) {
        problems.push({
          rule: 'SUBJECT_MISSING',
          subjectId: id,
          subjectName: label(id),
          message: `${label(id)} needs an easy/medium/hard split`,
        });
        continue;
      }
      const sum = picked.easy + picked.medium + picked.hard;
      if (sum !== row.numberOfQuestions) {
        problems.push({
          rule: 'SUBJECT_TOTAL_MISMATCH',
          subjectId: id,
          subjectName: label(id),
          expected: row.numberOfQuestions,
          actual: sum,
          message: `${label(id)}: easy + medium + hard is ${sum} but the exam needs ${row.numberOfQuestions}`,
        });
      }
    }

    if (problems.length > 0) {
      throw new BadRequestException({
        message: `Difficulty split is invalid. ${problems
          .map(p => p.message)
          .join('; ')}`,
        error: 'DIFFICULTY_DISTRIBUTION_INVALID',
        details: problems,
      });
    }

    const shortages: Array<Record<string, unknown>> = [];
    for (const row of exam.subjects) {
      const id = (row.subject as Types.ObjectId).toString();
      const picked = split.get(id) as Record<DifficultyLevel, number>;
      for (const level of DIFFICULTY_LEVELS) {
        const needed = picked[level];
        if (needed <= 0) {
          continue;
        }
        // exam.subjects[].subject can hydrate as a string; the question
        // collection stores real ObjectIds and raw string filters match nothing.
        const available = await this.countEligible(
          new Types.ObjectId(id),
          null,
          new Set(),
          exam._id,
          level,
        );
        if (available < needed) {
          shortages.push({
            subjectId: id,
            subjectName: label(id),
            difficulty: level,
            needed,
            available,
            message: `${label(id)} – ${level}: need ${needed}, only ${available} available`,
          });
        }
      }
    }

    if (shortages.length > 0) {
      throw new BadRequestException({
        message: `Not enough questions for the chosen difficulty split. ${shortages
          .map(s => s.message)
          .join('; ')}`,
        error: 'BANK_SHORTAGE',
        details: shortages,
      });
    }

    return split;
  }

  assertBlueprint(exam: Exam): void {
    const details: Array<Record<string, unknown>> = [];

    if (!exam.subjects || exam.subjects.length < 1) {
      details.push({ rule: 'SUBJECTS_REQUIRED' });
    }

    (exam.subjects || []).forEach((row, index) => {
      if (!row?.subject) {
        details.push({ rule: 'SUBJECT_REQUIRED', index });
      }
    });

    const subjectSum = (exam.subjects || []).reduce(
      (sum, row) => sum + (row.numberOfQuestions || 0),
      0,
    );

    if (exam.totalQuestions == null) {
      details.push({ rule: 'TOTAL_QUESTIONS_REQUIRED' });
    } else if (subjectSum !== exam.totalQuestions) {
      details.push({
        rule: 'TOTAL_QUESTIONS_MISMATCH',
        expected: exam.totalQuestions,
        actual: subjectSum,
      });
    }

    if (exam.totalMarks != null) {
      const marksSum = (exam.subjects || []).reduce(
        (sum, row) =>
          sum + (row.numberOfQuestions || 0) * (row.marksPerQuestion || 0),
        0,
      );
      if (marksSum !== exam.totalMarks) {
        details.push({
          rule: 'TOTAL_MARKS_MISMATCH',
          expected: exam.totalMarks,
          actual: marksSum,
        });
      }
    }

    if (!exam.isSessionWise) {
      if (exam.duration == null || exam.duration <= 0) {
        details.push({ rule: 'DURATION_REQUIRED' });
      }
    } else {
      const missingSession = (exam.subjects || []).filter(
        row => row.sessionTime == null || row.sessionTime <= 0,
      );
      if (missingSession.length > 0) {
        details.push({
          rule: 'SESSION_TIME_REQUIRED',
          subjects: missingSession.map(row => row.subject?.toString()),
        });
      }
    }

    if (details.length > 0) {
      throw new BadRequestException({
        message: 'Exam blueprint is inconsistent',
        error: 'BLUEPRINT_INVALID',
        details,
      });
    }
  }

  private async sampleSubject(
    row: ExamSubject,
    subject: SubjectDocument,
    usedIds: Set<string>,
    examId: Types.ObjectId,
    scope: { difficulty?: DifficultyLevel; needed?: number } = {},
  ): Promise<EligibleQuestion[]> {
    const needed = scope.needed ?? row.numberOfQuestions;
    const { difficulty } = scope;
    const subjectId = subject._id as Types.ObjectId;

    const topicIds = (subject.topics || []).map(id => id as Types.ObjectId);
    const activeTopics =
      topicIds.length > 0
        ? await this.topicModel
            .find({
              _id: { $in: topicIds },
              isActive: true,
            })
            .select('_id')
            .lean()
            .exec()
        : [];

    const buckets: TopicInventory[] =
      activeTopics.length === 0
        ? [
            {
              topicId: null,
              inventory: await this.countEligible(
                subjectId,
                null,
                usedIds,
                examId,
                difficulty,
              ),
              quota: 0,
              frac: 0,
            },
          ]
        : await Promise.all(
            activeTopics.map(async topic => ({
              topicId: topic._id as Types.ObjectId,
              inventory: await this.countEligible(
                subjectId,
                topic._id as Types.ObjectId,
                usedIds,
                examId,
                difficulty,
              ),
              quota: 0,
              frac: 0,
            })),
          );

    const usable = buckets.filter(b => b.inventory > 0);
    const available = usable.reduce((sum, b) => sum + b.inventory, 0);

    if (available < needed) {
      throw new BadRequestException({
        message: 'Not enough questions for subject',
        error: 'BANK_SHORTAGE',
        details: {
          subjectId: subjectId.toString(),
          subjectName: subject.name,
          needed,
          available,
        },
      });
    }

    this.allocateLargestRemainder(usable, needed);

    const picked: EligibleQuestion[] = [];
    for (const bucket of usable) {
      if (bucket.quota <= 0) {
        continue;
      }
      const pool = await this.loadEligible(
        subjectId,
        bucket.topicId,
        usedIds,
        examId,
        difficulty,
      );
      const sample = this.weightedSample(pool, bucket.quota);
      if (sample.length < bucket.quota) {
        throw new BadRequestException({
          message: 'Not enough questions for subject',
          error: 'BANK_SHORTAGE',
          details: {
            subjectId: subjectId.toString(),
            subjectName: subject.name,
            needed,
            available: picked.length + sample.length,
          },
        });
      }
      for (const q of sample) {
        usedIds.add(q._id.toString());
        picked.push(q);
      }
    }

    return picked;
  }

  private eligibleMatch(
    subjectId: Types.ObjectId,
    topicId: Types.ObjectId | null,
    usedIds: Set<string>,
    examId: Types.ObjectId,
    difficulty?: DifficultyLevel,
  ) {
    const match: Record<string, unknown> = {
      subject: subjectId,
      exams: examId,
      isActive: true,
      difficultyLevel: difficulty ?? { $in: DIFFICULTY_LEVELS },
    };
    if (topicId) {
      match.topic = topicId;
    }
    if (usedIds.size > 0) {
      match._id = {
        $nin: [...usedIds].map(id => new Types.ObjectId(id)),
      };
    }
    return match;
  }

  private countEligible(
    subjectId: Types.ObjectId,
    topicId: Types.ObjectId | null,
    usedIds: Set<string>,
    examId: Types.ObjectId,
    difficulty?: DifficultyLevel,
  ): Promise<number> {
    return this.questionModel
      .countDocuments(
        this.eligibleMatch(subjectId, topicId, usedIds, examId, difficulty),
      )
      .exec();
  }

  private async loadEligible(
    subjectId: Types.ObjectId,
    topicId: Types.ObjectId | null,
    usedIds: Set<string>,
    examId: Types.ObjectId,
    difficulty?: DifficultyLevel,
  ): Promise<EligibleQuestion[]> {
    const docs = await this.questionModel
      .find(this.eligibleMatch(subjectId, topicId, usedIds, examId, difficulty))
      .select(
        '_id topic difficultyLevel fullMockUsageCount lastUsedInFullMockAt',
      )
      .lean()
      .exec();
    return docs as unknown as EligibleQuestion[];
  }

  /**
   * Largest-remainder allocation, capped by inventory, leftover spilled to spare.
   */
  allocateLargestRemainder(buckets: TopicInventory[], seats: number): void {
    const totalInv = buckets.reduce((sum, b) => sum + b.inventory, 0);
    if (totalInv <= 0 || seats <= 0) {
      return;
    }

    for (const bucket of buckets) {
      const raw = (seats * bucket.inventory) / totalInv;
      bucket.quota = Math.floor(raw);
      bucket.frac = raw - Math.floor(raw);
    }

    let remainder = seats - buckets.reduce((sum, b) => sum + b.quota, 0);

    const byFrac = [...buckets].sort((a, b) => b.frac - a.frac);
    for (const bucket of byFrac) {
      if (remainder <= 0) {
        break;
      }
      if (bucket.quota < bucket.inventory) {
        bucket.quota += 1;
        remainder -= 1;
      }
    }

    if (remainder > 0) {
      const bySpare = [...buckets].sort(
        (a, b) => b.inventory - b.quota - (a.inventory - a.quota),
      );
      for (const bucket of bySpare) {
        if (remainder <= 0) {
          break;
        }
        const spare = bucket.inventory - bucket.quota;
        if (spare <= 0) {
          continue;
        }
        const add = Math.min(spare, remainder);
        bucket.quota += add;
        remainder -= add;
      }
    }
  }

  weightedSample(pool: EligibleQuestion[], count: number): EligibleQuestion[] {
    const remaining = [...pool];
    const picked: EligibleQuestion[] = [];

    while (picked.length < count && remaining.length > 0) {
      const weights = remaining.map(q => this.questionWeight(q));
      const total = weights.reduce((sum, w) => sum + w, 0);
      let cursor = Math.random() * total;
      let index = remaining.length - 1;
      for (let i = 0; i < remaining.length; i++) {
        cursor -= weights[i];
        if (cursor <= 0) {
          index = i;
          break;
        }
      }
      picked.push(remaining.splice(index, 1)[0]);
    }

    return picked;
  }

  private questionWeight(question: EligibleQuestion): number {
    const usage = question.fullMockUsageCount || 0;
    const usedAt = question.lastUsedInFullMockAt
      ? new Date(question.lastUsedInFullMockAt).getTime()
      : 0;
    const recencyPenalty =
      usedAt > 0 && Date.now() - usedAt < RECENCY_WINDOW_MS ? 0.4 : 1;
    const jitter = 0.85 + 0.15 * Math.random();
    return (1 / Math.pow(1 + usage, USAGE_EXPONENT)) * recencyPenalty * jitter;
  }

  /**
   * Arrange sampled questions for the draft:
   * - Session-wise: keep exam subject/session order; shuffle inside each session
   *   so same-topic items are not adjacent when possible.
   * - Mixed: shuffle the whole paper with the same topic-separation goal.
   * Positions are rewritten 0..n-1.
   */
  arrangePaperQuestions(
    questions: DraftQuestion[],
    subjects: Array<{ subject: Types.ObjectId | { toString(): string } }>,
    isSessionWise: boolean,
  ): DraftQuestion[] {
    if (questions.length === 0) {
      return [];
    }

    let arranged: DraftQuestion[];
    if (isSessionWise) {
      arranged = this.arrangeSessionWise(questions, subjects);
    } else {
      arranged = this.shuffleAvoidingAdjacentTopics(questions);
    }

    return arranged.map((q, position) => ({
      question: q.question,
      subject: q.subject,
      topic: q.topic,
      difficultyLevel: q.difficultyLevel,
      position,
      marksPerQuestion: q.marksPerQuestion,
      negativeMarking: q.negativeMarking,
      replacedFrom: q.replacedFrom,
    }));
  }

  private arrangeSessionWise(
    questions: DraftQuestion[],
    subjects: Array<{ subject: Types.ObjectId | { toString(): string } }>,
  ): DraftQuestion[] {
    const bySubject = new Map<string, DraftQuestion[]>();
    for (const q of questions) {
      const key = q.subject.toString();
      const bucket = bySubject.get(key) || [];
      bucket.push(q);
      bySubject.set(key, bucket);
    }

    const arranged: DraftQuestion[] = [];
    const seen = new Set<string>();
    for (const row of subjects) {
      const key = row.subject.toString();
      const block = bySubject.get(key) || [];
      arranged.push(...this.shuffleAvoidingAdjacentTopics(block));
      seen.add(key);
    }
    for (const [key, block] of bySubject) {
      if (!seen.has(key)) {
        arranged.push(...this.shuffleAvoidingAdjacentTopics(block));
      }
    }
    return arranged;
  }

  /**
   * Best-effort rearrange so consecutive questions have different topics.
   * When one topic dominates (more than half + remainder), some adjacency is
   * unavoidable; greedy largest-bucket picking still minimizes it.
   */
  shuffleAvoidingAdjacentTopics(questions: DraftQuestion[]): DraftQuestion[] {
    if (questions.length <= 1) {
      return [...questions];
    }

    const buckets = new Map<string, DraftQuestion[]>();
    for (const q of questions) {
      const key = this.topicKey(q);
      const bucket = buckets.get(key) || [];
      bucket.push(q);
      buckets.set(key, bucket);
    }

    for (const bucket of buckets.values()) {
      this.fisherYates(bucket);
    }

    const result: DraftQuestion[] = [];
    let lastKey: string | null = null;

    while (result.length < questions.length) {
      const candidates = [...buckets.entries()]
        .filter(([, qs]) => qs.length > 0)
        .sort((a, b) => {
          const sizeDiff = b[1].length - a[1].length;
          if (sizeDiff !== 0) {
            return sizeDiff;
          }
          return Math.random() - 0.5;
        });

      if (candidates.length === 0) {
        break;
      }

      const preferred = candidates.find(([key]) => key !== lastKey);
      const [chosenKey, chosenBucket] = preferred || candidates[0];
      result.push(chosenBucket.shift() as DraftQuestion);
      lastKey = chosenKey;
    }

    return result;
  }

  private topicKey(question: DraftQuestion): string {
    if (question.topic) {
      return question.topic.toString();
    }
    // Untopiced items never "match" each other for adjacency purposes.
    return `__none__:${question.question.toString()}`;
  }

  private fisherYates<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }
}
