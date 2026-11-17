import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { ImageLike, ImageUrlResolver } from '../aws/s3/image-url.resolver';
import { PaginationMetaDto } from '../common/dto/api-response.dto';
import { knownPaperType, PaperType } from '../common/enums/paper-type.enum';
import {
  MockTestAttempt,
  MockTestAttemptDocument,
} from '../mock-test-attempts/schemas/mock-test-attempt.schema';
import {
  Question,
  QuestionDocument,
} from '../mock-test-attempts/schemas/question.schema';
import {
  MockTest,
  MockTestDocument,
} from '../mock-tests/schemas/mock-test.schema';
import { Subject, SubjectDocument } from '../subjects/schemas/subject.schema';
import { Topic, TopicDocument } from '../topics/schemas/topic.schema';
import {
  MistakeBookChapterOptionDto,
  MistakeBookEntryDto,
  MistakeBookFilterOptionDto,
  MistakeBookListSummaryDto,
  MistakeBookSessionDetailDto,
  MistakeBookSessionDto,
  MistakeBookSessionsResponseDto,
  MistakeBookStartWithDto,
  MistakeBookSubjectCountDto,
} from './dto/mistake-book-response.dto';
import {
  clampMistakeBookLimit,
  clampMistakeBookPage,
  DEFAULT_TRIP_REASON,
  INSIGHT_TITLE,
  MistakeKind,
  MistakeTripReason,
  optionLetter,
  SOURCE_HINT,
} from './mistake-book.constants';
import {
  MistakeBookEntry,
  MistakeBookEntryDocument,
} from './schemas/mistake-book-entry.schema';

type SessionAggRow = {
  _id: Types.ObjectId;
  attemptId: Types.ObjectId;
  title: string;
  paperType: PaperType;
  remainingCount: number;
  attemptSubmittedAt: Date;
  subjects: Array<Types.ObjectId | null | undefined>;
  topics: Array<Types.ObjectId | null | undefined>;
};

type SummaryFacet = {
  bySubject: Array<{ _id: Types.ObjectId | null; count: number }>;
  chapters: Array<{
    _id: Types.ObjectId | null;
    subject: Types.ObjectId | null;
  }>;
  sessions: Array<{
    _id: Types.ObjectId;
    title: string;
    remainingCount: number;
    attemptSubmittedAt: Date;
  }>;
};

@Injectable()
export class MistakeBookService {
  private readonly logger = new Logger(MistakeBookService.name);

  constructor(
    @InjectModel(MistakeBookEntry.name)
    private readonly entryModel: Model<MistakeBookEntryDocument>,
    @InjectModel(MockTestAttempt.name)
    private readonly attemptModel: Model<MockTestAttemptDocument>,
    @InjectModel(MockTest.name)
    private readonly mockTestModel: Model<MockTestDocument>,
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Topic.name)
    private readonly topicModel: Model<TopicDocument>,
    private readonly imageUrlResolver: ImageUrlResolver,
  ) {}

  /**
   * Replace all Mistake Book rows for this user+paper with wrong + unattended
   * questions from the closed attempt (retakes supersede older rows).
   */
  async replaceForAttempt(attemptId: string): Promise<void> {
    if (!Types.ObjectId.isValid(attemptId)) {
      return;
    }

    const attempt = await this.attemptModel.findById(attemptId).exec();
    if (!attempt) {
      return;
    }
    if (attempt.status !== 'SUBMITTED' && attempt.status !== 'EXPIRED') {
      return;
    }
    if (!attempt.submittedAt) {
      return;
    }

    const mockTest = await this.mockTestModel
      .findById(attempt.mockTest)
      .select('paperType title')
      .lean()
      .exec();
    const paperType =
      knownPaperType(mockTest?.paperType) ?? PaperType.TOPIC_WISE;

    const questionIds = attempt.questions.map(q => q.question);
    const questions = await this.questionModel
      .find({ _id: { $in: questionIds } }, null, { includeDeleted: true })
      .select('_id subject topic')
      .lean()
      .exec();
    const questionMap = new Map(
      questions.map(question => [question._id.toString(), question]),
    );

    const docs: Array<Partial<MistakeBookEntry>> = [];
    attempt.questions.forEach((attemptQuestion, index) => {
      const questionId = attemptQuestion.question.toString();
      const selected = attemptQuestion.selectedOption;
      const isUnattended = selected == null || selected === '';
      const isIncorrect = !isUnattended && attemptQuestion.isCorrect === false;

      if (!isUnattended && !isIncorrect) {
        return;
      }

      const question = questionMap.get(questionId);
      const subject = question?.subject ?? attempt.subject ?? undefined;
      const topic = question?.topic ?? attempt.topic ?? undefined;
      const kind: MistakeKind = isUnattended ? 'unattended' : 'incorrect';

      docs.push({
        user: attempt.user,
        mockTest: attempt.mockTest,
        attempt: attempt._id as Types.ObjectId,
        question: attemptQuestion.question,
        kind,
        selectedOptionId: isUnattended ? null : selected,
        tripReason: DEFAULT_TRIP_REASON,
        mockTitle: attempt.testTitle || mockTest?.title || 'Mock',
        paperType,
        exam: attempt.exam,
        subject,
        topic,
        questionOrder: index + 1,
        attemptSubmittedAt: attempt.submittedAt!,
      });
    });

    const userId = attempt.user;
    const mockTestId = attempt.mockTest;

    await this.entryModel
      .deleteMany({ user: userId, mockTest: mockTestId })
      .exec();

    if (docs.length === 0) {
      return;
    }

    try {
      await this.entryModel.insertMany(docs, { ordered: false });
    } catch (error) {
      this.logger.error(
        `Failed to insert Mistake Book entries for attempt ${attemptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async countRemainingByMockTests(
    userId: string,
    mockTestIds: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!Types.ObjectId.isValid(userId) || mockTestIds.length === 0) {
      return result;
    }

    const validIds = mockTestIds.filter(id => Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      return result;
    }

    const rows = await this.entryModel
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            user: new Types.ObjectId(userId),
            mockTest: {
              $in: validIds.map(id => new Types.ObjectId(id)),
            },
          },
        },
        {
          $group: {
            _id: '$mockTest',
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    for (const row of rows) {
      result.set(row._id.toString(), row.count);
    }
    return result;
  }

  async listSessions(
    userId: string,
    page?: number,
    limit?: number,
    subjectId?: string,
    topicId?: string,
  ): Promise<MistakeBookSessionsResponseDto> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID format');
    }
    if (subjectId && !Types.ObjectId.isValid(subjectId)) {
      throw new BadRequestException('Invalid subject ID format');
    }
    if (topicId && !Types.ObjectId.isValid(topicId)) {
      throw new BadRequestException('Invalid topic ID format');
    }

    const safePage = clampMistakeBookPage(page);
    const safeLimit = clampMistakeBookLimit(limit);
    const skip = (safePage - 1) * safeLimit;
    const userObjectId = new Types.ObjectId(userId);

    const sessionMatch: Record<string, unknown> = { user: userObjectId };
    if (subjectId) {
      sessionMatch.subject = new Types.ObjectId(subjectId);
    }
    if (topicId) {
      sessionMatch.topic = new Types.ObjectId(topicId);
    }

    const sessionPipeline: PipelineStage[] = [
      { $match: sessionMatch },
      {
        $group: {
          _id: '$mockTest',
          attemptId: { $first: '$attempt' },
          title: { $first: '$mockTitle' },
          paperType: { $first: '$paperType' },
          remainingCount: { $sum: 1 },
          attemptSubmittedAt: { $max: '$attemptSubmittedAt' },
          subjects: { $push: '$subject' },
          topics: { $push: '$topic' },
        },
      },
      { $sort: { attemptSubmittedAt: -1 } },
      {
        $facet: {
          meta: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: safeLimit }],
        },
      },
    ];

    const summaryPipeline: PipelineStage[] = [
      { $match: { user: userObjectId } },
      {
        $facet: {
          bySubject: [
            { $group: { _id: '$subject', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          chapters: [
            {
              $match: {
                topic: { $ne: null },
                subject: { $ne: null },
              },
            },
            {
              $group: {
                _id: '$topic',
                subject: { $first: '$subject' },
              },
            },
          ],
          sessions: [
            {
              $group: {
                _id: '$mockTest',
                title: { $first: '$mockTitle' },
                remainingCount: { $sum: 1 },
                attemptSubmittedAt: { $max: '$attemptSubmittedAt' },
              },
            },
            // Same ordering as the session list: newest attempt first.
            { $sort: { attemptSubmittedAt: -1 } },
          ],
        },
      },
    ];

    const [[facet], [summaryFacet]] = await Promise.all([
      this.entryModel
        .aggregate<{
          meta: Array<{ total: number }>;
          data: SessionAggRow[];
        }>(sessionPipeline)
        .exec(),
      this.entryModel.aggregate<SummaryFacet>(summaryPipeline).exec(),
    ]);

    const total = facet?.meta[0]?.total ?? 0;
    const rows = facet?.data ?? [];
    const summaryRows = summaryFacet?.sessions ?? [];
    const bySubjectRows = summaryFacet?.bySubject ?? [];
    const chapterRows = summaryFacet?.chapters ?? [];

    const nameIds = [
      ...new Set([
        ...rows.flatMap(row =>
          row.subjects
            .map(id => id?.toString())
            .filter((id): id is string => Boolean(id)),
        ),
        ...bySubjectRows
          .map(row => row._id?.toString())
          .filter((id): id is string => Boolean(id)),
        ...chapterRows
          .map(row => row.subject?.toString())
          .filter((id): id is string => Boolean(id)),
      ]),
    ];
    const topicIds = [
      ...new Set([
        ...rows.flatMap(row =>
          row.topics
            .map(id => id?.toString())
            .filter((id): id is string => Boolean(id)),
        ),
        ...chapterRows
          .map(row => row._id?.toString())
          .filter((id): id is string => Boolean(id)),
      ]),
    ];
    const [subjects, topics] = await Promise.all([
      this.loadSubjectNames(nameIds),
      this.loadTopicNames(topicIds),
    ]);

    const data = rows.map(row => {
      const subjectIdList = distinctObjectIds(row.subjects);
      const dominantSubject = dominantObjectId(row.subjects);
      const dominantTopic = dominantObjectId(row.topics);
      return new MistakeBookSessionDto({
        mockTestId: row._id.toString(),
        attemptId: row.attemptId.toString(),
        title: row.title,
        paperType: row.paperType,
        remainingCount: row.remainingCount,
        attemptSubmittedAt: row.attemptSubmittedAt,
        subjectIds: subjectIdList.map(id => id.toString()),
        ...(dominantSubject
          ? {
              subjectId: dominantSubject.toString(),
              subjectLabel: subjects.get(dominantSubject.toString()),
            }
          : {}),
        ...(dominantTopic
          ? {
              topicId: dominantTopic.toString(),
              topicLabel: topics.get(dominantTopic.toString()),
            }
          : {}),
      });
    });

    const totalMistakes = bySubjectRows.reduce(
      (sum, row) => sum + row.count,
      0,
    );
    const bySubject = bySubjectRows
      .filter((row): row is { _id: Types.ObjectId; count: number } =>
        Boolean(row._id),
      )
      .map(
        row =>
          new MistakeBookSubjectCountDto({
            id: row._id.toString(),
            label: subjects.get(row._id.toString()) ?? 'Subject',
            count: row.count,
          }),
      );
    const filterSubjects = bySubject.map(
      row =>
        new MistakeBookFilterOptionDto({
          id: row.id,
          label: row.label,
        }),
    );
    const filterChapters = chapterRows
      .filter(
        (
          row,
        ): row is {
          _id: Types.ObjectId;
          subject: Types.ObjectId;
        } => Boolean(row._id && row.subject),
      )
      .map(
        row =>
          new MistakeBookChapterOptionDto({
            id: row._id.toString(),
            label: topics.get(row._id.toString()) ?? 'Chapter',
            subjectId: row.subject.toString(),
          }),
      );
    const topSession = summaryRows[0];
    const summary = new MistakeBookListSummaryDto({
      totalMistakes,
      sessionCount: summaryRows.length,
      bySubject,
      subjects: filterSubjects,
      chapters: filterChapters,
      startWith: topSession
        ? new MistakeBookStartWithDto({
            mockTestId: topSession._id.toString(),
            title: topSession.title,
          })
        : null,
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / safeLimit);
    const pagination: PaginationMetaDto = {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1,
    };

    return new MistakeBookSessionsResponseDto(data, pagination, summary);
  }

  async getSession(
    userId: string,
    mockTestId: string,
    subjectId?: string,
    topicId?: string,
  ): Promise<MistakeBookSessionDetailDto> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID format');
    }
    if (!Types.ObjectId.isValid(mockTestId)) {
      throw new BadRequestException('Invalid mock test ID format');
    }
    if (subjectId && !Types.ObjectId.isValid(subjectId)) {
      throw new BadRequestException('Invalid subject ID format');
    }
    if (topicId && !Types.ObjectId.isValid(topicId)) {
      throw new BadRequestException('Invalid topic ID format');
    }

    const match: Record<string, unknown> = {
      user: new Types.ObjectId(userId),
      mockTest: new Types.ObjectId(mockTestId),
    };
    if (subjectId) {
      match.subject = new Types.ObjectId(subjectId);
    }
    if (topicId) {
      match.topic = new Types.ObjectId(topicId);
    }

    const entries = await this.entryModel
      .find(match)
      .sort({ questionOrder: 1 })
      .exec();

    if (entries.length === 0) {
      // Distinguish empty filter vs missing session
      const anyForPaper = await this.entryModel
        .exists({
          user: new Types.ObjectId(userId),
          mockTest: new Types.ObjectId(mockTestId),
        })
        .exec();
      if (!anyForPaper) {
        throw new NotFoundException('Mistake Book session not found');
      }
    }

    const allForFilters = await this.entryModel
      .find({
        user: new Types.ObjectId(userId),
        mockTest: new Types.ObjectId(mockTestId),
      })
      .select('subject topic mockTitle paperType attempt attemptSubmittedAt')
      .lean()
      .exec();

    const header = allForFilters[0] ?? entries[0];
    if (!header) {
      throw new NotFoundException('Mistake Book session not found');
    }

    const questionIds = entries.map(entry => entry.question);
    const questions = await this.questionModel
      .find({ _id: { $in: questionIds } }, null, { includeDeleted: true })
      .lean()
      .exec();
    const questionMap = new Map(
      questions.map(question => [question._id.toString(), question]),
    );

    const subjectIds = [
      ...new Set(
        allForFilters
          .map(row => row.subject?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const topicIds = [
      ...new Set(
        allForFilters
          .map(row => row.topic?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const [subjectNames, topicNames] = await Promise.all([
      this.loadSubjectNames(subjectIds),
      this.loadTopicNames(topicIds),
    ]);

    const subjects = subjectIds.map(
      id =>
        new MistakeBookFilterOptionDto({
          id,
          label: subjectNames.get(id) ?? 'Subject',
        }),
    );
    const chapters = allForFilters
      .filter(row => row.topic && row.subject)
      .reduce<MistakeBookChapterOptionDto[]>((acc, row) => {
        const id = row.topic!.toString();
        if (acc.some(chapter => chapter.id === id)) {
          return acc;
        }
        acc.push(
          new MistakeBookChapterOptionDto({
            id,
            label: topicNames.get(id) ?? 'Chapter',
            subjectId: row.subject!.toString(),
          }),
        );
        return acc;
      }, []);

    const stemImageUrls = await this.resolveStemImageUrls(questions);
    const mapped = entries.map(entry =>
      this.toEntryDto(
        entry,
        questionMap,
        subjectNames,
        topicNames,
        stemImageUrls.get(entry.question.toString()) ?? null,
      ),
    );

    return new MistakeBookSessionDetailDto({
      mockTestId,
      attemptId: header.attempt.toString(),
      title: header.mockTitle,
      paperType: header.paperType,
      remainingCount: allForFilters.length,
      attemptSubmittedAt: header.attemptSubmittedAt,
      subjects,
      chapters,
      entries: mapped,
    });
  }

  async updateTripReason(
    userId: string,
    entryId: string,
    tripReason: MistakeTripReason,
  ): Promise<void> {
    const entry = await this.findOwnedEntry(userId, entryId);
    entry.tripReason = tripReason;
    await entry.save();
  }

  async deleteEntry(userId: string, entryId: string): Promise<void> {
    const entry = await this.findOwnedEntry(userId, entryId);
    await entry.deleteOne();
  }

  private async findOwnedEntry(
    userId: string,
    entryId: string,
  ): Promise<MistakeBookEntryDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID format');
    }
    if (!Types.ObjectId.isValid(entryId)) {
      throw new BadRequestException('Invalid entry ID format');
    }

    const entry = await this.entryModel
      .findOne({
        _id: new Types.ObjectId(entryId),
        user: new Types.ObjectId(userId),
      })
      .exec();

    if (!entry) {
      throw new NotFoundException('Mistake Book entry not found');
    }
    return entry;
  }

  private async resolveStemImageUrls(
    questions: Array<{
      _id: { toString(): string };
      questionText?: {
        en?: { image?: ImageLike };
        ml?: { image?: ImageLike };
      };
    }>,
  ): Promise<Map<string, string | null>> {
    const urls = await this.imageUrlResolver.resolveMany(
      questions.flatMap(question => [
        question.questionText?.en?.image,
        question.questionText?.ml?.image,
      ]),
    );
    const map = new Map<string, string | null>();
    questions.forEach((question, index) => {
      const enUrl = urls[index * 2] ?? null;
      const mlUrl = urls[index * 2 + 1] ?? null;
      map.set(question._id.toString(), enUrl || mlUrl || null);
    });
    return map;
  }

  private toEntryDto(
    entry: MistakeBookEntryDocument,
    questionMap: Map<string, QuestionDocument | Record<string, unknown>>,
    subjectNames: Map<string, string>,
    topicNames: Map<string, string>,
    imageUrl: string | null,
  ): MistakeBookEntryDto {
    const question = questionMap.get(entry.question.toString()) as
      | QuestionDocument
      | undefined;
    const options = question?.options ?? [];
    const textPrompt =
      question?.questionText?.en?.text?.trim() ||
      question?.questionText?.ml?.text?.trim() ||
      '';
    const prompt = textPrompt || (imageUrl ? '' : 'Question unavailable');

    const correctIndex = options.findIndex(
      option => option.id === question?.correctAnswer,
    );
    const correctOption = correctIndex >= 0 ? options[correctIndex] : undefined;
    const correctLetter = optionLetter(correctIndex >= 0 ? correctIndex : -1);
    const correctText =
      correctOption?.en?.trim() ||
      correctOption?.ml?.trim() ||
      question?.correctAnswer ||
      '';

    const selectedId = entry.selectedOptionId;
    const selectedIndex =
      selectedId == null
        ? -1
        : options.findIndex(option => option.id === selectedId);
    const selectedOption =
      selectedIndex >= 0 ? options[selectedIndex] : undefined;
    const yourLetter = optionLetter(selectedIndex);
    const yourText =
      selectedOption?.en?.trim() ||
      selectedOption?.ml?.trim() ||
      selectedId ||
      '';

    const explanation =
      question?.explanation?.en?.trim() ||
      question?.explanation?.ml?.trim() ||
      '';

    const subjectId = entry.subject?.toString() ?? '';
    const topicId = entry.topic?.toString();

    return new MistakeBookEntryDto({
      id: entry.id,
      kind: entry.kind,
      questionId: entry.question.toString(),
      questionNumber: `Q${entry.questionOrder}`,
      subjectId,
      subjectLabel: (subjectNames.get(subjectId) ?? 'SUBJECT').toUpperCase(),
      ...(topicId
        ? {
            topicId,
            topicLabel: topicNames.get(topicId),
          }
        : {}),
      prompt,
      imageUrl,
      ...(entry.kind === 'incorrect'
        ? {
            yourAnswerLabel: `YOUR ANSWER · ${yourLetter}`,
            yourAnswer: yourText,
          }
        : {}),
      correctAnswerLabel: `CORRECT · ${correctLetter}`,
      correctAnswer: correctText,
      insightTitle: INSIGHT_TITLE,
      insightBody: explanation,
      insightFormula: '',
      sourceLabel: '',
      sourceHref: '',
      sourceHint: SOURCE_HINT,
      tripReason: entry.tripReason,
    });
  }

  private async loadSubjectNames(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (ids.length === 0) {
      return map;
    }
    const rows = await this.subjectModel
      .find({ _id: { $in: ids.map(id => new Types.ObjectId(id)) } })
      .select('name')
      .lean()
      .exec();
    for (const row of rows) {
      map.set(row._id.toString(), row.name);
    }
    return map;
  }

  private async loadTopicNames(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (ids.length === 0) {
      return map;
    }
    const rows = await this.topicModel
      .find({ _id: { $in: ids.map(id => new Types.ObjectId(id)) } })
      .select('name')
      .lean()
      .exec();
    for (const row of rows) {
      map.set(row._id.toString(), row.name);
    }
    return map;
  }
}

/** Distinct ObjectIds preserving first-seen order. */
function distinctObjectIds(
  values: Array<Types.ObjectId | null | undefined>,
): Types.ObjectId[] {
  const seen = new Set<string>();
  const result: Types.ObjectId[] = [];
  for (const value of values) {
    if (!value) continue;
    const key = value.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/** ObjectId with the highest occurrence count (ties keep first max). */
function dominantObjectId(
  values: Array<Types.ObjectId | null | undefined>,
): Types.ObjectId | undefined {
  const counts = new Map<string, { id: Types.ObjectId; count: number }>();
  for (const value of values) {
    if (!value) continue;
    const key = value.toString();
    const prev = counts.get(key);
    if (prev) {
      prev.count += 1;
    } else {
      counts.set(key, { id: value, count: 1 });
    }
  }
  let best: { id: Types.ObjectId; count: number } | undefined;
  for (const row of counts.values()) {
    if (!best || row.count > best.count) {
      best = row;
    }
  }
  return best?.id;
}
