import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaperType } from '../common/enums/paper-type.enum';
import { Exam, ExamDocument } from '../exams/schemas/exam.schema';
import {
  MockTestAttempt,
  MockTestAttemptDocument,
} from '../mock-test-attempts/schemas/mock-test-attempt.schema';
import {
  MockTest,
  MockTestDocument,
} from '../mock-tests/schemas/mock-test.schema';
import {
  PATHWAY_ATTEMPT_WINDOW,
  attemptScorePercent,
  averagePercent,
  clampPercent,
  evaluateCutoffBand,
  recencyWeights,
  round2,
  weightedAverage,
} from '../recommendations/pathway-bands';
import { attemptMaxScore } from './attempt-score';
import { RecommendationsService } from '../recommendations/recommendations.service';
import {
  AnalysisFullMockAttemptDto,
  AnalysisLatestFullMockDto,
  AnalysisOverviewResponseDto,
  AnalysisPathwayDto,
  AnalysisPathwayStatus,
  AnalysisSubjectInsightDto,
  AnalysisTopicInsightDto,
} from './dto/analysis-overview-response.dto';

const COMPLETED_STATUSES = ['SUBMITTED', 'EXPIRED'] as const;
const FULL_MOCK_TARGET = 5;
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type LeanAttempt = {
  _id: Types.ObjectId;
  mockTest?: Types.ObjectId;
  testTitle?: string;
  score: number;
  totalQuestions: number;
  marksPerQuestion: number;
  negativeMarking?: number;
  durationInMinutes?: number;
  timeConsumed?: number;
  submittedAt?: Date;
  subject?: Types.ObjectId;
  topic?: Types.ObjectId;
  questions?: Array<{
    isCorrect?: boolean | null;
    selectedOption?: string | null;
    marksPerQuestion?: number | null;
  }>;
};

/** One completed full-mock attempt inside the pathway window. */
type WindowAttempt = {
  attemptId: string;
  mockTestId: string | null;
  title: string;
  score: number;
  maxScore: number;
  percent: number;
  submittedAt: string;
};

/** offeringId -> cut-off marks, per mock test id. */
type CutoffsByMock = Map<string, Map<string, number>>;

const cacheKeyFor = (userId: string, examId: string) =>
  `analysis:overview:v2:${userId}:${examId}`;

type NamedRef = { _id: Types.ObjectId; name?: string };

@Injectable()
export class AnalysisService {
  constructor(
    @InjectModel(MockTestAttempt.name)
    private readonly attemptModel: Model<MockTestAttemptDocument>,
    @InjectModel(Exam.name)
    private readonly examModel: Model<ExamDocument>,
    @InjectModel(MockTest.name)
    private readonly mockTestModel: Model<MockTestDocument>,
    private readonly recommendationsService: RecommendationsService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getOverview(
    userId: string,
    examId: string,
  ): Promise<AnalysisOverviewResponseDto> {
    if (!Types.ObjectId.isValid(examId)) {
      throw new BadRequestException('examId must be a valid ObjectId');
    }
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user');
    }

    const cacheKey = cacheKeyFor(userId, examId);
    const cached =
      await this.cacheManager.get<AnalysisOverviewResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const exam = await this.examModel
      .findById(examId)
      .select('name totalMarks')
      .lean()
      .exec();
    if (!exam) {
      throw new NotFoundException(`Exam with ID "${examId}" not found`);
    }

    const userObjectId = new Types.ObjectId(userId);
    const examObjectId = new Types.ObjectId(examId);

    const [fullMockBundle, fullMockTotal, chapterWise, offerings] =
      await Promise.all([
        this.loadRecentFullMocks(userObjectId, examObjectId),
        this.attemptModel
          .countDocuments({
            user: userObjectId,
            exam: examObjectId,
            paperType: PaperType.FULL_EXAM,
            status: { $in: [...COMPLETED_STATUSES] },
            submittedAt: { $exists: true },
          })
          .exec(),
        this.loadChapterWiseInsights(userObjectId, examObjectId),
        this.recommendationsService.listActiveCoursesForExam(examId),
      ]);
    const { window, latestRow } = fullMockBundle;

    // Newest-first, capped at the chart size so History/Today are unchanged.
    const fullMocks: AnalysisFullMockAttemptDto[] = window
      .slice(0, FULL_MOCK_TARGET)
      .map((item, index, shown) => ({
        attemptId: item.attemptId,
        label: `Mock ${shown.length - index}`,
        title: item.title,
        score: Math.round(item.score),
        maxScore: item.maxScore,
        percent: item.percent,
        submittedAt: item.submittedAt,
      }));

    const cutoffsByMock = await this.loadCutoffsByMock(window);
    const examTotalMarks =
      typeof exam.totalMarks === 'number' ? exam.totalMarks : null;
    const pathways = this.buildPathways(
      offerings,
      window,
      cutoffsByMock,
      examTotalMarks,
    );
    const avg = this.weightedPercent(window);

    const latest = this.buildLatest(fullMocks, latestRow);
    const overview: AnalysisOverviewResponseDto = {
      exam: {
        id: examId,
        name: exam.name,
        ...(typeof exam.totalMarks === 'number'
          ? { totalMarks: exam.totalMarks }
          : {}),
      },
      fullMocks: {
        completedCount: fullMockTotal,
        targetCount: FULL_MOCK_TARGET,
        needsMoreAttempts: fullMockTotal < FULL_MOCK_TARGET,
        latest,
        // Chart order: oldest → newest (API loaded newest-first)
        recent: [...fullMocks].reverse(),
      },
      pathways: {
        averagePercent: avg,
        attemptCountUsed: window.length,
        offerings: pathways,
      },
      subjects: {
        source: 'TOPIC_WISE',
        attemptCount: chapterWise.attemptCount,
        needsMoreAttempts: chapterWise.attemptCount === 0,
        items: chapterWise.items,
      },
      engagement: {
        hasFullMocks: fullMockTotal > 0,
        hasChapterWise: chapterWise.attemptCount > 0,
        fullMockTarget: FULL_MOCK_TARGET,
        fullMocksRemaining: Math.max(0, FULL_MOCK_TARGET - fullMockTotal),
      },
    };

    await this.cacheManager.set(cacheKey, overview, ANALYSIS_CACHE_TTL_MS);
    await this.trackExamCache(userId, examId);
    return overview;
  }

  async invalidateUserAnalysis(userId: string): Promise<void> {
    // Drop known exam-scoped keys by scanning is unavailable in memory cache;
    // store a small index of exam ids per user when caching.
    const indexKey = `analysis:exams:${userId}`;
    const examIds = (await this.cacheManager.get<string[]>(indexKey)) ?? [];
    await Promise.all([
      ...examIds.map(examId =>
        this.cacheManager.del(cacheKeyFor(userId, examId)),
      ),
      this.cacheManager.del(indexKey),
    ]);
  }

  /** Remember which exam keys exist for a user so invalidation can clear them. */
  private async trackExamCache(userId: string, examId: string): Promise<void> {
    const indexKey = `analysis:exams:${userId}`;
    const existing = (await this.cacheManager.get<string[]>(indexKey)) ?? [];
    if (!existing.includes(examId)) {
      await this.cacheManager.set(
        indexKey,
        [...existing, examId],
        ANALYSIS_CACHE_TTL_MS,
      );
    }
  }

  /**
   * Latest completed full mocks (newest first), up to the pathway window.
   * `window[0]` is the newest attempt.
   */
  private async loadRecentFullMocks(
    userId: Types.ObjectId,
    examId: Types.ObjectId,
  ): Promise<{ window: WindowAttempt[]; latestRow?: LeanAttempt }> {
    const rows = await this.attemptModel
      .find({
        user: userId,
        exam: examId,
        paperType: PaperType.FULL_EXAM,
        status: { $in: [...COMPLETED_STATUSES] },
        submittedAt: { $exists: true },
      })
      .sort({ submittedAt: -1 })
      .limit(PATHWAY_ATTEMPT_WINDOW)
      .select(
        'mockTest testTitle score totalQuestions marksPerQuestion negativeMarking durationInMinutes timeConsumed submittedAt questions',
      )
      .lean<LeanAttempt[]>()
      .exec();

    const window: WindowAttempt[] = rows.map((row, index) => {
      const maxScore = Math.max(1, attemptMaxScore(row));
      return {
        attemptId: row._id.toHexString(),
        mockTestId: row.mockTest ? row.mockTest.toString() : null,
        title: row.testTitle?.trim() || `Mock ${rows.length - index}`,
        score: row.score ?? 0,
        maxScore,
        percent: attemptScorePercent(row.score ?? 0, 0, 0, maxScore),
        submittedAt: (row.submittedAt ?? new Date()).toISOString(),
      };
    });

    return { window, latestRow: rows[0] };
  }

  /** One query: cut-offs set on the mocks behind the window's attempts. */
  private async loadCutoffsByMock(
    window: WindowAttempt[],
  ): Promise<CutoffsByMock> {
    const ids = [
      ...new Set(
        window
          .map(item => item.mockTestId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const map: CutoffsByMock = new Map();
    if (ids.length === 0) return map;

    const tests = await this.mockTestModel
      .find({ _id: { $in: ids.map(id => new Types.ObjectId(id)) } })
      .select('courseCutoffs')
      .lean<
        Array<{
          _id: Types.ObjectId;
          courseCutoffs?: Array<{
            offering: Types.ObjectId;
            cutoffMarks: number;
          }>;
        }>
      >()
      .exec();

    for (const test of tests) {
      const perCourse = new Map<string, number>();
      for (const entry of test.courseCutoffs ?? []) {
        if (
          Number.isFinite(entry.cutoffMarks) &&
          entry.cutoffMarks > 0 &&
          entry.offering
        ) {
          perCourse.set(entry.offering.toString(), entry.cutoffMarks);
        }
      }
      map.set(test._id.toString(), perCourse);
    }
    return map;
  }

  /** Recency-weighted average score percent over the whole window. */
  private weightedPercent(window: WindowAttempt[]): number | null {
    const oldestFirst = [...window].reverse();
    const value = weightedAverage(
      oldestFirst.map(item => item.percent),
      recencyWeights(oldestFirst.length),
    );
    return value === null ? null : Math.round(value * 10) / 10;
  }

  private buildPathways(
    offerings: Array<{
      id: string;
      title: string;
      subtitle?: string;
      minPercent?: number;
      comfortPercent?: number;
    }>,
    window: WindowAttempt[],
    cutoffsByMock: CutoffsByMock,
    examTotalMarks: number | null,
  ): AnalysisPathwayDto[] {
    // Recency weights are positional across the whole window, so "latest
    // matters most" holds even when the newest mock has no cut-off for a course.
    const oldestFirst = [...window].reverse();
    const weights = recencyWeights(oldestFirst.length);
    const maxMarks = window[0]?.maxScore ?? examTotalMarks;
    const overallMarks = weightedAverage(
      oldestFirst.map(item => item.score),
      weights,
    );

    return offerings.map(offering => {
      const paired = oldestFirst
        .map((item, index) => ({
          item,
          weight: weights[index],
          cutoff: item.mockTestId
            ? cutoffsByMock.get(item.mockTestId)?.get(offering.id)
            : undefined,
        }))
        .filter(
          (entry): entry is typeof entry & { cutoff: number } =>
            typeof entry.cutoff === 'number',
        );

      let status: AnalysisPathwayStatus;
      let yourMarks: number | null = null;
      let cutoffMarks: number | null = null;

      if (window.length === 0) {
        status = 'NO_ATTEMPTS';
      } else if (paired.length === 0) {
        status = 'NO_CUTOFF';
        yourMarks = overallMarks === null ? null : round2(overallMarks);
      } else {
        status = 'EVALUATED';
        const weightedScore = weightedAverage(
          paired.map(entry => entry.item.score),
          paired.map(entry => entry.weight),
        );
        const weightedCutoff = weightedAverage(
          paired.map(entry => entry.cutoff),
          paired.map(entry => entry.weight),
        );
        yourMarks = weightedScore === null ? null : round2(weightedScore);
        cutoffMarks = weightedCutoff === null ? null : round2(weightedCutoff);
      }

      const evaluation =
        status === 'EVALUATED'
          ? evaluateCutoffBand(yourMarks, cutoffMarks)
          : null;

      const finalStatus: AnalysisPathwayStatus =
        status === 'EVALUATED' && !evaluation ? 'NO_CUTOFF' : status;

      const message =
        evaluation?.message ??
        (status === 'NO_ATTEMPTS'
          ? 'Attempt a full mock to see how this path looks for you.'
          : 'Cut-off not announced yet for your recent mocks.');

      const percentOf = (marks: number | null): number | null =>
        marks !== null && maxMarks !== null && maxMarks > 0
          ? Math.round(clampPercent((marks / maxMarks) * 100) * 10) / 10
          : null;

      return {
        id: offering.id,
        title: offering.title,
        ...(offering.subtitle ? { subtitle: offering.subtitle } : {}),
        status: finalStatus,
        yourMarks,
        cutoffMarks: evaluation ? cutoffMarks : null,
        comfortMarks: evaluation ? evaluation.comfortMarks : null,
        gapMarks: evaluation ? evaluation.gapMarks : null,
        maxMarks,
        attemptsConsidered:
          status === 'EVALUATED'
            ? paired.length
            : status === 'NO_CUTOFF'
              ? window.length
              : 0,
        attemptsInWindow: window.length,
        // Legacy percent fields stay populated so an older app build keeps working.
        minPercent: percentOf(cutoffMarks) ?? offering.minPercent ?? 0,
        comfortPercent:
          percentOf(evaluation?.comfortMarks ?? null) ??
          offering.comfortPercent ??
          offering.minPercent ??
          0,
        userPercent: percentOf(yourMarks),
        progress01: evaluation?.progress01 ?? 0,
        band: evaluation?.band ?? 'below',
        message,
      };
    });
  }

  private buildLatest(
    newestFirst: AnalysisFullMockAttemptDto[],
    latestRow?: LeanAttempt,
  ): AnalysisLatestFullMockDto | null {
    if (newestFirst.length === 0) return null;
    const latest = newestFirst[0];
    const previous = newestFirst[1];
    const deltaFromPrevious =
      previous !== undefined ? latest.score - previous.score : null;

    let correctCount: number | undefined;
    let incorrectCount: number | undefined;
    let skippedCount: number | undefined;
    if (latestRow?.questions?.length) {
      correctCount = 0;
      incorrectCount = 0;
      skippedCount = 0;
      for (const q of latestRow.questions) {
        if (q.selectedOption == null) {
          skippedCount += 1;
        } else if (q.isCorrect === true) {
          correctCount += 1;
        } else {
          incorrectCount += 1;
        }
      }
    }

    return {
      attemptId: latest.attemptId,
      title: latest.title,
      score: latest.score,
      maxScore: latest.maxScore,
      percent: latest.percent,
      submittedAt: latest.submittedAt,
      deltaFromPrevious,
      ...(correctCount !== undefined ? { correctCount } : {}),
      ...(incorrectCount !== undefined ? { incorrectCount } : {}),
      ...(skippedCount !== undefined ? { skippedCount } : {}),
      ...(latestRow?.marksPerQuestion
        ? { marksPerCorrect: latestRow.marksPerQuestion }
        : {}),
      ...(latestRow?.negativeMarking !== undefined
        ? { negativeMarking: Math.abs(latestRow.negativeMarking) }
        : {}),
      ...(latestRow?.durationInMinutes
        ? { durationInMinutes: latestRow.durationInMinutes }
        : {}),
      ...(latestRow?.timeConsumed !== undefined
        ? { timeTakenSeconds: Math.max(0, Math.round(latestRow.timeConsumed)) }
        : {}),
    };
  }

  private async loadChapterWiseInsights(
    userId: Types.ObjectId,
    examId: Types.ObjectId,
  ): Promise<{ attemptCount: number; items: AnalysisSubjectInsightDto[] }> {
    const rows = await this.attemptModel
      .find({
        user: userId,
        exam: examId,
        paperType: PaperType.TOPIC_WISE,
        status: { $in: [...COMPLETED_STATUSES] },
        subject: { $exists: true, $ne: null },
      })
      .sort({ submittedAt: -1 })
      .limit(200)
      .select('score totalQuestions marksPerQuestion subject topic')
      .populate('subject', 'name')
      .populate('topic', 'name')
      .lean()
      .exec();

    if (rows.length === 0) {
      return { attemptCount: 0, items: [] };
    }

    type Agg = {
      subjectName: string;
      percents: number[];
      topics: Map<string, { name: string; percents: number[] }>;
    };

    const subjectMap = new Map<string, Agg>();

    for (const row of rows as Array<
      LeanAttempt & {
        subject?: NamedRef | Types.ObjectId;
        topic?: NamedRef | Types.ObjectId;
      }
    >) {
      const subjectRef = row.subject;
      if (!subjectRef) continue;
      const subjectId =
        typeof subjectRef === 'object' && '_id' in subjectRef
          ? subjectRef._id.toHexString()
          : (subjectRef as Types.ObjectId).toHexString();
      const subjectName =
        typeof subjectRef === 'object' && 'name' in subjectRef
          ? (subjectRef.name ?? 'Subject')
          : 'Subject';

      const percent = attemptScorePercent(
        row.score ?? 0,
        row.totalQuestions ?? 0,
        row.marksPerQuestion ?? 0,
      );

      if (!subjectMap.has(subjectId)) {
        subjectMap.set(subjectId, {
          subjectName,
          percents: [],
          topics: new Map(),
        });
      }
      const entry = subjectMap.get(subjectId)!;
      entry.percents.push(percent);

      const topicRef = row.topic;
      if (topicRef) {
        const topicId =
          typeof topicRef === 'object' && '_id' in topicRef
            ? topicRef._id.toHexString()
            : (topicRef as Types.ObjectId).toHexString();
        const topicName =
          typeof topicRef === 'object' && 'name' in topicRef
            ? (topicRef.name ?? 'Topic')
            : 'Topic';
        if (!entry.topics.has(topicId)) {
          entry.topics.set(topicId, { name: topicName, percents: [] });
        }
        entry.topics.get(topicId)!.percents.push(percent);
      }
    }

    const items: AnalysisSubjectInsightDto[] = [];
    for (const [subjectId, data] of subjectMap) {
      const average = averagePercent(data.percents) ?? 0;
      const strengthLabel =
        average >= 75 ? 'Strong' : average >= 50 ? 'Good' : 'Weak';

      const topics: AnalysisTopicInsightDto[] = [];
      for (const [topicId, topic] of data.topics) {
        const topicAvg = averagePercent(topic.percents) ?? 0;
        topics.push({
          topicId,
          topicName: topic.name,
          attemptCount: topic.percents.length,
          averagePercent: topicAvg,
          isWeak: topicAvg < 50,
          isStrong: topicAvg >= 75,
        });
      }
      topics.sort((a, b) => a.averagePercent - b.averagePercent);

      const weakest = topics.find(t => t.isWeak);
      items.push({
        subjectId,
        subjectName: data.subjectName,
        attemptCount: data.percents.length,
        averagePercent: average,
        strengthLabel,
        topics,
        ...(weakest
          ? {
              tip: `${weakest.topicName} needs another look before your next mock.`,
            }
          : strengthLabel === 'Strong'
            ? {
                tip: `Keep ${data.subjectName} sharp with a short recall session.`,
              }
            : {
                tip: `Steady chapter-wise practice will lift ${data.subjectName}.`,
              }),
      });
    }

    items.sort((a, b) => a.averagePercent - b.averagePercent);
    return { attemptCount: rows.length, items };
  }
}
