import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MockTestsService } from './mock-tests.service';
import { AccessControlService } from '../access/access-control.service';
import { AccessDecisionReason } from '../common/enums/access-decision-reason.enum';
import { AccessMode } from '../common/enums/access-mode.enum';
import { MockTest } from './schemas/mock-test.schema';
import { Topic } from '../topics/schemas/topic.schema';
import { Question } from '../mock-test-attempts/schemas/question.schema';
import { MockTestAttempt } from '../mock-test-attempts/schemas/mock-test-attempt.schema';
import { UserRole } from '../common/enums/user-role.enum';
import { UserAttemptAction } from '../common/enums/user-attempt-action.enum';
import { CreateTopicWiseMockTestDto } from './dto/create-topic-wise-mock-test.dto';
import { ImageUrlResolver } from '../aws/s3/image-url.resolver';

const TEST_ID = '507f1f77bcf86cd799439011';
const EXAM_ID = '507f1f77bcf86cd799439012';
const SUB_ID = '507f1f77bcf86cd799439013';
const TOP_ID = '507f1f77bcf86cd799439014';
const USER_ID = '507f1f77bcf86cd799439015';
const Q1 = '507f1f77bcf86cd799439016';
const Q2 = '507f1f77bcf86cd799439017';
const ATTEMPT_ID = '507f1f77bcf86cd799439018';

function chainable(resolved: unknown) {
  const query: any = {};
  ['populate', 'sort', 'skip', 'limit', 'lean', 'select', 'session'].forEach(
    m => {
      query[m] = jest.fn().mockReturnValue(query);
    },
  );
  query.exec = jest.fn().mockResolvedValue(resolved);
  return query;
}

function makeTest(overrides: Record<string, unknown> = {}) {
  const exam = {
    _id: { toString: () => EXAM_ID },
    toString: () => EXAM_ID,
    name: 'NEET',
    description: 'exam',
  };
  const subject = {
    _id: { toString: () => SUB_ID },
    toString: () => SUB_ID,
    name: 'Physics',
    description: 'sub',
  };
  const topic = {
    _id: { toString: () => TOP_ID },
    toString: () => TOP_ID,
    name: 'Optics',
  };
  const doc: any = {
    _id: { toString: () => TEST_ID },
    id: TEST_ID,
    totalQuestions: 10,
    durationInMinutes: 10,
    exam,
    subject,
    topic,
    title: 'Optics 10',
    description: 'desc',
    generationMode: 'STATIC',
    marksPerQuestion: 1,
    negativeMarking: 0.25,
    passingScore: 5,
    allowRetake: true,
    shuffleOptions: false,
    showResultsImmediately: true,
    isActive: true,
    createdBy: { toString: () => USER_ID },
    difficultyDistribution: { easy: 4, medium: 4, hard: 2 },
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    questionIds: [{ toString: () => Q1 }],
    toObject() {
      return {
        id: TEST_ID,
        totalQuestions: this.totalQuestions,
        durationInMinutes: this.durationInMinutes,
        exam: EXAM_ID,
        subject: SUB_ID,
        topic: TOP_ID,
        title: this.title,
        description: this.description,
        generationMode: this.generationMode,
        marksPerQuestion: this.marksPerQuestion,
        negativeMarking: this.negativeMarking,
        passingScore: this.passingScore,
        allowRetake: this.allowRetake,
        shuffleOptions: this.shuffleOptions,
        showResultsImmediately: this.showResultsImmediately,
        isActive: this.isActive,
        createdBy: USER_ID,
        difficultyDistribution: this.difficultyDistribution,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
      };
    },
    ...overrides,
  };
  return doc;
}

const dto: CreateTopicWiseMockTestDto = {
  totalQuestions: 10,
  durationInMinutes: 10,
  exam: EXAM_ID,
  subject: SUB_ID,
  topic: TOP_ID,
  difficultyDistribution: { easy: 4, medium: 4, hard: 2 },
  title: 'Test',
};

describe('MockTestsService', () => {
  let service: MockTestsService;
  const mockTestModel: any = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
    aggregate: jest.fn(),
  };
  const attemptModel: any = { find: jest.fn() };
  const topicModel: any = { find: jest.fn() };
  const questionModel: any = { aggregate: jest.fn() };
  const imageUrlResolver = {
    resolveMany: jest.fn(async (images: unknown[]) => images.map(() => null)),
  };
  const accessControlService = {
    resolveAccessForMockTests: jest.fn(
      async (
        _userId: string | undefined,
        papers: Array<{ id: string; accessMode?: string }>,
      ) => {
        const map = new Map();
        for (const paper of papers) {
          const entitled = paper.accessMode === AccessMode.ENTITLED;
          map.set(paper.id, {
            allowed: !entitled,
            reason: entitled
              ? AccessDecisionReason.ENTITLEMENT_REQUIRED
              : AccessDecisionReason.ALLOWED,
            accessMode: paper.accessMode ?? AccessMode.FREE,
          });
        }
        return map;
      },
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MockTestsService,
        { provide: getModelToken(MockTest.name), useValue: mockTestModel },
        {
          provide: getModelToken(MockTestAttempt.name),
          useValue: attemptModel,
        },
        { provide: getModelToken(Topic.name), useValue: topicModel },
        { provide: getModelToken(Question.name), useValue: questionModel },
        { provide: AccessControlService, useValue: accessControlService },
        { provide: ImageUrlResolver, useValue: imageUrlResolver },
      ],
    }).compile();

    service = module.get(MockTestsService);
    jest.clearAllMocks();
    mockTestModel.find.mockReset();
    mockTestModel.findOne.mockReset();
    mockTestModel.findOneAndUpdate.mockReset();
    mockTestModel.countDocuments.mockReset();
    mockTestModel.create.mockReset();
    mockTestModel.aggregate.mockReset();
    attemptModel.find.mockReset();
    topicModel.find.mockReset();
    questionModel.aggregate.mockReset();
    imageUrlResolver.resolveMany.mockReset();
    imageUrlResolver.resolveMany.mockImplementation(async (images: unknown[]) =>
      images.map(() => null),
    );
    mockTestModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should list tests for a student without questionIds', async () => {
      const test = makeTest();
      mockTestModel.find.mockReturnValue(chainable([test]));

      const result = await service.findAll(1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(mockTestModel.find().select).toHaveBeenCalledWith('-questionIds');
    });

    it('should apply search, admin populate, and user actions', async () => {
      const test = makeTest();
      mockTestModel.find.mockReturnValue(chainable([test]));
      attemptModel.find.mockReturnValue(
        chainable([
          {
            _id: { toString: () => ATTEMPT_ID },
            mockTest: { toString: () => TEST_ID },
            status: 'PAUSED',
            startedAt: new Date('2024-01-01T10:00:00.000Z'),
            durationInMinutes: 10,
            timeConsumed: 120,
            questions: [{ selectedOption: 'a' }],
          },
        ]),
      );

      const result = await service.findAll(0, 200, '  NEET  ', USER_ID, true);

      const adminItem = result.data[0] as unknown as {
        userAttemptAction: UserAttemptAction;
        resumeAttemptId?: string;
        attemptSummary?: { status: string };
        totalMarks?: number;
      };
      expect(adminItem.userAttemptAction).toBe(UserAttemptAction.RESUME);
      expect(adminItem.resumeAttemptId).toBe(ATTEMPT_ID);
      expect(adminItem.attemptSummary?.status).toBe('PAUSED');
      expect(adminItem.totalMarks).toBe(10);
      expect(result.pagination.limit).toBe(100);
      expect(result.pagination.page).toBe(1);
    });

    it('should map RETAKE and START from attempt history', async () => {
      const otherId = '507f1f77bcf86cd799439019';
      const t1 = makeTest();
      const t2 = makeTest({
        _id: { toString: () => otherId },
        toObject() {
          return { ...makeTest().toObject(), id: otherId };
        },
      });
      mockTestModel.find.mockReturnValue(chainable([t1, t2]));
      mockTestModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(2),
      });
      attemptModel.find.mockReturnValue(
        chainable([
          {
            _id: { toString: () => ATTEMPT_ID },
            mockTest: { toString: () => TEST_ID },
            status: 'SUBMITTED',
          },
        ]),
      );

      const result = await service.findAll(1, 10, undefined, USER_ID);

      const byId = new Map(result.data.map(d => [d.id, d.userAttemptAction]));
      expect(byId.get(TEST_ID)).toBe(UserAttemptAction.RETAKE);
      expect(byId.get(otherId) ?? result.data[1].userAttemptAction).toBe(
        UserAttemptAction.START,
      );
    });

    it('filters the list by exam, subject, and topic', async () => {
      mockTestModel.find.mockReturnValue(chainable([makeTest()]));

      await service.findAll(1, 10, undefined, undefined, true, {
        examId: EXAM_ID,
        subjectId: SUB_ID,
        topicId: TOP_ID,
      });

      const query = mockTestModel.find.mock.calls[0][0];
      expect(query.exam.toString()).toBe(EXAM_ID);
      expect(query.subject.toString()).toBe(SUB_ID);
      expect(query.topic.toString()).toBe(TOP_ID);
    });

    it('rejects an invalid exam filter', async () => {
      await expect(
        service.findAll(1, 10, undefined, undefined, true, { examId: 'nope' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('uses default pagination arguments', async () => {
      mockTestModel.find.mockReturnValue(chainable([makeTest()]));
      const result = await service.findAll();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
    });

    it('includes access.allowed false for ENTITLED paper without grant (ENFORCED mock)', async () => {
      const test = makeTest({
        accessMode: AccessMode.ENTITLED,
        toObject() {
          return {
            ...makeTest().toObject(),
            accessMode: AccessMode.ENTITLED,
          };
        },
      });
      mockTestModel.find.mockReturnValue(chainable([test]));
      attemptModel.find.mockReturnValue(chainable([]));

      const result = await service.findAll(1, 10, undefined, USER_ID);

      expect(result.data[0].accessMode).toBe(AccessMode.ENTITLED);
      expect(result.data[0].access).toEqual({
        allowed: false,
        reason: AccessDecisionReason.ENTITLEMENT_REQUIRED,
      });
      expect(accessControlService.resolveAccessForMockTests).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException when missing', async () => {
      mockTestModel.findOne.mockReturnValue(chainable(null));

      await expect(service.findOne(TEST_ID)).rejects.toThrow(NotFoundException);
    });

    it('should return student dto without admin populate', async () => {
      mockTestModel.findOne.mockReturnValue(chainable(makeTest()));

      const result = await service.findOne(TEST_ID);

      expect(result.id).toBe(TEST_ID);
      expect(mockTestModel.findOne().select).toHaveBeenCalledWith(
        '-questionIds',
      );
    });

    it('should return admin detail with populated questions', async () => {
      const test = makeTest({
        questionIds: [
          {
            id: Q1,
            _id: { toString: () => Q1 },
            questionText: { en: { text: 'Q' } },
            optionType: 'text',
            options: [{ id: 'a', type: 'text', en: 'Alpha', ml: null }],
            subject: { _id: { toString: () => SUB_ID }, name: 'Physics' },
            topic: { _id: { toString: () => TOP_ID }, name: 'Mechanics' },
          },
        ],
      });
      mockTestModel.findOne.mockReturnValue(chainable(test));

      const result = await service.findOne(TEST_ID, {
        id: USER_ID,
        role: UserRole.ADMIN,
      } as any);

      expect((result as any).questions[0].id).toBe(Q1);
      expect((result as any).questions[0].topic).toEqual({
        id: TOP_ID,
        name: 'Mechanics',
      });
      expect((result as any).questions[0].questionText.en).toEqual({
        text: 'Q',
        imageUrl: null,
      });
      expect((result as any).questions[0].options).toEqual([
        { id: 'a', type: 'text', en: 'Alpha', ml: null, imageUrl: null },
      ]);
      expect((result as any).exam).toEqual({ id: EXAM_ID, name: 'NEET' });
    });

    it('maps admin questions without subjects and missing exam/subject docs', async () => {
      const test = makeTest({
        exam: undefined,
        subject: undefined,
        topic: undefined,
        difficultyDistribution: undefined,
        questionIds: [
          {
            _id: { toString: () => Q1 },
            questionText: { en: { text: 'Q' } },
          },
        ],
        toObject() {
          return {
            id: TEST_ID,
            totalQuestions: 10,
            durationInMinutes: 10,
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-02'),
          };
        },
      });
      mockTestModel.findOne.mockReturnValue(chainable(test));

      const result = await service.findOne(TEST_ID, {
        id: USER_ID,
        role: UserRole.ADMIN,
      } as any);

      expect((result as any).questions[0].subject).toBeNull();
      expect((result as any).questions[0].topic).toBeNull();
      expect((result as any).questions[0].options).toEqual([]);
      expect((result as any).questions[0].questionText.en.imageUrl).toBeNull();
      expect((result as any).questions[0].id).toBe(Q1);
    });

    it('signs question and option images for the admin preview', async () => {
      imageUrlResolver.resolveMany.mockImplementation(
        async (images: Array<{ key?: string } | null | undefined>) =>
          images.map(image =>
            image?.key ? `https://signed.example/${image.key}` : null,
          ),
      );
      const test = makeTest({
        questionIds: [
          {
            id: Q1,
            _id: { toString: () => Q1 },
            questionText: {
              en: {
                text: 'Identify',
                image: {
                  key: 'question-imports/q.png',
                  bucket: 'ez-prep-image-bucket',
                },
              },
            },
            optionType: 'image',
            options: [
              {
                id: 'a',
                type: 'image',
                en: null,
                ml: null,
                image: {
                  key: 'question-imports/a.png',
                  bucket: 'ez-prep-image-bucket',
                },
              },
            ],
            subject: { _id: { toString: () => SUB_ID }, name: 'Physics' },
            topic: { _id: { toString: () => TOP_ID }, name: 'Mechanics' },
          },
        ],
      });
      mockTestModel.findOne.mockReturnValue(chainable(test));

      const result = await service.findOne(TEST_ID, {
        id: USER_ID,
        role: UserRole.ADMIN,
      } as any);

      expect((result as any).questions[0].questionText.en.imageUrl).toBe(
        'https://signed.example/question-imports/q.png',
      );
      expect((result as any).questions[0].options[0].imageUrl).toBe(
        'https://signed.example/question-imports/a.png',
      );
    });
  });

  describe('createTopicWise', () => {
    it('should throw when difficulty sum mismatches', async () => {
      await expect(
        service.createTopicWise(
          { ...dto, difficultyDistribution: { easy: 1, medium: 1, hard: 1 } },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when not enough questions', async () => {
      questionModel.aggregate.mockResolvedValue([{ _id: Q1 }]);

      await expect(service.createTopicWise(dto, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should sample questions and create a test', async () => {
      questionModel.aggregate
        .mockResolvedValueOnce(
          Array.from({ length: 4 }, (_, i) => ({
            _id: `e${i}`.padEnd(24, '0'),
          })),
        )
        .mockResolvedValueOnce(
          Array.from({ length: 4 }, (_, i) => ({
            _id: `m${i}`.padEnd(24, '0'),
          })),
        )
        .mockResolvedValueOnce(
          Array.from({ length: 2 }, (_, i) => ({
            _id: `h${i}`.padEnd(24, '0'),
          })),
        );
      mockTestModel.create.mockResolvedValue({ id: TEST_ID });
      mockTestModel.findOne.mockReturnValue(chainable(makeTest()));

      const result = await service.createTopicWise(dto, USER_ID);

      expect(mockTestModel.create).toHaveBeenCalled();
      expect(result.id).toBe(TEST_ID);
    });

    it('rejects create without a topic', async () => {
      await expect(
        service.createTopicWise(
          {
            ...dto,
            topic: undefined as unknown as string,
          },
          USER_ID,
        ),
      ).rejects.toMatchObject({ response: { error: 'TOPIC_REQUIRED' } });
      expect(mockTestModel.create).not.toHaveBeenCalled();
    });

    it('creates with dto defaults when optional scoring fields are omitted', async () => {
      questionModel.aggregate
        .mockResolvedValueOnce(Array.from({ length: 4 }, () => ({ _id: Q1 })))
        .mockResolvedValueOnce(Array.from({ length: 4 }, () => ({ _id: Q2 })))
        .mockResolvedValueOnce(
          Array.from({ length: 2 }, () => ({ _id: ATTEMPT_ID })),
        );
      mockTestModel.create.mockResolvedValue({ id: TEST_ID });
      mockTestModel.findOne.mockReturnValue(chainable(makeTest()));

      await service.createTopicWise(
        {
          ...dto,
          title: undefined,
          description: undefined,
          generationMode: undefined,
          marksPerQuestion: undefined,
          negativeMarking: undefined,
          passingScore: undefined,
          allowRetake: undefined,
          shuffleOptions: undefined,
          showResultsImmediately: undefined,
        },
        USER_ID,
      );

      expect(mockTestModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: expect.anything(),
          generationMode: 'STATIC',
          marksPerQuestion: 1,
          accessMode: 'FREE',
        }),
      );
      expect(mockTestModel.create.mock.calls[0][0].topic.toString()).toBe(
        TOP_ID,
      );
    });
  });

  describe('updateTopicWise', () => {
    it('should throw when test not found', async () => {
      mockTestModel.findOne.mockReturnValue(chainable(null));

      await expect(
        service.updateTopicWise(TEST_ID, dto, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should skip resample when selection fields match', async () => {
      const existing = makeTest({
        exam: { toString: () => EXAM_ID },
        subject: { toString: () => SUB_ID },
        topic: { toString: () => TOP_ID },
        questionIds: [{ toString: () => Q1 }, { toString: () => Q2 }],
      });
      mockTestModel.findOne.mockReturnValueOnce(chainable(existing));
      mockTestModel.findOneAndUpdate.mockReturnValue(chainable(existing));
      mockTestModel.findOne.mockReturnValue(chainable(existing));

      await service.updateTopicWise(TEST_ID, dto, USER_ID);

      expect(questionModel.aggregate).not.toHaveBeenCalled();
    });

    it('should resample when totals change', async () => {
      const existing = makeTest({
        totalQuestions: 15,
        exam: { toString: () => EXAM_ID },
        subject: { toString: () => SUB_ID },
        topic: { toString: () => TOP_ID },
        questionIds: [{ toString: () => Q1 }],
      });
      mockTestModel.findOne.mockReturnValueOnce(chainable(existing));
      questionModel.aggregate
        .mockResolvedValueOnce(Array.from({ length: 4 }, () => ({ _id: Q1 })))
        .mockResolvedValueOnce(Array.from({ length: 4 }, () => ({ _id: Q2 })))
        .mockResolvedValueOnce(
          Array.from({ length: 2 }, () => ({ _id: ATTEMPT_ID })),
        );
      mockTestModel.findOneAndUpdate.mockReturnValue(chainable(existing));
      mockTestModel.findOne.mockReturnValue(chainable(existing));

      await service.updateTopicWise(
        TEST_ID,
        {
          ...dto,
          totalQuestions: 10,
          difficultyDistribution: { easy: 4, medium: 4, hard: 2 },
        },
        USER_ID,
      );

      expect(questionModel.aggregate).toHaveBeenCalled();
    });

    it('rejects update without a topic', async () => {
      const existing = makeTest({
        exam: { toString: () => EXAM_ID },
        subject: { toString: () => SUB_ID },
        topic: { toString: () => TOP_ID },
      });
      mockTestModel.findOne.mockReturnValueOnce(chainable(existing));

      await expect(
        service.updateTopicWise(
          TEST_ID,
          { ...dto, topic: undefined as unknown as string },
          USER_ID,
        ),
      ).rejects.toMatchObject({ response: { error: 'TOPIC_REQUIRED' } });
      expect(mockTestModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('removeTopicWise', () => {
    it('should soft-delete', async () => {
      mockTestModel.findOneAndUpdate.mockReturnValue(chainable(makeTest()));

      await expect(service.removeTopicWise(TEST_ID)).resolves.toEqual({
        message: 'Mock test deleted successfully',
      });
    });

    it('should throw when missing', async () => {
      mockTestModel.findOneAndUpdate.mockReturnValue(chainable(null));

      await expect(service.removeTopicWise(TEST_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getStats', () => {
    it('should aggregate difficulty stats', async () => {
      mockTestModel.countDocuments.mockResolvedValue(5);
      mockTestModel.aggregate.mockReturnValue(
        chainable([{ totalEasy: 10, totalMedium: 20, totalHard: 5 }]),
      );

      const stats = await service.getStats();

      expect(stats.inactiveTests).toBe(0);
      expect(stats.totalQuestionsByDifficulty.easy).toBe(10);
    });

    it('should default difficulty when aggregation is empty', async () => {
      mockTestModel.countDocuments.mockResolvedValue(0);
      mockTestModel.aggregate.mockReturnValue(chainable([]));

      const stats = await service.getStats();

      expect(stats.totalQuestionsByDifficulty).toEqual({
        easy: 0,
        medium: 0,
        hard: 0,
      });
    });
  });

  describe('findByExam', () => {
    it('rejects invalid exam ids before touching Mongo', async () => {
      await expect(service.findByExam('not-an-id')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.findByExam('undefined')).rejects.toThrow(
        /Invalid exam ID/,
      );
      expect(mockTestModel.find).not.toHaveBeenCalled();
    });

    it('should return empty when search matches no topics', async () => {
      topicModel.find.mockReturnValue(chainable([]));

      const result = await service.findByExam(EXAM_ID, 1, 10, USER_ID, 'zzz');

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });

    it('should filter by subject and search topics', async () => {
      topicModel.find.mockReturnValue(chainable([{ _id: TOP_ID }]));
      mockTestModel.find.mockReturnValue(chainable([makeTest()]));
      attemptModel.find.mockReturnValue(chainable([]));

      const result = await service.findByExam(
        EXAM_ID,
        2,
        10,
        USER_ID,
        'opt',
        SUB_ID,
      );

      expect(result.data[0].exam?.name).toBe('NEET');
      expect(result.data[0].totalMarks).toBe(10);
      expect(result.data[0].attemptSummary?.status).toBe('NONE');
      expect(result.pagination.hasPrevPage).toBe(true);
    });

    it('omits attemptSummary when anonymous', async () => {
      mockTestModel.find.mockReturnValue(chainable([makeTest()]));

      const result = await service.findByExam(EXAM_ID);

      expect(result.data[0].attemptSummary).toBeUndefined();
      expect(result.data[0].totalMarks).toBe(10);
    });

    it('lists by exam with default pagination and no topic search', async () => {
      const query = chainable([
        makeTest({
          exam: undefined,
          subject: undefined,
          topic: undefined,
        }),
      ]);
      mockTestModel.find.mockReturnValue(query);
      const result = await service.findByExam(EXAM_ID);
      expect(result.pagination.page).toBe(1);
      expect(result.data[0].exam).toBeNull();
      expect(result.data[0].subject).toBeNull();
      expect(query.sort).toHaveBeenCalledWith({
        accessMode: -1,
        createdAt: 1,
      });
    });
  });

  describe('findBySubject / findByExamAndSubject / findActive', () => {
    beforeEach(() => {
      mockTestModel.find.mockReturnValue(chainable([makeTest()]));
      attemptModel.find.mockReturnValue(chainable([]));
    });

    it('should list by subject with user actions', async () => {
      const result = await service.findBySubject(SUB_ID, 1, 10, USER_ID);
      expect(result.data).toHaveLength(1);
    });

    it('should list by exam and subject', async () => {
      const result = await service.findByExamAndSubject(
        EXAM_ID,
        SUB_ID,
        1,
        10,
        USER_ID,
      );
      expect(result.data).toHaveLength(1);
    });

    it('should list active tests', async () => {
      const result = await service.findActive(1, 10, USER_ID);
      expect(result.data).toHaveLength(1);
    });

    it('uses default arguments without user actions', async () => {
      expect((await service.findBySubject(SUB_ID)).data).toHaveLength(1);
      expect(
        (await service.findByExamAndSubject(EXAM_ID, SUB_ID)).data,
      ).toHaveLength(1);
      expect((await service.findActive()).data).toHaveLength(1);
    });
  });

  describe('getUserAttemptActions', () => {
    it('should return empty map without ids', async () => {
      const map = await service.getUserAttemptActions([], USER_ID);
      expect(map.size).toBe(0);
    });

    it('should treat IN_PROGRESS as resume and other statuses as start', async () => {
      attemptModel.find.mockReturnValue(
        chainable([
          {
            _id: { toString: () => ATTEMPT_ID },
            mockTest: { toString: () => TEST_ID },
            status: 'IN_PROGRESS',
            startedAt: new Date('2024-01-01T10:00:00.000Z'),
            durationInMinutes: 10,
            timeConsumed: 0,
            questions: [{ selectedOption: 'a' }, {}],
          },
          {
            _id: { toString: () => '507f1f77bcf86cd799439099' },
            mockTest: { toString: () => EXAM_ID },
            status: 'ABANDONED',
          },
        ]),
      );

      const map = await service.getUserAttemptActions(
        [TEST_ID, EXAM_ID],
        USER_ID,
      );

      expect(map.get(TEST_ID)?.action).toBe(UserAttemptAction.RESUME);
      expect(map.get(TEST_ID)?.attemptSummary.status).toBe('IN_PROGRESS');
      expect(map.get(TEST_ID)?.attemptSummary.answeredCount).toBe(1);
      expect(map.get(EXAM_ID)?.action).toBe(UserAttemptAction.START);
      expect(map.get(EXAM_ID)?.attemptSummary.status).toBe('NONE');
    });

    it('should map EXPIRED as RETAKE with completed summary', async () => {
      attemptModel.find.mockReturnValue(
        chainable([
          {
            _id: { toString: () => ATTEMPT_ID },
            mockTest: { toString: () => TEST_ID },
            status: 'EXPIRED',
            score: 8,
            timeConsumed: 400,
            durationInMinutes: 10,
            startedAt: new Date('2024-01-01T10:00:00.000Z'),
            questions: [
              { selectedOption: 'a', isCorrect: true },
              { selectedOption: 'b', isCorrect: false },
            ],
          },
        ]),
      );

      const map = await service.getUserAttemptActions([TEST_ID], USER_ID);
      expect(map.get(TEST_ID)?.action).toBe(UserAttemptAction.RETAKE);
      expect(map.get(TEST_ID)?.attemptSummary).toMatchObject({
        status: 'COMPLETED',
        attemptCount: 1,
        bestScore: 8,
        lastAttemptId: ATTEMPT_ID,
        lastIncorrectAnswers: 1,
      });
    });

    it('keeps multiple attempts for the same test grouped', async () => {
      attemptModel.find.mockReturnValue(
        chainable([
          {
            _id: { toString: () => ATTEMPT_ID },
            mockTest: { toString: () => TEST_ID },
            status: 'SUBMITTED',
            score: 5,
            timeConsumed: 100,
            durationInMinutes: 10,
            startedAt: new Date('2024-01-02T10:00:00.000Z'),
            questions: [{ selectedOption: 'a', isCorrect: true }],
          },
          {
            _id: { toString: () => Q1 },
            mockTest: { toString: () => TEST_ID },
            status: 'EXPIRED',
            score: 9,
            timeConsumed: 200,
            durationInMinutes: 10,
            startedAt: new Date('2024-01-01T10:00:00.000Z'),
            questions: [
              { selectedOption: 'a', isCorrect: true },
              { selectedOption: 'b', isCorrect: true },
            ],
          },
        ]),
      );
      const map = await service.getUserAttemptActions([TEST_ID], USER_ID);
      expect(map.get(TEST_ID)?.action).toBe(UserAttemptAction.RETAKE);
      expect(map.get(TEST_ID)?.attemptSummary.attemptCount).toBe(2);
      expect(map.get(TEST_ID)?.attemptSummary.bestScore).toBe(9);
      expect(map.get(TEST_ID)?.attemptSummary.lastAttemptId).toBe(ATTEMPT_ID);
    });
  });
});
