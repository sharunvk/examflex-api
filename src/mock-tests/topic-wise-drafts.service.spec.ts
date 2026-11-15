import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TopicWiseDraftsService } from './topic-wise-drafts.service';
import { Exam } from '../exams/schemas/exam.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { Topic } from '../topics/schemas/topic.schema';
import { Question } from '../mock-test-attempts/schemas/question.schema';
import { MockTest } from './schemas/mock-test.schema';
import { TopicWiseMockTestDraft } from './schemas/topic-wise-mock-test-draft.schema';
import { ImageUrlResolver } from '../aws/s3/image-url.resolver';
import { PaperType } from '../common/enums/paper-type.enum';
import { AccessMode } from '../common/enums/access-mode.enum';

const EXAM_ID = '507f1f77bcf86cd799439011';
const SUB_ID = '507f1f77bcf86cd799439012';
const OTHER_SUB = '507f1f77bcf86cd799439022';
const TOP_ID = '507f1f77bcf86cd799439013';
const OTHER_TOP = '507f1f77bcf86cd799439023';
const DRAFT_ID = '507f1f77bcf86cd799439015';
const USER_ID = '507f1f77bcf86cd799439016';
const TEST_ID = '507f1f77bcf86cd799439017';
const Q1 = '507f1f77bcf86cd799439018';
const Q2 = '507f1f77bcf86cd799439019';

function chainable(resolved: unknown) {
  const query: any = {};
  ['populate', 'sort', 'skip', 'limit', 'lean', 'select'].forEach(method => {
    query[method] = jest.fn().mockReturnValue(query);
  });
  query.exec = jest.fn().mockResolvedValue(resolved);
  return query;
}

function questionRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(id),
    subject: new Types.ObjectId(SUB_ID),
    topic: new Types.ObjectId(TOP_ID),
    difficultyLevel: 'easy',
    isActive: true,
    exams: [new Types.ObjectId(EXAM_ID)],
    questionText: { en: { text: `Question ${id}` } },
    options: [{ id: 'a', type: 'text', en: 'A' }],
    ...overrides,
  };
}

function ids(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `507f1f77bcf86cd79944${index.toString(16).padStart(4, '0')}`,
  );
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  const draft: any = {
    _id: new Types.ObjectId(DRAFT_ID),
    id: DRAFT_ID,
    exam: new Types.ObjectId(EXAM_ID),
    examName: 'CGL',
    subject: new Types.ObjectId(SUB_ID),
    subjectName: 'Polity',
    topic: new Types.ObjectId(TOP_ID),
    topicName: 'Parliament',
    status: 'REVIEW',
    totalQuestions: 10,
    durationInMinutes: 15,
    difficultyDistribution: { easy: 10, medium: 0, hard: 0 },
    title: 'Polity 10',
    description: 'desc',
    generationMode: 'STATIC',
    marksPerQuestion: 1,
    negativeMarking: 0,
    passingScore: 4,
    allowRetake: true,
    shuffleOptions: false,
    showResultsImmediately: true,
    accessMode: AccessMode.FREE,
    questions: [
      {
        question: new Types.ObjectId(Q1),
        subject: new Types.ObjectId(SUB_ID),
        topic: new Types.ObjectId(TOP_ID),
        difficultyLevel: 'easy',
        position: 0,
        marksPerQuestion: 1,
        negativeMarking: 0,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return draft;
}

describe('TopicWiseDraftsService', () => {
  let service: TopicWiseDraftsService;
  const examModel: any = { findById: jest.fn() };
  const subjectModel: any = { findById: jest.fn(), find: jest.fn() };
  const topicModel: any = { findById: jest.fn() };
  const questionModel: any = {
    aggregate: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
  };
  const mockTestModel: any = { create: jest.fn() };
  const draftModel: any = {
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    countDocuments: jest.fn(),
  };
  const imageUrlResolver = {
    resolveMany: jest.fn().mockResolvedValue([null, null, null]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    subjectModel.find.mockReturnValue(chainable([]));
    subjectModel.findById.mockReturnValue(
      chainable({
        _id: new Types.ObjectId(SUB_ID),
        name: 'Polity',
        topics: [new Types.ObjectId(TOP_ID)],
        isActive: true,
      }),
    );
    topicModel.findById.mockReturnValue(
      chainable({
        _id: new Types.ObjectId(TOP_ID),
        name: 'Parliament',
        isActive: true,
      }),
    );
    questionModel.find.mockReturnValue(chainable([]));
    questionModel.countDocuments.mockReturnValue(chainable(0));
    imageUrlResolver.resolveMany.mockResolvedValue([null, null, null]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicWiseDraftsService,
        { provide: getModelToken(Exam.name), useValue: examModel },
        { provide: getModelToken(Subject.name), useValue: subjectModel },
        { provide: getModelToken(Topic.name), useValue: topicModel },
        { provide: getModelToken(Question.name), useValue: questionModel },
        { provide: getModelToken(MockTest.name), useValue: mockTestModel },
        {
          provide: getModelToken(TopicWiseMockTestDraft.name),
          useValue: draftModel,
        },
        { provide: ImageUrlResolver, useValue: imageUrlResolver },
      ],
    }).compile();
    service = module.get(TopicWiseDraftsService);
  });

  function activeExam() {
    examModel.findById.mockReturnValue(
      chainable({
        _id: new Types.ObjectId(EXAM_ID),
        name: 'CGL',
        isActive: true,
      }),
    );
  }

  it('samples a review draft and does not publish', async () => {
    activeExam();
    const sampled = ids(10).map(id => questionRow(id));
    questionModel.aggregate.mockResolvedValue(sampled);
    draftModel.create.mockImplementation(async (payload: any) =>
      makeDraft({
        questions: payload.questions,
        difficultyDistribution: payload.difficultyDistribution,
      }),
    );

    const result = await service.createDraft(
      {
        exam: EXAM_ID,
        subject: SUB_ID,
        topic: TOP_ID,
        totalQuestions: 10,
        durationInMinutes: 15,
        difficultyDistribution: { easy: 10, medium: 0, hard: 0 },
        title: 'Polity 10',
      },
      USER_ID,
    );

    expect(questionModel.aggregate).toHaveBeenCalledTimes(1);
    const match = questionModel.aggregate.mock.calls[0][0][0].$match;
    expect(match.subject.toString()).toBe(SUB_ID);
    expect(match.exams.toString()).toBe(EXAM_ID);
    expect(match.topic.toString()).toBe(TOP_ID);
    expect(match.difficultyLevel).toBe('easy');
    expect(match.isDeleted).toEqual({ $ne: true });
    const payload = draftModel.create.mock.calls[0][0];
    expect(payload.status).toBe('REVIEW');
    expect(payload.questions).toHaveLength(10);
    expect(payload.questions[0].difficultyLevel).toBe('easy');
    expect(payload.topic.toString()).toBe(TOP_ID);
    expect(mockTestModel.create).not.toHaveBeenCalled();
    expect(result.status).toBe('REVIEW');
  });

  it('saves nothing when the bank is short', async () => {
    activeExam();
    questionModel.aggregate.mockResolvedValue([questionRow(Q1)]);

    await expect(
      service.createDraft(
        {
          exam: EXAM_ID,
          subject: SUB_ID,
          totalQuestions: 10,
          durationInMinutes: 10,
          difficultyDistribution: { easy: 10, medium: 0, hard: 0 },
        },
        USER_ID,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(draftModel.create).not.toHaveBeenCalled();
  });

  it('rejects an inactive exam and a topic outside the subject', async () => {
    examModel.findById.mockReturnValue(
      chainable({ _id: new Types.ObjectId(EXAM_ID), isActive: false }),
    );
    await expect(
      service.createDraft(
        {
          exam: EXAM_ID,
          subject: SUB_ID,
          totalQuestions: 10,
          durationInMinutes: 10,
          difficultyDistribution: { easy: 10, medium: 0, hard: 0 },
        },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    activeExam();
    subjectModel.findById.mockReturnValue(
      chainable({
        _id: new Types.ObjectId(SUB_ID),
        name: 'Polity',
        topics: [],
      }),
    );
    await expect(
      service.createDraft(
        {
          exam: EXAM_ID,
          subject: SUB_ID,
          topic: TOP_ID,
          totalQuestions: 10,
          durationInMinutes: 10,
          difficultyDistribution: { easy: 10, medium: 0, hard: 0 },
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({ response: { error: 'TOPIC_MISMATCH' } });
    expect(draftModel.create).not.toHaveBeenCalled();
  });

  it('freezes hand-picked questions that share one topic', async () => {
    activeExam();
    const questionIds = ids(10);
    const rows = questionIds.map((id, index) =>
      questionRow(id, {
        difficultyLevel: index < 6 ? 'easy' : 'medium',
      }),
    );
    questionModel.find.mockReturnValue(chainable(rows));
    draftModel.create.mockImplementation(async (payload: any) =>
      makeDraft({ questions: payload.questions }),
    );

    await service.createDraft(
      {
        exam: EXAM_ID,
        totalQuestions: 10,
        durationInMinutes: 20,
        questionIds,
      },
      USER_ID,
    );

    const payload = draftModel.create.mock.calls[0][0];
    expect(payload.subject.toString()).toBe(SUB_ID);
    expect(payload.topic.toString()).toBe(TOP_ID);
    expect(payload.difficultyDistribution).toEqual({
      easy: 6,
      medium: 4,
      hard: 0,
    });
    expect(
      payload.questions.map((row: any) => row.question.toString()),
    ).toEqual(questionIds);
    expect(questionModel.aggregate).not.toHaveBeenCalled();
  });

  it('rejects hand-picked sets that break topic-wise rules', async () => {
    activeExam();
    const questionIds = ids(10);
    const base = () => questionIds.map(id => questionRow(id));

    questionModel.find.mockReturnValue(
      chainable(
        base().map((row, index) =>
          index === 9 ? { ...row, topic: new Types.ObjectId(OTHER_TOP) } : row,
        ),
      ),
    );
    await expect(
      service.createDraft(
        {
          exam: EXAM_ID,
          totalQuestions: 10,
          durationInMinutes: 10,
          questionIds,
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({ response: { error: 'TOPIC_MISMATCH' } });

    questionModel.find.mockReturnValue(
      chainable(
        base().map((row, index) =>
          index === 9
            ? { ...row, subject: new Types.ObjectId(OTHER_SUB) }
            : row,
        ),
      ),
    );
    await expect(
      service.createDraft(
        {
          exam: EXAM_ID,
          totalQuestions: 10,
          durationInMinutes: 10,
          questionIds,
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({ response: { error: 'SUBJECT_MISMATCH' } });

    questionModel.find.mockReturnValue(
      chainable(
        base().map((row, index) =>
          index === 9 ? { ...row, topic: undefined } : row,
        ),
      ),
    );
    await expect(
      service.createDraft(
        {
          exam: EXAM_ID,
          totalQuestions: 10,
          durationInMinutes: 10,
          questionIds,
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({ response: { error: 'TOPIC_REQUIRED' } });

    questionModel.find.mockReturnValue(
      chainable(
        base().map(row => ({
          ...row,
          exams: [new Types.ObjectId(USER_ID)],
        })),
      ),
    );
    await expect(
      service.createDraft(
        {
          exam: EXAM_ID,
          totalQuestions: 10,
          durationInMinutes: 10,
          questionIds,
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({ response: { error: 'EXAM_MISMATCH' } });

    await expect(
      service.createDraft(
        {
          exam: EXAM_ID,
          totalQuestions: 15,
          durationInMinutes: 10,
          questionIds,
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({ response: { error: 'QUESTION_COUNT_MISMATCH' } });
    expect(draftModel.create).not.toHaveBeenCalled();
  });

  it('replaces a question on the same topic at any difficulty', async () => {
    const draft = makeDraft();
    draftModel.findById.mockReturnValue(chainable(draft));
    questionModel.findById.mockReturnValue(chainable(questionRow(Q2)));

    await service.replaceQuestion(DRAFT_ID, 0, Q2, USER_ID);

    expect(draft.questions[0].question.toString()).toBe(Q2);
    expect(draft.questions[0].replacedFrom.toString()).toBe(Q1);
    expect(draft.difficultyDistribution).toEqual({
      easy: 1,
      medium: 0,
      hard: 0,
    });
    expect(draft.save).toHaveBeenCalled();

    questionModel.findById.mockReturnValue(
      chainable(questionRow(Q2, { topic: new Types.ObjectId(OTHER_TOP) })),
    );
    draftModel.findById.mockReturnValue(chainable(makeDraft()));
    await expect(
      service.replaceQuestion(DRAFT_ID, 0, Q2, USER_ID),
    ).rejects.toMatchObject({ response: { error: 'TOPIC_MISMATCH' } });

    questionModel.findById.mockReturnValue(
      chainable(questionRow(Q2, { subject: new Types.ObjectId(OTHER_SUB) })),
    );
    await expect(
      service.replaceQuestion(DRAFT_ID, 0, Q2, USER_ID),
    ).rejects.toMatchObject({ response: { error: 'SUBJECT_MISMATCH' } });

    const harder = makeDraft();
    draftModel.findById.mockReturnValue(chainable(harder));
    questionModel.findById.mockReturnValue(
      chainable(questionRow(Q2, { difficultyLevel: 'hard' })),
    );
    await service.replaceQuestion(DRAFT_ID, 0, Q2, USER_ID);
    expect(harder.questions[0].difficultyLevel).toBe('hard');
    expect(harder.difficultyDistribution).toEqual({
      easy: 0,
      medium: 0,
      hard: 1,
    });

    const duplicate = makeDraft({
      questions: [
        {
          question: new Types.ObjectId(Q1),
          subject: new Types.ObjectId(SUB_ID),
          topic: new Types.ObjectId(TOP_ID),
          difficultyLevel: 'easy',
          position: 0,
          marksPerQuestion: 1,
          negativeMarking: 0,
        },
        {
          question: new Types.ObjectId(Q2),
          subject: new Types.ObjectId(SUB_ID),
          topic: new Types.ObjectId(TOP_ID),
          difficultyLevel: 'easy',
          position: 1,
          marksPerQuestion: 1,
          negativeMarking: 0,
        },
      ],
    });
    draftModel.findById.mockReturnValue(chainable(duplicate));
    questionModel.findById.mockReturnValue(chainable(questionRow(Q1)));
    await expect(
      service.replaceQuestion(DRAFT_ID, 1, Q1, USER_ID),
    ).rejects.toMatchObject({ response: { error: 'DUPLICATE_QUESTION' } });
  });

  it('rejects replace on a draft without a topic', async () => {
    const draft = makeDraft({ topic: undefined, topicName: undefined });
    draftModel.findById.mockReturnValue(chainable(draft));
    questionModel.findById.mockReturnValue(
      chainable(questionRow(Q2, { topic: new Types.ObjectId(OTHER_TOP) })),
    );

    await expect(
      service.replaceQuestion(DRAFT_ID, 0, Q2, USER_ID),
    ).rejects.toMatchObject({ response: { error: 'TOPIC_REQUIRED' } });
  });

  it('rejects sampled create without a topic', async () => {
    activeExam();

    await expect(
      service.createDraft(
        {
          exam: EXAM_ID,
          subject: SUB_ID,
          totalQuestions: 10,
          durationInMinutes: 15,
          difficultyDistribution: { easy: 10, medium: 0, hard: 0 },
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({ response: { error: 'TOPIC_REQUIRED' } });
    expect(draftModel.create).not.toHaveBeenCalled();
  });

  it('rejects publish when the draft has no topic', async () => {
    const draft = makeDraft({ topic: undefined, topicName: undefined });
    draftModel.findOneAndUpdate.mockResolvedValue(draft);
    draftModel.updateOne.mockReturnValue(chainable({ acknowledged: true }));

    await expect(
      service.publishDraft(DRAFT_ID, { title: 'No topic' }, USER_ID),
    ).rejects.toMatchObject({ response: { error: 'TOPIC_REQUIRED' } });
    expect(mockTestModel.create).not.toHaveBeenCalled();
  });

  it('publishes a TOPIC_WISE mock test with the draft fields', async () => {
    const questionIds = ids(10);
    const draft = makeDraft({
      questions: questionIds.map((id, position) => ({
        question: new Types.ObjectId(id),
        subject: new Types.ObjectId(SUB_ID),
        topic: new Types.ObjectId(TOP_ID),
        difficultyLevel: 'easy',
        position,
        marksPerQuestion: 1,
        negativeMarking: 0,
      })),
    });
    draftModel.findOneAndUpdate.mockResolvedValue(draft);
    questionModel.find.mockReturnValue(
      chainable(questionIds.map(id => questionRow(id))),
    );
    mockTestModel.create.mockResolvedValue({
      id: TEST_ID,
      _id: new Types.ObjectId(TEST_ID),
    });

    const result = await service.publishDraft(
      DRAFT_ID,
      { title: 'Published polity' },
      USER_ID,
    );

    expect(mockTestModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        paperType: PaperType.TOPIC_WISE,
        totalQuestions: 10,
        durationInMinutes: 15,
        title: 'Published polity',
        generationMode: 'STATIC',
        marksPerQuestion: 1,
        negativeMarking: 0,
        allowRetake: true,
        shuffleOptions: false,
        showResultsImmediately: true,
        accessMode: AccessMode.FREE,
        isActive: true,
        isDeleted: false,
        difficultyDistribution: draft.difficultyDistribution,
      }),
    );
    const created = mockTestModel.create.mock.calls[0][0];
    expect(created.exam.toString()).toBe(EXAM_ID);
    expect(created.subject.toString()).toBe(SUB_ID);
    expect(created.topic.toString()).toBe(TOP_ID);
    expect(created.questionIds).toHaveLength(10);
    expect(created.subjectConfig).toBeUndefined();
    expect(draft.status).toBe('PUBLISHED');
    expect(result.mockTestId).toBe(TEST_ID);
  });

  it('returns a failed publish to REVIEW and does not keep a mock test', async () => {
    const draft = makeDraft({ totalQuestions: 1 });
    draftModel.findOneAndUpdate.mockResolvedValue(draft);
    questionModel.find.mockReturnValue(chainable([]));
    draftModel.updateOne.mockReturnValue(chainable({}));

    await expect(
      service.publishDraft(DRAFT_ID, {}, USER_ID),
    ).rejects.toMatchObject({ response: { error: 'QUESTION_NOT_ELIGIBLE' } });
    expect(mockTestModel.create).not.toHaveBeenCalled();
    expect(draftModel.updateOne).toHaveBeenCalledWith(
      { _id: draft._id, status: 'PUBLISHING' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'REVIEW' }),
      }),
    );
  });

  it('discards a review draft without publishing', async () => {
    const draft = makeDraft();
    draftModel.findById.mockReturnValue(chainable(draft));

    await service.discardDraft(DRAFT_ID, USER_ID);

    expect(draft.status).toBe('DISCARDED');
    expect(draft.save).toHaveBeenCalled();
    expect(mockTestModel.create).not.toHaveBeenCalled();

    draftModel.findById.mockReturnValue(
      chainable(makeDraft({ status: 'PUBLISHED' })),
    );
    await expect(service.discardDraft(DRAFT_ID, USER_ID)).rejects.toMatchObject(
      { response: { error: 'DRAFT_NOT_EDITABLE' } },
    );
  });

  it('searches the draft topic across every eligible difficulty', async () => {
    const draft = makeDraft();
    draftModel.findById.mockReturnValue(chainable(draft));
    const findQuery = chainable([]);
    questionModel.find.mockReturnValue(findQuery);

    await service.searchQuestions({ draftId: DRAFT_ID });

    const query = questionModel.find.mock.calls[0][0];
    expect(query.subject.toString()).toBe(SUB_ID);
    expect(query.exams.toString()).toBe(EXAM_ID);
    expect(query.topic.toString()).toBe(TOP_ID);
    expect(query.difficultyLevel).toEqual({ $in: ['easy', 'medium', 'hard'] });
    expect(query._id.$nin).toHaveLength(1);
  });
});
