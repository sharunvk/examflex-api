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
import { PaperType } from '../common/enums/paper-type.enum';
import { AccessMode } from '../common/enums/access-mode.enum';
import { UserAttemptAction } from '../common/enums/user-attempt-action.enum';
import { PaginationMetaDto } from '../common/dto/api-response.dto';
import { PopulatedDocument } from '../common/types/populated-document.interface';
import { FullMockSelectionService } from './full-mock-selection.service';
import {
  assignUpdatedBy,
  updatedByFields,
} from '../common/types/to-actor-object-id';
import {
  DraftQuestion,
  FullMockTestDraft,
  FullMockTestDraftDocument,
} from './schemas/full-mock-test-draft.schema';
import { CreateDraftDto } from './dto/create-draft.dto';
import { PublishDraftDto } from './dto/publish-draft.dto';
import { UpdateCourseCutoffsDto } from './dto/course-cutoff.dto';
import {
  duplicateOfferingIds,
  mergeCutoffs,
  normalizeCutoffInput,
  NormalizedCourseCutoff,
  paperTotalMarks,
} from './course-cutoffs';
import {
  RecommendationOffering,
  RecommendationOfferingDocument,
} from '../recommendations/schemas/recommendation-offering.schema';
import { RecommendationKind } from '../recommendations/enums/recommendation-kind.enum';
import { FullMockExamListItemDto } from './dto/exam-list-item.dto';
import {
  DraftResponseDto,
  DraftSubjectBlockDto,
} from './dto/draft-response.dto';
import { AttemptSummaryDto } from '../mock-tests/dto/attempt-summary.dto';
import { FullMockTestListItemDto } from './dto/full-mock-test-list-item.dto';
import { DraftListItemDto } from './dto/draft-list-item.dto';
import { SafeQuestionDto } from '../mock-test-attempts/dto/start-attempt-response.dto';
import { SearchQuestionItemDto } from './dto/search-question-item.dto';
import { ImageLike, ImageUrlResolver } from '../aws/s3/image-url.resolver';
import { questionTagNames } from '../questions/question-tag-names';
import { AccessControlService } from '../access/access-control.service';
import { AccessDto, toAccessDto } from '../access/to-access-dto';
import { AccessDecisionReason } from '../common/enums/access-decision-reason.enum';
import {
  assertDraftEditable,
  assertIncomingEligible,
  assertQuestionId,
  assertReplacementRules,
  duplicateQuestionSummary,
} from '../common/papers/question-replacement';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
}

@Injectable()
export class FullMockTestsService {
  constructor(
    @InjectModel(Exam.name) private readonly examModel: Model<ExamDocument>,
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
    @InjectModel(MockTest.name)
    private readonly mockTestModel: Model<MockTestDocument>,
    @InjectModel(FullMockTestDraft.name)
    private readonly draftModel: Model<FullMockTestDraftDocument>,
    @InjectModel(RecommendationOffering.name)
    private readonly offeringModel: Model<RecommendationOfferingDocument>,
    private readonly selectionService: FullMockSelectionService,
    private readonly mockTestsService: MockTestsService,
    private readonly imageUrlResolver: ImageUrlResolver,
    private readonly accessControlService: AccessControlService,
  ) {}

  async listExamsForAdmin(
    page = 1,
    limit = 10,
    search?: string,
  ): Promise<{
    data: FullMockExamListItemDto[];
    pagination: PaginationMetaDto;
  }> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<ExamDocument> = { isActive: true };
    if (search?.trim()) {
      const term = escapeRegex(search.trim());
      query.$or = [
        { name: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } },
      ];
    }

    const [exams, total] = await Promise.all([
      this.examModel
        .find(query)
        .populate('category', 'name')
        .populate('examGroup', 'name')
        .sort({ name: 1 })
        .skip(skip)
        .limit(validLimit)
        .exec(),
      this.examModel.countDocuments(query).exec(),
    ]);

    const subjectIds = [
      ...new Set(
        exams.flatMap(exam =>
          Array.from(exam.subjects || [])
            .map(row => this.subjectIdFromRow(row))
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    ];
    const subjects = subjectIds.length
      ? await this.subjectModel
          .find({ _id: { $in: subjectIds.map(id => new Types.ObjectId(id)) } })
          .select('_id name')
          .lean()
          .exec()
      : [];
    const subjectNameById = new Map(
      subjects.map(s => [s._id.toString(), s.name]),
    );

    const totalPages = Math.ceil(total / validLimit) || 0;

    return {
      data: exams.map(exam => {
        const category = exam.category as unknown as PopulatedDocument;
        const examGroup = exam.examGroup as unknown as PopulatedDocument;
        return {
          id: exam._id.toString(),
          examName: exam.name,
          duration: exam.duration != null ? `${exam.duration} mins` : undefined,
          questions: exam.totalQuestions,
          totalMarks: exam.totalMarks,
          category: category?.name,
          examGroup: examGroup?.name || undefined,
          subjects: Array.from(exam.subjects || [])
            .map(row => {
              const id = this.subjectIdFromRow(row);
              return id ? subjectNameById.get(id) || id : undefined;
            })
            .filter((name): name is string => Boolean(name)),
          subjectDetails: Array.from(exam.subjects || [])
            .map(row => {
              const id = this.subjectIdFromRow(row);
              return id
                ? {
                    subjectId: id,
                    name: subjectNameById.get(id) || id,
                    numberOfQuestions: row.numberOfQuestions || 0,
                  }
                : undefined;
            })
            .filter((detail): detail is NonNullable<typeof detail> => !!detail),
          mode: exam.isSessionWise ? 'Session-wise' : 'Mixed',
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

  async createDraft(
    dto: CreateDraftDto,
    userId: string,
  ): Promise<DraftResponseDto> {
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

    const { questions, subjectNames } =
      await this.selectionService.generatePaper(
        exam,
        dto.difficultyDistribution,
      );
    const arranged = this.selectionService.arrangePaperQuestions(
      questions,
      exam.subjects,
      !!exam.isSessionWise,
    );
    this.assertNoDuplicateQuestions(arranged);

    const draft = await this.draftModel.create({
      exam: exam._id,
      createdBy: new Types.ObjectId(userId),
      status: 'REVIEW',
      examSnapshot: {
        name: exam.name,
        description: exam.description,
        duration: exam.duration,
        totalQuestions: exam.totalQuestions,
        totalMarks: exam.totalMarks,
        isSessionWise: exam.isSessionWise,
        subjects: exam.subjects.map(row => ({
          subject: row.subject,
          name: subjectNames.get(row.subject.toString()) || '',
          numberOfQuestions: row.numberOfQuestions,
          marksPerQuestion: row.marksPerQuestion,
          hasNegativeMarking: row.hasNegativeMarking,
          negativeMarksPerQuestion: row.negativeMarksPerQuestion || 0,
          sessionTime: row.sessionTime,
        })),
      },
      questions: arranged,
    });

    return this.toDraftResponse(draft);
  }

  async getDraft(draftId: string): Promise<DraftResponseDto> {
    const draft = await this.loadDraft(draftId);
    return this.toDraftResponse(draft);
  }

  async listDrafts(
    examId?: string,
    page = 1,
    limit = 10,
  ): Promise<{
    data: DraftListItemDto[];
    pagination: PaginationMetaDto;
  }> {
    if (examId && !Types.ObjectId.isValid(examId)) {
      throw new BadRequestException('Invalid exam ID');
    }

    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<FullMockTestDraftDocument> = {
      status: { $in: ['REVIEW', 'GENERATING', 'PUBLISHING'] },
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
        examName: draft.examSnapshot?.name || 'Untitled exam',
        status: draft.status,
        totalQuestions: draft.examSnapshot?.totalQuestions ?? 0,
        totalMarks: draft.examSnapshot?.totalMarks,
        duration: draft.examSnapshot?.duration,
        isSessionWise: draft.examSnapshot?.isSessionWise || false,
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
    data: SearchQuestionItemDto[];
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
      difficultyLevel: { $in: ['easy', 'medium', 'hard'] },
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
      const exclude = draft.questions.map(q => q.question);
      if (exclude.length) {
        query._id = { $nin: exclude };
      }
    }

    const [docs, total] = await Promise.all([
      this.questionModel
        .find(query)
        .select('-correctAnswer -explanation')
        .populate('tags', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .lean()
        .exec(),
      this.questionModel.countDocuments(query).exec(),
    ]);

    const totalPages = Math.ceil(total / validLimit) || 0;

    const safeQuestions = await Promise.all(
      docs.map(q => this.toSafeQuestion(q)),
    );

    return {
      data: safeQuestions.map((safe, index) => {
        const snippet = docs[index].questionText?.en?.text
          ? docs[index].questionText.en.text.slice(0, 100)
          : undefined;
        return { ...safe, snippet };
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
  ): Promise<DraftResponseDto> {
    const draft = await this.loadDraft(draftId);
    assertDraftEditable(draft.status);

    const slot = draft.questions.find(q => q.position === position);
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
    dto: PublishDraftDto,
    userId: string,
  ): Promise<{ mockTestId: string; draft: DraftResponseDto }> {
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

  private async finalizePublish(
    draft: FullMockTestDraftDocument,
    dto: PublishDraftDto,
    userId: string,
  ): Promise<{ mockTestId: string; draft: DraftResponseDto }> {
    const snapshot = draft.examSnapshot;
    // Session-wise always stays in exam subject/session order.
    // Mixed stays in the shuffled draft order unless keepSubjectOrder is set,
    // in which case subjects become contiguous blocks in exam order.
    const ordered =
      snapshot.isSessionWise || dto.keepSubjectOrder
        ? this.groupQuestionsBySubjectOrder(draft.questions, snapshot.subjects)
        : draft.questions.map((q, position) =>
            this.cloneDraftQuestion(q, position),
          );
    this.assertNoDuplicateQuestions(ordered);
    if (
      snapshot.totalQuestions != null &&
      ordered.length !== snapshot.totalQuestions
    ) {
      throw new BadRequestException({
        message: `Paper has ${ordered.length} questions but the exam requires ${snapshot.totalQuestions}`,
        error: 'PAPER_INCOMPLETE',
        details: {
          expected: snapshot.totalQuestions,
          actual: ordered.length,
        },
      });
    }
    const questionIds = ordered.map(q => q.question).filter(Boolean);
    if (questionIds.length !== ordered.length) {
      throw new BadRequestException({
        message: 'Draft questions are missing question ids',
        error: 'PAPER_INCOMPLETE',
      });
    }
    await this.assertQuestionsEligibleForPublish(questionIds);

    const courseCutoffs = normalizeCutoffInput(dto.courseCutoffs ?? []);
    await this.assertCourseCutoffs(
      draft.exam,
      courseCutoffs,
      paperTotalMarks(snapshot),
    );

    const subjectConfig = snapshot.subjects.map(row => {
      const indices = ordered
        .map((q, i) => ({ q, i }))
        .filter(entry => entry.q.subject.toString() === row.subject.toString())
        .map(entry => entry.i);
      const start = indices.length ? Math.min(...indices) : 0;
      const end = indices.length ? Math.max(...indices) : -1;
      return {
        subject: row.subject,
        name: row.name,
        numberOfQuestions: row.numberOfQuestions,
        marksPerQuestion: row.marksPerQuestion,
        hasNegativeMarking: row.hasNegativeMarking,
        negativeMarksPerQuestion: row.negativeMarksPerQuestion,
        sessionTime: row.sessionTime,
        questionStartIndex: start,
        questionEndIndex: end,
        questionIds: ordered
          .filter(q => q.subject.toString() === row.subject.toString())
          .map(q => q.question),
      };
    });

    const durationInMinutes = snapshot.isSessionWise
      ? snapshot.subjects.reduce((sum, row) => sum + (row.sessionTime || 0), 0)
      : snapshot.duration || 0;

    const firstSubject = snapshot.subjects[0];

    const mockTest = await this.mockTestModel.create({
      paperType: PaperType.FULL_EXAM,
      accessMode: dto.accessMode ?? AccessMode.FREE,
      totalQuestions: snapshot.totalQuestions,
      durationInMinutes,
      exam: draft.exam,
      title: dto.title || snapshot.name,
      description: dto.description,
      generationMode: 'STATIC',
      questionIds,
      marksPerQuestion: firstSubject?.marksPerQuestion ?? 1,
      negativeMarking: firstSubject?.hasNegativeMarking
        ? firstSubject.negativeMarksPerQuestion
        : 0,
      totalMarks: snapshot.totalMarks,
      isSessionWise: snapshot.isSessionWise,
      subjectConfig,
      ...(courseCutoffs.length > 0
        ? {
            courseCutoffs: courseCutoffs.map(entry => ({
              offering: new Types.ObjectId(entry.offeringId),
              cutoffMarks: entry.cutoffMarks as number,
            })),
          }
        : {}),
      passingScore: dto.passingScore,
      allowRetake: dto.allowRetake ?? true,
      shuffleOptions: dto.shuffleOptions ?? false,
      showResultsImmediately: dto.showResultsImmediately ?? true,
      isActive: true,
      isDeleted: false,
      createdBy: new Types.ObjectId(userId),
    });

    await this.questionModel.updateMany(
      { _id: { $in: questionIds } },
      {
        $inc: { fullMockUsageCount: 1 },
        $set: { lastUsedInFullMockAt: new Date() },
      },
    );

    draft.status = 'PUBLISHED';
    draft.publishedMockTestId = mockTest._id as Types.ObjectId;
    assignUpdatedBy(draft, userId);
    await draft.save();

    return {
      mockTestId: mockTest.id || mockTest._id.toString(),
      draft: await this.toDraftResponse(draft),
    };
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
    data: FullMockTestListItemDto[];
    pagination: PaginationMetaDto;
  }> {
    if (examId && !Types.ObjectId.isValid(examId)) {
      throw new BadRequestException('Invalid exam ID');
    }

    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<MockTestDocument> = {
      paperType: PaperType.FULL_EXAM,
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
        .sort({ accessMode: -1, createdAt: 1 })
        .skip(skip)
        .limit(validLimit)
        .exec(),
      this.mockTestModel.countDocuments(query).exec(),
    ]);

    const userActions = await (userId
      ? this.mockTestsService.getUserAttemptActions(
          tests.map(t => t._id.toString()),
          userId,
        )
      : Promise.resolve(new Map()));

    const accessMap = await this.buildAccessMap(userId, tests);
    const totalPages = Math.ceil(total / validLimit) || 0;

    return {
      data: tests.map(test => {
        const entry = userActions.get(test._id.toString());
        const item = this.toListItem(
          test,
          entry?.action ?? UserAttemptAction.START,
          entry?.resumeAttemptId,
          accessMap.get(test._id.toString()),
          entry?.attemptSummary,
        );
        if (includeInactive) {
          item.courseCutoffs = this.toCourseCutoffDtos(test);
        }
        return item;
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
  ): Promise<FullMockTestListItemDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid mock test ID');
    }

    const test = await this.mockTestModel
      .findOne({
        _id: id,
        paperType: PaperType.FULL_EXAM,
      })
      .populate('exam', '_id name description')
      .exec();

    if (!test) {
      throw new NotFoundException('Full mock test not found');
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
      item.subjects = await this.toPublishedSubjects(test);
      item.courseCutoffs = this.toCourseCutoffDtos(test);
    }
    return item;
  }

  /**
   * Admin-only. Upsert / clear per-course cut-offs on a published full mock.
   * Touches `courseCutoffs` (and the audit actor) and nothing else, so the
   * frozen paper snapshot can never change through this path.
   */
  async updateCourseCutoffs(
    id: string,
    dto: UpdateCourseCutoffsDto,
    actorUserId?: string,
  ): Promise<FullMockTestListItemDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid mock test ID');
    }

    const test = await this.mockTestModel
      .findOne({ _id: id, paperType: PaperType.FULL_EXAM })
      .exec();
    if (!test) {
      throw new NotFoundException('Full mock test not found');
    }

    const incoming = normalizeCutoffInput(dto.courseCutoffs);
    await this.assertCourseCutoffs(
      test.exam,
      incoming,
      paperTotalMarks({
        totalMarks: test.totalMarks,
        subjects: test.subjectConfig,
      }),
    );

    const merged = mergeCutoffs(test.courseCutoffs ?? [], incoming);
    const updated = await this.mockTestModel
      .findOneAndUpdate(
        { _id: id, paperType: PaperType.FULL_EXAM },
        {
          $set: {
            courseCutoffs: merged.map(entry => ({
              offering: new Types.ObjectId(entry.offeringId),
              cutoffMarks: entry.cutoffMarks,
            })),
            ...updatedByFields(actorUserId),
          },
        },
        { new: true },
      )
      .populate('exam', '_id name description')
      .exec();
    if (!updated) {
      throw new NotFoundException('Full mock test not found');
    }

    const item = this.toListItem(updated, UserAttemptAction.START);
    item.courseCutoffs = this.toCourseCutoffDtos(updated);
    return item;
  }

  private toCourseCutoffDtos(test: MockTestDocument) {
    return (test.courseCutoffs ?? []).map(entry => ({
      offeringId: entry.offering.toString(),
      cutoffMarks: entry.cutoffMarks,
    }));
  }

  /**
   * Every cut-off being set must point at an active COURSE of the paper's
   * exam and sit inside the paper's mark range. Entries that only clear a
   * cut-off (`null`) are not checked against the course, so an admin can
   * still remove a cut-off for a course that was deactivated since.
   */
  private async assertCourseCutoffs(
    examId: Types.ObjectId,
    entries: NormalizedCourseCutoff[],
    totalMarks: number,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const duplicates = duplicateOfferingIds(entries);
    if (duplicates.length > 0) {
      throw new BadRequestException({
        message: 'Each course can have only one cut-off',
        error: 'DUPLICATE_COURSE_CUTOFF',
        details: { offeringIds: duplicates },
      });
    }

    const setting = entries.filter(entry => entry.cutoffMarks !== null);
    if (setting.length === 0) {
      return;
    }

    const offerings = await this.offeringModel
      .find({
        _id: { $in: setting.map(e => new Types.ObjectId(e.offeringId)) },
      })
      .select('exam kind isActive')
      .exec();
    const byId = new Map(offerings.map(o => [o._id.toString(), o]));

    const missing = setting
      .filter(entry => !byId.has(entry.offeringId))
      .map(entry => entry.offeringId);
    if (missing.length > 0) {
      throw new BadRequestException({
        message: 'Course not found',
        error: 'COURSE_NOT_FOUND',
        details: { offeringIds: missing },
      });
    }

    const ineligible = setting
      .filter(entry => {
        const offering = byId.get(entry.offeringId)!;
        return (
          offering.kind !== RecommendationKind.COURSE ||
          offering.isActive !== true ||
          offering.exam.toString() !== examId.toString()
        );
      })
      .map(entry => entry.offeringId);
    if (ineligible.length > 0) {
      throw new BadRequestException({
        message:
          "Cut-offs can only be set for active courses of this paper's exam",
        error: 'COURSE_NOT_ELIGIBLE',
        details: { offeringIds: ineligible },
      });
    }

    const outOfRange = setting
      .filter(
        entry =>
          (entry.cutoffMarks as number) <= 0 ||
          (totalMarks > 0 && (entry.cutoffMarks as number) > totalMarks),
      )
      .map(entry => entry.offeringId);
    if (outOfRange.length > 0) {
      throw new BadRequestException({
        message: `Cut-off must be greater than 0 and at most the paper's total marks (${totalMarks})`,
        error: 'CUTOFF_OUT_OF_RANGE',
        details: { offeringIds: outOfRange, totalMarks },
      });
    }
  }

  private async loadDraft(draftId: string): Promise<FullMockTestDraftDocument> {
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
    draft: FullMockTestDraftDocument,
  ): Promise<DraftResponseDto> {
    const questionIds = draft.questions.map(q => q.question);
    const docs = questionIds.length
      ? await this.questionModel
          .find({ _id: { $in: questionIds } })
          .select('-explanation')
          .populate('tags', 'name')
          .lean()
          .exec()
      : [];
    const byId = new Map(docs.map(q => [q._id.toString(), q]));

    const subjects = await Promise.all(
      draft.examSnapshot.subjects.map(async row => {
        const blockSource = draft.questions
          .filter(q => q.subject.toString() === row.subject.toString())
          .sort((a, b) => a.position - b.position);

        const blockQuestions = await Promise.all(
          blockSource.map(async q => {
            const doc = byId.get(q.question.toString());
            const safe = doc
              ? await this.toSafeQuestion(doc)
              : {
                  _id: q.question.toString(),
                  questionText: {
                    en: { text: null, imageUrl: null },
                    ml: { text: null, imageUrl: null },
                  },
                  options: [],
                  subject: q.subject.toString(),
                  topic: q.topic?.toString(),
                  difficultyLevel: q.difficultyLevel,
                  tags: [],
                };
            return {
              ...safe,
              // Admin-only draft review: expose the right answer (option id).
              correctAnswer: (doc as { correctAnswer?: string } | undefined)
                ?.correctAnswer,
              position: q.position,
              marksPerQuestion: q.marksPerQuestion,
              negativeMarking: q.negativeMarking,
              replacedFrom: q.replacedFrom?.toString(),
            };
          }),
        );

        return {
          subjectId: row.subject.toString(),
          name: row.name,
          numberOfQuestions: row.numberOfQuestions,
          marksPerQuestion: row.marksPerQuestion,
          hasNegativeMarking: row.hasNegativeMarking,
          negativeMarksPerQuestion: row.negativeMarksPerQuestion,
          sessionTime: row.sessionTime,
          questions: blockQuestions,
        };
      }),
    );

    return {
      id: draft.id || draft._id.toString(),
      examId: draft.exam.toString(),
      status: draft.status,
      examSnapshot: {
        name: draft.examSnapshot.name,
        description: draft.examSnapshot.description,
        duration: draft.examSnapshot.duration,
        totalQuestions: draft.examSnapshot.totalQuestions,
        totalMarks: draft.examSnapshot.totalMarks,
        isSessionWise: draft.examSnapshot.isSessionWise,
      },
      subjects,
      publishedMockTestId: draft.publishedMockTestId?.toString(),
      createdAt: draft.createdAt as Date,
      updatedAt: draft.updatedAt as Date,
    };
  }

  private async toPublishedSubjects(
    test: MockTestDocument,
  ): Promise<DraftSubjectBlockDto[]> {
    const questionIds = (test.questionIds || []).map(id => id.toString());
    // Paper order is authoritative — never invent contiguous positions from
    // questionStartIndex (min/max ranges overlap on mixed/interleaved papers).
    const positionById = new Map(questionIds.map((id, i) => [id, i]));
    const docs = questionIds.length
      ? await this.questionModel
          .find({ _id: { $in: questionIds } })
          .select('-explanation')
          .populate('tags', 'name')
          .lean()
          .exec()
      : [];
    const byId = new Map(docs.map(q => [q._id.toString(), q]));

    return Promise.all(
      (test.subjectConfig || []).map(async row => {
        const blockIds =
          row.questionIds?.map(id => id.toString()) ||
          questionIds.slice(row.questionStartIndex, row.questionEndIndex + 1);

        const questions = await Promise.all(
          blockIds.map(async qid => {
            const doc = byId.get(qid);
            const position = positionById.get(qid);
            const safe = doc
              ? await this.toSafeQuestion(doc)
              : {
                  _id: qid,
                  questionText: {
                    en: { text: null, imageUrl: null },
                    ml: { text: null, imageUrl: null },
                  },
                  options: [],
                  subject: row.subject.toString(),
                  tags: [],
                };
            return {
              ...safe,
              // Admin-only published view: expose the right answer (option id).
              correctAnswer: (doc as { correctAnswer?: string } | undefined)
                ?.correctAnswer,
              // Fall back only if the id is absent from questionIds (corrupt config).
              position: position ?? -1,
              marksPerQuestion: row.marksPerQuestion,
              negativeMarking: row.hasNegativeMarking
                ? row.negativeMarksPerQuestion
                : 0,
            };
          }),
        );

        questions.sort((a, b) => a.position - b.position);

        return {
          subjectId: row.subject.toString(),
          name: row.name,
          numberOfQuestions: row.numberOfQuestions,
          marksPerQuestion: row.marksPerQuestion,
          hasNegativeMarking: row.hasNegativeMarking,
          negativeMarksPerQuestion: row.negativeMarksPerQuestion,
          sessionTime: row.sessionTime,
          questions,
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
  ): FullMockTestListItemDto {
    const examDoc = test.exam as unknown as PopulatedDocument;
    return {
      id: test.id || test._id.toString(),
      accessMode: test.accessMode ?? AccessMode.FREE,
      access: access ?? this.defaultAccessDto(test.accessMode),
      title: test.title,
      description: test.description,
      totalQuestions: test.totalQuestions,
      durationInMinutes: test.durationInMinutes,
      totalMarks: test.totalMarks,
      isSessionWise: test.isSessionWise || false,
      exam: test.exam
        ? {
            id: examDoc?._id?.toString() || test.exam.toString(),
            name: examDoc?.name || '',
            description: examDoc?.description,
          }
        : null,
      subjectConfig: (test.subjectConfig || []).map(row => ({
        subject: row.subject.toString(),
        name: row.name,
        numberOfQuestions: row.numberOfQuestions,
        marksPerQuestion: row.marksPerQuestion,
        hasNegativeMarking: row.hasNegativeMarking,
        negativeMarksPerQuestion: row.negativeMarksPerQuestion,
        sessionTime: row.sessionTime,
        questionStartIndex: row.questionStartIndex,
        questionEndIndex: row.questionEndIndex,
        questionIds: row.questionIds?.map(id => id.toString()),
      })),
      marksPerQuestion: test.marksPerQuestion,
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

  private async toSafeQuestion(q: {
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
      q.questionText?.en?.image,
      q.questionText?.ml?.image,
      ...(q.options || []).map(opt => opt.image),
    ];
    const urls = await this.imageUrlResolver.resolveMany(images);
    let cursor = 0;
    const enUrl = urls[cursor++];
    const mlUrl = urls[cursor++];

    return {
      _id: q._id.toString(),
      questionText: {
        en: {
          text: q.questionText?.en?.text || null,
          imageUrl: enUrl,
        },
        ml: {
          text: q.questionText?.ml?.text || null,
          imageUrl: mlUrl,
        },
      },
      optionType: q.optionType,
      options:
        q.options?.map(opt => ({
          id: opt.id,
          type: opt.type,
          en: opt.en,
          ml: opt.ml,
          imageUrl: urls[cursor++],
        })) || [],
      subject: q.subject?.toString(),
      topic: q.topic?.toString(),
      difficultyLevel: q.difficultyLevel,
      tags: questionTagNames(q),
    };
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
        difficultyLevel: { $in: ['easy', 'medium', 'hard'] },
      })
      .select('_id')
      .lean()
      .exec();

    if (live.length === questionIds.length) {
      return;
    }

    const liveIds = new Set(live.map(q => q._id.toString()));
    const missing = questionIds
      .filter(id => id != null)
      .map(id => id.toString())
      .filter(id => !liveIds.has(id));

    throw new BadRequestException({
      message:
        'One or more questions are no longer eligible (inactive, deleted, or missing difficulty). Replace them before publishing.',
      error: 'QUESTION_NOT_ELIGIBLE',
      details: { questionIds: missing },
    });
  }

  /**
   * Contiguous subject blocks in exam-subject order, positions rewritten 0..n-1.
   * Within a subject, original position is preserved.
   */
  private groupQuestionsBySubjectOrder(
    questions: DraftQuestion[],
    subjects: Array<{ subject: Types.ObjectId | { toString(): string } }>,
  ): DraftQuestion[] {
    const bySubject = new Map<string, DraftQuestion[]>();
    for (const q of questions) {
      const key = q.subject.toString();
      const bucket = bySubject.get(key) || [];
      bucket.push(q);
      bySubject.set(key, bucket);
    }
    for (const bucket of bySubject.values()) {
      bucket.sort((a, b) => a.position - b.position);
    }

    const grouped: DraftQuestion[] = [];
    const seen = new Set<string>();
    for (const row of subjects) {
      const key = row.subject.toString();
      const block = bySubject.get(key) || [];
      grouped.push(...block);
      seen.add(key);
    }
    for (const [key, block] of bySubject) {
      if (!seen.has(key)) {
        grouped.push(...block);
      }
    }

    return grouped.map((q, position) => this.cloneDraftQuestion(q, position));
  }

  private cloneDraftQuestion(
    q: DraftQuestion,
    position?: number,
  ): DraftQuestion {
    return {
      question: q.question,
      subject: q.subject,
      topic: q.topic,
      difficultyLevel: q.difficultyLevel,
      position: position ?? q.position,
      marksPerQuestion: q.marksPerQuestion,
      negativeMarking: q.negativeMarking,
      replacedFrom: q.replacedFrom,
    };
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

  /**
   * Legacy exams may store a bare ObjectId, or a row with a missing `subject`.
   */
  private subjectIdFromRow(row: unknown): string | undefined {
    if (row == null) {
      return undefined;
    }
    if (typeof row === 'string') {
      return Types.ObjectId.isValid(row) ? row : undefined;
    }
    if (row instanceof Types.ObjectId) {
      return row.toString();
    }
    if (typeof row === 'object' && 'subject' in row) {
      const subject = (row as { subject?: unknown }).subject;
      if (subject == null) {
        return undefined;
      }
      if (typeof subject === 'string') {
        return Types.ObjectId.isValid(subject) ? subject : undefined;
      }
      if (typeof (subject as { toString?: unknown }).toString === 'function') {
        const id = (subject as { toString: () => string }).toString();
        return Types.ObjectId.isValid(id) ? id : undefined;
      }
    }
    return undefined;
  }
}
