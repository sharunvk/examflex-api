import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FullMockTestsService } from './full-mock-tests.service';
import { Exam } from '../exams/schemas/exam.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { Question } from '../mock-test-attempts/schemas/question.schema';
import { MockTest } from '../mock-tests/schemas/mock-test.schema';
import { FullMockTestDraft } from './schemas/full-mock-test-draft.schema';
import { RecommendationOffering } from '../recommendations/schemas/recommendation-offering.schema';
import { RecommendationKind } from '../recommendations/enums/recommendation-kind.enum';
import { FullMockSelectionService } from './full-mock-selection.service';
import { MockTestsService } from '../mock-tests/mock-tests.service';
import { ImageUrlResolver } from '../aws/s3/image-url.resolver';
import { AccessControlService } from '../access/access-control.service';
import { AccessDecisionReason } from '../common/enums/access-decision-reason.enum';
import { AccessMode } from '../common/enums/access-mode.enum';
import { UserAttemptAction } from '../common/enums/user-attempt-action.enum';

const EXAM_ID = '507f1f77bcf86cd799439011';
const SUB_ID = '507f1f77bcf86cd799439012';
const Q1 = '507f1f77bcf86cd799439013';
const Q2 = '507f1f77bcf86cd799439014';
const DRAFT_ID = '507f1f77bcf86cd799439015';
const USER_ID = '507f1f77bcf86cd799439016';
const TEST_ID = '507f1f77bcf86cd799439017';
const TOP_ID = '507f1f77bcf86cd799439018';
const OFF_A = '507f1f77bcf86cd7994390a1';
const OFF_B = '507f1f77bcf86cd7994390b2';
const OFF_C = '507f1f77bcf86cd7994390c3';
const OTHER_EXAM_ID = '507f1f77bcf86cd7994390e4';

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

function makeExam() {
  return {
    _id: new Types.ObjectId(EXAM_ID),
    name: 'CGL',
    description: 'tier',
    duration: 60,
    totalQuestions: 1,
    totalMarks: 2,
    isSessionWise: false,
    isActive: true,
    category: { name: 'SSC' },
    examGroup: { name: 'CGL' },
    subjects: [
      {
        subject: new Types.ObjectId(SUB_ID),
        numberOfQuestions: 1,
        marksPerQuestion: 2,
        hasNegativeMarking: true,
        negativeMarksPerQuestion: 0.5,
        sessionTime: 30,
        name: 'GS',
      },
    ],
  };
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(DRAFT_ID),
    id: DRAFT_ID,
    exam: new Types.ObjectId(EXAM_ID),
    status: 'REVIEW',
    examSnapshot: {
      name: 'CGL',
      description: 'd',
      duration: 60,
      totalQuestions: 1,
      totalMarks: 2,
      isSessionWise: false,
      subjects: [
        {
          subject: new Types.ObjectId(SUB_ID),
          name: 'GS',
          numberOfQuestions: 1,
          marksPerQuestion: 2,
          hasNegativeMarking: true,
          negativeMarksPerQuestion: 0.5,
          sessionTime: 30,
        },
      ],
    },
    questions: [
      {
        question: new Types.ObjectId(Q1),
        subject: new Types.ObjectId(SUB_ID),
        topic: new Types.ObjectId(TOP_ID),
        difficultyLevel: 'easy',
        position: 0,
        marksPerQuestion: 2,
        negativeMarking: 0.5,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function questionLean(id = Q1) {
  return {
    _id: { toString: () => id },
    questionText: { en: { text: 'Hello world' }, ml: { text: null } },
    optionType: 'text',
    options: [{ id: 'a', type: 'text', en: 'A', ml: null }],
    subject: { toString: () => SUB_ID },
    topic: { toString: () => TOP_ID },
    difficultyLevel: 'easy',
    isActive: true,
  };
}

describe('FullMockTestsService', () => {
  let service: FullMockTestsService;
  const examModel: any = {
    find: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
  };
  const subjectModel: any = { find: jest.fn() };
  const questionModel: any = {
    find: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
    updateMany: jest.fn(),
  };
  const mockTestModel: any = {
    find: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
  };
  const draftModel: any = {
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    countDocuments: jest.fn(),
  };
  const offeringModel: any = { find: jest.fn() };
  const realSelection = new FullMockSelectionService(
    null as any,
    null as any,
    null as any,
  );
  const selectionService = {
    generatePaper: jest.fn(),
    arrangePaperQuestions: jest.fn(
      (
        questions: Parameters<
          FullMockSelectionService['arrangePaperQuestions']
        >[0],
        subjects: Parameters<
          FullMockSelectionService['arrangePaperQuestions']
        >[1],
        isSessionWise: boolean,
      ) =>
        realSelection.arrangePaperQuestions(questions, subjects, isSessionWise),
    ),
  };
  const mockTestsService = { getUserAttemptActions: jest.fn() };
  const imageUrlResolver = {
    resolveMany: jest.fn().mockResolvedValue([null, null, null]),
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
        FullMockTestsService,
        { provide: getModelToken(Exam.name), useValue: examModel },
        { provide: getModelToken(Subject.name), useValue: subjectModel },
        { provide: getModelToken(Question.name), useValue: questionModel },
        { provide: getModelToken(MockTest.name), useValue: mockTestModel },
        {
          provide: getModelToken(RecommendationOffering.name),
          useValue: offeringModel,
        },
        {
          provide: getModelToken(FullMockTestDraft.name),
          useValue: draftModel,
        },
        { provide: FullMockSelectionService, useValue: selectionService },
        { provide: MockTestsService, useValue: mockTestsService },
        { provide: ImageUrlResolver, useValue: imageUrlResolver },
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    service = module.get(FullMockTestsService);
    jest.clearAllMocks();
    examModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });
    mockTestModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });
    questionModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });
    draftModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });
    draftModel.updateOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({}),
    });
    imageUrlResolver.resolveMany.mockResolvedValue([null, null, null]);
  });

  describe('listExamsForAdmin', () => {
    it('should list exams with subject names and search', async () => {
      const exam = makeExam();
      examModel.find.mockReturnValue(chainable([exam]));
      subjectModel.find.mockReturnValue(
        chainable([{ _id: { toString: () => SUB_ID }, name: 'GS' }]),
      );

      const result = await service.listExamsForAdmin(1, 10, 'CGL');
      expect(result.data[0].examName).toBe('CGL');
      expect(result.data[0].mode).toBe('Mixed');
      expect(result.data[0].subjects).toEqual(['GS']);
    });

    it('should skip subject lookup when none present', async () => {
      examModel.find.mockReturnValue(
        chainable([
          {
            ...makeExam(),
            subjects: [],
            duration: undefined,
            isSessionWise: true,
            examGroup: undefined,
          },
        ]),
      );

      const result = await service.listExamsForAdmin(0, 200);
      expect(result.pagination.limit).toBe(100);
      expect(result.data[0].mode).toBe('Session-wise');
      expect(subjectModel.find).not.toHaveBeenCalled();
    });

    it('uses default pagination arguments', async () => {
      examModel.find.mockReturnValue(chainable([]));
      const result = await service.listExamsForAdmin();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
    });
  });

  describe('createDraft / getDraft', () => {
    it('should reject invalid exam ids and inactive exams', async () => {
      await expect(
        service.createDraft({ examId: 'bad' }, USER_ID),
      ).rejects.toThrow(BadRequestException);

      examModel.findById.mockReturnValue(chainable({ isActive: false }));
      await expect(
        service.createDraft({ examId: EXAM_ID }, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create a draft from generated paper', async () => {
      examModel.findById.mockReturnValue(chainable(makeExam()));
      selectionService.generatePaper.mockResolvedValue({
        questions: makeDraft().questions,
        subjectNames: new Map([[SUB_ID, 'GS']]),
      });
      const draft = makeDraft();
      draftModel.create.mockResolvedValue(draft);
      questionModel.find.mockReturnValue(chainable([questionLean()]));

      const result = await service.createDraft({ examId: EXAM_ID }, USER_ID);
      expect(result.id).toBe(DRAFT_ID);
      expect(result.subjects[0].questions[0]._id).toBe(Q1);
    });

    it('should persist session-wise questions in exam subject order', async () => {
      const sub2 = '507f1f77bcf86cd799439019';
      const exam = {
        ...makeExam(),
        isSessionWise: true,
        totalQuestions: 2,
        subjects: [
          ...makeExam().subjects,
          {
            subject: new Types.ObjectId(sub2),
            numberOfQuestions: 1,
            marksPerQuestion: 1,
            hasNegativeMarking: false,
            negativeMarksPerQuestion: 0,
            sessionTime: 15,
            name: 'Math',
          },
        ],
      };
      examModel.findById.mockReturnValue(chainable(exam));
      selectionService.generatePaper.mockResolvedValue({
        questions: [
          {
            question: new Types.ObjectId(Q2),
            subject: new Types.ObjectId(sub2),
            topic: new Types.ObjectId(TOP_ID),
            difficultyLevel: 'easy',
            position: 0,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
          {
            question: new Types.ObjectId(Q1),
            subject: new Types.ObjectId(SUB_ID),
            topic: new Types.ObjectId(TOP_ID),
            difficultyLevel: 'easy',
            position: 1,
            marksPerQuestion: 2,
            negativeMarking: 0.5,
          },
        ],
        subjectNames: new Map([
          [SUB_ID, 'GS'],
          [sub2, 'Math'],
        ]),
      });
      draftModel.create.mockResolvedValue(makeDraft());
      questionModel.find.mockReturnValue(chainable([questionLean()]));

      await service.createDraft({ examId: EXAM_ID }, USER_ID);

      const stored = draftModel.create.mock.calls[0][0].questions;
      expect(
        stored.map((q: { question: Types.ObjectId }) => q.question.toString()),
      ).toEqual([Q1, Q2]);
      expect(stored[0].position).toBe(0);
      expect(stored[1].position).toBe(1);
      expect(selectionService.arrangePaperQuestions).toHaveBeenCalledWith(
        expect.any(Array),
        exam.subjects,
        true,
      );
    });

    it('should arrange mixed papers as a whole pack (not subject blocks)', async () => {
      const sub2 = '507f1f77bcf86cd799439019';
      const topicA = '507f1f77bcf86cd7994390a1';
      const topicB = '507f1f77bcf86cd7994390a2';
      const q3 = '507f1f77bcf86cd7994390a3';
      const q4 = '507f1f77bcf86cd7994390a4';
      const exam = {
        ...makeExam(),
        isSessionWise: false,
        totalQuestions: 4,
        subjects: [
          {
            subject: new Types.ObjectId(SUB_ID),
            numberOfQuestions: 2,
            marksPerQuestion: 1,
            hasNegativeMarking: false,
            negativeMarksPerQuestion: 0,
          },
          {
            subject: new Types.ObjectId(sub2),
            numberOfQuestions: 2,
            marksPerQuestion: 1,
            hasNegativeMarking: false,
            negativeMarksPerQuestion: 0,
          },
        ],
      };
      const clustered = [
        {
          question: new Types.ObjectId(Q1),
          subject: new Types.ObjectId(SUB_ID),
          topic: new Types.ObjectId(topicA),
          difficultyLevel: 'easy',
          position: 0,
          marksPerQuestion: 1,
          negativeMarking: 0,
        },
        {
          question: new Types.ObjectId(Q2),
          subject: new Types.ObjectId(SUB_ID),
          topic: new Types.ObjectId(topicA),
          difficultyLevel: 'easy',
          position: 1,
          marksPerQuestion: 1,
          negativeMarking: 0,
        },
        {
          question: new Types.ObjectId(q3),
          subject: new Types.ObjectId(sub2),
          topic: new Types.ObjectId(topicB),
          difficultyLevel: 'easy',
          position: 2,
          marksPerQuestion: 1,
          negativeMarking: 0,
        },
        {
          question: new Types.ObjectId(q4),
          subject: new Types.ObjectId(sub2),
          topic: new Types.ObjectId(topicB),
          difficultyLevel: 'easy',
          position: 3,
          marksPerQuestion: 1,
          negativeMarking: 0,
        },
      ];
      examModel.findById.mockReturnValue(chainable(exam));
      selectionService.generatePaper.mockResolvedValue({
        questions: clustered,
        subjectNames: new Map([
          [SUB_ID, 'GS'],
          [sub2, 'Math'],
        ]),
      });
      draftModel.create.mockResolvedValue(makeDraft());
      questionModel.find.mockReturnValue(chainable([questionLean()]));

      await service.createDraft({ examId: EXAM_ID }, USER_ID);

      const stored = draftModel.create.mock.calls[0][0].questions;
      expect(stored).toHaveLength(4);
      expect(selectionService.arrangePaperQuestions).toHaveBeenCalledWith(
        clustered,
        exam.subjects,
        false,
      );
      for (let i = 1; i < stored.length; i++) {
        expect(stored[i].topic.toString()).not.toBe(
          stored[i - 1].topic.toString(),
        );
      }
    });

    it('should load a draft', async () => {
      draftModel.findById.mockReturnValue(chainable(makeDraft()));
      questionModel.find.mockReturnValue(chainable([]));
      const result = await service.getDraft(DRAFT_ID);
      expect(result.status).toBe('REVIEW');
    });

    it('uses placeholder questions when documents are missing', async () => {
      draftModel.findById.mockReturnValue(chainable(makeDraft()));
      questionModel.find.mockReturnValue(chainable([]));
      const result = await service.getDraft(DRAFT_ID);
      expect(result.subjects[0].questions[0]._id).toBe(Q1);
      expect(result.subjects[0].questions[0].options).toEqual([]);
    });

    it('should 404 discarded drafts', async () => {
      draftModel.findById.mockReturnValue(
        chainable(makeDraft({ status: 'DISCARDED' })),
      );
      await expect(service.getDraft(DRAFT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('searchQuestions', () => {
    it('should validate ids', async () => {
      await expect(service.searchQuestions({ subjectId: 'x' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.searchQuestions({ subjectId: SUB_ID, topicId: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should search with filters and exclude draft questions', async () => {
      draftModel.findById.mockReturnValue(chainable(makeDraft()));
      questionModel.find.mockReturnValue(chainable([questionLean()]));

      const result = await service.searchQuestions({
        subjectId: SUB_ID,
        draftId: DRAFT_ID,
        search: 'Hello',
        topicId: TOP_ID,
        difficultyLevel: 'easy',
        page: 1,
        limit: 20,
      });
      expect(result.data[0].snippet).toBe('Hello world');
      const query = questionModel.find.mock.calls[0][0];
      expect(query.subject.toString()).toBe(SUB_ID);
      expect(query.exams.toString()).toBe(EXAM_ID);
      expect(query.topic.toString()).toBe(TOP_ID);
      expect(query.difficultyLevel).toBe('easy');
      expect(query._id.$nin.map((id: Types.ObjectId) => id.toString())).toEqual(
        [Q1],
      );
    });

    it('should not filter by exam when draftId is omitted', async () => {
      questionModel.find.mockReturnValue(chainable([questionLean()]));

      await service.searchQuestions({ subjectId: SUB_ID });

      expect(questionModel.find).toHaveBeenCalledWith(
        expect.not.objectContaining({ exams: expect.anything() }),
      );
      expect(questionModel.find.mock.calls[0][0].exams).toBeUndefined();
    });

    it('should require draftId when allowCrossSubject is true', async () => {
      await expect(
        service.searchQuestions({ allowCrossSubject: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should search all exam-tagged questions when allowCrossSubject omits subjectId', async () => {
      draftModel.findById.mockReturnValue(chainable(makeDraft()));
      questionModel.find.mockReturnValue(chainable([questionLean()]));

      await service.searchQuestions({
        draftId: DRAFT_ID,
        allowCrossSubject: true,
      });

      const query = questionModel.find.mock.calls[0][0];
      expect(query.exams.toString()).toBe(EXAM_ID);
      expect(query.subject).toBeUndefined();
    });
  });

  describe('replaceQuestion', () => {
    it('should reject non-review drafts and missing slots', async () => {
      draftModel.findById.mockReturnValue(
        chainable(makeDraft({ status: 'PUBLISHED' })),
      );
      await expect(service.replaceQuestion(DRAFT_ID, 0, Q2)).rejects.toThrow(
        BadRequestException,
      );

      draftModel.findById.mockReturnValue(chainable(makeDraft()));
      await expect(service.replaceQuestion(DRAFT_ID, 9, Q2)).rejects.toThrow(
        /No question at position/,
      );
    });

    it('should reject ineligible, mismatched, and duplicate questions', async () => {
      draftModel.findById.mockReturnValue(chainable(makeDraft()));
      await expect(service.replaceQuestion(DRAFT_ID, 0, 'bad')).rejects.toThrow(
        BadRequestException,
      );

      questionModel.findById.mockReturnValue(chainable(null));
      await expect(service.replaceQuestion(DRAFT_ID, 0, Q2)).rejects.toThrow(
        BadRequestException,
      );

      questionModel.findById.mockReturnValue(
        chainable({
          _id: new Types.ObjectId(Q2),
          isActive: true,
          difficultyLevel: 'easy',
          subject: new Types.ObjectId(EXAM_ID),
        }),
      );
      await expect(service.replaceQuestion(DRAFT_ID, 0, Q2)).rejects.toThrow(
        BadRequestException,
      );

      questionModel.findById.mockReturnValue(
        chainable({
          _id: new Types.ObjectId(Q1),
          isActive: true,
          difficultyLevel: 'easy',
          subject: new Types.ObjectId(SUB_ID),
          topic: new Types.ObjectId(TOP_ID),
          exams: [new Types.ObjectId(EXAM_ID)],
        }),
      );
      const withDup = makeDraft({
        questions: [
          {
            question: new Types.ObjectId(Q1),
            subject: new Types.ObjectId(SUB_ID),
            position: 0,
          },
          {
            question: new Types.ObjectId(Q2),
            subject: new Types.ObjectId(SUB_ID),
            position: 1,
          },
        ],
      });
      draftModel.findById.mockReturnValue(chainable(withDup));
      await expect(service.replaceQuestion(DRAFT_ID, 1, Q1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject questions that are not tagged to the draft exam', async () => {
      draftModel.findById.mockReturnValue(chainable(makeDraft()));
      questionModel.findById.mockReturnValue(
        chainable({
          _id: new Types.ObjectId(Q2),
          isActive: true,
          difficultyLevel: 'easy',
          subject: new Types.ObjectId(SUB_ID),
          topic: new Types.ObjectId(TOP_ID),
          exams: [new Types.ObjectId(Q2)],
        }),
      );

      await expect(service.replaceQuestion(DRAFT_ID, 0, Q2)).rejects.toThrow(
        BadRequestException,
      );
      try {
        await service.replaceQuestion(DRAFT_ID, 0, Q2);
      } catch (error) {
        expect((error as BadRequestException).getResponse()).toMatchObject({
          error: 'EXAM_MISMATCH',
        });
      }
    });

    it('should replace a question', async () => {
      const draft = makeDraft();
      draftModel.findById.mockReturnValue(chainable(draft));
      questionModel.findById.mockReturnValue(
        chainable({
          _id: new Types.ObjectId(Q2),
          isActive: true,
          difficultyLevel: 'hard',
          subject: new Types.ObjectId(SUB_ID),
          topic: new Types.ObjectId(TOP_ID),
          exams: [new Types.ObjectId(EXAM_ID)],
        }),
      );
      questionModel.find.mockReturnValue(chainable([questionLean(Q2)]));

      const result = await service.replaceQuestion(DRAFT_ID, 0, Q2);
      expect(draft.save).toHaveBeenCalled();
      expect(result.id).toBe(DRAFT_ID);
    });

    it('should reject a different subject unless allowCrossSubject is set', async () => {
      const otherSubject = '507f1f77bcf86cd799439099';
      draftModel.findById.mockReturnValue(chainable(makeDraft()));
      questionModel.findById.mockReturnValue(
        chainable({
          _id: new Types.ObjectId(Q2),
          isActive: true,
          difficultyLevel: 'easy',
          subject: new Types.ObjectId(otherSubject),
          topic: new Types.ObjectId(TOP_ID),
          exams: [new Types.ObjectId(EXAM_ID)],
        }),
      );

      await expect(service.replaceQuestion(DRAFT_ID, 0, Q2)).rejects.toThrow(
        BadRequestException,
      );
      try {
        await service.replaceQuestion(DRAFT_ID, 0, Q2);
      } catch (error) {
        expect((error as BadRequestException).getResponse()).toMatchObject({
          error: 'SUBJECT_MISMATCH',
        });
      }
    });

    it('should replace a cross-subject question without changing the slot subject', async () => {
      const otherSubject = '507f1f77bcf86cd799439099';
      const draft = makeDraft();
      const originalSubject = draft.questions[0].subject.toString();
      draftModel.findById.mockReturnValue(chainable(draft));
      questionModel.findById.mockReturnValue(
        chainable({
          _id: new Types.ObjectId(Q2),
          isActive: true,
          difficultyLevel: 'medium',
          subject: new Types.ObjectId(otherSubject),
          topic: new Types.ObjectId(TOP_ID),
          exams: [new Types.ObjectId(EXAM_ID)],
        }),
      );
      questionModel.find.mockReturnValue(chainable([questionLean(Q2)]));

      await service.replaceQuestion(DRAFT_ID, 0, Q2, true);
      expect(draft.save).toHaveBeenCalled();
      expect(draft.questions[0].subject.toString()).toBe(originalSubject);
      expect(draft.questions[0].question.toString()).toBe(Q2);
    });
  });

  describe('publishDraft', () => {
    it('should reject invalid ids and non-review drafts', async () => {
      await expect(service.publishDraft('bad', {}, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      draftModel.findOneAndUpdate.mockResolvedValue(null);
      await expect(service.publishDraft(DRAFT_ID, {}, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should roll back status when finalize fails', async () => {
      const draft = makeDraft({
        examSnapshot: {
          ...makeDraft().examSnapshot,
          totalQuestions: 9,
        },
      });
      draftModel.findOneAndUpdate.mockResolvedValue(draft);

      await expect(service.publishDraft(DRAFT_ID, {}, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(draftModel.updateOne).toHaveBeenCalled();
    });

    it('should publish a complete paper', async () => {
      const draft = makeDraft();
      draftModel.findOneAndUpdate.mockResolvedValue(draft);
      questionModel.find.mockReturnValue(
        chainable([{ _id: { toString: () => Q1 } }]),
      );
      mockTestModel.create.mockResolvedValue({
        id: TEST_ID,
        _id: new Types.ObjectId(TEST_ID),
      });
      questionModel.updateMany.mockResolvedValue({});
      questionModel.find.mockReturnValue(chainable([questionLean()]));

      const result = await service.publishDraft(
        DRAFT_ID,
        { title: 'Paper 1', passingScore: 1 },
        USER_ID,
      );
      expect(result.mockTestId).toBe(TEST_ID);
      expect(draft.status).toBe('PUBLISHED');
    });

    it('should regroup interleaved questions into contiguous subject blocks for session-wise', async () => {
      const sub2 = '507f1f77bcf86cd799439019';
      const draft = makeDraft({
        examSnapshot: {
          name: 'CGL',
          description: 'd',
          duration: 60,
          totalQuestions: 2,
          totalMarks: 3,
          isSessionWise: true,
          subjects: [
            {
              subject: new Types.ObjectId(SUB_ID),
              name: 'GS',
              numberOfQuestions: 1,
              marksPerQuestion: 2,
              hasNegativeMarking: true,
              negativeMarksPerQuestion: 0.5,
              sessionTime: 15,
            },
            {
              subject: new Types.ObjectId(sub2),
              name: 'Math',
              numberOfQuestions: 1,
              marksPerQuestion: 1,
              hasNegativeMarking: false,
              negativeMarksPerQuestion: 0,
              sessionTime: 15,
            },
          ],
        },
        questions: [
          {
            question: new Types.ObjectId(Q2),
            subject: new Types.ObjectId(sub2),
            topic: new Types.ObjectId(TOP_ID),
            difficultyLevel: 'easy',
            position: 0,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
          {
            question: new Types.ObjectId(Q1),
            subject: new Types.ObjectId(SUB_ID),
            topic: new Types.ObjectId(TOP_ID),
            difficultyLevel: 'easy',
            position: 1,
            marksPerQuestion: 2,
            negativeMarking: 0.5,
          },
        ],
      });
      draftModel.findOneAndUpdate.mockResolvedValue(draft);
      questionModel.find.mockReturnValue(
        chainable([questionLean(Q1), questionLean(Q2)]),
      );
      mockTestModel.create.mockResolvedValue({
        id: TEST_ID,
        _id: new Types.ObjectId(TEST_ID),
      });
      questionModel.updateMany.mockResolvedValue({});

      await service.publishDraft(DRAFT_ID, { title: 'Paper 1' }, USER_ID);

      const payload = mockTestModel.create.mock.calls[0][0];
      expect(
        payload.questionIds.map((id: Types.ObjectId) => id.toString()),
      ).toEqual([Q1, Q2]);
      expect(payload.subjectConfig[0].questionStartIndex).toBe(0);
      expect(payload.subjectConfig[0].questionEndIndex).toBe(0);
      expect(payload.subjectConfig[1].questionStartIndex).toBe(1);
      expect(payload.subjectConfig[1].questionEndIndex).toBe(1);
      expect(
        payload.subjectConfig[0].questionIds.map((id: Types.ObjectId) =>
          id.toString(),
        ),
      ).toEqual([Q1]);
      expect(
        payload.subjectConfig[1].questionIds.map((id: Types.ObjectId) =>
          id.toString(),
        ),
      ).toEqual([Q2]);
    });

    it('should keep mixed draft order on publish (no subject regroup)', async () => {
      const sub2 = '507f1f77bcf86cd799439019';
      const draft = makeDraft({
        examSnapshot: {
          name: 'CGL',
          description: 'd',
          duration: 60,
          totalQuestions: 2,
          totalMarks: 3,
          isSessionWise: false,
          subjects: [
            {
              subject: new Types.ObjectId(SUB_ID),
              name: 'GS',
              numberOfQuestions: 1,
              marksPerQuestion: 2,
              hasNegativeMarking: true,
              negativeMarksPerQuestion: 0.5,
            },
            {
              subject: new Types.ObjectId(sub2),
              name: 'Math',
              numberOfQuestions: 1,
              marksPerQuestion: 1,
              hasNegativeMarking: false,
              negativeMarksPerQuestion: 0,
            },
          ],
        },
        questions: [
          {
            question: new Types.ObjectId(Q2),
            subject: new Types.ObjectId(sub2),
            topic: new Types.ObjectId(TOP_ID),
            difficultyLevel: 'easy',
            position: 0,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
          {
            question: new Types.ObjectId(Q1),
            subject: new Types.ObjectId(SUB_ID),
            topic: new Types.ObjectId(TOP_ID),
            difficultyLevel: 'medium',
            position: 1,
            marksPerQuestion: 2,
            negativeMarking: 0.5,
          },
        ],
      });
      draftModel.findOneAndUpdate.mockResolvedValue(draft);
      questionModel.find.mockReturnValue(
        chainable([questionLean(Q1), questionLean(Q2)]),
      );
      mockTestModel.create.mockResolvedValue({
        id: TEST_ID,
        _id: new Types.ObjectId(TEST_ID),
      });
      questionModel.updateMany.mockResolvedValue({});

      await service.publishDraft(DRAFT_ID, { title: 'Paper 1' }, USER_ID);

      const payload = mockTestModel.create.mock.calls[0][0];
      expect(
        payload.questionIds.map((id: Types.ObjectId) => id.toString()),
      ).toEqual([Q2, Q1]);
      expect(payload.isSessionWise).toBe(false);
    });

    it('should keep mixed draft order when keepSubjectOrder is false', async () => {
      const sub2 = '507f1f77bcf86cd799439019';
      const draft = makeDraft({
        examSnapshot: {
          name: 'NTPC',
          description: 'd',
          duration: 90,
          totalQuestions: 3,
          isSessionWise: false,
          subjects: [
            {
              subject: new Types.ObjectId(SUB_ID),
              name: 'Maths',
              numberOfQuestions: 1,
              marksPerQuestion: 1,
              hasNegativeMarking: false,
              negativeMarksPerQuestion: 0,
            },
            {
              subject: new Types.ObjectId(sub2),
              name: 'Reasoning',
              numberOfQuestions: 2,
              marksPerQuestion: 1,
              hasNegativeMarking: false,
              negativeMarksPerQuestion: 0,
            },
          ],
        },
        questions: [
          {
            question: new Types.ObjectId(Q2),
            subject: new Types.ObjectId(sub2),
            difficultyLevel: 'easy',
            position: 0,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
          {
            question: new Types.ObjectId(Q1),
            subject: new Types.ObjectId(SUB_ID),
            difficultyLevel: 'easy',
            position: 1,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
          {
            question: new Types.ObjectId('507f1f77bcf86cd799439031'),
            subject: new Types.ObjectId(sub2),
            difficultyLevel: 'medium',
            position: 2,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
        ],
      });
      draftModel.findOneAndUpdate.mockResolvedValue(draft);
      questionModel.find.mockReturnValue(
        chainable([
          questionLean(Q1),
          questionLean(Q2),
          questionLean('507f1f77bcf86cd799439031'),
        ]),
      );
      mockTestModel.create.mockResolvedValue({
        id: TEST_ID,
        _id: new Types.ObjectId(TEST_ID),
      });
      questionModel.updateMany.mockResolvedValue({});

      await service.publishDraft(
        DRAFT_ID,
        { keepSubjectOrder: false },
        USER_ID,
      );

      const payload = mockTestModel.create.mock.calls[0][0];
      expect(
        payload.questionIds.map((id: Types.ObjectId) => id.toString()),
      ).toEqual([Q2, Q1, '507f1f77bcf86cd799439031']);
    });

    it('should group a mixed paper into exam subject blocks when keepSubjectOrder is true', async () => {
      const reasoningId = '507f1f77bcf86cd799439019';
      const gaId = '507f1f77bcf86cd79943901a';
      const mathA = Q1;
      const mathB = '507f1f77bcf86cd799439032';
      const reasonA = Q2;
      const reasonB = '507f1f77bcf86cd799439033';
      const gaA = '507f1f77bcf86cd799439034';
      const draft = makeDraft({
        examSnapshot: {
          name: 'NTPC CBT 1',
          description: 'd',
          duration: 90,
          totalQuestions: 5,
          isSessionWise: false,
          subjects: [
            {
              subject: new Types.ObjectId(SUB_ID),
              name: 'Maths',
              numberOfQuestions: 2,
              marksPerQuestion: 1,
              hasNegativeMarking: false,
              negativeMarksPerQuestion: 0,
            },
            {
              subject: new Types.ObjectId(reasoningId),
              name: 'Reasoning',
              numberOfQuestions: 2,
              marksPerQuestion: 1,
              hasNegativeMarking: false,
              negativeMarksPerQuestion: 0,
            },
            {
              subject: new Types.ObjectId(gaId),
              name: 'General Awareness',
              numberOfQuestions: 1,
              marksPerQuestion: 1,
              hasNegativeMarking: false,
              negativeMarksPerQuestion: 0,
            },
          ],
        },
        questions: [
          {
            question: new Types.ObjectId(gaA),
            subject: new Types.ObjectId(gaId),
            difficultyLevel: 'easy',
            position: 0,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
          {
            question: new Types.ObjectId(mathB),
            subject: new Types.ObjectId(SUB_ID),
            difficultyLevel: 'hard',
            position: 1,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
          {
            question: new Types.ObjectId(reasonA),
            subject: new Types.ObjectId(reasoningId),
            difficultyLevel: 'medium',
            position: 2,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
          {
            question: new Types.ObjectId(mathA),
            subject: new Types.ObjectId(SUB_ID),
            difficultyLevel: 'easy',
            position: 3,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
          {
            question: new Types.ObjectId(reasonB),
            subject: new Types.ObjectId(reasoningId),
            difficultyLevel: 'easy',
            position: 4,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
        ],
      });
      draftModel.findOneAndUpdate.mockResolvedValue(draft);
      questionModel.find.mockReturnValue(
        chainable([
          questionLean(mathA),
          questionLean(mathB),
          questionLean(reasonA),
          questionLean(reasonB),
          questionLean(gaA),
        ]),
      );
      mockTestModel.create.mockResolvedValue({
        id: TEST_ID,
        _id: new Types.ObjectId(TEST_ID),
      });
      questionModel.updateMany.mockResolvedValue({});

      await service.publishDraft(DRAFT_ID, { keepSubjectOrder: true }, USER_ID);

      const payload = mockTestModel.create.mock.calls[0][0];
      expect(
        payload.questionIds.map((id: Types.ObjectId) => id.toString()),
      ).toEqual([mathB, mathA, reasonA, reasonB, gaA]);
      expect(payload.subjectConfig).toEqual([
        expect.objectContaining({
          name: 'Maths',
          questionStartIndex: 0,
          questionEndIndex: 1,
        }),
        expect.objectContaining({
          name: 'Reasoning',
          questionStartIndex: 2,
          questionEndIndex: 3,
        }),
        expect.objectContaining({
          name: 'General Awareness',
          questionStartIndex: 4,
          questionEndIndex: 4,
        }),
      ]);
      expect(
        payload.subjectConfig[0].questionIds.map((id: Types.ObjectId) =>
          id.toString(),
        ),
      ).toEqual([mathB, mathA]);
      expect(payload.isSessionWise).toBe(false);
    });

    it('should still regroup session-wise papers when keepSubjectOrder is false', async () => {
      const sub2 = '507f1f77bcf86cd799439019';
      const draft = makeDraft({
        examSnapshot: {
          name: 'CGL',
          description: 'd',
          duration: 60,
          totalQuestions: 2,
          totalMarks: 3,
          isSessionWise: true,
          subjects: [
            {
              subject: new Types.ObjectId(SUB_ID),
              name: 'GS',
              numberOfQuestions: 1,
              marksPerQuestion: 2,
              hasNegativeMarking: true,
              negativeMarksPerQuestion: 0.5,
              sessionTime: 15,
            },
            {
              subject: new Types.ObjectId(sub2),
              name: 'Math',
              numberOfQuestions: 1,
              marksPerQuestion: 1,
              hasNegativeMarking: false,
              negativeMarksPerQuestion: 0,
              sessionTime: 15,
            },
          ],
        },
        questions: [
          {
            question: new Types.ObjectId(Q2),
            subject: new Types.ObjectId(sub2),
            difficultyLevel: 'easy',
            position: 0,
            marksPerQuestion: 1,
            negativeMarking: 0,
          },
          {
            question: new Types.ObjectId(Q1),
            subject: new Types.ObjectId(SUB_ID),
            difficultyLevel: 'easy',
            position: 1,
            marksPerQuestion: 2,
            negativeMarking: 0.5,
          },
        ],
      });
      draftModel.findOneAndUpdate.mockResolvedValue(draft);
      questionModel.find.mockReturnValue(
        chainable([questionLean(Q1), questionLean(Q2)]),
      );
      mockTestModel.create.mockResolvedValue({
        id: TEST_ID,
        _id: new Types.ObjectId(TEST_ID),
      });
      questionModel.updateMany.mockResolvedValue({});

      await service.publishDraft(
        DRAFT_ID,
        { keepSubjectOrder: false },
        USER_ID,
      );

      const payload = mockTestModel.create.mock.calls[0][0];
      expect(
        payload.questionIds.map((id: Types.ObjectId) => id.toString()),
      ).toEqual([Q1, Q2]);
      expect(payload.isSessionWise).toBe(true);
    });

    it('should keep question ids when grouping mongoose-like subdocuments', async () => {
      const asSubdoc = (plain: Record<string, unknown>) => {
        const doc: Record<string, unknown> = {};
        Object.defineProperties(doc, {
          question: { value: plain.question, enumerable: false },
          subject: { value: plain.subject, enumerable: false },
          topic: { value: plain.topic, enumerable: false },
          difficultyLevel: { value: plain.difficultyLevel, enumerable: false },
          position: { value: plain.position, enumerable: false },
          marksPerQuestion: {
            value: plain.marksPerQuestion,
            enumerable: false,
          },
          negativeMarking: { value: plain.negativeMarking, enumerable: false },
        });
        return doc;
      };
      const draft = makeDraft({
        questions: [
          asSubdoc({
            question: new Types.ObjectId(Q1),
            subject: new Types.ObjectId(SUB_ID),
            topic: new Types.ObjectId(TOP_ID),
            difficultyLevel: 'easy',
            position: 0,
            marksPerQuestion: 2,
            negativeMarking: 0.5,
          }),
        ],
      });
      draftModel.findOneAndUpdate.mockResolvedValue(draft);
      questionModel.find.mockReturnValue(chainable([questionLean(Q1)]));
      mockTestModel.create.mockResolvedValue({
        id: TEST_ID,
        _id: new Types.ObjectId(TEST_ID),
      });
      questionModel.updateMany.mockResolvedValue({});

      const result = await service.publishDraft(DRAFT_ID, {}, USER_ID);
      expect(result.mockTestId).toBe(TEST_ID);
      const payload = mockTestModel.create.mock.calls[0][0];
      expect(
        payload.questionIds.map((id: Types.ObjectId) => id.toString()),
      ).toEqual([Q1]);
    });

    it('should reject ineligible questions', async () => {
      const draft = makeDraft();
      draftModel.findOneAndUpdate.mockResolvedValue(draft);
      questionModel.find.mockReturnValue(chainable([]));

      await expect(service.publishDraft(DRAFT_ID, {}, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject an empty question list', async () => {
      const draft = makeDraft({ questions: [] });
      draftModel.findOneAndUpdate.mockResolvedValue(draft);
      await expect(service.publishDraft(DRAFT_ID, {}, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('discardDraft', () => {
    it('should discard review drafts only', async () => {
      const draft = makeDraft();
      draftModel.findById.mockReturnValue(chainable(draft));
      await service.discardDraft(DRAFT_ID);
      expect(draft.status).toBe('DISCARDED');

      draftModel.findById.mockReturnValue(
        chainable(makeDraft({ status: 'PUBLISHED' })),
      );
      await expect(service.discardDraft(DRAFT_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('listDrafts', () => {
    it('should reject invalid exam ids and list open drafts', async () => {
      await expect(service.listDrafts('bad')).rejects.toThrow(
        BadRequestException,
      );

      const draft = makeDraft();
      draftModel.find.mockReturnValue(chainable([draft]));
      draftModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      });

      const result = await service.listDrafts(EXAM_ID, 1, 10);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: DRAFT_ID,
        examId: EXAM_ID,
        examName: 'CGL',
        status: 'REVIEW',
        totalQuestions: 1,
        isSessionWise: false,
      });
      expect(result.pagination.total).toBe(1);
    });

    it('lists drafts without exam filter using defaults', async () => {
      draftModel.find.mockReturnValue(chainable([]));
      draftModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });
      const result = await service.listDrafts();
      expect(result.data).toEqual([]);
      expect(draftModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: { $in: ['REVIEW', 'GENERATING', 'PUBLISHING'] },
        }),
      );
    });
  });

  describe('listPublished / findOnePublished', () => {
    const published = {
      id: TEST_ID,
      _id: { toString: () => TEST_ID },
      title: 'Full',
      description: 'd',
      totalQuestions: 1,
      durationInMinutes: 60,
      totalMarks: 2,
      isSessionWise: false,
      exam: {
        _id: { toString: () => EXAM_ID },
        name: 'CGL',
        description: 'd',
        toString: () => EXAM_ID,
      },
      questionIds: [{ toString: () => Q1 }],
      subjectConfig: [
        {
          subject: { toString: () => SUB_ID },
          name: 'GS',
          numberOfQuestions: 1,
          marksPerQuestion: 2,
          hasNegativeMarking: true,
          negativeMarksPerQuestion: 0.5,
          sessionTime: 30,
          questionStartIndex: 0,
          questionEndIndex: 0,
          questionIds: [{ toString: () => Q1 }],
        },
      ],
      marksPerQuestion: 2,
      negativeMarking: 0.5,
      passingScore: 1,
      allowRetake: true,
      shuffleOptions: false,
      showResultsImmediately: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should reject invalid exam ids and list papers', async () => {
      await expect(service.listPublished('bad')).rejects.toThrow(
        BadRequestException,
      );
      const query = chainable([published]);
      mockTestModel.find.mockReturnValue(query);
      mockTestsService.getUserAttemptActions.mockResolvedValue(
        new Map([
          [
            TEST_ID,
            {
              action: UserAttemptAction.RESUME,
              resumeAttemptId: 'a1',
              attemptSummary: {
                status: 'IN_PROGRESS',
                activeAttemptId: 'a1',
                answeredCount: 3,
                timeRemainingSeconds: 100,
                attemptCount: 0,
              },
            },
          ],
        ]),
      );

      const result = await service.listPublished(
        EXAM_ID,
        1,
        10,
        USER_ID,
        false,
      );
      expect(result.data[0].userAttemptAction).toBe(UserAttemptAction.RESUME);
      expect(result.data[0].attemptSummary).toMatchObject({
        status: 'IN_PROGRESS',
        answeredCount: 3,
      });
      expect(query.sort).toHaveBeenCalledWith({
        accessMode: -1,
        createdAt: 1,
      });
    });

    it('should find one published paper', async () => {
      await expect(service.findOnePublished('bad')).rejects.toThrow(
        BadRequestException,
      );
      mockTestModel.findOne.mockReturnValue(chainable(null));
      await expect(service.findOnePublished(TEST_ID)).rejects.toThrow(
        NotFoundException,
      );

      mockTestModel.findOne.mockReturnValue(chainable(published));
      mockTestsService.getUserAttemptActions.mockResolvedValue(new Map());
      const result = await service.findOnePublished(TEST_ID, USER_ID);
      expect(result.id).toBe(TEST_ID);
      expect(result.subjects).toBeUndefined();
    });

    it('includes safe question subjects for admin detail', async () => {
      mockTestModel.findOne.mockReturnValue(chainable(published));
      mockTestsService.getUserAttemptActions.mockResolvedValue(new Map());
      questionModel.find.mockReturnValue(chainable([questionLean(Q1)]));

      const result = await service.findOnePublished(TEST_ID, USER_ID, true);
      expect(result.subjects).toHaveLength(1);
      expect(result.subjects![0]).toMatchObject({
        subjectId: SUB_ID,
        name: 'GS',
        numberOfQuestions: 1,
      });
      expect(result.subjects![0].questions[0]).toMatchObject({
        _id: Q1,
        position: 0,
        marksPerQuestion: 2,
        negativeMarking: 0.5,
      });
      expect(result.subjects![0].questions[0]).not.toHaveProperty(
        'correctAnswer',
      );
    });

    it('uses real paper positions for interleaved mixed subjects (not startIndex+offset)', async () => {
      const subB = '507f1f77bcf86cd799439019';
      const q3 = '507f1f77bcf86cd79943901a';
      const q4 = '507f1f77bcf86cd79943901b';
      // Paper order: A, B, A, B — overlapping min/max ranges like a real mixed publish.
      const interleaved = {
        ...published,
        totalQuestions: 4,
        questionIds: [
          { toString: () => Q1 },
          { toString: () => Q2 },
          { toString: () => q3 },
          { toString: () => q4 },
        ],
        subjectConfig: [
          {
            subject: { toString: () => SUB_ID },
            name: 'DATA INTERPRETATION',
            numberOfQuestions: 2,
            marksPerQuestion: 1,
            hasNegativeMarking: true,
            negativeMarksPerQuestion: 0.33,
            questionStartIndex: 0,
            questionEndIndex: 2,
            questionIds: [{ toString: () => Q1 }, { toString: () => q3 }],
          },
          {
            subject: { toString: () => subB },
            name: 'GENERAL INTELLIGENCE AND REASONING',
            numberOfQuestions: 2,
            marksPerQuestion: 1,
            hasNegativeMarking: true,
            negativeMarksPerQuestion: 0.33,
            questionStartIndex: 1,
            questionEndIndex: 3,
            questionIds: [{ toString: () => Q2 }, { toString: () => q4 }],
          },
        ],
      };

      mockTestModel.findOne.mockReturnValue(chainable(interleaved));
      mockTestsService.getUserAttemptActions.mockResolvedValue(new Map());
      questionModel.find.mockReturnValue(
        chainable([
          questionLean(Q1),
          questionLean(Q2),
          questionLean(q3),
          questionLean(q4),
        ]),
      );

      const result = await service.findOnePublished(TEST_ID, USER_ID, true);
      expect(result.subjects).toHaveLength(2);

      const di = result.subjects!.find(s => s.name === 'DATA INTERPRETATION')!;
      const gir = result.subjects!.find(
        s => s.name === 'GENERAL INTELLIGENCE AND REASONING',
      )!;

      // Real paper slots — not contiguous 0,1 / 1,2 from startIndex+offset.
      expect(di.questions.map(q => q.position)).toEqual([0, 2]);
      expect(gir.questions.map(q => q.position)).toEqual([1, 3]);
      expect(di.questions.map(q => q._id)).toEqual([Q1, q3]);
      expect(gir.questions.map(q => q._id)).toEqual([Q2, q4]);

      const allPositions = [...di.questions, ...gir.questions].map(
        q => q.position,
      );
      expect(new Set(allPositions).size).toBe(allPositions.length);
    });

    it('lists and loads papers without a user id', async () => {
      mockTestModel.find.mockReturnValue(chainable([published]));
      const listed = await service.listPublished(undefined);
      expect(listed.data[0].userAttemptAction).toBe(UserAttemptAction.START);
      expect(mockTestsService.getUserAttemptActions).not.toHaveBeenCalled();

      mockTestModel.findOne.mockReturnValue(chainable(published));
      const one = await service.findOnePublished(TEST_ID);
      expect(one.id).toBe(TEST_ID);
    });
  });

  describe('course cut-offs', () => {
    const offering = (id: string, overrides: Record<string, unknown> = {}) => ({
      _id: new Types.ObjectId(id),
      kind: RecommendationKind.COURSE,
      isActive: true,
      exam: new Types.ObjectId(EXAM_ID),
      ...overrides,
    });

    const arrange = () => {
      const draft = makeDraft();
      draftModel.findOneAndUpdate.mockResolvedValue(draft);
      questionModel.find.mockReturnValue(chainable([questionLean()]));
      mockTestModel.create.mockResolvedValue({
        id: TEST_ID,
        _id: new Types.ObjectId(TEST_ID),
      });
      questionModel.updateMany.mockResolvedValue({});
      return draft;
    };

    const expectCode = async (promise: Promise<unknown>, code: string) => {
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toMatchObject({
        response: { error: code },
      });
    };

    describe('publish', () => {
      it('persists the cut-offs on the created full mock', async () => {
        arrange();
        offeringModel.find.mockReturnValue(
          chainable([offering(OFF_A), offering(OFF_B)]),
        );

        await service.publishDraft(
          DRAFT_ID,
          {
            courseCutoffs: [
              { offeringId: OFF_A, cutoffMarks: 1.5 },
              { offeringId: OFF_B, cutoffMarks: 2 },
            ],
          },
          USER_ID,
        );

        const payload = mockTestModel.create.mock.calls[0][0];
        expect(payload.courseCutoffs).toEqual([
          { offering: new Types.ObjectId(OFF_A), cutoffMarks: 1.5 },
          { offering: new Types.ObjectId(OFF_B), cutoffMarks: 2 },
        ]);
      });

      it('leaves courseCutoffs off the document when none are sent', async () => {
        arrange();
        await service.publishDraft(DRAFT_ID, { title: 'Plain' }, USER_ID);
        const payload = mockTestModel.create.mock.calls[0][0];
        expect(payload).not.toHaveProperty('courseCutoffs');
        expect(offeringModel.find).not.toHaveBeenCalled();

        mockTestModel.create.mockClear();
        arrange();
        await service.publishDraft(DRAFT_ID, { courseCutoffs: [] }, USER_ID);
        expect(mockTestModel.create.mock.calls[0][0]).not.toHaveProperty(
          'courseCutoffs',
        );
      });

      it('derives the allowed maximum from the subjects when totalMarks is missing', async () => {
        const draft = arrange();
        draft.examSnapshot.totalMarks = undefined as unknown as number;
        offeringModel.find.mockReturnValue(chainable([offering(OFF_A)]));

        await service.publishDraft(
          DRAFT_ID,
          { courseCutoffs: [{ offeringId: OFF_A, cutoffMarks: 2 }] },
          USER_ID,
        ); // 1 question x 2 marks = 2

        expect(mockTestModel.create).toHaveBeenCalled();
      });

      it.each([
        [
          'an unknown course',
          () => offeringModel.find.mockReturnValue(chainable([])),
          1,
          'COURSE_NOT_FOUND',
        ],
        [
          'a course of a different exam',
          () =>
            offeringModel.find.mockReturnValue(
              chainable([
                offering(OFF_A, { exam: new Types.ObjectId(OTHER_EXAM_ID) }),
              ]),
            ),
          1,
          'COURSE_NOT_ELIGIBLE',
        ],
        [
          'an inactive course',
          () =>
            offeringModel.find.mockReturnValue(
              chainable([offering(OFF_A, { isActive: false })]),
            ),
          1,
          'COURSE_NOT_ELIGIBLE',
        ],
        [
          'an INSTITUTION offering',
          () =>
            offeringModel.find.mockReturnValue(
              chainable([
                offering(OFF_A, { kind: RecommendationKind.INSTITUTION }),
              ]),
            ),
          1,
          'COURSE_NOT_ELIGIBLE',
        ],
        [
          'a cut-off above the paper total',
          () =>
            offeringModel.find.mockReturnValue(chainable([offering(OFF_A)])),
          2.01,
          'CUTOFF_OUT_OF_RANGE',
        ],
        [
          'a non-positive cut-off',
          () =>
            offeringModel.find.mockReturnValue(chainable([offering(OFF_A)])),
          0,
          'CUTOFF_OUT_OF_RANGE',
        ],
      ])(
        'rejects %s and rolls the draft back',
        async (_label, setup, marks, code) => {
          arrange();
          setup();
          await expectCode(
            service.publishDraft(
              DRAFT_ID,
              { courseCutoffs: [{ offeringId: OFF_A, cutoffMarks: marks }] },
              USER_ID,
            ),
            code,
          );
          expect(mockTestModel.create).not.toHaveBeenCalled();
          expect(questionModel.updateMany).not.toHaveBeenCalled();
          expect(draftModel.updateOne).toHaveBeenCalled(); // back to REVIEW
        },
      );

      it('rejects the same course twice', async () => {
        arrange();
        await expectCode(
          service.publishDraft(
            DRAFT_ID,
            {
              courseCutoffs: [
                { offeringId: OFF_A, cutoffMarks: 1 },
                { offeringId: OFF_A, cutoffMarks: 2 },
              ],
            },
            USER_ID,
          ),
          'DUPLICATE_COURSE_CUTOFF',
        );
        expect(mockTestModel.create).not.toHaveBeenCalled();
      });
    });

    describe('updateCourseCutoffs', () => {
      const existingTest = (overrides: Record<string, unknown> = {}) => ({
        _id: new Types.ObjectId(TEST_ID),
        exam: new Types.ObjectId(EXAM_ID),
        totalMarks: 2,
        subjectConfig: [],
        courseCutoffs: [
          { offering: new Types.ObjectId(OFF_A), cutoffMarks: 1 },
          { offering: new Types.ObjectId(OFF_B), cutoffMarks: 1.2 },
        ],
        ...overrides,
      });

      const updatedDoc = (cutoffs: Array<[string, number]>) => ({
        id: TEST_ID,
        _id: { toString: () => TEST_ID },
        title: 'Full',
        totalQuestions: 1,
        durationInMinutes: 60,
        totalMarks: 2,
        isSessionWise: false,
        exam: {
          _id: { toString: () => EXAM_ID },
          name: 'CGL',
          toString: () => EXAM_ID,
        },
        subjectConfig: [],
        marksPerQuestion: 2,
        negativeMarking: 0.5,
        allowRetake: true,
        shuffleOptions: false,
        showResultsImmediately: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        courseCutoffs: cutoffs.map(([id, cutoffMarks]) => ({
          offering: { toString: () => id },
          cutoffMarks,
        })),
      });

      it('rejects a malformed id and non-full-mock / missing papers', async () => {
        await expect(
          service.updateCourseCutoffs('bad', { courseCutoffs: [] }),
        ).rejects.toThrow(BadRequestException);

        mockTestModel.findOne.mockReturnValue(chainable(null));
        await expect(
          service.updateCourseCutoffs(TEST_ID, { courseCutoffs: [] }),
        ).rejects.toThrow(NotFoundException);
        expect(mockTestModel.findOne).toHaveBeenCalledWith({
          _id: TEST_ID,
          paperType: 'FULL_EXAM',
        });
      });

      it('merges edits and writes ONLY courseCutoffs and the audit actor', async () => {
        mockTestModel.findOne.mockReturnValue(chainable(existingTest()));
        offeringModel.find.mockReturnValue(
          chainable([offering(OFF_A), offering(OFF_C)]),
        );
        mockTestModel.findOneAndUpdate = jest.fn().mockReturnValue(
          chainable(
            updatedDoc([
              [OFF_A, 2],
              [OFF_C, 1.1],
            ]),
          ),
        );

        const result = await service.updateCourseCutoffs(
          TEST_ID,
          {
            courseCutoffs: [
              { offeringId: OFF_A, cutoffMarks: 2 }, // update
              { offeringId: OFF_B, cutoffMarks: null }, // remove
              { offeringId: OFF_C, cutoffMarks: 1.1 }, // add
            ],
          },
          USER_ID,
        );

        const [filter, update, options] =
          mockTestModel.findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({ _id: TEST_ID, paperType: 'FULL_EXAM' });
        // frozen snapshot guard: nothing but these two keys may be written
        expect(Object.keys(update)).toEqual(['$set']);
        expect(Object.keys(update.$set).sort()).toEqual([
          'courseCutoffs',
          'updatedBy',
        ]);
        expect(update.$set.courseCutoffs).toEqual([
          { offering: new Types.ObjectId(OFF_A), cutoffMarks: 2 },
          { offering: new Types.ObjectId(OFF_C), cutoffMarks: 1.1 },
        ]);
        expect(options).toEqual({ new: true });
        // only the courses being SET are looked up
        const lookedUp = offeringModel.find.mock.calls[0][0]._id.$in.map(
          (id: Types.ObjectId) => id.toString(),
        );
        expect(lookedUp.sort()).toEqual([OFF_A, OFF_C].sort());

        expect(result.courseCutoffs).toEqual([
          { offeringId: OFF_A, cutoffMarks: 2 },
          { offeringId: OFF_C, cutoffMarks: 1.1 },
        ]);
        expect(result.title).toBe('Full');
      });

      it('can clear a cut-off without checking the (maybe deactivated) course', async () => {
        mockTestModel.findOne.mockReturnValue(chainable(existingTest()));
        mockTestModel.findOneAndUpdate = jest
          .fn()
          .mockReturnValue(chainable(updatedDoc([[OFF_B, 1.2]])));

        await service.updateCourseCutoffs(TEST_ID, {
          courseCutoffs: [{ offeringId: OFF_A, cutoffMarks: null }],
        });

        expect(offeringModel.find).not.toHaveBeenCalled();
        const [, update] = mockTestModel.findOneAndUpdate.mock.calls[0];
        expect(update.$set.courseCutoffs).toEqual([
          { offering: new Types.ObjectId(OFF_B), cutoffMarks: 1.2 },
        ]);
        expect(update.$set).not.toHaveProperty('updatedBy'); // no actor given
      });

      it('keeps stored cut-offs when the edit list is empty', async () => {
        mockTestModel.findOne.mockReturnValue(chainable(existingTest()));
        mockTestModel.findOneAndUpdate = jest.fn().mockReturnValue(
          chainable(
            updatedDoc([
              [OFF_A, 1],
              [OFF_B, 1.2],
            ]),
          ),
        );
        await service.updateCourseCutoffs(
          TEST_ID,
          { courseCutoffs: [] },
          USER_ID,
        );
        const [, update] = mockTestModel.findOneAndUpdate.mock.calls[0];
        expect(update.$set.courseCutoffs).toHaveLength(2);
      });

      it('sets cut-offs on a paper that had none', async () => {
        mockTestModel.findOne.mockReturnValue(
          chainable(existingTest({ courseCutoffs: undefined })),
        );
        offeringModel.find.mockReturnValue(chainable([offering(OFF_A)]));
        mockTestModel.findOneAndUpdate = jest
          .fn()
          .mockReturnValue(chainable(updatedDoc([[OFF_A, 1.5]])));
        await service.updateCourseCutoffs(
          TEST_ID,
          { courseCutoffs: [{ offeringId: OFF_A, cutoffMarks: 1.5 }] },
          USER_ID,
        );
        const [, update] = mockTestModel.findOneAndUpdate.mock.calls[0];
        expect(update.$set.courseCutoffs).toEqual([
          { offering: new Types.ObjectId(OFF_A), cutoffMarks: 1.5 },
        ]);
      });

      it('derives the maximum from subjectConfig when totalMarks is missing', async () => {
        mockTestModel.findOne.mockReturnValue(
          chainable(
            existingTest({
              totalMarks: undefined,
              subjectConfig: [{ numberOfQuestions: 10, marksPerQuestion: 4 }],
            }),
          ),
        );
        offeringModel.find.mockReturnValue(chainable([offering(OFF_A)]));
        mockTestModel.findOneAndUpdate = jest
          .fn()
          .mockReturnValue(chainable(updatedDoc([[OFF_A, 40]])));
        await service.updateCourseCutoffs(TEST_ID, {
          courseCutoffs: [{ offeringId: OFF_A, cutoffMarks: 40 }],
        });
        expect(mockTestModel.findOneAndUpdate).toHaveBeenCalled();

        mockTestModel.findOneAndUpdate.mockClear();
        await expectCode(
          service.updateCourseCutoffs(TEST_ID, {
            courseCutoffs: [{ offeringId: OFF_A, cutoffMarks: 41 }],
          }),
          'CUTOFF_OUT_OF_RANGE',
        );
        expect(mockTestModel.findOneAndUpdate).not.toHaveBeenCalled();
      });

      it('applies the same validation as publish and never writes on failure', async () => {
        mockTestModel.findOne.mockReturnValue(chainable(existingTest()));
        mockTestModel.findOneAndUpdate = jest.fn();

        offeringModel.find.mockReturnValue(
          chainable([
            offering(OFF_A, { exam: new Types.ObjectId(OTHER_EXAM_ID) }),
          ]),
        );
        await expectCode(
          service.updateCourseCutoffs(TEST_ID, {
            courseCutoffs: [{ offeringId: OFF_A, cutoffMarks: 1 }],
          }),
          'COURSE_NOT_ELIGIBLE',
        );

        await expectCode(
          service.updateCourseCutoffs(TEST_ID, {
            courseCutoffs: [
              { offeringId: OFF_A, cutoffMarks: 1 },
              { offeringId: OFF_A, cutoffMarks: null },
            ],
          }),
          'DUPLICATE_COURSE_CUTOFF',
        );

        offeringModel.find.mockReturnValue(chainable([]));
        await expectCode(
          service.updateCourseCutoffs(TEST_ID, {
            courseCutoffs: [{ offeringId: OFF_C, cutoffMarks: 1 }],
          }),
          'COURSE_NOT_FOUND',
        );

        expect(mockTestModel.findOneAndUpdate).not.toHaveBeenCalled();
      });

      it('404s when the paper disappears between read and write', async () => {
        mockTestModel.findOne.mockReturnValue(chainable(existingTest()));
        mockTestModel.findOneAndUpdate = jest
          .fn()
          .mockReturnValue(chainable(null));
        await expect(
          service.updateCourseCutoffs(TEST_ID, {
            courseCutoffs: [{ offeringId: OFF_A, cutoffMarks: null }],
          }),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('visibility', () => {
      const doc = () => ({
        ...updatedDocForVisibility(),
      });
      function updatedDocForVisibility() {
        return {
          id: TEST_ID,
          _id: { toString: () => TEST_ID },
          title: 'Full',
          totalQuestions: 1,
          durationInMinutes: 60,
          totalMarks: 2,
          isSessionWise: false,
          exam: {
            _id: { toString: () => EXAM_ID },
            name: 'CGL',
            toString: () => EXAM_ID,
          },
          questionIds: [{ toString: () => Q1 }],
          subjectConfig: [
            {
              subject: { toString: () => SUB_ID },
              name: 'GS',
              numberOfQuestions: 1,
              marksPerQuestion: 2,
              hasNegativeMarking: false,
              negativeMarksPerQuestion: 0,
              questionStartIndex: 0,
              questionEndIndex: 0,
              questionIds: [{ toString: () => Q1 }],
            },
          ],
          marksPerQuestion: 2,
          negativeMarking: 0,
          allowRetake: true,
          shuffleOptions: false,
          showResultsImmediately: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          courseCutoffs: [
            { offering: { toString: () => OFF_A }, cutoffMarks: 1.5 },
          ],
        };
      }

      it('list: students never receive cut-offs, admins do', async () => {
        mockTestModel.find.mockReturnValue(chainable([doc()]));
        mockTestsService.getUserAttemptActions.mockResolvedValue(new Map());

        const student = await service.listPublished(
          EXAM_ID,
          1,
          10,
          USER_ID,
          false,
        );
        expect(student.data[0]).not.toHaveProperty('courseCutoffs');

        mockTestModel.find.mockReturnValue(chainable([doc()]));
        const admin = await service.listPublished(
          EXAM_ID,
          1,
          10,
          USER_ID,
          true,
        );
        expect(admin.data[0].courseCutoffs).toEqual([
          { offeringId: OFF_A, cutoffMarks: 1.5 },
        ]);
      });

      it('detail: only the admin view (with questions) includes cut-offs', async () => {
        mockTestModel.findOne.mockReturnValue(chainable(doc()));
        mockTestsService.getUserAttemptActions.mockResolvedValue(new Map());
        questionModel.find.mockReturnValue(chainable([questionLean(Q1)]));

        const student = await service.findOnePublished(TEST_ID, USER_ID, false);
        expect(student).not.toHaveProperty('courseCutoffs');

        const admin = await service.findOnePublished(TEST_ID, USER_ID, true);
        expect(admin.courseCutoffs).toEqual([
          { offeringId: OFF_A, cutoffMarks: 1.5 },
        ]);
      });

      it('papers without cut-offs return an empty list for admins', async () => {
        const noCutoffs = { ...doc(), courseCutoffs: undefined };
        mockTestModel.find.mockReturnValue(chainable([noCutoffs]));
        const admin = await service.listPublished(
          EXAM_ID,
          1,
          10,
          undefined,
          true,
        );
        expect(admin.data[0].courseCutoffs).toEqual([]);
      });
    });
  });
});
