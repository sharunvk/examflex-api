import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Exam, ExamDocument } from '../exams/schemas/exam.schema';
import { Subject, SubjectDocument } from '../subjects/schemas/subject.schema';
import {
  Question,
  QuestionDocument,
} from '../mock-test-attempts/schemas/question.schema';
import {
  MockTest,
  MockTestDocument,
} from '../mock-tests/schemas/mock-test.schema';
import { MockTestsService } from '../mock-tests/mock-tests.service';
import { AttemptSummaryDto } from '../mock-tests/dto/attempt-summary.dto';
import { PaperType } from '../common/enums/paper-type.enum';
import { AccessMode } from '../common/enums/access-mode.enum';
import { UserAttemptAction } from '../common/enums/user-attempt-action.enum';
import { PaginationMetaDto } from '../common/dto/api-response.dto';
import { PopulatedDocument } from '../common/types/populated-document.interface';
import {
  SprintDraftQuestion,
  SprintTestDraft,
  SprintTestDraftDocument,
} from './schemas/sprint-test-draft.schema';
import { CreateSprintDraftDto } from './dto/create-sprint-draft.dto';
import { PublishSprintDraftDto } from './dto/publish-sprint-draft.dto';
import {
  SprintDraftListItemDto,
  SprintDraftResponseDto,
  SprintDraftSubjectBlockDto,
  SprintQuestionItemDto,
  SprintSearchQuestionItemDto,
} from './dto/sprint-draft-response.dto';
import { SprintTestListItemDto } from './dto/sprint-test-list-item.dto';
import { SafeQuestionDto } from '../mock-test-attempts/dto/start-attempt-response.dto';
import { ImageLike, ImageUrlResolver } from '../aws/s3/image-url.resolver';
import { questionTagNames } from '../questions/question-tag-names';
import {
  assignUpdatedBy,
  updatedByFields,
} from '../common/types/to-actor-object-id';
import {
  ELIGIBLE_DIFFICULTY_LEVELS,
  assertDraftEditable,
  assertIncomingEligible,
  assertQuestionId,
  assertReplacementRules,
  duplicateQuestionSummary,
  isTaggedToExam,
} from '../common/papers/question-replacement';
import { AccessControlService } from '../access/access-control.service';
import { AccessDto, toAccessDto } from '../access/to-access-dto';
import { AccessDecisionReason } from '../common/enums/access-decision-reason.enum';
import { SPRINT_SIZE_OPTIONS } from './dto/create-sprint-draft.dto';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
}

const OPEN_DRAFT_STATUSES = ['REVIEW', 'GENERATING', 'PUBLISHING'] as const;

@Injectable()
export class SprintTestsService {
  constructor(
    @InjectModel(Exam.name) private readonly examModel: Model<ExamDocument>,
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
    @InjectModel(MockTest.name)
    private readonly mockTestModel: Model<MockTestDocument>,
    @InjectModel(SprintTestDraft.name)
    private readonly draftModel: Model<SprintTestDraftDocument>,
    private readonly mockTestsService: MockTestsService,
    private readonly imageUrlResolver: ImageUrlResolver,
    private readonly accessControlService: AccessControlService,
  ) {}

  async createDraft(
    dto: CreateSprintDraftDto,
    userId: string,
  ): Promise<SprintDraftResponseDto> {
    if (!Types.ObjectId.isValid(dto.examId)) {
      throw new BadRequestException({
        message: 'Invalid exam ID',
        error: 'EXAM_NOT_FOUND',
      });
    }

    const exam = await this.examModel.findById(dto.examId).exec();
    if (!exam || !exam.isActive) {
      throw new NotFoundException({
        message: 'Exam not found or inactive',
        error: 'EXAM_NOT_FOUND',
      });
    }

    const marksPerQuestion = dto.marksPerQuestion ?? 1;
    const negativeMarking = dto.negativeMarking ?? 0;
    const picked = dto.questionIds?.length
      ? await this.loadHandPickedQuestions(
          exam._id as Types.ObjectId,
          dto.totalQuestions,
          dto.questionIds,
        )
      : await this.sampleRecentQuestions(
          exam._id as Types.ObjectId,
          dto.totalQuestions,
        );

    const questions: SprintDraftQuestion[] = picked.map(
      (question, position) => ({
        question: question._id as Types.ObjectId,
        subject: question.subject as Types.ObjectId,
        topic: question.topic as Types.ObjectId | undefined,
        difficultyLevel: question.difficultyLevel,
        position,
        marksPerQuestion,
        negativeMarking,
      }),
    );

    const draft = await this.draftModel.create({
      exam: exam._id,
      examName: exam.name,
      createdBy: new Types.ObjectId(userId),
      status: 'REVIEW',
      totalQuestions: dto.totalQuestions,
      durationInMinutes: dto.durationInMinutes,
      title: dto.title?.trim() || undefined,
      description: dto.description?.trim() || undefined,
      marksPerQuestion,
      negativeMarking,
      passingScore: dto.passingScore,
      allowRetake: dto.allowRetake ?? true,
      shuffleOptions: dto.shuffleOptions ?? false,
      showResultsImmediately: dto.showResultsImmediately ?? true,
      accessMode: dto.accessMode ?? AccessMode.FREE,
      questions,
    });

    return this.toDraftResponse(draft);
  }

  async listDrafts(
    examId?: string,
    page = 1,
    limit = 10,
  ): Promise<{
    data: SprintDraftListItemDto[];
    pagination: PaginationMetaDto;
  }> {
    if (examId && !Types.ObjectId.isValid(examId)) {
      throw new BadRequestException('Invalid exam ID');
    }

    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;
    const query: FilterQuery<SprintTestDraftDocument> = {
      status: { $in: [...OPEN_DRAFT_STATUSES] },
    };
    if (examId) {
      query.exam = new Types.ObjectId(examId);
    }

    const [drafts, total] = await Promise.all([
      this.draftModel
        .find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .exec(),
      this.draftModel.countDocuments(query).exec(),
    ]);
    const totalPages = Math.ceil(total / validLimit) || 0;

    return {
      data: drafts.map(draft => ({
        id: draft.id || draft._id.toString(),
        examId: draft.exam.toString(),
        examName: draft.examName || 'Untitled exam',
        status: draft.status,
        totalQuestions: draft.totalQuestions,
        durationInMinutes: draft.durationInMinutes,
        title: draft.title,
        createdAt: draft.createdAt as Date,
        updatedAt: draft.updatedAt as Date,
      })),
      pagination: {
        total,
        page: validPage,
        limit: validLimit,
        totalPages,
        hasNextPage: validPage < totalPages,
        hasPrevPage: validPage > 1,
      },
    };
  }

  async getDraft(draftId: string): Promise<SprintDraftResponseDto> {
    return this.toDraftResponse(await this.loadDraft(draftId));
  }

  async searchQuestions(params: {
    subjectId?: string;
    draftId?: string;
    search?: string;
    topicId?: string;
    difficultyLevel?: string;
    page?: number;
    limit?: number;
    allowCrossSubject?: boolean;
  }): Promise<{
    data: SprintSearchQuestionItemDto[];
    pagination: PaginationMetaDto;
  }> {
    const allowCrossSubject = !!params.allowCrossSubject;
    if (allowCrossSubject && !params.draftId) {
      throw new BadRequestException(
        'draftId is required when allowCrossSubject is true',
      );
    }

    if (!allowCrossSubject) {
      if (!params.subjectId || !Types.ObjectId.isValid(params.subjectId)) {
        throw new BadRequestException('Invalid subject ID');
      }
    } else if (params.subjectId && !Types.ObjectId.isValid(params.subjectId)) {
      throw new BadRequestException('Invalid subject ID');
    }

    const validPage = Math.max(1, params.page || 1);
    const validLimit = Math.min(Math.max(1, params.limit || 20), 50);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<QuestionDocument> = {
      isActive: true,
      difficultyLevel: { $in: [...ELIGIBLE_DIFFICULTY_LEVELS] },
    };

    if (params.subjectId && Types.ObjectId.isValid(params.subjectId)) {
      query.subject = new Types.ObjectId(params.subjectId);
    }

    if (params.topicId) {
      if (!Types.ObjectId.isValid(params.topicId)) {
        throw new BadRequestException('Invalid topic ID');
      }
      query.topic = new Types.ObjectId(params.topicId);
    }

    if (params.difficultyLevel) {
      query.difficultyLevel = params.difficultyLevel;
    }

    if (params.search?.trim()) {
      const term = escapeRegex(params.search.trim());
      query.$or = [
        { 'questionText.en.text': { $regex: term, $options: 'i' } },
        { 'questionText.ml.text': { $regex: term, $options: 'i' } },
      ];
    }

    if (params.draftId) {
      const draft = await this.loadDraft(params.draftId);
      query.exams = draft.exam;
      const exclude = draft.questions.map(question => question.question);
      if (exclude.length) {
        query._id = { $nin: exclude };
      }
    }

    const [docs, total] = await Promise.all([
      this.questionModel
        .find(query)
        .select('-correctAnswer -explanation')
        .populate('tags', 'name')
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .lean()
        .exec(),
      this.questionModel.countDocuments(query).exec(),
    ]);

    const totalPages = Math.ceil(total / validLimit) || 0;
    const safeQuestions = await Promise.all(
      docs.map(question => this.toSafeQuestion(question)),
    );

    return {
      data: safeQuestions.map((safe, index) => {
        const text = docs[index].questionText?.en?.text;
        return {
          ...safe,
          snippet: text ? text.slice(0, 100) : undefined,
        };
      }),
      pagination: {
        total,
        page: validPage,
        limit: validLimit,
        totalPages,
        hasNextPage: validPage < totalPages,
        hasPrevPage: validPage > 1,
      },
    };
  }

  async replaceQuestion(
    draftId: string,
    position: number,
    questionId: string,
    allowCrossSubject = false,
    actorUserId?: string,
  ): Promise<SprintDraftResponseDto> {
    const draft = await this.loadDraft(draftId);
    assertDraftEditable(draft.status);

    const slot = draft.questions.find(
      question => question.position === position,
    );
    if (!slot) {
      throw new BadRequestException(`No question at position ${position}`);
    }

    assertQuestionId(questionId);
    const incoming = await this.questionModel.findById(questionId).exec();
    assertIncomingEligible(incoming);

    assertReplacementRules({
      slotSubjectId: slot.subject.toString(),
      incomingSubjectId: incoming.subject?.toString(),
      incomingQuestionId: incoming._id.toString(),
      draftExamId: draft.exam,
      incomingExams: incoming.exams,
      allowCrossSubject,
      questions: draft.questions,
      position,
    });

    slot.replacedFrom = slot.question;
    slot.question = incoming._id as Types.ObjectId;
    slot.topic = incoming.topic;
    slot.difficultyLevel = incoming.difficultyLevel;
    assignUpdatedBy(draft, actorUserId);
    await draft.save();

    return this.toDraftResponse(draft);
  }

  async publishDraft(
    draftId: string,
    dto: PublishSprintDraftDto,
    userId: string,
  ): Promise<{ mockTestId: string; draft: SprintDraftResponseDto }> {
    if (!Types.ObjectId.isValid(draftId)) {
      throw new BadRequestException('Invalid draft ID');
    }

    const draft = await this.draftModel.findOneAndUpdate(
      { _id: draftId, status: 'REVIEW' },
      { $set: { status: 'PUBLISHING', ...updatedByFields(userId) } },
      { new: true },
    );
    if (!draft) {
      throw new BadRequestException({
        message: 'Draft is not editable',
        error: 'DRAFT_NOT_EDITABLE',
      });
    }

    try {
      return await this.finalizePublish(draft, dto, userId);
    } catch (error) {
      await this.draftModel
        .updateOne(
          { _id: draft._id, status: 'PUBLISHING' },
          { $set: { status: 'REVIEW', ...updatedByFields(userId) } },
        )
        .exec();
      throw error;
    }
  }

  async discardDraft(draftId: string, actorUserId?: string): Promise<void> {
    const draft = await this.loadDraft(draftId);
    if (draft.status === 'PUBLISHED' || draft.status === 'PUBLISHING') {
      throw new BadRequestException({
        message: 'Published drafts cannot be discarded',
        error: 'DRAFT_NOT_EDITABLE',
      });
    }
    draft.status = 'DISCARDED';
    assignUpdatedBy(draft, actorUserId);
    await draft.save();
  }

  async listPublished(
    examId: string | undefined,
    page = 1,
    limit = 10,
    userId?: string,
    includeInactive = false,
  ): Promise<{
    data: SprintTestListItemDto[];
    pagination: PaginationMetaDto;
  }> {
    if (examId && !Types.ObjectId.isValid(examId)) {
      throw new BadRequestException('Invalid exam ID');
    }

    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;
    const query: FilterQuery<MockTestDocument> = {
      paperType: PaperType.SPRINT,
    };
    if (examId) {
      query.exam = new Types.ObjectId(examId);
    }
    if (!includeInactive) {
      query.isActive = true;
    }

    const [tests, total] = await Promise.all([
      this.mockTestModel
        .find(query)
        .populate('exam', '_id name description')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .exec(),
      this.mockTestModel.countDocuments(query).exec(),
    ]);

    const userActions = userId
      ? await this.mockTestsService.getUserAttemptActions(
          tests.map(test => test._id.toString()),
          userId,
        )
      : new Map();

    const accessMap = await this.buildAccessMap(userId, tests);
    const totalPages = Math.ceil(total / validLimit) || 0;
    return {
      data: tests.map(test => {
        const entry = userActions.get(test._id.toString());
        return this.toListItem(
          test,
          entry?.action || UserAttemptAction.START,
          entry?.resumeAttemptId,
          accessMap.get(test._id.toString()),
          entry?.attemptSummary,
        );
      }),
      pagination: {
        total,
        page: validPage,
        limit: validLimit,
        totalPages,
        hasNextPage: validPage < totalPages,
        hasPrevPage: validPage > 1,
      },
    };
  }

  async findOnePublished(
    id: string,
    userId?: string,
    includeQuestions = false,
  ): Promise<SprintTestListItemDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid mock test ID');
    }

    const test = await this.mockTestModel
      .findOne({ _id: id, paperType: PaperType.SPRINT })
      .populate('exam', '_id name description')
      .exec();

    if (!test) {
      throw new NotFoundException('Sprint test not found');
    }

    let action = UserAttemptAction.START;
    let resumeAttemptId: string | undefined;
    let attemptSummary = undefined;
    if (userId) {
      const actions = await this.mockTestsService.getUserAttemptActions(
        [test._id.toString()],
        userId,
      );
      const entry = actions.get(test._id.toString());
      action = entry?.action || UserAttemptAction.START;
      resumeAttemptId = entry?.resumeAttemptId;
      attemptSummary = entry?.attemptSummary;
    }

    const accessMap = await this.buildAccessMap(userId, [test]);
    const item = this.toListItem(
      test,
      action,
      resumeAttemptId,
      accessMap.get(test._id.toString()),
      attemptSummary,
    );
    if (includeQuestions) {
      item.questions = await this.toPublishedQuestions(test);
    }
    return item;
  }

  async removePublished(
    id: string,
    actorUserId?: string,
  ): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid mock test ID');
    }

    const test = await this.mockTestModel
      .findOneAndUpdate(
        { _id: id, paperType: PaperType.SPRINT },
        {
          isDeleted: true,
          isActive: false,
          ...updatedByFields(actorUserId),
        },
        { new: true },
      )
      .exec();

    if (!test) {
      throw new NotFoundException('Sprint test not found');
    }

    return { message: 'Sprint test deleted successfully' };
  }

  private async loadHandPickedQuestions(
    examId: Types.ObjectId,
    totalQuestions: number,
    questionIds: string[],
  ): Promise<
    Array<{
      _id: Types.ObjectId;
      subject?: Types.ObjectId;
      topic?: Types.ObjectId;
      difficultyLevel?: string;
    }>
  > {
    if (
      !(SPRINT_SIZE_OPTIONS as readonly number[]).includes(
        questionIds.length,
      ) ||
      questionIds.length !== totalQuestions
    ) {
      throw new BadRequestException({
        message: `questionIds length (${questionIds.length}) must equal totalQuestions and be one of ${SPRINT_SIZE_OPTIONS.join(', ')}`,
        error: 'QUESTION_COUNT_MISMATCH',
        details: {
          totalQuestions,
          actual: questionIds.length,
          allowed: [...SPRINT_SIZE_OPTIONS],
        },
      });
    }

    const unique = new Set(questionIds);
    if (unique.size !== questionIds.length) {
      throw new BadRequestException({
        message: 'questionIds contains duplicates',
        error: 'DUPLICATE_QUESTION',
      });
    }

    const docs = await this.questionModel
      .find({ _id: { $in: questionIds.map(id => new Types.ObjectId(id)) } })
      .select('_id subject topic difficultyLevel exams isActive')
      .exec();
    const byId = new Map(
      docs.map(question => [question._id.toString(), question]),
    );

    return questionIds.map(id => {
      const question = byId.get(id);
      if (
        !question ||
        !question.isActive ||
        !question.subject ||
        !question.difficultyLevel ||
        !(ELIGIBLE_DIFFICULTY_LEVELS as readonly string[]).includes(
          question.difficultyLevel,
        )
      ) {
        throw new BadRequestException({
          message: 'One or more selected questions are not eligible',
          error: 'QUESTION_NOT_ELIGIBLE',
          details: { questionId: id },
        });
      }
      if (!isTaggedToExam(question.exams, examId)) {
        throw new BadRequestException({
          message: 'Every selected question must be tagged to this exam',
          error: 'EXAM_MISMATCH',
          details: { questionId: id },
        });
      }
      return {
        _id: question._id as Types.ObjectId,
        subject: question.subject as Types.ObjectId,
        topic: question.topic as Types.ObjectId | undefined,
        difficultyLevel: question.difficultyLevel,
      };
    });
  }

  private async sampleRecentQuestions(
    examId: Types.ObjectId,
    count: number,
  ): Promise<
    Array<{
      _id: Types.ObjectId;
      subject?: Types.ObjectId;
      topic?: Types.ObjectId;
      difficultyLevel?: string;
    }>
  > {
    const questions = await this.questionModel
      .find({
        exams: examId,
        isActive: true,
        difficultyLevel: { $in: [...ELIGIBLE_DIFFICULTY_LEVELS] },
        subject: { $ne: null },
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(count)
      .select('_id subject topic difficultyLevel')
      .exec();

    if (questions.length < count) {
      throw new BadRequestException({
        message: 'Not enough questions tagged to this exam',
        error: 'BANK_SHORTAGE',
        details: {
          needed: count,
          available: questions.length,
        },
      });
    }

    return questions.map(question => ({
      _id: question._id as Types.ObjectId,
      subject: question.subject as Types.ObjectId,
      topic: question.topic as Types.ObjectId | undefined,
      difficultyLevel: question.difficultyLevel,
    }));
  }

  private async finalizePublish(
    draft: SprintTestDraftDocument,
    dto: PublishSprintDraftDto,
    userId: string,
  ): Promise<{ mockTestId: string; draft: SprintDraftResponseDto }> {
    const ordered = [...draft.questions].sort(
      (a, b) => a.position - b.position,
    );
    this.assertNoDuplicateQuestions(ordered);

    if (ordered.length !== draft.totalQuestions) {
      throw new BadRequestException({
        message: `Paper has ${ordered.length} questions but the sprint requires ${draft.totalQuestions}`,
        error: 'PAPER_INCOMPLETE',
        details: {
          expected: draft.totalQuestions,
          actual: ordered.length,
        },
      });
    }

    const questionIds = ordered
      .map(question => question.question)
      .filter(Boolean);
    if (questionIds.length !== ordered.length) {
      throw new BadRequestException({
        message: 'Draft questions are missing question ids',
        error: 'PAPER_INCOMPLETE',
      });
    }

    await this.assertQuestionsEligibleForPublish(questionIds);
    await this.assertQuestionsTaggedToExam(questionIds, draft.exam);

    const marksPerQuestion = dto.marksPerQuestion ?? draft.marksPerQuestion;
    const negativeMarking = dto.negativeMarking ?? draft.negativeMarking;
    const title = dto.title || draft.title || draft.examName;
    const description =
      dto.description !== undefined ? dto.description : draft.description;

    const mockTest = await this.mockTestModel.create({
      paperType: PaperType.SPRINT,
      accessMode: dto.accessMode ?? draft.accessMode ?? AccessMode.FREE,
      totalQuestions: draft.totalQuestions,
      durationInMinutes: draft.durationInMinutes,
      exam: draft.exam,
      title,
      description,
      generationMode: 'STATIC',
      questionIds,
      marksPerQuestion,
      negativeMarking,
      passingScore:
        dto.passingScore !== undefined ? dto.passingScore : draft.passingScore,
      allowRetake: dto.allowRetake ?? draft.allowRetake,
      shuffleOptions: dto.shuffleOptions ?? draft.shuffleOptions,
      showResultsImmediately:
        dto.showResultsImmediately ?? draft.showResultsImmediately,
      isSessionWise: false,
      isActive: true,
      isDeleted: false,
      createdBy: new Types.ObjectId(userId),
    });

    draft.status = 'PUBLISHED';
    draft.publishedMockTestId = mockTest._id as Types.ObjectId;
    draft.title = title;
    draft.description = description;
    draft.marksPerQuestion = marksPerQuestion;
    draft.negativeMarking = negativeMarking;
    draft.passingScore =
      dto.passingScore !== undefined ? dto.passingScore : draft.passingScore;
    draft.allowRetake = dto.allowRetake ?? draft.allowRetake;
    draft.shuffleOptions = dto.shuffleOptions ?? draft.shuffleOptions;
    draft.showResultsImmediately =
      dto.showResultsImmediately ?? draft.showResultsImmediately;
    draft.accessMode = dto.accessMode ?? draft.accessMode ?? AccessMode.FREE;
    assignUpdatedBy(draft, userId);
    await draft.save();

    return {
      mockTestId: mockTest.id || mockTest._id.toString(),
      draft: await this.toDraftResponse(draft),
    };
  }

  private async assertQuestionsTaggedToExam(
    questionIds: Array<{ toString(): string }>,
    examId: { toString(): string },
  ): Promise<void> {
    const docs = await this.questionModel
      .find({ _id: { $in: questionIds } })
      .select('_id exams')
      .lean()
      .exec();
    const byId = new Map(docs.map(doc => [doc._id.toString(), doc.exams]));
    const missing = questionIds
      .map(id => id.toString())
      .filter(id => !isTaggedToExam(byId.get(id), examId));

    if (missing.length === 0) {
      return;
    }

    throw new BadRequestException({
      message: 'Every sprint question must stay tagged to this exam',
      error: 'EXAM_MISMATCH',
      details: { questionIds: missing },
    });
  }

  private async assertQuestionsEligibleForPublish(
    questionIds: Array<{ toString(): string }>,
  ): Promise<void> {
    if (questionIds.length === 0) {
      throw new BadRequestException({
        message: 'Draft has no questions to publish',
        error: 'PAPER_INCOMPLETE',
      });
    }

    const live = await this.questionModel
      .find({
        _id: { $in: questionIds },
        isActive: true,
        difficultyLevel: { $in: [...ELIGIBLE_DIFFICULTY_LEVELS] },
      })
      .select('_id')
      .lean()
      .exec();

    if (live.length === questionIds.length) {
      return;
    }

    const liveIds = new Set(live.map(question => question._id.toString()));
    const missing = questionIds
      .map(id => id.toString())
      .filter(id => !liveIds.has(id));

    throw new BadRequestException({
      message:
        'One or more questions are no longer eligible (inactive, deleted, or missing difficulty). Replace them before publishing.',
      error: 'QUESTION_NOT_ELIGIBLE',
      details: { questionIds: missing },
    });
  }

  private assertNoDuplicateQuestions(
    questions: Array<{ question?: { toString(): string }; position?: number }>,
  ): void {
    const duplicates = duplicateQuestionSummary(questions);
    if (duplicates.length === 0) {
      return;
    }

    const summary = duplicates
      .map(
        row =>
          `question ${row.questionId} at positions ${row.displayPositions.join(', ')}`,
      )
      .join('; ');

    throw new BadRequestException({
      message: `This paper contains duplicate questions. ${summary}. Replace the extra copies before publishing.`,
      error: 'DUPLICATE_QUESTION',
      details: duplicates,
    });
  }

  private async loadDraft(draftId: string): Promise<SprintTestDraftDocument> {
    if (!Types.ObjectId.isValid(draftId)) {
      throw new BadRequestException('Invalid draft ID');
    }
    const draft = await this.draftModel.findById(draftId).exec();
    if (!draft || draft.status === 'DISCARDED') {
      throw new NotFoundException('Draft not found');
    }
    return draft;
  }

  private async toDraftResponse(
    draft: SprintTestDraftDocument,
  ): Promise<SprintDraftResponseDto> {
    const questionIds = draft.questions.map(question => question.question);
    const docs = questionIds.length
      ? await this.questionModel
          .find({ _id: { $in: questionIds } })
          .select('-explanation')
          .populate('tags', 'name')
          .lean()
          .exec()
      : [];
    const byId = new Map(
      docs.map(question => [question._id.toString(), question]),
    );
    const subjects = await this.groupDraftSubjects(draft, byId);

    return {
      id: draft.id || draft._id.toString(),
      examId: draft.exam.toString(),
      examName: draft.examName || 'Untitled exam',
      status: draft.status,
      settings: {
        totalQuestions: draft.totalQuestions,
        durationInMinutes: draft.durationInMinutes,
        title: draft.title,
        description: draft.description,
        marksPerQuestion: draft.marksPerQuestion,
        negativeMarking: draft.negativeMarking,
        passingScore: draft.passingScore,
        allowRetake: draft.allowRetake,
        shuffleOptions: draft.shuffleOptions,
        showResultsImmediately: draft.showResultsImmediately,
        accessMode: draft.accessMode ?? AccessMode.FREE,
      },
      subjects,
      publishedMockTestId: draft.publishedMockTestId?.toString(),
      createdAt: draft.createdAt as Date,
      updatedAt: draft.updatedAt as Date,
    };
  }

  private async groupDraftSubjects(
    draft: SprintTestDraftDocument,
    byId: Map<string, QuestionDocument | Record<string, unknown>>,
  ): Promise<SprintDraftSubjectBlockDto[]> {
    const ordered = [...draft.questions].sort(
      (a, b) => a.position - b.position,
    );
    const subjectOrder: string[] = [];
    const buckets = new Map<string, SprintDraftQuestion[]>();
    for (const question of ordered) {
      const key = question.subject.toString();
      if (!buckets.has(key)) {
        subjectOrder.push(key);
        buckets.set(key, []);
      }
      buckets.get(key)!.push(question);
    }

    const subjectDocs = subjectOrder.length
      ? await this.subjectModel
          .find({
            _id: { $in: subjectOrder.map(id => new Types.ObjectId(id)) },
          })
          .select('name')
          .lean()
          .exec()
      : [];
    const names = new Map(
      subjectDocs.map(subject => [
        (subject._id as Types.ObjectId).toString(),
        subject.name,
      ]),
    );

    return Promise.all(
      subjectOrder.map(async subjectId => {
        const questions = await Promise.all(
          (buckets.get(subjectId) || []).map(question =>
            this.toDraftQuestionItem(
              question,
              byId.get(question.question.toString()),
            ),
          ),
        );
        return {
          subjectId,
          name: names.get(subjectId) || subjectId,
          questions,
        };
      }),
    );
  }

  private async toDraftQuestionItem(
    slot: SprintDraftQuestion,
    doc: unknown,
  ): Promise<SprintQuestionItemDto> {
    const safe = doc
      ? await this.toSafeQuestion(
          doc as Parameters<SprintTestsService['toSafeQuestion']>[0],
        )
      : {
          _id: slot.question.toString(),
          questionText: {
            en: { text: null, imageUrl: null },
            ml: { text: null, imageUrl: null },
          },
          options: [],
          subject: slot.subject.toString(),
          topic: slot.topic?.toString(),
          difficultyLevel: slot.difficultyLevel,
          tags: [],
        };

    return {
      ...safe,
      // Admin-only draft review: expose the right answer (option id).
      correctAnswer: (doc as { correctAnswer?: string } | null | undefined)
        ?.correctAnswer,
      position: slot.position,
      marksPerQuestion: slot.marksPerQuestion,
      negativeMarking: slot.negativeMarking,
      replacedFrom: slot.replacedFrom?.toString(),
    };
  }

  private async toPublishedQuestions(
    test: MockTestDocument,
  ): Promise<SprintQuestionItemDto[]> {
    const ids = (test.questionIds || []).map(id => id.toString());
    if (!ids.length) {
      return [];
    }
    const docs = await this.questionModel
      .find({ _id: { $in: ids } })
      .select('-explanation')
      .populate('tags', 'name')
      .lean()
      .exec();
    const byId = new Map(
      docs.map(question => [question._id.toString(), question]),
    );

    return Promise.all(
      ids.map(async (id, position) => {
        const doc = byId.get(id);
        const safe = doc
          ? await this.toSafeQuestion(doc)
          : {
              _id: id,
              questionText: {
                en: { text: null, imageUrl: null },
                ml: { text: null, imageUrl: null },
              },
              options: [],
              tags: [],
            };
        return {
          ...safe,
          // Admin-only published view: expose the right answer (option id).
          correctAnswer: (doc as { correctAnswer?: string } | undefined)
            ?.correctAnswer,
          position,
          marksPerQuestion: test.marksPerQuestion,
          negativeMarking: test.negativeMarking,
        };
      }),
    );
  }

  private toListItem(
    test: MockTestDocument,
    userAttemptAction: UserAttemptAction,
    resumeAttemptId?: string,
    access?: AccessDto,
    attemptSummary?: AttemptSummaryDto,
  ): SprintTestListItemDto {
    const examDoc = test.exam as unknown as PopulatedDocument;
    const totalQuestions = test.totalQuestions ?? 0;
    const marksPerQuestion = test.marksPerQuestion ?? 0;
    return {
      id: test.id || test._id.toString(),
      accessMode: test.accessMode ?? AccessMode.FREE,
      access: access ?? this.defaultAccessDto(test.accessMode),
      title: test.title,
      description: test.description,
      totalQuestions,
      durationInMinutes: test.durationInMinutes,
      totalMarks: totalQuestions * marksPerQuestion,
      exam: test.exam
        ? {
            id: examDoc?._id?.toString() || test.exam.toString(),
            name: examDoc?.name || '',
            description: examDoc?.description,
          }
        : null,
      marksPerQuestion,
      negativeMarking: test.negativeMarking,
      passingScore: test.passingScore,
      allowRetake: test.allowRetake,
      shuffleOptions: test.shuffleOptions,
      showResultsImmediately: test.showResultsImmediately,
      isActive: test.isActive,
      createdAt: test.createdAt as Date,
      updatedAt: test.updatedAt as Date,
      userAttemptAction,
      resumeAttemptId,
      attemptSummary,
    };
  }

  private async buildAccessMap(
    userId: string | undefined,
    tests: MockTestDocument[],
  ): Promise<Map<string, AccessDto>> {
    const decisions = await this.accessControlService.resolveAccessForMockTests(
      userId,
      tests.map(test => ({
        id: test._id.toString(),
        accessMode: test.accessMode ?? AccessMode.FREE,
        examId: this.examIdOf(test),
        isActive: test.isActive !== false,
      })),
    );
    const map = new Map<string, AccessDto>();
    for (const [id, decision] of decisions) {
      map.set(id, toAccessDto(decision));
    }
    return map;
  }

  private examIdOf(test: MockTestDocument): string | null {
    const exam = test.exam as unknown as
      | { _id?: { toString(): string }; toString(): string }
      | Types.ObjectId
      | string
      | null
      | undefined;
    if (!exam) {
      return null;
    }
    if (typeof exam === 'string') {
      return exam;
    }
    if (typeof exam === 'object' && '_id' in exam && exam._id) {
      return exam._id.toString();
    }
    return exam.toString();
  }

  private defaultAccessDto(accessMode?: AccessMode | string): AccessDto {
    if (accessMode === AccessMode.ENTITLED) {
      return {
        allowed: false,
        reason: AccessDecisionReason.ENTITLEMENT_REQUIRED,
      };
    }
    return {
      allowed: true,
      reason: AccessDecisionReason.ALLOWED,
    };
  }

  private async toSafeQuestion(question: {
    _id: { toString(): string };
    questionText?: {
      en?: { text?: string; image?: ImageLike };
      ml?: { text?: string; image?: ImageLike };
    };
    optionType?: string;
    options?: Array<{
      id: string;
      type: string;
      en?: string | null;
      ml?: string | null;
      image?: ImageLike;
    }>;
    subject?: { toString(): string };
    topic?: { toString(): string };
    difficultyLevel?: string;
    tags?: unknown;
  }): Promise<SafeQuestionDto> {
    const images: ImageLike[] = [
      question.questionText?.en?.image,
      question.questionText?.ml?.image,
      ...(question.options || []).map(option => option.image),
    ];
    const urls = await this.imageUrlResolver.resolveMany(images);
    let cursor = 0;
    const enUrl = urls[cursor++];
    const mlUrl = urls[cursor++];

    return {
      _id: question._id.toString(),
      questionText: {
        en: {
          text: question.questionText?.en?.text || null,
          imageUrl: enUrl,
        },
        ml: {
          text: question.questionText?.ml?.text || null,
          imageUrl: mlUrl,
        },
      },
      optionType: question.optionType,
      options:
        question.options?.map(option => ({
          id: option.id,
          type: option.type,
          en: option.en,
          ml: option.ml,
          imageUrl: urls[cursor++],
        })) || [],
      subject: question.subject?.toString(),
      topic: question.topic?.toString(),
      difficultyLevel: question.difficultyLevel,
      tags: questionTagNames(question),
    };
  }
}
