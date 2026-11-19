import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AnalysisService } from '../analysis/analysis.service';
import { PaperType } from '../common/enums/paper-type.enum';
import { MistakeBookService } from '../mistake-book/mistake-book.service';
import {
  MockTest,
  MockTestDocument,
} from '../mock-tests/schemas/mock-test.schema';
import { TodayPageResponseDto } from './dto/today-response.dto';
import { buildTodayPage, NextMockTeaser } from './today-page.builder';

const TODAY_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class TodayService {
  constructor(
    private readonly analysisService: AnalysisService,
    private readonly mistakeBookService: MistakeBookService,
    @InjectModel(MockTest.name)
    private readonly mockTestModel: Model<MockTestDocument>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getToday(
    userId: string,
    examId: string,
  ): Promise<TodayPageResponseDto> {
    if (!Types.ObjectId.isValid(examId)) {
      throw new BadRequestException('examId must be a valid ObjectId');
    }
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user');
    }

    const cacheKey = this.pageCacheKey(userId, examId);
    const cached = await this.cacheManager.get<TodayPageResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const [analysis, mistakes, nextMock] = await Promise.all([
      this.analysisService.getOverview(userId, examId),
      this.mistakeBookService.getTeaserSummary(userId),
      this.loadNextMockTeaser(examId),
    ]);

    const page = buildTodayPage({
      examId,
      analysis,
      mistakes,
      nextMock,
    });

    await this.cacheManager.set(cacheKey, page, TODAY_CACHE_TTL_MS);
    await this.trackExamCache(userId, examId);
    return page;
  }

  async invalidateUserToday(userId: string): Promise<void> {
    const indexKey = this.examIndexKey(userId);
    const examIds = (await this.cacheManager.get<string[]>(indexKey)) ?? [];
    await Promise.all([
      ...examIds.map(examId =>
        this.cacheManager.del(this.pageCacheKey(userId, examId)),
      ),
      this.cacheManager.del(indexKey),
    ]);
  }

  /** One published full-mock paper — projection only, no attempt enrichment. */
  private async loadNextMockTeaser(examId: string): Promise<NextMockTeaser> {
    const row = await this.mockTestModel
      .findOne({
        paperType: PaperType.FULL_EXAM,
        exam: new Types.ObjectId(examId),
        isActive: true,
        isDeleted: { $ne: true },
      })
      .sort({ accessMode: -1, createdAt: 1 })
      .select('_id title totalQuestions durationInMinutes exam')
      .lean<{
        _id: Types.ObjectId;
        title?: string;
        totalQuestions: number;
        durationInMinutes: number;
        exam: Types.ObjectId;
      }>()
      .exec();

    if (!row) {
      return null;
    }

    return {
      id: row._id.toString(),
      title: row.title?.trim() || 'Full-syllabus mock',
      totalQuestions: row.totalQuestions,
      durationInMinutes: row.durationInMinutes,
      examId: row.exam.toString(),
    };
  }

  private pageCacheKey(userId: string, examId: string): string {
    return `today:v1:${userId}:${examId}`;
  }

  private examIndexKey(userId: string): string {
    return `today:exams:${userId}`;
  }

  private async trackExamCache(userId: string, examId: string): Promise<void> {
    const indexKey = this.examIndexKey(userId);
    const existing = (await this.cacheManager.get<string[]>(indexKey)) ?? [];
    if (!existing.includes(examId)) {
      await this.cacheManager.set(
        indexKey,
        [...existing, examId],
        TODAY_CACHE_TTL_MS,
      );
    }
  }
}
