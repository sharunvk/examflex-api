import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { MockTestAttemptsService } from './mock-test-attempts.service';
import { MockTestAttempt } from './schemas/mock-test-attempt.schema';
import { MockTest } from '../mock-tests/schemas/mock-test.schema';
import { Question } from './schemas/question.schema';
import { ImageUrlResolver } from '../aws/s3/image-url.resolver';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalysisService } from '../analysis/analysis.service';
import { AccessControlService } from '../access/access-control.service';
import { AccessDecisionReason } from '../common/enums/access-decision-reason.enum';
import { AccessMode } from '../common/enums/access-mode.enum';
import { MistakeBookService } from '../mistake-book/mistake-book.service';
import { TodayService } from '../today/today.service';

const TEST_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const ATTEMPT_ID = '507f1f77bcf86cd799439013';
const Q1 = '507f1f77bcf86cd799439014';
const Q2 = '507f1f77bcf86cd799439015';
const EXAM_ID = '507f1f77bcf86cd799439016';
const SUB_ID = '507f1f77bcf86cd799439017';
const TOP_ID = '507f1f77bcf86cd799439018';

function chainable(resolved: unknown) {
  const query: any = {};
  [
    'populate',
    'sort',
    'skip',
    'limit',
    'lean',
    'select',
    'session',
    'setOptions',
  ].forEach(m => {
    query[m] = jest.fn().mockReturnValue(query);
  });
  query.exec = jest.fn().mockResolvedValue(resolved);
  return query;
}

function questionDoc(id = Q1, correct = 'a') {
  return {
    _id: { toString: () => id },
    correctAnswer: correct,
    explanation: { en: 'why', ml: null, image: null, images: [] },
    questionText: { en: { text: 'Q', image: null }, ml: { text: null } },
    optionType: 'text',
    options: [{ id: 'a', type: 'text', en: 'A', ml: null }],
    subject: { toString: () => SUB_ID },
    topic: { toString: () => TOP_ID },
    difficultyLevel: 'easy',
  };
}

function makeTest(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(TEST_ID),
    title: 'Paper',
    isActive: true,
    allowRetake: true,
    totalQuestions: 2,
    durationInMinutes: 10,
    exam: {
      _id: { toString: () => EXAM_ID },
      name: 'Exam',
      description: 'd',
    },
    subject: {
      _id: { toString: () => SUB_ID },
      name: 'Sub',
      description: 's',
    },
    topic: { _id: { toString: () => TOP_ID }, name: 'Top' },
    marksPerQuestion: 1,
    negativeMarking: 0.25,
    passingScore: 1,
    shuffleOptions: false,
    showResultsImmediately: true,
    difficultyDistribution: { easy: 1, medium: 1, hard: 0 },
    questionIds: [new Types.ObjectId(Q1), new Types.ObjectId(Q2)],
    subjectConfig: [],
    isSessionWise: false,
    ...overrides,
  };
}

function makeAttempt(overrides: Record<string, unknown> = {}) {
  const startedAt = new Date(Date.now() - 30_000);
  const attempt: any = {
    id: ATTEMPT_ID,
    _id: new Types.ObjectId(ATTEMPT_ID),
    user: { toString: () => USER_ID },
    testTitle: 'Paper',
    status: 'IN_PROGRESS',
    durationInMinutes: 10,
    totalQuestions: 2,
    marksPerQuestion: 1,
    negativeMarking: 0.25,
    passingScore: 1,
    showResultsImmediately: true,
    startedAt,
    timeConsumed: 0,
    score: 0,
    isSessionWise: false,
    currentSessionIndex: 0,
    sessions: [],
    pauseResumeHistory: [],
    exam: {
      _id: { toString: () => EXAM_ID },
      name: 'Exam',
      description: 'd',
    },
    subject: {
      _id: { toString: () => SUB_ID },
      name: 'Sub',
      description: 's',
    },
    topic: {
      _id: { toString: () => TOP_ID },
      name: 'Top',
      description: 't',
    },
    mockTest: {
      _id: { toString: () => TEST_ID },
      title: 'Paper',
      totalQuestions: 2,
      marksPerQuestion: 1,
    },
    questions: [
      {
        question: { toString: () => Q1 },
        selectedOption: 'a',
        isCorrect: null,
        marksAwarded: 0,
        marksPerQuestion: 1,
        negativeMarking: 0.25,
      },
      {
        question: { toString: () => Q2 },
        selectedOption: null,
        isCorrect: null,
        marksAwarded: 0,
        marksPerQuestion: 1,
        negativeMarking: 0.25,
      },
    ],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return attempt;
}

describe('MockTestAttemptsService', () => {
  let service: MockTestAttemptsService;
  const attemptModel: any = {
    findOne: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  };
  const mockTestModel: any = { findById: jest.fn() };
  const questionModel: any = { find: jest.fn() };
  const imageUrlResolver = {
    resolveMany: jest.fn().mockResolvedValue([null, null, null]),
  };
  const analyticsService = {
    invalidateDashboardCache: jest.fn().mockResolvedValue(undefined),
  };
  const analysisService = {
    invalidateUserAnalysis: jest.fn().mockResolvedValue(undefined),
  };
  const todayService = {
    invalidateUserToday: jest.fn().mockResolvedValue(undefined),
  };
  const accessControlService = {
    canAccessMockTest: jest.fn().mockResolvedValue({
      allowed: true,
      reason: AccessDecisionReason.ALLOWED,
      accessMode: AccessMode.FREE,
    }),
  };
  const mistakeBookService = {
    replaceForAttempt: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MockTestAttemptsService,
        {
          provide: getModelToken(MockTestAttempt.name),
          useValue: attemptModel,
        },
        { provide: getModelToken(MockTest.name), useValue: mockTestModel },
        { provide: getModelToken(Question.name), useValue: questionModel },
        { provide: ImageUrlResolver, useValue: imageUrlResolver },
        { provide: AnalyticsService, useValue: analyticsService },
        { provide: AnalysisService, useValue: analysisService },
        { provide: AccessControlService, useValue: accessControlService },
        { provide: MistakeBookService, useValue: mistakeBookService },
        { provide: TodayService, useValue: todayService },
      ],
    }).compile();

    service = module.get(MockTestAttemptsService);
    jest.clearAllMocks();
    attemptModel.findOne.mockReset();
    attemptModel.find.mockReset();
    attemptModel.findById.mockReset();
    attemptModel.create.mockReset();
    attemptModel.updateOne.mockReset();
    mockTestModel.findById.mockReset();
    questionModel.find.mockReset();
    imageUrlResolver.resolveMany.mockResolvedValue([null, null, null]);
    analyticsService.invalidateDashboardCache.mockResolvedValue(undefined);
    analysisService.invalidateUserAnalysis.mockResolvedValue(undefined);
    todayService.invalidateUserToday.mockResolvedValue(undefined);
    accessControlService.canAccessMockTest.mockResolvedValue({
      allowed: true,
      reason: AccessDecisionReason.ALLOWED,
      accessMode: AccessMode.FREE,
    });
    mistakeBookService.replaceForAttempt.mockResolvedValue(undefined);
    attemptModel.updateOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({}),
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startAttempt', () => {
    it('should reject invalid ids', async () => {
      await expect(
        service.startAttempt({ mockTestId: 'bad' }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFound when test missing', async () => {
      mockTestModel.findById.mockReturnValue(chainable(null));
      await expect(
        service.startAttempt({ mockTestId: TEST_ID }, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject inactive tests', async () => {
      mockTestModel.findById.mockReturnValue(
        chainable(makeTest({ isActive: false })),
      );
      await expect(
        service.startAttempt({ mockTestId: TEST_ID }, USER_ID),
      ).rejects.toThrow(BadRequestException);
      expect(accessControlService.canAccessMockTest).not.toHaveBeenCalled();
    });

    it('ENFORCED deny → ForbiddenException with ENTITLEMENT_REQUIRED', async () => {
      mockTestModel.findById.mockReturnValue(chainable(makeTest()));
      accessControlService.canAccessMockTest.mockResolvedValue({
        allowed: false,
        reason: AccessDecisionReason.ENTITLEMENT_REQUIRED,
        accessMode: AccessMode.ENTITLED,
      });

      await expect(
        service.startAttempt({ mockTestId: TEST_ID }, USER_ID),
      ).rejects.toMatchObject({
        response: {
          details: { code: AccessDecisionReason.ENTITLEMENT_REQUIRED },
        },
      });
      await expect(
        service.startAttempt({ mockTestId: TEST_ID }, USER_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(attemptModel.create).not.toHaveBeenCalled();
    });

    it('ENFORCED allow with entitlement → proceeds past access gate', async () => {
      mockTestModel.findById.mockReturnValue(chainable(makeTest()));
      accessControlService.canAccessMockTest.mockResolvedValue({
        allowed: true,
        reason: AccessDecisionReason.ALLOWED,
        accessMode: AccessMode.ENTITLED,
      });
      attemptModel.findOne.mockReturnValue(chainable(null));
      const created = makeAttempt({
        toObject: () => ({}),
        id: ATTEMPT_ID,
      });
      attemptModel.create.mockResolvedValue(created);
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1), questionDoc(Q2)]),
      );

      // If create is reached, access gate passed
      try {
        await service.startAttempt({ mockTestId: TEST_ID }, USER_ID);
      } catch {
        // may fail later on response mapping; access must still have been called allow
      }
      expect(accessControlService.canAccessMockTest).toHaveBeenCalledWith(
        USER_ID,
        TEST_ID,
      );
      expect(attemptModel.create).toHaveBeenCalled();
    });

    it('FREE allow → access check passes', async () => {
      mockTestModel.findById.mockReturnValue(chainable(makeTest()));
      accessControlService.canAccessMockTest.mockResolvedValue({
        allowed: true,
        reason: AccessDecisionReason.ALLOWED,
        accessMode: AccessMode.FREE,
      });
      attemptModel.findOne.mockReturnValue(chainable(null));
      attemptModel.create.mockResolvedValue(makeAttempt());
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1), questionDoc(Q2)]),
      );

      try {
        await service.startAttempt({ mockTestId: TEST_ID }, USER_ID);
      } catch {
        // ignore downstream mapping issues
      }
      expect(accessControlService.canAccessMockTest).toHaveBeenCalled();
      expect(attemptModel.create).toHaveBeenCalled();
    });

    it('LEGACY allow without entitlement → proceeds', async () => {
      mockTestModel.findById.mockReturnValue(chainable(makeTest()));
      accessControlService.canAccessMockTest.mockResolvedValue({
        allowed: true,
        reason: AccessDecisionReason.LEGACY_ALLOW,
        accessMode: AccessMode.ENTITLED,
      });
      attemptModel.findOne.mockReturnValue(chainable(null));
      attemptModel.create.mockResolvedValue(makeAttempt());
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1), questionDoc(Q2)]),
      );

      try {
        await service.startAttempt({ mockTestId: TEST_ID }, USER_ID);
      } catch {
        // ignore downstream mapping issues
      }
      expect(attemptModel.create).toHaveBeenCalled();
    });

    it('should reject retakes when not allowed', async () => {
      mockTestModel.findById.mockReturnValue(
        chainable(makeTest({ allowRetake: false })),
      );
      attemptModel.findOne.mockReturnValue(chainable({ id: ATTEMPT_ID }));

      await expect(
        service.startAttempt({ mockTestId: TEST_ID }, USER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject when an in-progress attempt is still active', async () => {
      mockTestModel.findById.mockReturnValue(chainable(makeTest()));
      const inProgress = makeAttempt();
      attemptModel.findOne.mockReturnValue(chainable(inProgress));

      await expect(
        service.startAttempt({ mockTestId: TEST_ID }, USER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('should start a topic-wise attempt', async () => {
      mockTestModel.findById.mockReturnValue(chainable(makeTest()));
      attemptModel.findOne.mockReturnValue(chainable(null));
      attemptModel.create.mockResolvedValue(
        makeAttempt({ id: ATTEMPT_ID, startedAt: new Date() }),
      );
      const lockedQuery = chainable([questionDoc(Q1), questionDoc(Q2, 'b')]);
      questionModel.find.mockReturnValue(lockedQuery);

      const result = await service.startAttempt(
        { mockTestId: TEST_ID },
        USER_ID,
      );

      expect(result.attemptId).toBe(ATTEMPT_ID);
      expect(result.questions).toHaveLength(2);
      expect(result.questions.every(q => q.sessionOrder == null)).toBe(true);
      expect(result.mockTestData.sessions).toBeUndefined();
      expect(result.mockTestData.currentSessionIndex).toBeUndefined();
      expect(attemptModel.create).toHaveBeenCalled();
      // Locked IDs must load even if soft-deleted after the paper was built.
      expect(lockedQuery.setOptions).toHaveBeenCalledWith({
        includeDeleted: true,
      });
      const created = attemptModel.create.mock.calls[0][0];
      expect(created.sessions).toBeUndefined();
      expect(created.questions[0].sessionOrder).toBeUndefined();
    });

    it('should start a sprint paper on one timer without sessions', async () => {
      mockTestModel.findById.mockReturnValue(
        chainable(makeTest({ paperType: 'SPRINT' })),
      );
      attemptModel.findOne.mockReturnValue(chainable(null));
      attemptModel.create.mockResolvedValue(
        makeAttempt({ id: ATTEMPT_ID, startedAt: new Date() }),
      );
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1), questionDoc(Q2, 'b')]),
      );

      const result = await service.startAttempt(
        { mockTestId: TEST_ID },
        USER_ID,
      );

      expect(result.mockTestData.paperType).toBe('SPRINT');
      expect(result.mockTestData.isSessionWise).toBe(false);
      expect(result.mockTestData.sessions).toBeUndefined();
      expect(result.mockTestData.currentSessionIndex).toBeUndefined();
    });

    it('should start a session-wise full exam with per-question marks', async () => {
      const test = makeTest({
        isSessionWise: true,
        subjectConfig: [
          {
            subject: new Types.ObjectId(SUB_ID),
            name: 'Physics',
            questionStartIndex: 0,
            questionEndIndex: 0,
            marksPerQuestion: 2,
            hasNegativeMarking: true,
            negativeMarksPerQuestion: 0.5,
            sessionTime: 20,
          },
          {
            subject: new Types.ObjectId(SUB_ID),
            name: 'Chem',
            questionStartIndex: 1,
            questionEndIndex: 1,
            marksPerQuestion: 1,
            hasNegativeMarking: false,
            negativeMarksPerQuestion: 0,
            sessionTime: 20,
          },
        ],
      });
      mockTestModel.findById.mockReturnValue(chainable(test));
      attemptModel.findOne.mockReturnValue(chainable(null));
      attemptModel.create.mockResolvedValue(
        makeAttempt({
          isSessionWise: true,
          currentSessionIndex: 0,
          sessions: [
            {
              subject: SUB_ID,
              name: 'Physics',
              order: 0,
              durationInMinutes: 20,
              startIndex: 0,
              endIndex: 0,
              status: 'IN_PROGRESS',
              startedAt: new Date(),
              timeConsumed: 0,
            },
          ],
        }),
      );
      questionModel.find.mockReturnValue(chainable([questionDoc()]));

      const result = await service.startAttempt(
        { mockTestId: TEST_ID },
        USER_ID,
      );
      expect(result.mockTestData.isSessionWise).toBe(true);
    });

    it('should freeze session membership and return questions in locked session order', async () => {
      const sub2 = '507f1f77bcf86cd799439019';
      const test = makeTest({
        isSessionWise: true,
        questionIds: [new Types.ObjectId(Q1), new Types.ObjectId(Q2)],
        subjectConfig: [
          {
            subject: new Types.ObjectId(SUB_ID),
            name: 'Physics',
            questionStartIndex: 0,
            questionEndIndex: 0,
            questionIds: [new Types.ObjectId(Q1)],
            marksPerQuestion: 2,
            hasNegativeMarking: true,
            negativeMarksPerQuestion: 0.5,
            sessionTime: 20,
          },
          {
            subject: new Types.ObjectId(sub2),
            name: 'Chem',
            questionStartIndex: 1,
            questionEndIndex: 1,
            questionIds: [new Types.ObjectId(Q2)],
            marksPerQuestion: 1,
            hasNegativeMarking: false,
            negativeMarksPerQuestion: 0,
            sessionTime: 20,
          },
        ],
      });
      mockTestModel.findById.mockReturnValue(chainable(test));
      attemptModel.findOne.mockReturnValue(chainable(null));
      attemptModel.create.mockImplementation(async (doc: any) =>
        makeAttempt({
          isSessionWise: true,
          currentSessionIndex: 0,
          questions: doc.questions,
          sessions: doc.sessions,
        }),
      );
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q2, 'b'), questionDoc(Q1)]),
      );
      imageUrlResolver.resolveMany.mockResolvedValue(Array(6).fill(null));

      const result = await service.startAttempt(
        { mockTestId: TEST_ID },
        USER_ID,
      );

      const created = attemptModel.create.mock.calls[0][0];
      expect(created.questions[0].sessionOrder).toBe(0);
      expect(created.questions[1].sessionOrder).toBe(1);
      expect(created.sessions[0].questionIds.map(String)).toEqual([Q1]);
      expect(created.sessions[1].questionIds.map(String)).toEqual([Q2]);

      expect(result.questions.map(q => q._id)).toEqual([Q1, Q2]);
      expect(result.questions[0].sessionOrder).toBe(0);
      expect(result.questions[1].sessionOrder).toBe(1);
      expect(result.mockTestData.sessions?.[0].questionIds).toEqual([Q1]);
      expect(result.mockTestData.sessions?.[0].questionCount).toBe(1);
      expect(result.mockTestData.sessions?.[1].questionCount).toBe(1);
    });

    it('should expire abandoned in-progress attempts then start a new one', async () => {
      mockTestModel.findById.mockReturnValue(chainable(makeTest()));
      const expired = makeAttempt({
        startedAt: new Date(Date.now() - 20 * 60 * 1000),
        durationInMinutes: 1,
      });
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));
      attemptModel.findOne.mockReturnValue(chainable(expired));
      attemptModel.create.mockResolvedValue(makeAttempt());

      const result = await service.startAttempt(
        { mockTestId: TEST_ID },
        USER_ID,
      );
      expect(expired.status).toBe('EXPIRED');
      expect(expired.save).toHaveBeenCalled();
      expect(result.attemptId).toBe(ATTEMPT_ID);
    });
  });

  describe('question and option images', () => {
    const imageOf = (key: string) => ({
      key,
      bucket: 'examflex-images',
      region: 'ap-south-1',
    });

    // Behaves like the real resolver: one signed URL per image, null for none.
    const signLikeResolver = async (
      images: Array<{ key?: string } | null | undefined>,
    ) =>
      images.map(image =>
        image?.key
          ? `https://examflex-images.s3.ap-south-1.amazonaws.com/${image.key}?X-Amz-Signature=sig`
          : null,
      );

    it('puts each signed URL on the right question and option in the start payload', async () => {
      mockTestModel.findById.mockReturnValue(chainable(makeTest()));
      attemptModel.findOne.mockReturnValue(chainable(null));
      attemptModel.create.mockImplementation(async (doc: any) =>
        makeAttempt({ questions: doc.questions }),
      );
      const withImages = {
        ...questionDoc(Q1),
        questionText: {
          en: { text: 'See figure', image: imageOf('admin-images/q1.png') },
          ml: { text: null, image: null },
        },
        optionType: 'image',
        options: [
          {
            id: 'a',
            type: 'image',
            en: null,
            ml: null,
            image: imageOf('admin-images/q1-a.png'),
          },
          {
            id: 'b',
            type: 'image',
            en: null,
            ml: null,
            image: imageOf('admin-images/q1-b.png'),
          },
        ],
      };
      const second = {
        ...questionDoc(Q2),
        options: [
          { id: 'a', type: 'text', en: 'Plain', ml: null, image: null },
          {
            id: 'b',
            type: 'text',
            en: 'Mixed',
            ml: null,
            image: imageOf('admin-images/q2-b.png'),
          },
        ],
      };
      questionModel.find.mockReturnValue(chainable([second, withImages]));
      imageUrlResolver.resolveMany.mockImplementation(signLikeResolver);

      const result = await service.startAttempt(
        { mockTestId: TEST_ID },
        USER_ID,
      );

      const base =
        'https://examflex-images.s3.ap-south-1.amazonaws.com/admin-images';
      const [first, other] = result.questions;
      expect(first._id).toBe(Q1);
      expect(first.questionText.en.imageUrl).toBe(
        `${base}/q1.png?X-Amz-Signature=sig`,
      );
      expect(first.questionText.ml.imageUrl).toBeNull();
      expect(first.optionType).toBe('image');
      expect(first.options.map(o => [o.id, o.type, o.imageUrl])).toEqual([
        ['a', 'image', `${base}/q1-a.png?X-Amz-Signature=sig`],
        ['b', 'image', `${base}/q1-b.png?X-Amz-Signature=sig`],
      ]);
      // the second question has no stem picture, and only option b has one
      expect(other._id).toBe(Q2);
      expect(other.questionText.en.imageUrl).toBeNull();
      expect(other.options.map(o => o.imageUrl)).toEqual([
        null,
        `${base}/q2-b.png?X-Amz-Signature=sig`,
      ]);
      // raw bucket / key metadata never leaves the API
      expect(JSON.stringify(result.questions)).not.toContain('"bucket"');
    });

    it('sends null (not an error) when a question has no picture', async () => {
      mockTestModel.findById.mockReturnValue(chainable(makeTest()));
      attemptModel.findOne.mockReturnValue(chainable(null));
      attemptModel.create.mockImplementation(async (doc: any) =>
        makeAttempt({ questions: doc.questions }),
      );
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1), questionDoc(Q2)]),
      );
      imageUrlResolver.resolveMany.mockImplementation(signLikeResolver);

      const result = await service.startAttempt(
        { mockTestId: TEST_ID },
        USER_ID,
      );
      for (const question of result.questions) {
        expect(question.questionText.en.imageUrl).toBeNull();
        expect(question.options.every(o => o.imageUrl === null)).toBe(true);
      }
    });
  });

  describe('pauseAttempt', () => {
    it('should reject invalid attempt ids', async () => {
      await expect(service.pauseAttempt('bad', USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should 404 when attempt is missing', async () => {
      attemptModel.findOne.mockReturnValue(chainable(null));
      await expect(service.pauseAttempt(ATTEMPT_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject non in-progress attempts', async () => {
      attemptModel.findOne.mockReturnValue(
        chainable(makeAttempt({ status: 'PAUSED' })),
      );
      await expect(service.pauseAttempt(ATTEMPT_ID, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject when time already expired', async () => {
      attemptModel.findOne.mockReturnValue(
        chainable(
          makeAttempt({
            startedAt: new Date(Date.now() - 20 * 60 * 1000),
            durationInMinutes: 1,
          }),
        ),
      );
      await expect(service.pauseAttempt(ATTEMPT_ID, USER_ID)).rejects.toThrow(
        /already expired/,
      );
    });

    it('should pause and record history', async () => {
      const attempt = makeAttempt();
      attemptModel.findOne.mockReturnValue(chainable(attempt));

      const result = await service.pauseAttempt(ATTEMPT_ID, USER_ID);

      expect(result.status).toBe('PAUSED');
      expect(attempt.status).toBe('PAUSED');
      expect(result.pauseCount).toBe(1);
    });

    it('should pause a session-wise attempt', async () => {
      const attempt = makeAttempt({
        isSessionWise: true,
        sessions: [
          {
            subject: SUB_ID,
            name: 'P',
            order: 0,
            durationInMinutes: 20,
            startIndex: 0,
            endIndex: 1,
            status: 'IN_PROGRESS',
            startedAt: new Date(Date.now() - 5000),
            timeConsumed: 10,
          },
        ],
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));

      const result = await service.pauseAttempt(ATTEMPT_ID, USER_ID);
      expect(result.status).toBe('PAUSED');
      expect(attempt.sessions[0].status).toBe('PAUSED');
    });
  });

  describe('findOne', () => {
    it('should validate and 404', async () => {
      await expect(service.findOne('x', USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      attemptModel.findOne.mockReturnValue(chainable(null));
      await expect(service.findOne(ATTEMPT_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('exposes the paper id so the results page can deep-link to the Mistake Book', async () => {
      // populated reference (as findOne loads it)
      attemptModel.findOne.mockReturnValue(
        chainable(
          makeAttempt({
            mockTest: {
              _id: new Types.ObjectId(TEST_ID),
              paperType: 'TOPIC_WISE',
            },
          }),
        ),
      );
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));
      expect((await service.findOne(ATTEMPT_ID, USER_ID)).test.mockTestId).toBe(
        TEST_ID,
      );

      // plain ObjectId reference
      attemptModel.findOne.mockReturnValue(
        chainable(makeAttempt({ mockTest: new Types.ObjectId(TEST_ID) })),
      );
      expect((await service.findOne(ATTEMPT_ID, USER_ID)).test.mockTestId).toBe(
        TEST_ID,
      );

      // nothing to point at -> field omitted, no error
      attemptModel.findOne.mockReturnValue(
        chainable(makeAttempt({ mockTest: null })),
      );
      expect(
        (await service.findOne(ATTEMPT_ID, USER_ID)).test.mockTestId,
      ).toBeUndefined();
    });

    it('should return in-progress details with remaining time', async () => {
      attemptModel.findOne.mockReturnValue(chainable(makeAttempt()));
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));

      const result = await service.findOne(ATTEMPT_ID, USER_ID);
      expect(result.attemptId).toBe(ATTEMPT_ID);
      expect(result.timeRemaining).toBeGreaterThan(0);
    });

    it('should include results when submitted and showResultsImmediately', async () => {
      const attempt = makeAttempt({
        status: 'SUBMITTED',
        score: 1,
        submittedAt: new Date(),
        questions: [
          {
            question: { toString: () => Q1 },
            selectedOption: 'a',
            isCorrect: true,
            marksAwarded: 1,
          },
          {
            question: { toString: () => Q2 },
            selectedOption: 'b',
            isCorrect: false,
            marksAwarded: -0.25,
          },
          {
            question: { toString: () => '507f1f77bcf86cd799439099' },
            selectedOption: null,
            isCorrect: false,
            marksAwarded: 0,
          },
        ],
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1), questionDoc(Q2, 'a')]),
      );

      const result = await service.findOne(ATTEMPT_ID, USER_ID);
      expect(result.correctAnswers).toBe(1);
      expect(result.incorrectAnswers).toBe(1);
      expect(result.unansweredQuestions).toBe(1);
      expect(result.isPassed).toBe(true);
    });

    it('omits topic and uses paused elapsed time', async () => {
      const attempt = makeAttempt({
        status: 'PAUSED',
        timeConsumed: 12,
        topic: undefined,
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));

      const result = await service.findOne(ATTEMPT_ID, USER_ID);
      expect(result.timeElapsed).toBe(12);
      expect(result.test.topic).toBeUndefined();
    });
  });

  describe('resumeAttempt', () => {
    it('should reject expired attempts', async () => {
      const attempt = makeAttempt({
        startedAt: new Date(Date.now() - 20 * 60 * 1000),
        durationInMinutes: 1,
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc()]));

      await expect(service.resumeAttempt(ATTEMPT_ID, USER_ID)).rejects.toThrow(
        /expired/,
      );
    });

    it('should reject submitted attempts', async () => {
      attemptModel.findOne.mockReturnValue(
        chainable(makeAttempt({ status: 'SUBMITTED' })),
      );
      await expect(service.resumeAttempt(ATTEMPT_ID, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should resume a paused attempt', async () => {
      const attempt = makeAttempt({
        status: 'PAUSED',
        timeConsumed: 40,
        isSessionWise: true,
        sessions: [
          {
            subject: SUB_ID,
            name: 'P',
            order: 0,
            durationInMinutes: 20,
            startIndex: 0,
            endIndex: 1,
            status: 'PAUSED',
            startedAt: new Date(),
            timeConsumed: 40,
          },
        ],
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));

      const result = await service.resumeAttempt(ATTEMPT_ID, USER_ID);
      expect(attempt.status).toBe('IN_PROGRESS');
      expect(result.timeConsumed).toBe(40);
      expect(result.pauseCount).toBeUndefined();
      expect(result.mockTestData.isSessionWise).toBe(true);
      expect(result.sessions?.[0].questionCount).toBe(2);
    });

    it('allows resume after entitlement lapse without re-checking access (D-08)', async () => {
      const attempt = makeAttempt({ status: 'IN_PROGRESS' });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));
      accessControlService.canAccessMockTest.mockClear();

      await service.resumeAttempt(ATTEMPT_ID, USER_ID);

      expect(accessControlService.canAccessMockTest).not.toHaveBeenCalled();
    });

    it('should return questions in locked order with sessionOrder', async () => {
      const attempt = makeAttempt({
        isSessionWise: true,
        questions: [
          {
            question: { toString: () => Q1 },
            selectedOption: 'a',
            sessionOrder: 0,
          },
          {
            question: { toString: () => Q2 },
            selectedOption: null,
            sessionOrder: 1,
          },
        ],
        sessions: [
          {
            subject: SUB_ID,
            name: 'P',
            order: 0,
            durationInMinutes: 20,
            startIndex: 0,
            endIndex: 0,
            questionIds: [new Types.ObjectId(Q1)],
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            timeConsumed: 0,
          },
          {
            subject: SUB_ID,
            name: 'C',
            order: 1,
            durationInMinutes: 20,
            startIndex: 1,
            endIndex: 1,
            questionIds: [new Types.ObjectId(Q2)],
            status: 'LOCKED',
            timeConsumed: 0,
          },
        ],
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q2, 'b'), questionDoc(Q1)]),
      );
      imageUrlResolver.resolveMany.mockResolvedValue(Array(6).fill(null));

      const result = await service.resumeAttempt(ATTEMPT_ID, USER_ID);
      expect(result.questions.map(q => q._id)).toEqual([Q1, Q2]);
      expect(result.questions[0].sessionOrder).toBe(0);
      expect(result.questions[1].sessionOrder).toBe(1);
      expect(result.sessions?.[0].questionIds).toEqual([Q1]);
    });

    it('should 404 and reject invalid ids', async () => {
      await expect(service.resumeAttempt('nope', USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      attemptModel.findOne.mockReturnValue(chainable(null));
      await expect(service.resumeAttempt(ATTEMPT_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findUserAttempts / findUserTestAttempts', () => {
    it('should map summaries', async () => {
      attemptModel.find.mockReturnValue(chainable([makeAttempt()]));
      const rows = await service.findUserAttempts(USER_ID);
      expect(rows[0].mockTestTitle).toBe('Paper');
      expect(rows[0].totalMarks).toBe(2);
    });

    it('should validate mockTestId', async () => {
      await expect(
        service.findUserTestAttempts(USER_ID, 'bad'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should list attempts for a test', async () => {
      attemptModel.find.mockReturnValue(chainable([makeAttempt()]));
      const rows = await service.findUserTestAttempts(USER_ID, TEST_ID);
      expect(rows).toHaveLength(1);
    });
  });

  describe('updateAnswer', () => {
    it('should validate ids', async () => {
      await expect(
        service.updateAnswer('x', USER_ID, {
          questionId: Q1,
          selectedOptionId: 'a',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateAnswer(ATTEMPT_ID, USER_ID, {
          questionId: 'x',
          selectedOptionId: 'a',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should 404 missing attempts and reject non in-progress', async () => {
      attemptModel.findOne.mockReturnValue(chainable(null));
      await expect(
        service.updateAnswer(ATTEMPT_ID, USER_ID, {
          questionId: Q1,
          selectedOptionId: 'a',
        }),
      ).rejects.toThrow(NotFoundException);

      attemptModel.findOne.mockReturnValue(
        chainable(makeAttempt({ status: 'PAUSED' })),
      );
      await expect(
        service.updateAnswer(ATTEMPT_ID, USER_ID, {
          questionId: Q1,
          selectedOptionId: 'a',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject expired papers and mid-session expiry', async () => {
      const expiredPaper = makeAttempt({
        startedAt: new Date(Date.now() - 20 * 60 * 1000),
        durationInMinutes: 1,
      });
      questionModel.find.mockReturnValue(chainable([questionDoc()]));
      attemptModel.findOne.mockReturnValue(chainable(expiredPaper));
      await expect(
        service.updateAnswer(ATTEMPT_ID, USER_ID, {
          questionId: Q1,
          selectedOptionId: 'a',
        }),
      ).rejects.toThrow(/expired/);

      const sessionExpired = makeAttempt({
        isSessionWise: true,
        currentSessionIndex: 0,
        durationInMinutes: 1,
        startedAt: new Date(Date.now() - 20 * 60 * 1000),
        sessions: [
          {
            status: 'IN_PROGRESS',
            durationInMinutes: 1,
            startedAt: new Date(Date.now() - 20 * 60 * 1000),
            timeConsumed: 0,
            startIndex: 0,
            endIndex: 0,
            name: 'P',
            order: 0,
            subject: SUB_ID,
          },
          {
            status: 'LOCKED',
            durationInMinutes: 1,
            startIndex: 1,
            endIndex: 1,
            name: 'C',
            order: 1,
            subject: SUB_ID,
          },
        ],
      });
      attemptModel.findOne.mockReturnValue(chainable(sessionExpired));
      await expect(
        service.updateAnswer(ATTEMPT_ID, USER_ID, {
          questionId: Q1,
          selectedOptionId: 'a',
        }),
      ).rejects.toThrow(/session has expired/);
    });

    it('should reject unknown questions and out-of-session questions', async () => {
      attemptModel.findOne.mockReturnValue(chainable(makeAttempt()));
      await expect(
        service.updateAnswer(ATTEMPT_ID, USER_ID, {
          questionId: EXAM_ID,
          selectedOptionId: 'a',
        }),
      ).rejects.toThrow(/not part of this attempt/);

      const sessionAttempt = makeAttempt({
        isSessionWise: true,
        sessions: [
          {
            status: 'IN_PROGRESS',
            durationInMinutes: 20,
            startedAt: new Date(),
            timeConsumed: 0,
            startIndex: 0,
            endIndex: 0,
            name: 'P',
            order: 0,
            subject: SUB_ID,
          },
        ],
      });
      attemptModel.findOne.mockReturnValue(chainable(sessionAttempt));
      await expect(
        service.updateAnswer(ATTEMPT_ID, USER_ID, {
          questionId: Q2,
          selectedOptionId: 'a',
        }),
      ).rejects.toThrow(/current session/);
    });

    it('should reject answers using frozen session questionIds even if indexes overlap', async () => {
      const sessionAttempt = makeAttempt({
        isSessionWise: true,
        questions: [
          {
            question: { toString: () => Q1 },
            selectedOption: null,
            sessionOrder: 0,
          },
          {
            question: { toString: () => Q2 },
            selectedOption: null,
            sessionOrder: 1,
          },
        ],
        sessions: [
          {
            status: 'IN_PROGRESS',
            durationInMinutes: 20,
            startedAt: new Date(),
            timeConsumed: 0,
            startIndex: 0,
            endIndex: 1,
            questionIds: [new Types.ObjectId(Q1)],
            name: 'P',
            order: 0,
            subject: SUB_ID,
          },
        ],
      });
      attemptModel.findOne.mockReturnValue(chainable(sessionAttempt));
      await expect(
        service.updateAnswer(ATTEMPT_ID, USER_ID, {
          questionId: Q2,
          selectedOptionId: 'a',
        }),
      ).rejects.toThrow(/current session/);
    });

    it('should update a valid answer', async () => {
      attemptModel.findOne.mockReturnValue(chainable(makeAttempt()));
      await service.updateAnswer(ATTEMPT_ID, USER_ID, {
        questionId: Q1,
        selectedOptionId: 'b',
      });
      expect(attemptModel.updateOne).toHaveBeenCalled();
    });

    it('clears the stored answer when selectedOptionId is null', async () => {
      attemptModel.findOne.mockReturnValue(chainable(makeAttempt()));
      await service.updateAnswer(ATTEMPT_ID, USER_ID, {
        questionId: Q1,
        selectedOptionId: null,
      });
      expect(attemptModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: { 'questions.$.selectedOption': null },
        }),
      );
    });

    it('rejects answers when the current session is not in progress', async () => {
      attemptModel.findOne.mockReturnValue(
        chainable(
          makeAttempt({
            isSessionWise: true,
            sessions: [
              {
                status: 'PAUSED',
                durationInMinutes: 20,
                startedAt: new Date(),
                timeConsumed: 0,
                startIndex: 0,
                endIndex: 1,
                name: 'P',
                order: 0,
                subject: SUB_ID,
              },
            ],
          }),
        ),
      );
      await expect(
        service.updateAnswer(ATTEMPT_ID, USER_ID, {
          questionId: Q1,
          selectedOptionId: 'a',
        }),
      ).rejects.toThrow(/session is not active/);
    });
  });

  describe('submitAttempt', () => {
    it('should validate and 404', async () => {
      await expect(service.submitAttempt('x', USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      attemptModel.findOne.mockReturnValue(chainable(null));
      await expect(service.submitAttempt(ATTEMPT_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject paused and mid-session submit', async () => {
      attemptModel.findOne.mockReturnValue(
        chainable(makeAttempt({ status: 'PAUSED' })),
      );
      await expect(service.submitAttempt(ATTEMPT_ID, USER_ID)).rejects.toThrow(
        BadRequestException,
      );

      attemptModel.findOne.mockReturnValue(
        chainable(
          makeAttempt({
            isSessionWise: true,
            currentSessionIndex: 0,
            sessions: [
              {
                status: 'IN_PROGRESS',
                durationInMinutes: 20,
                startedAt: new Date(),
                startIndex: 0,
                endIndex: 0,
                name: 'P',
                order: 0,
                subject: SUB_ID,
                timeConsumed: 0,
              },
              {
                status: 'LOCKED',
                durationInMinutes: 20,
                startIndex: 1,
                endIndex: 1,
                name: 'C',
                order: 1,
                subject: SUB_ID,
                timeConsumed: 0,
              },
            ],
          }),
        ),
      );
      await expect(service.submitAttempt(ATTEMPT_ID, USER_ID)).rejects.toThrow(
        /session-wise/,
      );
    });

    it('should score answers and include results', async () => {
      const attempt = makeAttempt();
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      attemptModel.findById.mockReturnValue(
        chainable({ questions: attempt.questions }),
      );
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1, 'a'), questionDoc(Q2, 'b')]),
      );

      const result = await service.submitAttempt(ATTEMPT_ID, USER_ID, {
        answers: [
          { questionId: Q2, selectedOptionId: 'b' },
          { questionId: 'not-an-id', selectedOptionId: 'x' },
          { questionId: EXAM_ID, selectedOptionId: 'x' },
        ],
      });

      expect(result.correctAnswers).toBe(1);
      expect(result.unansweredQuestions).toBe(1);
      expect(result.questionResults).toBeDefined();
      expect(attempt.status).toBe('SUBMITTED');
    });

    it('allows submit after entitlement lapse without re-checking access (D-08)', async () => {
      const attempt = makeAttempt();
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      attemptModel.findById.mockReturnValue(
        chainable({ questions: attempt.questions }),
      );
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1, 'a'), questionDoc(Q2, 'b')]),
      );
      accessControlService.canAccessMockTest.mockClear();

      await service.submitAttempt(ATTEMPT_ID, USER_ID);

      expect(accessControlService.canAccessMockTest).not.toHaveBeenCalled();
      expect(attempt.status).toBe('SUBMITTED');
    });

    it('should mark expired submits and skip late answers', async () => {
      const attempt = makeAttempt({
        startedAt: new Date(Date.now() - 20 * 60 * 1000),
        durationInMinutes: 1,
        showResultsImmediately: false,
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc()]));

      const result = await service.submitAttempt(ATTEMPT_ID, USER_ID, {
        answers: [{ questionId: Q1, selectedOptionId: 'z' }],
      });
      expect(result.questionResults).toBeUndefined();
      expect(attempt.status).toBe('EXPIRED');
    });

    it('applies negative marks for incorrect answers', async () => {
      const attempt = makeAttempt({
        questions: [
          {
            question: { toString: () => Q1 },
            selectedOption: 'z',
            isCorrect: null,
            marksAwarded: 0,
            marksPerQuestion: 1,
            negativeMarking: 0.25,
          },
        ],
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      attemptModel.findById.mockReturnValue(
        chainable({ questions: attempt.questions }),
      );
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1, 'a')]));

      const result = await service.submitAttempt(ATTEMPT_ID, USER_ID);
      expect(result.incorrectAnswers).toBe(1);
      expect(result.score).toBe(-0.25);
    });

    it('skips answers outside the current session on submit', async () => {
      const attempt = makeAttempt({
        isSessionWise: true,
        currentSessionIndex: 0,
        sessions: [
          {
            status: 'IN_PROGRESS',
            durationInMinutes: 20,
            startedAt: new Date(),
            timeConsumed: 0,
            startIndex: 0,
            endIndex: 0,
            name: 'P',
            order: 0,
            subject: SUB_ID,
          },
        ],
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      attemptModel.findById.mockReturnValue(
        chainable({ questions: attempt.questions }),
      );
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1, 'a'), questionDoc(Q2, 'b')]),
      );

      await service.submitAttempt(ATTEMPT_ID, USER_ID, {
        answers: [{ questionId: Q2, selectedOptionId: 'b' }],
      });
      expect(attempt.status).toBe('SUBMITTED');
    });
  });

  describe('completeSession', () => {
    it('should validate and reject non session-wise', async () => {
      await expect(service.completeSession('x', USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      attemptModel.findOne.mockReturnValue(chainable(null));
      await expect(
        service.completeSession(ATTEMPT_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
      attemptModel.findOne.mockReturnValue(chainable(makeAttempt()));
      await expect(
        service.completeSession(ATTEMPT_ID, USER_ID),
      ).rejects.toThrow(/not session-wise/);
    });

    it('should reject paused, finished, locked sessions', async () => {
      attemptModel.findOne.mockReturnValue(
        chainable(
          makeAttempt({
            isSessionWise: true,
            status: 'PAUSED',
            sessions: [{ status: 'PAUSED', durationInMinutes: 10 }],
          }),
        ),
      );
      await expect(
        service.completeSession(ATTEMPT_ID, USER_ID),
      ).rejects.toThrow(/Resume/);

      attemptModel.findOne.mockReturnValue(
        chainable(
          makeAttempt({
            isSessionWise: true,
            status: 'SUBMITTED',
            sessions: [{ status: 'SUBMITTED', durationInMinutes: 10 }],
          }),
        ),
      );
      await expect(
        service.completeSession(ATTEMPT_ID, USER_ID),
      ).rejects.toThrow(/status/);

      attemptModel.findOne.mockReturnValue(
        chainable(
          makeAttempt({
            isSessionWise: true,
            status: 'IN_PROGRESS',
            currentSessionIndex: 0,
            sessions: [
              {
                status: 'LOCKED',
                durationInMinutes: 10,
                startedAt: new Date(),
                startIndex: 0,
                endIndex: 0,
                name: 'P',
                order: 0,
                subject: SUB_ID,
                timeConsumed: 0,
              },
            ],
          }),
        ),
      );
      await expect(
        service.completeSession(ATTEMPT_ID, USER_ID),
      ).rejects.toThrow(/locked/);

      attemptModel.findOne.mockReturnValue(
        chainable(
          makeAttempt({
            isSessionWise: true,
            currentSessionIndex: 9,
            sessions: [
              {
                status: 'IN_PROGRESS',
                durationInMinutes: 10,
                startedAt: new Date(),
                startIndex: 0,
                endIndex: 0,
                name: 'P',
                order: 0,
                subject: SUB_ID,
                timeConsumed: 0,
              },
            ],
          }),
        ),
      );
      await expect(
        service.completeSession(ATTEMPT_ID, USER_ID),
      ).rejects.toThrow(/No active session/);
    });

    it('should unlock the next session', async () => {
      const attempt = makeAttempt({
        isSessionWise: true,
        currentSessionIndex: 0,
        sessions: [
          {
            status: 'IN_PROGRESS',
            durationInMinutes: 20,
            startedAt: new Date(),
            startIndex: 0,
            endIndex: 0,
            name: 'P',
            order: 0,
            subject: SUB_ID,
            timeConsumed: 0,
          },
          {
            status: 'LOCKED',
            durationInMinutes: 20,
            startIndex: 1,
            endIndex: 1,
            name: 'C',
            order: 1,
            subject: SUB_ID,
            timeConsumed: 0,
          },
        ],
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));

      const result = await service.completeSession(ATTEMPT_ID, USER_ID);
      expect(result.paperCompleted).toBe(false);
      expect(result.nextSession).toBeDefined();
      expect(attempt.currentSessionIndex).toBe(1);
    });

    it('should submit on last session', async () => {
      const attempt = makeAttempt({
        isSessionWise: true,
        currentSessionIndex: 0,
        sessions: [
          {
            status: 'IN_PROGRESS',
            durationInMinutes: 20,
            startedAt: new Date(),
            startIndex: 0,
            endIndex: 1,
            name: 'P',
            order: 0,
            subject: SUB_ID,
            timeConsumed: 0,
          },
        ],
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1), questionDoc(Q2)]),
      );
      attemptModel.findById.mockReturnValue(chainable(attempt));

      const result = await service.completeSession(ATTEMPT_ID, USER_ID);
      expect(result.paperCompleted).toBe(true);
      expect(result.results).toBeDefined();
    });
  });

  describe('time tracking', () => {
    const minutesAgo = (mins: number) => new Date(Date.now() - mins * 60_000);
    const secondsAgo = (secs: number) => new Date(Date.now() - secs * 1000);

    function sessionAttempt(
      sessions: Array<Record<string, unknown>>,
      overrides: Record<string, unknown> = {},
    ) {
      return makeAttempt({
        isSessionWise: true,
        currentSessionIndex: 0,
        durationInMinutes: sessions.reduce(
          (sum, s) => sum + (s.durationInMinutes as number),
          0,
        ),
        sessions: sessions.map((session, order) => ({
          subject: SUB_ID,
          name: `S${order}`,
          order,
          startIndex: order,
          endIndex: order,
          status: 'LOCKED',
          timeConsumed: 0,
          ...session,
        })),
        ...overrides,
      });
    }

    it('stores the time actually consumed on pause, without a grace bonus', async () => {
      const attempt = makeAttempt({
        durationInMinutes: 10,
        startedAt: secondsAgo(120),
        timeConsumed: 0,
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));

      const result = await service.pauseAttempt(ATTEMPT_ID, USER_ID);

      expect(result.timeConsumed).toBeGreaterThanOrEqual(120);
      expect(result.timeConsumed).toBeLessThan(125);
      expect(attempt.timeConsumed).toBe(result.timeConsumed);
      expect(result.timeRemaining).toBe(600 - result.timeConsumed);
    });

    it('keeps accumulating across pause and resume cycles', async () => {
      // First leg: 2 minutes, then paused
      const attempt = makeAttempt({
        durationInMinutes: 10,
        startedAt: secondsAgo(120),
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      const firstPause = await service.pauseAttempt(ATTEMPT_ID, USER_ID);

      // Paused for a while: the frozen time must not grow
      attempt.startedAt = minutesAgo(60);
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));
      const resumed = await service.resumeAttempt(ATTEMPT_ID, USER_ID);

      expect(attempt.timeConsumed).toBe(firstPause.timeConsumed);
      expect(resumed.timeElapsed).toBeLessThan(firstPause.timeConsumed + 5);
      expect(resumed.timeRemaining).toBeGreaterThan(400);
      // Second leg starts from now, so the paused hour is not charged
      expect(attempt.startedAt.getTime()).toBeGreaterThan(
        Date.now() - 5 * 1000,
      );

      // Second leg: another minute, then paused again
      attempt.startedAt = secondsAgo(60);
      const secondPause = await service.pauseAttempt(ATTEMPT_ID, USER_ID);

      expect(secondPause.timeConsumed).toBeGreaterThanOrEqual(180);
      expect(secondPause.timeConsumed).toBeLessThan(190);
    });

    it('persists the paper time on submit so analytics can read it', async () => {
      const attempt = makeAttempt({
        durationInMinutes: 10,
        startedAt: secondsAgo(300),
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1), questionDoc(Q2, 'b')]),
      );

      const result = await service.submitAttempt(ATTEMPT_ID, USER_ID);

      expect(result.timeTaken).toBeGreaterThanOrEqual(300);
      expect(result.timeTaken).toBeLessThan(310);
      expect(attempt.timeConsumed).toBe(result.timeTaken);
      expect(attempt.status).toBe('SUBMITTED');
    });

    it('drops cached analytics when an attempt is submitted', async () => {
      const attempt = makeAttempt({ startedAt: secondsAgo(60) });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));

      await service.submitAttempt(ATTEMPT_ID, USER_ID);

      expect(analyticsService.invalidateDashboardCache).toHaveBeenCalledWith(
        USER_ID,
      );
    });

    it('caps the paper time when an abandoned attempt expires', async () => {
      const attempt = makeAttempt({
        durationInMinutes: 10,
        startedAt: minutesAgo(600),
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));

      await service.findOne(ATTEMPT_ID, USER_ID);

      expect(attempt.status).toBe('EXPIRED');
      expect(attempt.timeConsumed).toBe(600);
    });

    it('reports the paper time for a submitted attempt', async () => {
      const attempt = makeAttempt({
        status: 'SUBMITTED',
        submittedAt: new Date(),
        timeConsumed: 412,
      });
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));

      const result = await service.findOne(ATTEMPT_ID, USER_ID);

      expect(result.timeTaken).toBe(412);
    });

    it('falls back to the section timers for attempts closed before the total was stored', async () => {
      const attempt = sessionAttempt(
        [
          { durationInMinutes: 20, status: 'SUBMITTED', timeConsumed: 900 },
          { durationInMinutes: 20, status: 'SUBMITTED', timeConsumed: 600 },
        ],
        {
          status: 'SUBMITTED',
          currentSessionIndex: 1,
          submittedAt: new Date(),
          timeConsumed: 0,
        },
      );
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));

      const result = await service.findOne(ATTEMPT_ID, USER_ID);

      expect(result.timeTaken).toBe(1500);
    });

    it('runs the section timer, not the paper timer, on a session-wise pause', async () => {
      const attempt = sessionAttempt([
        {
          durationInMinutes: 20,
          status: 'SUBMITTED',
          timeConsumed: 1200,
          submittedAt: minutesAgo(5),
        },
        {
          durationInMinutes: 30,
          status: 'IN_PROGRESS',
          startedAt: secondsAgo(60),
        },
      ]);
      attempt.currentSessionIndex = 1;
      attemptModel.findOne.mockReturnValue(chainable(attempt));

      const result = await service.pauseAttempt(ATTEMPT_ID, USER_ID);

      // Section timer: one minute into a 30 minute section
      expect(result.timeConsumed).toBeGreaterThanOrEqual(60);
      expect(result.timeConsumed).toBeLessThan(70);
      expect(result.timeRemaining).toBe(1800 - result.timeConsumed);
      // Paper total: the finished section plus the current one
      expect(result.totalTimeConsumed).toBe(1200 + result.timeConsumed);
      expect(attempt.timeConsumed).toBe(result.totalTimeConsumed);
      expect(attempt.sessions[1].timeConsumed).toBe(result.timeConsumed);
    });

    it('adds up every section when a session-wise paper is completed', async () => {
      const attempt = sessionAttempt([
        {
          durationInMinutes: 20,
          status: 'SUBMITTED',
          timeConsumed: 1100,
          submittedAt: minutesAgo(10),
        },
        {
          durationInMinutes: 20,
          status: 'SUBMITTED',
          timeConsumed: 1200,
          submittedAt: minutesAgo(5),
        },
        {
          durationInMinutes: 20,
          status: 'IN_PROGRESS',
          startedAt: secondsAgo(300),
        },
      ]);
      attempt.currentSessionIndex = 2;
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      attemptModel.findById.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(
        chainable([questionDoc(Q1), questionDoc(Q2, 'b')]),
      );

      const result = await service.completeSession(ATTEMPT_ID, USER_ID);

      expect(result.paperCompleted).toBe(true);
      expect(result.results?.timeTaken).toBeGreaterThanOrEqual(2600);
      expect(result.results?.timeTaken).toBeLessThan(2620);
      expect(attempt.timeConsumed).toBe(result.results?.timeTaken);
    });

    it('carries finished sections forward when the next section opens', async () => {
      const attempt = sessionAttempt([
        {
          durationInMinutes: 20,
          status: 'IN_PROGRESS',
          startedAt: secondsAgo(600),
        },
        { durationInMinutes: 20 },
      ]);
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));

      await service.completeSession(ATTEMPT_ID, USER_ID);

      expect(attempt.sessions[0].timeConsumed).toBeGreaterThanOrEqual(600);
      expect(attempt.sessions[1].timeConsumed).toBe(0);
      expect(attempt.timeConsumed).toBe(attempt.sessions[0].timeConsumed);
      expect(attempt.currentSessionIndex).toBe(1);
    });

    it('caps an expired section at its own duration', async () => {
      const attempt = sessionAttempt([
        {
          durationInMinutes: 5,
          status: 'IN_PROGRESS',
          startedAt: minutesAgo(120),
        },
        { durationInMinutes: 5 },
      ]);
      attemptModel.findOne.mockReturnValue(chainable(attempt));
      questionModel.find.mockReturnValue(chainable([questionDoc(Q1)]));

      await service.findOne(ATTEMPT_ID, USER_ID);

      expect(attempt.sessions[0].status).toBe('EXPIRED');
      expect(attempt.sessions[0].timeConsumed).toBe(300);
      expect(attempt.timeConsumed).toBe(300);
      // The paper stays open so the student can move to the next section
      expect(attempt.status).toBe('IN_PROGRESS');
    });
  });
});
