import { BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AnalysisService } from '../analysis/analysis.service';
import { MistakeBookService } from '../mistake-book/mistake-book.service';
import { MockTest } from '../mock-tests/schemas/mock-test.schema';
import { TodayService } from './today.service';

const USER_ID = '507f1f77bcf86cd799439012';
const EXAM_ID = '507f1f77bcf86cd799439011';
const MOCK_ID = '507f1f77bcf86cd799439013';

describe('TodayService', () => {
  let service: TodayService;
  const cache = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
  const analysisService = {
    getOverview: jest.fn(),
  };
  const mistakeBookService = {
    getTeaserSummary: jest.fn(),
    listSessions: jest.fn(),
  };
  const mockTestModel = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TodayService,
        { provide: AnalysisService, useValue: analysisService },
        { provide: MistakeBookService, useValue: mistakeBookService },
        { provide: getModelToken(MockTest.name), useValue: mockTestModel },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    service = module.get(TodayService);
    jest.clearAllMocks();
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(undefined);
    cache.del.mockResolvedValue(undefined);
  });

  function chainFindOne(resolved: unknown) {
    const query: Record<string, jest.Mock> = {};
    for (const m of ['sort', 'select', 'lean']) {
      query[m] = jest.fn().mockReturnValue(query);
    }
    query.exec = jest.fn().mockResolvedValue(resolved);
    mockTestModel.findOne.mockReturnValue(query);
    return query;
  }

  it('rejects invalid examId', async () => {
    await expect(service.getToday(USER_ID, 'bad')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns cached page when present', async () => {
    const cached = { mode: 'empty', examId: EXAM_ID };
    cache.get.mockResolvedValue(cached);
    const result = await service.getToday(USER_ID, EXAM_ID);
    expect(result).toBe(cached);
    expect(analysisService.getOverview).not.toHaveBeenCalled();
    expect(mistakeBookService.listSessions).not.toHaveBeenCalled();
  });

  it('composes overview + teaser + lean next mock without listSessions', async () => {
    analysisService.getOverview.mockResolvedValue({
      exam: { id: EXAM_ID, name: 'NEET', totalMarks: 720 },
      fullMocks: {
        completedCount: 0,
        targetCount: 5,
        needsMoreAttempts: true,
        latest: null,
        recent: [],
      },
      pathways: { averagePercent: null, attemptCountUsed: 0, offerings: [] },
      subjects: {
        source: 'TOPIC_WISE',
        attemptCount: 0,
        needsMoreAttempts: true,
        items: [],
      },
      engagement: {
        hasFullMocks: false,
        hasChapterWise: false,
        fullMockTarget: 5,
        fullMocksRemaining: 5,
      },
    });
    mistakeBookService.getTeaserSummary.mockResolvedValue({
      totalMistakes: 0,
      startWith: null,
    });
    chainFindOne({
      _id: new Types.ObjectId(MOCK_ID),
      title: 'NEET full-syllabus mock',
      totalQuestions: 180,
      durationInMinutes: 180,
      exam: new Types.ObjectId(EXAM_ID),
    });

    const result = await service.getToday(USER_ID, EXAM_ID);

    expect(result.mode).toBe('empty');
    expect(result.nextMock.title).toBe('NEET full-syllabus mock');
    expect(analysisService.getOverview).toHaveBeenCalledWith(USER_ID, EXAM_ID);
    expect(mistakeBookService.getTeaserSummary).toHaveBeenCalledWith(USER_ID);
    expect(mistakeBookService.listSessions).not.toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalled();
  });

  it('invalidates indexed exam cache keys', async () => {
    cache.get.mockResolvedValue([EXAM_ID]);
    await service.invalidateUserToday(USER_ID);
    expect(cache.del).toHaveBeenCalledWith(`today:v1:${USER_ID}:${EXAM_ID}`);
    expect(cache.del).toHaveBeenCalledWith(`today:exams:${USER_ID}`);
  });
});
