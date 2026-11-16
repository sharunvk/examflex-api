import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SprintTestsService } from './sprint-tests.service';
import { Exam } from '../exams/schemas/exam.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { Question } from '../mock-test-attempts/schemas/question.schema';
import { MockTest } from '../mock-tests/schemas/mock-test.schema';
import { SprintTestDraft } from './schemas/sprint-test-draft.schema';
import { MockTestsService } from '../mock-tests/mock-tests.service';
import { ImageUrlResolver } from '../aws/s3/image-url.resolver';
import { AccessControlService } from '../access/access-control.service';
import { AccessDecisionReason } from '../common/enums/access-decision-reason.enum';
import { AccessMode } from '../common/enums/access-mode.enum';
import { PaperType } from '../common/enums/paper-type.enum';
import { UserAttemptAction } from '../common/enums/user-attempt-action.enum';

const EXAM_ID = '507f1f77bcf86cd799439011';
const SUB_ID = '507f1f77bcf86cd799439012';
const OTHER_SUB = '507f1f77bcf86cd799439022';
const Q1 = '507f1f77bcf86cd799439013';
const Q2 = '507f1f77bcf86cd799439014';
const Q3 = '507f1f77bcf86cd799439019';
const DRAFT_ID = '507f1f77bcf86cd799439015';
const USER_ID = '507f1f77bcf86cd799439016';
const TEST_ID = '507f1f77bcf86cd799439017';
const TOP_ID = '507f1f77bcf86cd799439018';

function chainable(resolved: unknown) {
  const query: any = {};
  ['populate', 'sort', 'skip', 'limit', 'lean', 'select'].forEach(method => {
    query[method] = jest.fn().mockReturnValue(query);
  });
  query.exec = jest.fn().mockResolvedValue(resolved);
  return query;
}

function questionRow(id: string, subject = SUB_ID, createdAt = new Date()) {
  return {
    _id: new Types.ObjectId(id),
    subject: new Types.ObjectId(subject),
    topic: new Types.ObjectId(TOP_ID),
    difficultyLevel: 'easy',
    isActive: true,
    exams: [new Types.ObjectId(EXAM_ID)],
    createdAt,
    questionText: { en: { text: `Question ${id}` }, ml: { text: null } },
    options: [{ id: 'a', type: 'text', en: 'A', ml: null }],
  };
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  const draft: any = {
    _id: new Types.ObjectId(DRAFT_ID),
    id: DRAFT_ID,
    exam: new Types.ObjectId(EXAM_ID),
    examName: 'CGL',
    status: 'REVIEW',
    totalQuestions: 1,
    durationInMinutes: 10,
    title: 'Sprint',
    description: 'mixed',
    marksPerQuestion: 1,
    negativeMarking: 0.25,
    passingScore: 1,
    allowRetake: true,
    shuffleOptions: false,
    showResultsImmediately: true,
    questions: [
      {
        question: new Types.ObjectId(Q1),
        subject: new Types.ObjectId(SUB_ID),
        topic: new Types.ObjectId(TOP_ID),
        difficultyLevel: 'easy',
        position: 0,
        marksPerQuestion: 1,
        negativeMarking: 0.25,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return draft;
}

describe('SprintTestsService', () => {
  let service: SprintTestsService;
  const examModel: any = { findById: jest.fn() };
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
    findOneAndUpdate: jest.fn(),
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
    jest.clearAllMocks();
    subjectModel.find.mockReturnValue(
      chainable([{ _id: new Types.ObjectId(SUB_ID), name: 'GS' }]),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SprintTestsService,
        { provide: getModelToken(Exam.name), useValue: examModel },
        { provide: getModelToken(Subject.name), useValue: subjectModel },
        { provide: getModelToken(Question.name), useValue: questionModel },
        { provide: getModelToken(MockTest.name), useValue: mockTestModel },
        { provide: getModelToken(SprintTestDraft.name), useValue: draftModel },
        { provide: MockTestsService, useValue: mockTestsService },
        { provide: ImageUrlResolver, useValue: imageUrlResolver },
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();
    service = module.get(SprintTestsService);
  });

  it('drafts the newest exam-tagged questions and does not publish yet', async () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      questionRow(
        new Types.ObjectId().toString(),
        SUB_ID,
        new Date(Date.UTC(2026, 0, 10 - index)),
      ),
    );
    examModel.findById.mockReturnValue(
      chainable({
        _id: new Types.ObjectId(EXAM_ID),
        name: 'CGL',
        isActive: true,
      }),
    );
    const findQuery = chainable(rows);
    questionModel.find.mockReturnValueOnce(findQuery);
    questionModel.find.mockReturnValue(chainable(rows));
    draftModel.create.mockImplementation(
      async (payload: { questions: unknown[] }) =>
        makeDraft({
          totalQuestions: 10,
          questions: payload.questions,
        }),
    );

    await service.createDraft(
      {
        examId: EXAM_ID,
        totalQuestions: 10,
        durationInMinutes: 15,
        marksPerQuestion: 2,
        negativeMarking: 0.5,
      },
      USER_ID,
    );

    expect(findQuery.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(findQuery.limit).toHaveBeenCalledWith(10);
    expect(findQuery.select).toHaveBeenCalled();
    const match = questionModel.find.mock.calls[0][0];
    expect(match.exams.toString()).toBe(EXAM_ID);
    expect(match.isActive).toBe(true);
    expect(match.difficultyLevel.$in).toEqual(['easy', 'medium', 'hard']);
    expect(mockTestModel.create).not.toHaveBeenCalled();
    expect(questionModel.updateMany).not.toHaveBeenCalled();
    const payload = draftModel.create.mock.calls[0][0];
    expect(payload.questions).toHaveLength(10);
    expect(payload.questions[0].question.toString()).toBe(
      rows[0]._id.toString(),
    );
    expect(payload.questions[0].marksPerQuestion).toBe(2);
    expect(payload.durationInMinutes).toBe(15);
    expect(payload.accessMode).toBe(AccessMode.FREE);
  });

  it('freezes hand-picked question ids in order and skips recency sampling', async () => {
    const rows = Array.from({ length: 10 }, () =>
      questionRow(new Types.ObjectId().toString()),
    );
    examModel.findById.mockReturnValue(
      chainable({
        _id: new Types.ObjectId(EXAM_ID),
        name: 'CGL',
        isActive: true,
      }),
    );
    const findQuery = chainable(rows);
    questionModel.find.mockReturnValue(findQuery);
    draftModel.create.mockImplementation(
      async (payload: { questions: unknown[] }) =>
        makeDraft({ totalQuestions: 10, questions: payload.questions }),
    );

    const ids = rows.map(row => row._id.toString());
    await service.createDraft(
      {
        examId: EXAM_ID,
        totalQuestions: 10,
        durationInMinutes: 15,
        questionIds: ids,
      },
      USER_ID,
    );

    expect(findQuery.sort).not.toHaveBeenCalled();
    const payload = draftModel.create.mock.calls[0][0];
    expect(
      payload.questions.map((row: { question: Types.ObjectId }) =>
        row.question.toString(),
      ),
    ).toEqual(ids);
  });

  it('rejects a hand-picked question that is not tagged to the exam', async () => {
    const rows = Array.from({ length: 10 }, () =>
      questionRow(new Types.ObjectId().toString()),
    );
    rows[3] = { ...rows[3], exams: [new Types.ObjectId(USER_ID)] };
    examModel.findById.mockReturnValue(
      chainable({
        _id: new Types.ObjectId(EXAM_ID),
        name: 'CGL',
        isActive: true,
      }),
    );
    questionModel.find.mockReturnValue(chainable(rows));

    await expect(
      service.createDraft(
        {
          examId: EXAM_ID,
          totalQuestions: 10,
          durationInMinutes: 10,
          questionIds: rows.map(row => row._id.toString()),
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({ response: { error: 'EXAM_MISMATCH' } });
    expect(draftModel.create).not.toHaveBeenCalled();
  });

  it('rejects a hand-picked set whose length does not match the paper', async () => {
    examModel.findById.mockReturnValue(
      chainable({
        _id: new Types.ObjectId(EXAM_ID),
        name: 'CGL',
        isActive: true,
      }),
    );

    await expect(
      service.createDraft(
        {
          examId: EXAM_ID,
          totalQuestions: 15,
          durationInMinutes: 15,
          questionIds: Array.from({ length: 10 }, () =>
            new Types.ObjectId().toString(),
          ),
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({ response: { error: 'QUESTION_COUNT_MISMATCH' } });
    expect(questionModel.find).not.toHaveBeenCalled();
    expect(draftModel.create).not.toHaveBeenCalled();
  });

  it('does not write a draft when the exam bank is short', async () => {
    examModel.findById.mockReturnValue(
      chainable({
        _id: new Types.ObjectId(EXAM_ID),
        name: 'CGL',
        isActive: true,
      }),
    );
    questionModel.find.mockReturnValue(chainable([questionRow(Q1)]));

    await expect(
      service.createDraft(
        { examId: EXAM_ID, totalQuestions: 10, durationInMinutes: 10 },
        USER_ID,
      ),
    ).rejects.toMatchObject({
      response: {
        error: 'BANK_SHORTAGE',
        details: { needed: 10, available: 1 },
      },
    });
    expect(draftModel.create).not.toHaveBeenCalled();
  });

  it('rejects an inactive exam', async () => {
    examModel.findById.mockReturnValue(
      chainable({ _id: new Types.ObjectId(EXAM_ID), isActive: false }),
    );
    await expect(
      service.createDraft(
        { examId: EXAM_ID, totalQuestions: 10, durationInMinutes: 10 },
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(draftModel.create).not.toHaveBeenCalled();
  });

  it('rejects a same-subject replacement from another subject', async () => {
    draftModel.findById.mockReturnValue(chainable(makeDraft()));
    questionModel.findById.mockReturnValue(
      chainable({
        ...questionRow(Q2, OTHER_SUB),
        isActive: true,
      }),
    );

    await expect(
      service.replaceQuestion(DRAFT_ID, 0, Q2, false),
    ).rejects.toMatchObject({ response: { error: 'SUBJECT_MISMATCH' } });
  });

  it('rejects a replacement that is not tagged to the exam', async () => {
    draftModel.findById.mockReturnValue(chainable(makeDraft()));
    questionModel.findById.mockReturnValue(
      chainable({
        ...questionRow(Q2),
        exams: [new Types.ObjectId(USER_ID)],
      }),
    );

    await expect(
      service.replaceQuestion(DRAFT_ID, 0, Q2, false),
    ).rejects.toMatchObject({ response: { error: 'EXAM_MISMATCH' } });
  });

  it('rejects a duplicate and an ineligible or locked draft', async () => {
    const draft = makeDraft({
      totalQuestions: 2,
      questions: [
        {
          question: new Types.ObjectId(Q1),
          subject: new Types.ObjectId(SUB_ID),
          position: 0,
          marksPerQuestion: 1,
          negativeMarking: 0,
        },
        {
          question: new Types.ObjectId(Q2),
          subject: new Types.ObjectId(SUB_ID),
          position: 1,
          marksPerQuestion: 1,
          negativeMarking: 0,
        },
      ],
    });
    draftModel.findById.mockReturnValue(chainable(draft));
    questionModel.findById.mockReturnValue(chainable(questionRow(Q1)));
    await expect(
      service.replaceQuestion(DRAFT_ID, 1, Q1, false),
    ).rejects.toMatchObject({ response: { error: 'DUPLICATE_QUESTION' } });

    questionModel.findById.mockReturnValue(
      chainable({ ...questionRow(Q3), isActive: false }),
    );
    await expect(
      service.replaceQuestion(DRAFT_ID, 1, Q3, false),
    ).rejects.toMatchObject({ response: { error: 'QUESTION_NOT_ELIGIBLE' } });

    draftModel.findById.mockReturnValue(
      chainable(makeDraft({ status: 'PUBLISHED' })),
    );
    await expect(
      service.replaceQuestion(DRAFT_ID, 0, Q3, false),
    ).rejects.toMatchObject({ response: { error: 'DRAFT_NOT_EDITABLE' } });
  });

  it('allows a cross-subject replacement outside the exam blueprint and keeps the slot', async () => {
    const draft = makeDraft();
    draftModel.findById.mockReturnValue(chainable(draft));
    questionModel.find.mockReturnValue(chainable([questionRow(Q3, OTHER_SUB)]));
    questionModel.findById.mockReturnValue(
      chainable(questionRow(Q3, OTHER_SUB)),
    );

    await service.replaceQuestion(DRAFT_ID, 0, Q3, true);

    expect(draft.questions[0].subject.toString()).toBe(SUB_ID);
    expect(draft.questions[0].question.toString()).toBe(Q3);
    expect(draft.questions[0].marksPerQuestion).toBe(1);
    expect(draft.questions[0].replacedFrom.toString()).toBe(Q1);
    expect(draft.save).toHaveBeenCalled();
  });

  it('publishes a frozen sprint paper without incrementing full-mock usage', async () => {
    const draft = makeDraft();
    draftModel.findOneAndUpdate.mockResolvedValue(draft);
    questionModel.find.mockReturnValue(chainable([questionRow(Q1)]));
    mockTestModel.create.mockResolvedValue({
      _id: new Types.ObjectId(TEST_ID),
      id: TEST_ID,
    });

    const result = await service.publishDraft(
      DRAFT_ID,
      { title: 'Paper 1' },
      USER_ID,
    );

    expect(result.mockTestId).toBe(TEST_ID);
    const created = mockTestModel.create.mock.calls[0][0];
    expect(created.paperType).toBe(PaperType.SPRINT);
    expect(created.isSessionWise).toBe(false);
    expect(created.subjectConfig).toBeUndefined();
    expect(created.subject).toBeUndefined();
    expect(created.questionIds).toHaveLength(1);
    expect(questionModel.updateMany).not.toHaveBeenCalled();
    expect(draft.status).toBe('PUBLISHED');
  });

  it('publishes the access mode stored on the draft when publish omits it', async () => {
    const draft = makeDraft({ accessMode: AccessMode.ENTITLED });
    draftModel.findOneAndUpdate.mockResolvedValue(draft);
    questionModel.find.mockReturnValue(chainable([questionRow(Q1)]));
    mockTestModel.create.mockResolvedValue({
      _id: new Types.ObjectId(TEST_ID),
      id: TEST_ID,
    });

    await service.publishDraft(DRAFT_ID, {}, USER_ID);

    expect(mockTestModel.create.mock.calls[0][0].accessMode).toBe(
      AccessMode.ENTITLED,
    );
  });

  it('rolls a failed publish back to REVIEW', async () => {
    const draft = makeDraft({
      questions: [
        {
          question: new Types.ObjectId(Q1),
          subject: new Types.ObjectId(SUB_ID),
          position: 0,
          marksPerQuestion: 1,
          negativeMarking: 0,
        },
        {
          question: new Types.ObjectId(Q1),
          subject: new Types.ObjectId(SUB_ID),
          position: 1,
          marksPerQuestion: 1,
          negativeMarking: 0,
        },
      ],
      totalQuestions: 2,
    });
    draftModel.findOneAndUpdate.mockResolvedValue(draft);
    draftModel.updateOne.mockReturnValue(chainable(undefined));

    await expect(
      service.publishDraft(DRAFT_ID, {}, USER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(draftModel.updateOne).toHaveBeenCalledWith(
      { _id: draft._id, status: 'PUBLISHING' },
      {
        $set: {
          status: 'REVIEW',
          updatedBy: new Types.ObjectId(USER_ID),
        },
      },
    );
    expect(mockTestModel.create).not.toHaveBeenCalled();
  });

  it('discards an open draft and refuses a published one', async () => {
    const draft = makeDraft();
    draftModel.findById.mockReturnValue(chainable(draft));
    await service.discardDraft(DRAFT_ID);
    expect(draft.status).toBe('DISCARDED');

    draftModel.findById.mockReturnValue(
      chainable(makeDraft({ status: 'PUBLISHED' })),
    );
    await expect(service.discardDraft(DRAFT_ID)).rejects.toMatchObject({
      response: { error: 'DRAFT_NOT_EDITABLE' },
    });
  });

  it('requires a draft when searching across subjects and excludes questions already on the paper', async () => {
    await expect(
      service.searchQuestions({ allowCrossSubject: true }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const draft = makeDraft();
    draftModel.findById.mockReturnValue(chainable(draft));
    const findQuery = chainable([]);
    questionModel.find.mockReturnValue(findQuery);
    questionModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    });

    await service.searchQuestions({
      draftId: DRAFT_ID,
      allowCrossSubject: true,
      subjectId: OTHER_SUB,
    });

    const query = questionModel.find.mock.calls[0][0];
    expect(query.exams.toString()).toBe(EXAM_ID);
    expect(query.subject.toString()).toBe(OTHER_SUB);
    expect(query._id.$nin[0].toString()).toBe(Q1);
  });

  it('lists only sprint papers and reports the attempt action', async () => {
    const test = {
      _id: new Types.ObjectId(TEST_ID),
      id: TEST_ID,
      title: 'Sprint 1',
      totalQuestions: 10,
      durationInMinutes: 10,
      exam: { _id: new Types.ObjectId(EXAM_ID), name: 'CGL' },
      marksPerQuestion: 1,
      negativeMarking: 0,
      allowRetake: true,
      shuffleOptions: false,
      showResultsImmediately: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockTestModel.find.mockReturnValue(chainable([test]));
    mockTestModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });
    mockTestsService.getUserAttemptActions.mockResolvedValue(
      new Map([
        [
          TEST_ID,
          {
            action: UserAttemptAction.START,
            attemptSummary: { status: 'NONE', attemptCount: 0 },
          },
        ],
      ]),
    );

    const result = await service.listPublished(undefined, 1, 10, USER_ID, true);
    expect(mockTestModel.find).toHaveBeenCalledWith({
      paperType: PaperType.SPRINT,
    });
    expect(result.data[0].userAttemptAction).toBe(UserAttemptAction.START);
    expect(result.data[0].totalMarks).toBe(10);
    expect(result.data[0].attemptSummary).toMatchObject({
      status: 'NONE',
      attemptCount: 0,
    });
  });

  it('soft-deletes only a sprint paper', async () => {
    mockTestModel.findOneAndUpdate.mockReturnValue(
      chainable({ _id: new Types.ObjectId(TEST_ID) }),
    );
    await service.removePublished(TEST_ID);
    expect(mockTestModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: TEST_ID, paperType: PaperType.SPRINT },
      { isDeleted: true, isActive: false },
      { new: true },
    );
  });
});
