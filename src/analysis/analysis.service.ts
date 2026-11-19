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
  attemptScorePercent,
  averagePercent,
  evaluatePathwayBand,
  resolveComfortPercent,
} from '../recommendations/pathway-bands';
import { RecommendationsService } from '../recommendations/recommendations.service';
import {
  AnalysisFullMockAttemptDto,
  AnalysisLatestFullMockDto,
  AnalysisOverviewResponseDto,
  AnalysisPathwayDto,
  AnalysisSubjectInsightDto,
  AnalysisTopicInsightDto,
} from './dto/analysis-overview-response.dto';

const COMPLETED_STATUSES = ['SUBMITTED', 'EXPIRED'] as const;
const FULL_MOCK_TARGET = 5;
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type LeanAttempt = {
  _id: Types.ObjectId;
  testTitle?: string;
  score: number;
  totalQuestions: number;
  marksPerQuestion: number;
  submittedAt?: Date;
  subject?: Types.ObjectId;
  topic?: Types.ObjectId;
  questions?: Array<{
    isCorrect?: boolean | null;
    selectedOption?: string | null;
  }>;
};

type NamedRef = { _id: Types.ObjectId; name?: string };

@Injectable()
export class AnalysisService {
  constructor(
    @InjectModel(MockTestAttempt.name)
    private readonly attemptModel: Model<MockTestAttemptDocument>,
    @InjectModel(Exam.name)
    private readonly examModel: Model<ExamDocument>,
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

    const cacheKey = `analysis:overview:${userId}:${examId}`;
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
    const { items: fullMocks, latestRow } = fullMockBundle;

    const percents = fullMocks.map(item => item.percent);
    const avg = averagePercent(percents);

    const pathways: AnalysisPathwayDto[] = offerings.map(offering => {
      const comfort = resolveComfortPercent(
        offering.minPercent,
        offering.comfortPercent,
      );
      const band = evaluatePathwayBand(avg, offering.minPercent, comfort);
      return {
        id: offering.id,
        title: offering.title,
        ...(offering.subtitle ? { subtitle: offering.subtitle } : {}),
        minPercent: offering.minPercent,
        comfortPercent: comfort,
        userPercent: avg,
        progress01: band.progress01,
        band: band.band,
        message: band.message,
      };
    });

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
        attemptCountUsed: fullMocks.length,
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
        this.cacheManager.del(`analysis:overview:${userId}:${examId}`),
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

  private async loadRecentFullMocks(
    userId: Types.ObjectId,
    examId: Types.ObjectId,
  ): Promise<{ items: AnalysisFullMockAttemptDto[]; latestRow?: LeanAttempt }> {
    const rows = await this.attemptModel
      .find({
        user: userId,
        exam: examId,
        paperType: PaperType.FULL_EXAM,
        status: { $in: [...COMPLETED_STATUSES] },
        submittedAt: { $exists: true },
      })
      .sort({ submittedAt: -1 })
      .limit(FULL_MOCK_TARGET)
      .select(
        'testTitle score totalQuestions marksPerQuestion submittedAt questions',
      )
      .lean<LeanAttempt[]>()
      .exec();

    const items = rows.map((row, index) => {
      const maxScore = Math.max(
        1,
        (row.totalQuestions ?? 0) * (row.marksPerQuestion ?? 0),
      );
      const percent = attemptScorePercent(
        row.score ?? 0,
        row.totalQuestions ?? 0,
        row.marksPerQuestion ?? 0,
      );
      const label = `Mock ${rows.length - index}`;
      return {
        attemptId: row._id.toHexString(),
        label,
        title: row.testTitle?.trim() || label,
        score: Math.round(row.score ?? 0),
        maxScore,
        percent,
        submittedAt: (row.submittedAt ?? new Date()).toISOString(),
      };
    });

    return { items, latestRow: rows[0] };
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
