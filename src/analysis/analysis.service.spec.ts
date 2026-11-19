import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Exam } from '../exams/schemas/exam.schema';
import { MockTestAttempt } from '../mock-test-attempts/schemas/mock-test-attempt.schema';
import { RecommendationKind } from '../recommendations/enums/recommendation-kind.enum';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { AnalysisService } from './analysis.service';

const USER_ID = '64f123456789abcdef123450';
const EXAM_ID = '64f123456789abcdef123456';

function chain(result: unknown) {
  const q: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(result),
    populate: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    select: jest.fn(),
    lean: jest.fn(),
  };
  for (const key of ['populate', 'sort', 'skip', 'limit', 'select', 'lean']) {
    q[key].mockReturnValue(q);
  }
  return q;
}

describe('AnalysisService', () => {
  let service: AnalysisService;
  const attemptModel: Record<string, jest.Mock> = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };
  const examModel: Record<string, jest.Mock> = {
    findById: jest.fn(),
  };
  const recommendationsService = {
    listActiveCoursesForExam: jest.fn(),
  };
  const cache = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        {
          provide: getModelToken(MockTestAttempt.name),
          useValue: attemptModel,
        },
        { provide: getModelToken(Exam.name), useValue: examModel },
        {
          provide: RecommendationsService,
          useValue: recommendationsService,
        },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();
    service = module.get(AnalysisService);
    jest.clearAllMocks();
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(undefined);
    cache.del.mockResolvedValue(undefined);
  });

  it('rejects invalid examId', async () => {
    await expect(service.getOverview(USER_ID, 'bad')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws when exam missing', async () => {
    examModel.findById.mockReturnValue(chain(null));
    await expect(service.getOverview(USER_ID, EXAM_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('builds overview with pathways and empty subjects', async () => {
    examModel.findById.mockReturnValue(
      chain({ _id: EXAM_ID, name: 'NEET UG', totalMarks: 720 }),
    );
    attemptModel.find
      .mockReturnValueOnce(
        chain([
          {
            _id: new Types.ObjectId(),
            testTitle: 'Mock 12',
            score: 548,
            totalQuestions: 180,
            marksPerQuestion: 4,
            submittedAt: new Date('2026-01-02'),
            questions: [
              { selectedOption: 'A', isCorrect: true },
              { selectedOption: 'B', isCorrect: false },
              { selectedOption: null, isCorrect: null },
            ],
          },
        ]),
      )
      .mockReturnValueOnce(chain([]));
    attemptModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });
    recommendationsService.listActiveCoursesForExam.mockResolvedValue([
      {
        id: 'o1',
        title: 'MBBS',
        subtitle: 'Medicine',
        minPercent: 80,
        comfortPercent: 90,
        kind: RecommendationKind.COURSE,
      },
    ]);

    const result = await service.getOverview(USER_ID, EXAM_ID);

    expect(result.exam.name).toBe('NEET UG');
    expect(result.fullMocks.latest?.score).toBe(548);
    expect(result.fullMocks.recent).toHaveLength(1);
    expect(result.pathways.offerings[0].band).toBe('below');
    expect(result.subjects.source).toBe('TOPIC_WISE');
    expect(result.engagement.hasFullMocks).toBe(true);
    expect(cache.set).toHaveBeenCalled();
  });

  it('returns cached overview when present', async () => {
    const cached = { exam: { id: EXAM_ID, name: 'NEET' } };
    cache.get.mockResolvedValue(cached);
    const result = await service.getOverview(USER_ID, EXAM_ID);
    expect(result).toBe(cached);
    expect(examModel.findById).not.toHaveBeenCalled();
  });

  it('invalidates tracked exam keys', async () => {
    cache.get.mockResolvedValue([EXAM_ID]);
    await service.invalidateUserAnalysis(USER_ID);
    expect(cache.del).toHaveBeenCalledWith(
      `analysis:overview:${USER_ID}:${EXAM_ID}`,
    );
  });
});
