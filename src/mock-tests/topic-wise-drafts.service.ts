import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Exam, ExamDocument } from '../exams/schemas/exam.schema';
import { Subject, SubjectDocument } from '../subjects/schemas/subject.schema';
import { Topic, TopicDocument } from '../topics/schemas/topic.schema';
import {
  Question,
  QuestionDocument,
} from '../mock-test-attempts/schemas/question.schema';
import { MockTest, MockTestDocument } from './schemas/mock-test.schema';
import {
  TopicWiseDraftQuestion,
  TopicWiseMockTestDraft,
  TopicWiseMockTestDraftDocument,
} from './schemas/topic-wise-mock-test-draft.schema';
import {
  CreateTopicWiseDraftDto,
  TOPIC_WISE_SIZE_OPTIONS,
} from './dto/create-topic-wise-draft.dto';
import { PublishTopicWiseDraftDto } from './dto/publish-topic-wise-draft.dto';
import {
  TopicWiseDraftListItemDto,
  TopicWiseDraftResponseDto,
  TopicWiseDraftSubjectBlockDto,
  TopicWiseDraftQuestionItemDto,
  TopicWiseSearchQuestionItemDto,
} from './dto/topic-wise-draft-response.dto';
import { sampleTopicWiseQuestionIds } from './topic-wise-question-sampler';
import { PaperType } from '../common/enums/paper-type.enum';
import { AccessMode } from '../common/enums/access-mode.enum';
import { PaginationMetaDto } from '../common/dto/api-response.dto';
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
}

const OPEN_DRAFT_STATUSES = ['REVIEW', 'GENERATING', 'PUBLISHING'] as const;

interface HandPickedQuestion {
  _id: Types.ObjectId;
  subject: Types.ObjectId;
  topic: Types.ObjectId;
  difficultyLevel: string;
}

@Injectable()
export class TopicWiseDraftsService {
  constructor(
    @InjectModel(Exam.name) private readonly examModel: Model<ExamDocument>,
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Topic.name) private readonly topicModel: Model<TopicDocument>,
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
    @InjectModel(MockTest.name)
    private readonly mockTestModel: Model<MockTestDocument>,
    @InjectModel(TopicWiseMockTestDraft.name)
    private readonly draftModel: Model<TopicWiseMockTestDraftDocument>,
    private readonly imageUrlResolver: ImageUrlResolver,
  ) {}

  async createDraft(
    dto: CreateTopicWiseDraftDto,
    userId: string,
  ): Promise<TopicWiseDraftResponseDto> {
    const exam = await this.loadActiveExam(dto.exam);
    if (dto.questionIds?.length) {
      return this.createHandPickedDraft(dto, exam, userId);
    }
    return this.createSampledDraft(dto, exam, userId);
  }

  async listDrafts(
    examId?: string,
    page = 1,
    limit = 10,
  ): Promise<{
    data: TopicWiseDraftListItemDto[];
    pagination: PaginationMetaDto;
  }> {
    if (examId && !Types.ObjectId.isValid(examId)) {
      throw new BadRequestException('Invalid exam ID');
    }

    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;
    const query: FilterQuery<TopicWiseMockTestDraftDocument> = {
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
      data: drafts.map(draft => this.toListItem(draft)),
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

  async getDraft(draftId: string): Promise<TopicWiseDraftResponseDto> {
    return this.toDraftResponse(await this.loadDraft(draftId));
  }

  async searchQuestions(params: {
    draftId?: string;
    search?: string;
    topicId?: string;
    difficultyLevel?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: TopicWiseSearchQuestionItemDto[];
    pagination: PaginationMetaDto;
  }> {
    if (!params.draftId || !Types.ObjectId.isValid(params.draftId)) {
      throw new BadRequestException('draftId is required');
    }

    const draft = await this.loadDraft(params.draftId);
    const validPage = Math.max(1, params.page || 1);
    const validLimit = Math.min(Math.max(1, params.limit || 20), 50);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<QuestionDocument> = {
      isActive: true,
      subject: draft.subject,
      exams: draft.exam,
      difficultyLevel: { $in: [...ELIGIBLE_DIFFICULTY_LEVELS] },
    };

    if (
      params.difficultyLevel &&
      (ELIGIBLE_DIFFICULTY_LEVELS as readonly string[]).includes(
        params.difficultyLevel,
      )
    ) {
      query.difficultyLevel = params.difficultyLevel;
    }

    if (draft.topic) {
      query.topic = draft.topic;
    } else if (params.topicId) {
      if (!Types.ObjectId.isValid(params.topicId)) {
        throw new BadRequestException('Invalid topic ID');
      }
      query.topic = new Types.ObjectId(params.topicId);
    }

    if (params.search?.trim()) {
      const term = escapeRegex(params.search.trim());
      query.$or = [
        { 'questionText.en.text': { $regex: term, $options: 'i' } },
        { 'questionText.ml.text': { $regex: term, $options: 'i' } },
      ];
    }

    const exclude = draft.questions.map(question => question.question);
    if (exclude.length) {
      query._id = { $nin: exclude };
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
        return { ...safe, snippet: text ? text.slice(0, 100) : undefined };
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
    actorUserId?: string,
  ): Promise<TopicWiseDraftResponseDto> {
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
      allowCrossSubject: false,
      questions: draft.questions,
      position,
    });
    this.assertSameTopic(draft.topic?.toString(), incoming.topic?.toString());

    slot.replacedFrom = slot.question;
    slot.question = incoming._id as Types.ObjectId;
    slot.topic = incoming.topic;
    slot.difficultyLevel = incoming.difficultyLevel;
    this.syncDifficultyDistribution(draft);
    assignUpdatedBy(draft, actorUserId);
    await draft.save();

    return this.toDraftResponse(draft);
  }

  async publishDraft(
    draftId: string,
    dto: PublishTopicWiseDraftDto,
    userId: string,
  ): Promise<{ mockTestId: string; draft: TopicWiseDraftResponseDto }> {
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

  private async createSampledDraft(
    dto: CreateTopicWiseDraftDto,
    exam: ExamDocument,
    userId: string,
  ): Promise<TopicWiseDraftResponseDto> {
    if (!dto.subject || !Types.ObjectId.isValid(dto.subject)) {
      throw new BadRequestException('A subject is required');
    }
    if (!dto.difficultyDistribution) {
      throw new BadRequestException(
        'Difficulty distribution (easy, medium, hard) is required',
      );
    }
    this.assertDifficultySum(dto.totalQuestions, dto.difficultyDistribution);

    const subject = await this.subjectModel.findById(dto.subject).exec();
    if (!subject) {
      throw new NotFoundException({
        message: 'Subject not found',
        error: 'SUBJECT_NOT_FOUND',
      });
    }

    if (!dto.topic) {
      throw new BadRequestException({
        message:
          'A topic is required for topic-wise tests. Use sprint tests for questions from multiple topics.',
        error: 'TOPIC_REQUIRED',
      });
    }

    const topicName = await this.assertTopicOnSubject(subject, dto.topic);
    const topicId = new Types.ObjectId(dto.topic);

    const sampled = await sampleTopicWiseQuestionIds(this.questionModel, {
      exam: dto.exam,
      subject: dto.subject,
      topic: dto.topic,
      difficultyDistribution: dto.difficultyDistribution,
    });

    const marksPerQuestion = dto.marksPerQuestion ?? 1;
    const negativeMarking = dto.negativeMarking ?? 0;
    const questions = sampled.map((question, position) => ({
      question: question._id,
      subject: new Types.ObjectId(dto.subject),
      topic: topicId,
      difficultyLevel: question.difficultyLevel,
      position,
      marksPerQuestion,
      negativeMarking,
    }));

    const draft = await this.draftModel.create(
      this.draftPayload({
        dto,
        exam,
        userId,
        subjectId: subject._id as Types.ObjectId,
        subjectName: subject.name,
        topicId,
        topicName,
        difficultyDistribution: dto.difficultyDistribution,
        marksPerQuestion,
        negativeMarking,
        questions,
      }),
    );

    return this.toDraftResponse(draft);
  }

  private async createHandPickedDraft(
    dto: CreateTopicWiseDraftDto,
    exam: ExamDocument,
    userId: string,
  ): Promise<TopicWiseDraftResponseDto> {
    const picked = await this.loadHandPickedQuestions(
      exam._id as Types.ObjectId,
      dto.totalQuestions,
      dto.questionIds || [],
    );
    const subjectId = picked[0].subject;
    const topicId = picked[0].topic;
    const [subject, topic] = await Promise.all([
      this.subjectModel.findById(subjectId).select('name').exec(),
      this.topicModel.findById(topicId).select('name').exec(),
    ]);

    const difficultyDistribution = { easy: 0, medium: 0, hard: 0 };
    for (const question of picked) {
      const level = question.difficultyLevel as 'easy' | 'medium' | 'hard';
      difficultyDistribution[level] += 1;
    }

    const marksPerQuestion = dto.marksPerQuestion ?? 1;
    const negativeMarking = dto.negativeMarking ?? 0;
    const questions = picked.map((question, position) => ({
      question: question._id,
      subject: question.subject,
      topic: question.topic,
      difficultyLevel: question.difficultyLevel,
      position,
      marksPerQuestion,
      negativeMarking,
    }));

    const draft = await this.draftModel.create(
      this.draftPayload({
        dto,
        exam,
        userId,
        subjectId,
        subjectName: subject?.name || '',
        topicId,
        topicName: topic?.name,
        difficultyDistribution,
        marksPerQuestion,
        negativeMarking,
        questions,
      }),
    );

    return this.toDraftResponse(draft);
  }

  private draftPayload(input: {
    dto: CreateTopicWiseDraftDto;
    exam: ExamDocument;
    userId: string;
    subjectId: Types.ObjectId;
    subjectName: string;
    topicId: Types.ObjectId;
    topicName?: string;
    difficultyDistribution: { easy: number; medium: number; hard: number };
    marksPerQuestion: number;
    negativeMarking: number;
    questions: Array<{
      question: Types.ObjectId;
      subject: Types.ObjectId;
      topic?: Types.ObjectId;
      difficultyLevel: string;
      position: number;
      marksPerQuestion: number;
      negativeMarking: number;
    }>;
  }) {
    return {
      exam: input.exam._id,
      examName: input.exam.name,
      subject: input.subjectId,
      subjectName: input.subjectName,
      topic: input.topicId,
      topicName: input.topicName,
      createdBy: new Types.ObjectId(input.userId),
      status: 'REVIEW' as const,
      totalQuestions: input.dto.totalQuestions,
      durationInMinutes: input.dto.durationInMinutes,
      difficultyDistribution: input.difficultyDistribution,
      title: input.dto.title?.trim() || undefined,
      description: input.dto.description?.trim() || undefined,
      generationMode: input.dto.generationMode || 'STATIC',
      marksPerQuestion: input.marksPerQuestion,
      negativeMarking: input.negativeMarking,
      passingScore: input.dto.passingScore,
      allowRetake: input.dto.allowRetake ?? true,
      shuffleOptions: input.dto.shuffleOptions ?? false,
      showResultsImmediately: input.dto.showResultsImmediately ?? true,
      accessMode: input.dto.accessMode ?? AccessMode.FREE,
      questions: input.questions,
    };
  }

  private async finalizePublish(
    draft: TopicWiseMockTestDraftDocument,
    dto: PublishTopicWiseDraftDto,
    userId: string,
  ): Promise<{ mockTestId: string; draft: TopicWiseDraftResponseDto }> {
    if (!draft.topic) {
      throw new BadRequestException({
        message:
          'A topic is required for topic-wise tests. Discard this draft and create a new one with a topic. Use sprint tests for questions from multiple topics.',
        error: 'TOPIC_REQUIRED',
      });
    }

    const ordered = [...draft.questions].sort(
      (a, b) => a.position - b.position,
    );
    this.assertNoDuplicateQuestions(ordered);

    if (ordered.length !== draft.totalQuestions) {
      throw new BadRequestException({
        message: `Paper has ${ordered.length} questions but the test requires ${draft.totalQuestions}`,
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
    await this.assertQuestionsStillMatch(draft, ordered);

    const marksPerQuestion = dto.marksPerQuestion ?? draft.marksPerQuestion;
    const negativeMarking = dto.negativeMarking ?? draft.negativeMarking;
    const title = dto.title || draft.title || null;
    const description =
      dto.description !== undefined ? dto.description : draft.description;
    const passingScore =
      dto.passingScore !== undefined
        ? dto.passingScore
        : (draft.passingScore ?? null);
    const allowRetake = dto.allowRetake ?? draft.allowRetake;
    const shuffleOptions = dto.shuffleOptions ?? draft.shuffleOptions;
    const showResultsImmediately =
      dto.showResultsImmediately ?? draft.showResultsImmediately;
    const accessMode = dto.accessMode ?? draft.accessMode ?? AccessMode.FREE;

    const mockTest = await this.mockTestModel.create({
      paperType: PaperType.TOPIC_WISE,
      accessMode,
      totalQuestions: draft.totalQuestions,
      durationInMinutes: draft.durationInMinutes,
      exam: draft.exam,
      subject: draft.subject,
      topic: draft.topic,
      difficultyDistribution: draft.difficultyDistribution,
      title,
      description: description || null,
      generationMode: draft.generationMode || 'STATIC',
      questionIds,
      marksPerQuestion,
      negativeMarking,
      passingScore,
      allowRetake,
      shuffleOptions,
      showResultsImmediately,
      createdBy: new Types.ObjectId(userId),
      isActive: true,
      isDeleted: false,
    });

    draft.status = 'PUBLISHED';
    draft.publishedMockTestId = mockTest._id as Types.ObjectId;
    draft.title = title || undefined;
    draft.description = description || undefined;
    draft.marksPerQuestion = marksPerQuestion;
    draft.negativeMarking = negativeMarking;
    draft.passingScore = passingScore ?? undefined;
    draft.allowRetake = allowRetake;
    draft.shuffleOptions = shuffleOptions;
    draft.showResultsImmediately = showResultsImmediately;
    draft.accessMode = accessMode;
    assignUpdatedBy(draft, userId);
    await draft.save();

    return {
      mockTestId: mockTest.id || mockTest._id.toString(),
      draft: await this.toDraftResponse(draft),
    };
  }

  private async loadActiveExam(examId: string): Promise<ExamDocument> {
    if (!Types.ObjectId.isValid(examId)) {
      throw new BadRequestException({
        message: 'Invalid exam ID',
        error: 'EXAM_NOT_FOUND',
      });
    }
    const exam = await this.examModel.findById(examId).exec();
    if (!exam || !exam.isActive) {
      throw new NotFoundException({
        message: 'Exam not found or inactive',
        error: 'EXAM_NOT_FOUND',
      });
    }
    return exam;
  }

  private async assertTopicOnSubject(
    subject: SubjectDocument,
    topicId: string,
  ): Promise<string> {
    if (!Types.ObjectId.isValid(topicId)) {
      throw new BadRequestException({
        message: 'Topic does not belong to this subject',
        error: 'TOPIC_MISMATCH',
      });
    }
    const onSubject = (subject.topics || []).some(
      id => id.toString() === topicId,
    );
    const topic = await this.topicModel.findById(topicId).exec();
    if (!onSubject || !topic || topic.isActive === false) {
      throw new BadRequestException({
        message: 'Topic does not belong to this subject',
        error: 'TOPIC_MISMATCH',
      });
    }
    return topic.name;
  }

  private assertDifficultySum(
    totalQuestions: number,
    distribution: { easy: number; medium: number; hard: number },
  ): void {
    const sum = distribution.easy + distribution.medium + distribution.hard;
    if (sum !== totalQuestions) {
      throw new BadRequestException(
        `Difficulty distribution sum (${sum}) must equal total questions (${totalQuestions})`,
      );
    }
  }

  private async loadHandPickedQuestions(
    examId: Types.ObjectId,
    totalQuestions: number,
    questionIds: string[],
  ): Promise<HandPickedQuestion[]> {
    if (
      !(TOPIC_WISE_SIZE_OPTIONS as readonly number[]).includes(
        questionIds.length,
      ) ||
      questionIds.length !== totalQuestions
    ) {
      throw new BadRequestException({
        message: `questionIds length (${questionIds.length}) must equal totalQuestions and be one of ${TOPIC_WISE_SIZE_OPTIONS.join(', ')}`,
        error: 'QUESTION_COUNT_MISMATCH',
        details: {
          totalQuestions,
          actual: questionIds.length,
          allowed: [...TOPIC_WISE_SIZE_OPTIONS],
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

    const picked = questionIds.map(id => {
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
      if (!question.topic) {
        throw new BadRequestException({
          message: 'Every selected question must have a topic',
          error: 'TOPIC_REQUIRED',
          details: { questionId: id },
        });
      }
      return {
        _id: question._id as Types.ObjectId,
        subject: question.subject as Types.ObjectId,
        topic: question.topic as Types.ObjectId,
        difficultyLevel: question.difficultyLevel,
      };
    });

    const subjectId = picked[0].subject.toString();
    if (picked.some(question => question.subject.toString() !== subjectId)) {
      throw new BadRequestException({
        message: 'Every selected question must belong to the same subject',
        error: 'SUBJECT_MISMATCH',
      });
    }

    const topicId = picked[0].topic.toString();
    if (picked.some(question => question.topic.toString() !== topicId)) {
      throw new BadRequestException({
        message: 'Every selected question must belong to the same topic',
        error: 'TOPIC_MISMATCH',
      });
    }

    return picked;
  }

  private assertSameTopic(
    draftTopicId?: string,
    incomingTopicId?: string,
  ): void {
    if (!draftTopicId) {
      throw new BadRequestException({
        message:
          'A topic is required for topic-wise tests. Discard this draft and create a new one with a topic.',
        error: 'TOPIC_REQUIRED',
      });
    }
    if (incomingTopicId !== draftTopicId) {
      throw new BadRequestException({
        message: 'Replacement question must belong to the same topic',
        error: 'TOPIC_MISMATCH',
      });
    }
  }

  private syncDifficultyDistribution(
    draft: TopicWiseMockTestDraftDocument,
  ): void {
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const slot of draft.questions) {
      if (slot.difficultyLevel === 'easy') counts.easy += 1;
      else if (slot.difficultyLevel === 'medium') counts.medium += 1;
      else if (slot.difficultyLevel === 'hard') counts.hard += 1;
    }
    draft.difficultyDistribution.easy = counts.easy;
    draft.difficultyDistribution.medium = counts.medium;
    draft.difficultyDistribution.hard = counts.hard;
  }

  private async assertQuestionsStillMatch(
    draft: TopicWiseMockTestDraftDocument,
    ordered: TopicWiseDraftQuestion[],
  ): Promise<void> {
    const ids = ordered.map(question => question.question);
    const docs = await this.questionModel
      .find({ _id: { $in: ids } })
      .select('_id subject topic difficultyLevel exams')
      .exec();
    const byId = new Map(docs.map(doc => [doc._id.toString(), doc]));
    const draftTopic = draft.topic?.toString();
    if (!draftTopic) {
      throw new BadRequestException({
        message:
          'A topic is required for topic-wise tests. Discard this draft and create a new one with a topic.',
        error: 'TOPIC_REQUIRED',
      });
    }

    for (const slot of ordered) {
      const live = byId.get(slot.question.toString());
      const sameSubject =
        live?.subject?.toString() === draft.subject.toString();
      const sameDifficulty = live?.difficultyLevel === slot.difficultyLevel;
      const sameTopic = live?.topic?.toString() === draftTopic;
      const tagged = live ? isTaggedToExam(live.exams, draft.exam) : false;
      if (!live || !sameSubject || !sameDifficulty || !sameTopic || !tagged) {
        throw new BadRequestException({
          message:
            'One or more questions no longer match this topic-wise paper. Replace them before publishing.',
          error: 'QUESTION_NOT_ELIGIBLE',
          details: { questionId: slot.question.toString() },
        });
      }
    }
  }

  private async assertQuestionsEligibleForPublish(
    questionIds: Array<{ toString(): string }>,
  ): Promise<void> {
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
    throw new BadRequestException({
      message: 'This paper contains duplicate questions.',
      error: 'DUPLICATE_QUESTION',
      details: duplicates,
    });
  }

  private async loadDraft(
    draftId: string,
  ): Promise<TopicWiseMockTestDraftDocument> {
    if (!Types.ObjectId.isValid(draftId)) {
      throw new BadRequestException('Invalid draft ID');
    }
    const draft = await this.draftModel.findById(draftId).exec();
    if (!draft || draft.status === 'DISCARDED') {
      throw new NotFoundException('Draft not found');
    }
    return draft;
  }

  private toListItem(
    draft: TopicWiseMockTestDraftDocument,
  ): TopicWiseDraftListItemDto {
    return {
      id: draft.id || draft._id.toString(),
      examId: draft.exam.toString(),
      examName: draft.examName || 'Untitled exam',
      subjectId: draft.subject.toString(),
      subjectName: draft.subjectName || '',
      topicId: draft.topic?.toString(),
      topicName: draft.topicName,
      status: draft.status,
      totalQuestions: draft.totalQuestions,
      durationInMinutes: draft.durationInMinutes,
      title: draft.title,
      difficultyDistribution: {
        easy: draft.difficultyDistribution?.easy || 0,
        medium: draft.difficultyDistribution?.medium || 0,
        hard: draft.difficultyDistribution?.hard || 0,
      },
      createdAt: draft.createdAt as Date,
      updatedAt: draft.updatedAt as Date,
    };
  }

  private async toDraftResponse(
    draft: TopicWiseMockTestDraftDocument,
  ): Promise<TopicWiseDraftResponseDto> {
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

    return {
      ...this.toListItem(draft),
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
        generationMode: draft.generationMode || 'STATIC',
        difficultyDistribution: {
          easy: draft.difficultyDistribution?.easy || 0,
          medium: draft.difficultyDistribution?.medium || 0,
          hard: draft.difficultyDistribution?.hard || 0,
        },
      },
      subjects: await this.groupDraftSubjects(draft, byId),
      publishedMockTestId: draft.publishedMockTestId?.toString(),
    };
  }

  private async groupDraftSubjects(
    draft: TopicWiseMockTestDraftDocument,
    byId: Map<string, QuestionDocument | Record<string, unknown>>,
  ): Promise<TopicWiseDraftSubjectBlockDto[]> {
    const ordered = [...draft.questions].sort(
      (a, b) => a.position - b.position,
    );
    const subjectOrder: string[] = [];
    const buckets = new Map<string, TopicWiseDraftQuestion[]>();
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
    if (draft.subjectName) {
      names.set(draft.subject.toString(), draft.subjectName);
    }

    return Promise.all(
      subjectOrder.map(async subjectId => ({
        subjectId,
        name: names.get(subjectId) || subjectId,
        questions: await Promise.all(
          (buckets.get(subjectId) || []).map(question =>
            this.toDraftQuestionItem(
              question,
              byId.get(question.question.toString()),
            ),
          ),
        ),
      })),
    );
  }

  private async toDraftQuestionItem(
    slot: TopicWiseDraftQuestion,
    doc: unknown,
  ): Promise<TopicWiseDraftQuestionItemDto> {
    const safe = doc
      ? await this.toSafeQuestion(
          doc as Parameters<TopicWiseDraftsService['toSafeQuestion']>[0],
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
