import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { MockTest, MockTestDocument } from './schemas/mock-test.schema';
import { Topic, TopicDocument } from '../topics/schemas/topic.schema';
import {
  Question,
  QuestionDocument,
} from '../mock-test-attempts/schemas/question.schema';
import { CreateTopicWiseMockTestDto } from './dto/create-topic-wise-mock-test.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UserRole } from '../common/enums/user-role.enum';
import {
  MockTestAttempt,
  MockTestAttemptDocument,
} from '../mock-test-attempts/schemas/mock-test-attempt.schema';
import { MockTestResponseDto } from './dto/mock-test-response.dto';
import { MockTestListItemDto } from './dto/mock-test-list-item.dto';
import {
  PaginatedMockTestsResponseDto,
  PaginatedMockTestListResponseDto,
} from './dto/paginated-mock-tests-response.dto';
import { PopulatedDocument } from '../common/types/populated-document.interface';
import { UserAttemptAction } from '../common/enums/user-attempt-action.enum';
import { AccessMode } from '../common/enums/access-mode.enum';
import {
  PaperType,
  TOPIC_WISE_PAPER_MATCH,
} from '../common/enums/paper-type.enum';
import { AccessControlService } from '../access/access-control.service';
import { AccessDto, toAccessDto } from '../access/to-access-dto';
import { AccessDecisionReason } from '../common/enums/access-decision-reason.enum';
import { updatedByFields } from '../common/types/to-actor-object-id';
import { ImageLike, ImageUrlResolver } from '../aws/s3/image-url.resolver';
import { questionTagNames } from '../questions/question-tag-names';
import { sampleTopicWiseQuestionIds } from './topic-wise-question-sampler';

const TOPIC_WISE_FILTER: FilterQuery<MockTestDocument> = {
  ...TOPIC_WISE_PAPER_MATCH,
  isDeleted: { $ne: true },
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
}

@Injectable()
export class MockTestsService {
  constructor(
    @InjectModel(MockTest.name) private mockTestModel: Model<MockTestDocument>,
    @InjectModel(MockTestAttempt.name)
    private attemptModel: Model<MockTestAttemptDocument>,
    @InjectModel(Topic.name) private topicModel: Model<TopicDocument>,
    @InjectModel(Question.name) private questionModel: Model<QuestionDocument>,
    @Inject(forwardRef(() => AccessControlService))
    private readonly accessControlService: AccessControlService,
    private readonly imageUrlResolver: ImageUrlResolver,
  ) {}

  /**
   * Find all mock tests with pagination and search
   * @param page - Page number (default: 1)
   * @param limit - Items per page (default: 10)
   * @param search - Search term for title (optional)
   * @param userId - User ID to calculate attempt actions (optional)
   * @returns Paginated mock tests with metadata
   */
  async findAll(
    page: number = 1,
    limit: number = 10,
    search?: string,
    userId?: string,
    isAdmin = false,
    filters?: { examId?: string; subjectId?: string; topicId?: string },
  ): Promise<PaginatedMockTestsResponseDto> {
    // Validate and normalize pagination parameters
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100); // Max 100 items per page
    const skip = (validPage - 1) * validLimit;

    // Build query — never leak full-exam papers into topic-wise lists
    const query: FilterQuery<MockTestDocument> = {
      ...TOPIC_WISE_FILTER,
      ...(isAdmin ? {} : { isActive: true }),
    };
    const examId = this.filterObjectId(filters?.examId, 'exam ID');
    const subjectId = this.filterObjectId(filters?.subjectId, 'subject ID');
    const topicId = this.filterObjectId(filters?.topicId, 'topic ID');
    if (examId) query.exam = examId;
    if (subjectId) query.subject = subjectId;
    if (topicId) query.topic = topicId;

    // Add search filter if search term is provided
    if (search && search.trim()) {
      const term = escapeRegex(search.trim());
      query.$or = [
        { title: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } },
      ];
    }

    // Execute queries in parallel for better performance
    const findQuery = this.mockTestModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(validLimit);

    if (!isAdmin) {
      findQuery.select('-questionIds');
    }

    if (isAdmin) {
      findQuery
        .populate('exam', 'name description')
        .populate('subject', 'name description')
        .populate('topic', 'name');
    }

    const [mockTests, total] = await Promise.all([
      findQuery.exec(),
      this.mockTestModel.countDocuments(query).exec(),
    ]);

    // Calculate user attempt actions if userId provided
    let userActions = new Map<
      string,
      { action: UserAttemptAction; resumeAttemptId?: string }
    >();
    if (userId) {
      const testIds = mockTests.map(test => test._id.toString());
      userActions = await this.calculateUserAttemptActions(testIds, userId);
    }

    const accessMap = await this.buildAccessMap(userId, mockTests);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / validLimit);
    const hasNextPage = validPage < totalPages;
    const hasPrevPage = validPage > 1;

    return {
      data: mockTests.map(test => {
        const testId = test._id.toString();
        const entry = userActions.get(testId) || {
          action: UserAttemptAction.START,
        };
        const access = accessMap.get(testId);
        return isAdmin
          ? (this.toListItemDto(
              test,
              entry.action,
              entry.resumeAttemptId,
              access,
            ) as unknown as MockTestResponseDto)
          : this.toResponseDto(
              test,
              entry.action,
              entry.resumeAttemptId,
              access,
            );
      }),
      pagination: {
        total,
        page: validPage,
        limit: validLimit,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    };
  }

  private filterObjectId(
    value: string | undefined,
    label: string,
  ): Types.ObjectId | undefined {
    if (!value) return undefined;
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`Invalid ${label}`);
    }
    return new Types.ObjectId(value);
  }

  /**
   * Find a single mock test by ID
   * @param id - Mock test ID
   * @returns Mock test details
   * @throws NotFoundException if mock test not found
   */
  async findOne(
    id: string,
    user?: UserResponseDto,
  ): Promise<MockTestResponseDto> {
    const isAdmin = user?.role === UserRole.ADMIN;
    let query = this.mockTestModel.findOne({
      _id: id,
      ...TOPIC_WISE_FILTER,
      ...(isAdmin ? {} : { isActive: true }),
    });

    if (isAdmin) {
      query = query
        .populate('exam', 'name')
        .populate('subject', 'name')
        .populate('topic', 'name')
        .populate({
          path: 'questionIds',
          select: 'questionText subject topic options optionType tags',
          populate: [
            { path: 'subject', select: 'name' },
            { path: 'topic', select: 'name' },
            { path: 'tags', select: 'name' },
          ],
        });
    } else {
      query = query.select('-questionIds');
    }

    const mockTest = await query.exec();

    if (!mockTest) {
      throw new NotFoundException(`Mock test with ID "${id}" not found`);
    }

    if (isAdmin) {
      const accessMap = await this.buildAccessMap(user?.id, [mockTest]);
      return await this.toAdminDetailDto(
        mockTest,
        accessMap.get(mockTest._id.toString()),
      );
    }

    const accessMap = await this.buildAccessMap(user?.id, [mockTest]);
    return this.toResponseDto(
      mockTest,
      undefined,
      undefined,
      accessMap.get(mockTest._id.toString()),
    );
  }

  async createTopicWise(
    dto: CreateTopicWiseMockTestDto,
    userId: string,
  ): Promise<MockTestResponseDto> {
    this.assertDifficultySum(dto);
    this.assertTopicRequired(dto.topic);
    const questionIds = await this.sampleQuestionIds(dto);

    const mockTest = await this.mockTestModel.create({
      paperType: PaperType.TOPIC_WISE,
      accessMode: dto.accessMode ?? AccessMode.FREE,
      totalQuestions: dto.totalQuestions,
      durationInMinutes: dto.durationInMinutes,
      exam: new Types.ObjectId(dto.exam),
      subject: new Types.ObjectId(dto.subject),
      topic: new Types.ObjectId(dto.topic),
      difficultyDistribution: dto.difficultyDistribution,
      title: dto.title || null,
      description: dto.description || null,
      generationMode: dto.generationMode || 'STATIC',
      questionIds,
      marksPerQuestion: dto.marksPerQuestion ?? 1,
      negativeMarking: dto.negativeMarking ?? 0,
      passingScore: dto.passingScore ?? null,
      allowRetake: dto.allowRetake ?? true,
      shuffleOptions: dto.shuffleOptions ?? false,
      showResultsImmediately: dto.showResultsImmediately ?? true,
      createdBy: new Types.ObjectId(userId),
      isActive: true,
      isDeleted: false,
    });

    return this.findOne(mockTest.id, {
      id: userId,
      role: UserRole.ADMIN,
    } as UserResponseDto);
  }

  async updateTopicWise(
    id: string,
    dto: CreateTopicWiseMockTestDto,
    userId: string,
  ): Promise<MockTestResponseDto> {
    const existing = await this.mockTestModel
      .findOne({ _id: id, ...TOPIC_WISE_FILTER })
      .exec();

    if (!existing) {
      throw new NotFoundException(`Mock test with ID "${id}" not found`);
    }

    this.assertDifficultySum(dto);
    this.assertTopicRequired(dto.topic);
    const shouldResample = this.shouldResampleTopicWise(existing, dto);
    const questionIds = shouldResample
      ? await this.sampleQuestionIds(dto)
      : existing.questionIds;

    await this.mockTestModel
      .findOneAndUpdate(
        { _id: id, ...TOPIC_WISE_FILTER },
        {
          $set: {
            paperType: PaperType.TOPIC_WISE,
            accessMode:
              dto.accessMode ?? existing.accessMode ?? AccessMode.FREE,
            totalQuestions: dto.totalQuestions,
            durationInMinutes: dto.durationInMinutes,
            exam: new Types.ObjectId(dto.exam),
            subject: new Types.ObjectId(dto.subject),
            topic: new Types.ObjectId(dto.topic),
            difficultyDistribution: dto.difficultyDistribution,
            title: dto.title,
            description: dto.description,
            generationMode: dto.generationMode || existing.generationMode,
            questionIds,
            marksPerQuestion: dto.marksPerQuestion ?? existing.marksPerQuestion,
            negativeMarking: dto.negativeMarking ?? existing.negativeMarking,
            passingScore: dto.passingScore,
            allowRetake: dto.allowRetake,
            shuffleOptions: dto.shuffleOptions,
            showResultsImmediately: dto.showResultsImmediately,
            ...updatedByFields(userId),
          },
        },
        { new: true },
      )
      .exec();

    return this.findOne(id, {
      id: userId,
      role: UserRole.ADMIN,
    } as UserResponseDto);
  }

  async removeTopicWise(
    id: string,
    actorUserId?: string,
  ): Promise<{ message: string }> {
    const mockTest = await this.mockTestModel
      .findOneAndUpdate(
        { _id: id, ...TOPIC_WISE_FILTER },
        {
          isDeleted: true,
          isActive: false,
          ...updatedByFields(actorUserId),
        },
        { new: true },
      )
      .exec();

    if (!mockTest) {
      throw new NotFoundException(`Mock test with ID "${id}" not found`);
    }

    return { message: 'Mock test deleted successfully' };
  }

  private assertDifficultySum(dto: CreateTopicWiseMockTestDto) {
    const { easy, medium, hard } = dto.difficultyDistribution;
    const sum = easy + medium + hard;
    if (sum !== dto.totalQuestions) {
      throw new BadRequestException(
        `Difficulty distribution sum (${sum}) must equal total questions (${dto.totalQuestions})`,
      );
    }
  }

  private assertTopicRequired(topic?: string): void {
    if (!topic || !Types.ObjectId.isValid(topic)) {
      throw new BadRequestException({
        message:
          'A topic is required for topic-wise tests. Use sprint tests for questions from multiple topics.',
        error: 'TOPIC_REQUIRED',
      });
    }
  }

  private shouldResampleTopicWise(
    existing: MockTestDocument,
    dto: CreateTopicWiseMockTestDto,
  ): boolean {
    const existingTopic = existing.topic?.toString() || '';
    const nextTopic = dto.topic || '';
    const existingDist = existing.difficultyDistribution || {
      easy: 0,
      medium: 0,
      hard: 0,
    };

    return (
      !existing.questionIds?.length ||
      existing.totalQuestions !== dto.totalQuestions ||
      existing.exam?.toString() !== dto.exam ||
      existing.subject?.toString() !== dto.subject ||
      existingTopic !== nextTopic ||
      existingDist.easy !== dto.difficultyDistribution.easy ||
      existingDist.medium !== dto.difficultyDistribution.medium ||
      existingDist.hard !== dto.difficultyDistribution.hard
    );
  }

  private async sampleQuestionIds(
    dto: CreateTopicWiseMockTestDto,
  ): Promise<Types.ObjectId[]> {
    const sampled = await sampleTopicWiseQuestionIds(this.questionModel, {
      exam: dto.exam,
      subject: dto.subject,
      topic: dto.topic,
      difficultyDistribution: dto.difficultyDistribution,
    });
    return sampled.map(question => question._id);
  }

  private async toAdminDetailDto(
    mockTest: MockTestDocument,
    access?: AccessDto,
  ): Promise<MockTestResponseDto> {
    const examDoc = mockTest.exam as unknown as PopulatedDocument;
    const subjectDoc = mockTest.subject as unknown as PopulatedDocument;
    const topicDoc = mockTest.topic as unknown as PopulatedDocument;
    const populated = (mockTest.questionIds || []).map(question => {
      return question as unknown as PopulatedDocument & {
        questionText?: {
          en?: { text?: string | null; image?: ImageLike };
          ml?: { text?: string | null; image?: ImageLike };
        };
        optionType?: string;
        options?: Array<{
          id?: string;
          type?: string;
          en?: string | null;
          ml?: string | null;
          image?: ImageLike;
        }>;
        subject?: PopulatedDocument;
        topic?: PopulatedDocument;
        tags?: unknown;
        id?: string;
      };
    });
    const images: ImageLike[] = [];
    for (const question of populated) {
      images.push(
        question.questionText?.en?.image,
        question.questionText?.ml?.image,
        ...(question.options || []).map(option => option.image),
      );
    }
    const urls = await this.imageUrlResolver.resolveMany(images);
    let cursor = 0;
    const questions = populated.map(question => {
      const enUrl = urls[cursor++];
      const mlUrl = urls[cursor++];
      return {
        id: question.id || question._id?.toString(),
        questionText: {
          en: {
            text: question.questionText?.en?.text ?? null,
            imageUrl: enUrl,
          },
          ml: {
            text: question.questionText?.ml?.text ?? null,
            imageUrl: mlUrl,
          },
        },
        optionType: question.optionType,
        options: (question.options || []).map(option => ({
          id: option.id,
          type: option.type,
          en: option.en ?? null,
          ml: option.ml ?? null,
          imageUrl: urls[cursor++],
        })),
        subject: question.subject
          ? {
              id: question.subject._id?.toString() || question.subject.id,
              name: question.subject.name,
            }
          : null,
        topic: question.topic
          ? {
              id: question.topic._id?.toString() || question.topic.id,
              name: question.topic.name,
            }
          : null,
        tags: questionTagNames(question),
      };
    });

    return {
      ...this.toListItemDto(mockTest, undefined, undefined, access),
      exam: examDoc
        ? { id: examDoc._id?.toString() || examDoc.id, name: examDoc.name }
        : mockTest.exam?.toString(),
      subject: subjectDoc
        ? {
            id: subjectDoc._id?.toString() || subjectDoc.id,
            name: subjectDoc.name,
          }
        : mockTest.subject?.toString(),
      topic: topicDoc
        ? { id: topicDoc._id?.toString() || topicDoc.id, name: topicDoc.name }
        : undefined,
      questions,
    } as unknown as MockTestResponseDto;
  }

  /**
   * Get mock test statistics
   * @returns Statistics about mock tests
   */
  async getStats() {
    const [totalTests, activeTests, staticTests, dynamicTests] =
      await Promise.all([
        this.mockTestModel.countDocuments({ ...TOPIC_WISE_FILTER }),
        this.mockTestModel.countDocuments({
          ...TOPIC_WISE_FILTER,
          isActive: true,
        }),
        this.mockTestModel.countDocuments({
          ...TOPIC_WISE_FILTER,
          generationMode: 'STATIC',
        }),
        this.mockTestModel.countDocuments({
          ...TOPIC_WISE_FILTER,
          generationMode: 'DYNAMIC',
        }),
      ]);

    // Aggregate difficulty distribution across all tests
    const difficultyAggregation = await this.mockTestModel
      .aggregate([
        { $match: { ...TOPIC_WISE_FILTER, isDeleted: { $ne: true } } },
        {
          $group: {
            _id: null,
            totalEasy: { $sum: '$difficultyDistribution.easy' },
            totalMedium: { $sum: '$difficultyDistribution.medium' },
            totalHard: { $sum: '$difficultyDistribution.hard' },
          },
        },
      ])
      .exec();

    const difficultyStats = difficultyAggregation[0] || {
      totalEasy: 0,
      totalMedium: 0,
      totalHard: 0,
    };

    return {
      totalTests,
      activeTests,
      inactiveTests: totalTests - activeTests,
      byGenerationMode: {
        static: staticTests,
        dynamic: dynamicTests,
      },
      totalQuestionsByDifficulty: {
        easy: difficultyStats.totalEasy,
        medium: difficultyStats.totalMedium,
        hard: difficultyStats.totalHard,
      },
    };
  }

  /**
   * Find mock tests by exam with optional topic search and subject filter
   * @param examId - Exam ID
   * @param page - Page number
   * @param limit - Items per page
   * @param userId - User ID to calculate attempt actions (optional)
   * @param search - Search term for topic name (optional)
   * @param subjectId - Subject ID to filter by (optional)
   * @returns Paginated mock tests with populated references
   */
  async findByExam(
    examId: string,
    page: number = 1,
    limit: number = 10,
    userId?: string,
    search?: string,
    subjectId?: string,
  ): Promise<PaginatedMockTestListResponseDto> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<MockTestDocument> = {
      ...TOPIC_WISE_FILTER,
      isActive: true,
      exam: new Types.ObjectId(examId),
    };

    // Filter by subject if provided
    if (subjectId) {
      query.subject = new Types.ObjectId(subjectId);
    }

    // Search by topic name if provided
    if (search && search.trim()) {
      const matchingTopics = await this.topicModel
        .find({ name: { $regex: escapeRegex(search.trim()), $options: 'i' } })
        .select('_id')
        .lean()
        .exec();
      // If no topics match, return empty result immediately
      if (matchingTopics.length === 0) {
        return {
          data: [],
          pagination: {
            total: 0,
            page: validPage,
            limit: validLimit,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
        };
      }
      query.topic = { $in: matchingTopics.map(t => t._id) };
    }

    const [mockTests, total] = await Promise.all([
      this.mockTestModel
        .find(query)
        .select('-questionIds')
        .populate('exam', '_id name description')
        .populate('subject', '_id name description')
        .populate('topic', '_id name')
        .sort({ accessMode: -1, createdAt: 1 })
        .skip(skip)
        .limit(validLimit)
        .exec(),
      this.mockTestModel.countDocuments(query).exec(),
    ]);

    // Calculate user attempt actions if userId provided
    let userActions = new Map<
      string,
      { action: UserAttemptAction; resumeAttemptId?: string }
    >();
    if (userId) {
      const testIds = mockTests.map(test => test._id.toString());
      userActions = await this.calculateUserAttemptActions(testIds, userId);
    }

    const accessMap = await this.buildAccessMap(userId, mockTests);
    const totalPages = Math.ceil(total / validLimit);

    return {
      data: mockTests.map(test => {
        const testId = test._id.toString();
        const entry = userActions.get(testId) || {
          action: UserAttemptAction.START,
        };
        return this.toListItemDto(
          test,
          entry.action,
          entry.resumeAttemptId,
          accessMap.get(testId),
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

  /**
   * Find mock tests by subject
   * @param subjectId - Subject ID
   * @param page - Page number
   * @param limit - Items per page
   * @param userId - User ID to calculate attempt actions (optional)
   * @returns Paginated mock tests
   */
  async findBySubject(
    subjectId: string,
    page: number = 1,
    limit: number = 10,
    userId?: string,
  ): Promise<PaginatedMockTestsResponseDto> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<MockTestDocument> = {
      ...TOPIC_WISE_FILTER,
      isActive: true,
      subject: new Types.ObjectId(subjectId),
    };

    const [mockTests, total] = await Promise.all([
      this.mockTestModel
        .find(query)
        .select('-questionIds')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .exec(),
      this.mockTestModel.countDocuments(query).exec(),
    ]);

    // Calculate user attempt actions if userId provided
    let userActions = new Map<
      string,
      { action: UserAttemptAction; resumeAttemptId?: string }
    >();
    if (userId) {
      const testIds = mockTests.map(test => test._id.toString());
      userActions = await this.calculateUserAttemptActions(testIds, userId);
    }

    const accessMap = await this.buildAccessMap(userId, mockTests);
    const totalPages = Math.ceil(total / validLimit);

    return {
      data: mockTests.map(test => {
        const testId = test._id.toString();
        const entry = userActions.get(testId) || {
          action: UserAttemptAction.START,
        };
        return this.toResponseDto(
          test,
          entry.action,
          entry.resumeAttemptId,
          accessMap.get(testId),
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

  /**
   * Find mock tests by exam and subject
   * @param examId - Exam ID
   * @param subjectId - Subject ID
   * @param page - Page number
   * @param limit - Items per page
   * @param userId - User ID to calculate attempt actions (optional)
   * @returns Paginated mock tests
   */
  async findByExamAndSubject(
    examId: string,
    subjectId: string,
    page: number = 1,
    limit: number = 10,
    userId?: string,
  ): Promise<PaginatedMockTestsResponseDto> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<MockTestDocument> = {
      ...TOPIC_WISE_FILTER,
      isActive: true,
      exam: new Types.ObjectId(examId),
      subject: new Types.ObjectId(subjectId),
    };

    const [mockTests, total] = await Promise.all([
      this.mockTestModel
        .find(query)
        .select('-questionIds')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .exec(),
      this.mockTestModel.countDocuments(query).exec(),
    ]);

    // Calculate user attempt actions if userId provided
    let userActions = new Map<
      string,
      { action: UserAttemptAction; resumeAttemptId?: string }
    >();
    if (userId) {
      const testIds = mockTests.map(test => test._id.toString());
      userActions = await this.calculateUserAttemptActions(testIds, userId);
    }

    const accessMap = await this.buildAccessMap(userId, mockTests);
    const totalPages = Math.ceil(total / validLimit);

    return {
      data: mockTests.map(test => {
        const testId = test._id.toString();
        const entry = userActions.get(testId) || {
          action: UserAttemptAction.START,
        };
        return this.toResponseDto(
          test,
          entry.action,
          entry.resumeAttemptId,
          accessMap.get(testId),
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

  /**
   * Find active mock tests only
   * @param page - Page number
   * @param limit - Items per page
   * @param userId - User ID to calculate attempt actions (optional)
   * @returns Paginated active mock tests
   */
  async findActive(
    page: number = 1,
    limit: number = 10,
    userId?: string,
  ): Promise<PaginatedMockTestsResponseDto> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<MockTestDocument> = {
      ...TOPIC_WISE_FILTER,
      isActive: true,
    };

    const [mockTests, total] = await Promise.all([
      this.mockTestModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .exec(),
      this.mockTestModel.countDocuments(query).exec(),
    ]);

    // Calculate user attempt actions if userId provided
    let userActions = new Map<
      string,
      { action: UserAttemptAction; resumeAttemptId?: string }
    >();
    if (userId) {
      const testIds = mockTests.map(test => test._id.toString());
      userActions = await this.calculateUserAttemptActions(testIds, userId);
    }

    const accessMap = await this.buildAccessMap(userId, mockTests);
    const totalPages = Math.ceil(total / validLimit);

    return {
      data: mockTests.map(test => {
        const testId = test._id.toString();
        const entry = userActions.get(testId) || {
          action: UserAttemptAction.START,
        };
        return this.toResponseDto(
          test,
          entry.action,
          entry.resumeAttemptId,
          accessMap.get(testId),
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

  /**
   * Public wrapper used by full-mock lists (same START / RESUME / RETAKE rules).
   */
  async getUserAttemptActions(
    mockTestIds: string[],
    userId: string,
  ): Promise<
    Map<string, { action: UserAttemptAction; resumeAttemptId?: string }>
  > {
    return this.calculateUserAttemptActions(mockTestIds, userId);
  }

  /**
   * Calculate user attempt action for multiple mock tests efficiently
   * Determines whether user should START, RESUME, or RETAKE each test.
   * For RESUME, also returns the ID of the latest active attempt.
   * @param mockTestIds - Array of mock test IDs to check
   * @param userId - User ID to check attempts for
   * @returns Map of mock test ID to { action, resumeAttemptId? }
   */
  private async calculateUserAttemptActions(
    mockTestIds: string[],
    userId: string,
  ): Promise<
    Map<string, { action: UserAttemptAction; resumeAttemptId?: string }>
  > {
    const actionMap = new Map<
      string,
      { action: UserAttemptAction; resumeAttemptId?: string }
    >();

    if (!mockTestIds.length || !userId) {
      return actionMap;
    }

    // Query all relevant attempts sorted newest-first so we can pick the latest active one
    const attempts = await this.attemptModel
      .find({
        user: new Types.ObjectId(userId),
        mockTest: { $in: mockTestIds.map(id => new Types.ObjectId(id)) },
      })
      .select('mockTest status createdAt')
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    // Group attempts by test ID (order preserved — newest first)
    const attemptsByTest = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      const testId = attempt.mockTest.toString();
      if (!attemptsByTest.has(testId)) {
        attemptsByTest.set(testId, []);
      }
      attemptsByTest.get(testId)!.push(attempt);
    }

    // Determine action for each test
    for (const testId of mockTestIds) {
      const testAttempts = attemptsByTest.get(testId) || [];

      if (testAttempts.length === 0) {
        actionMap.set(testId, { action: UserAttemptAction.START });
        continue;
      }

      // Find the latest attempt that is still active (IN_PROGRESS or PAUSED)
      const activeAttempt = testAttempts.find(
        attempt =>
          attempt.status === 'PAUSED' || attempt.status === 'IN_PROGRESS',
      );

      if (activeAttempt) {
        actionMap.set(testId, {
          action: UserAttemptAction.RESUME,
          resumeAttemptId: (activeAttempt._id as Types.ObjectId).toString(),
        });
        continue;
      }

      const hasCompletedAttempt = testAttempts.some(
        attempt =>
          attempt.status === 'SUBMITTED' || attempt.status === 'EXPIRED',
      );

      if (hasCompletedAttempt) {
        actionMap.set(testId, { action: UserAttemptAction.RETAKE });
      } else {
        actionMap.set(testId, { action: UserAttemptAction.START });
      }
    }

    return actionMap;
  }

  /**
   * Helper method to convert MockTest document to DTO
   * Transforms ObjectIds to strings for proper serialization
   */
  private toResponseDto(
    mockTest: MockTestDocument,
    userAttemptAction?: UserAttemptAction,
    resumeAttemptId?: string,
    access?: AccessDto,
  ): MockTestResponseDto {
    const obj = mockTest.toObject();
    return new MockTestResponseDto({
      id: obj.id,
      accessMode: obj.accessMode ?? AccessMode.FREE,
      access: access ?? this.defaultAccessDto(obj.accessMode),
      totalQuestions: obj.totalQuestions,
      durationInMinutes: obj.durationInMinutes,
      exam: obj.exam?.toString(),
      subject: obj.subject?.toString(),
      topic: obj.topic?.toString(),
      title: obj.title,
      description: obj.description,
      generationMode: obj.generationMode,
      marksPerQuestion: obj.marksPerQuestion,
      negativeMarking: obj.negativeMarking,
      passingScore: obj.passingScore,
      allowRetake: obj.allowRetake,
      shuffleOptions: obj.shuffleOptions,
      showResultsImmediately: obj.showResultsImmediately,
      isActive: obj.isActive,
      createdBy: obj.createdBy?.toString(),
      difficultyDistribution: obj.difficultyDistribution || {
        easy: 0,
        medium: 0,
        hard: 0,
      },
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt,
      userAttemptAction: userAttemptAction || UserAttemptAction.START,
      resumeAttemptId,
    });
  }

  /**
   * Helper method to convert MockTest document to list item DTO
   * Includes populated exam, subject, and topic details
   */
  private toListItemDto(
    mockTest: MockTestDocument,
    userAttemptAction?: UserAttemptAction,
    resumeAttemptId?: string,
    access?: AccessDto,
  ): MockTestListItemDto {
    // Access _id and other fields before calling toObject() since toObject transforms delete _id
    const mockTestId = mockTest._id?.toString();

    const examId = mockTest.exam?._id?.toString();
    const examDoc = mockTest.exam as unknown as PopulatedDocument;

    const subjectId = mockTest.subject?._id?.toString();
    const subjectDoc = mockTest.subject as unknown as PopulatedDocument;

    const topicId = mockTest.topic?._id?.toString();
    const topicDoc = mockTest.topic as unknown as PopulatedDocument;

    const obj = mockTest.toObject();

    return new MockTestListItemDto({
      id: mockTestId,
      accessMode: obj.accessMode ?? AccessMode.FREE,
      access: access ?? this.defaultAccessDto(obj.accessMode),
      title: obj.title,
      description: obj.description,
      totalQuestions: obj.totalQuestions,
      durationInMinutes: obj.durationInMinutes,
      exam: mockTest.exam
        ? {
            id: examId || '',
            name: examDoc?.name || '',
            description: examDoc?.description,
          }
        : null,
      subject: mockTest.subject
        ? {
            id: subjectId || '',
            name: subjectDoc?.name || '',
            description: subjectDoc?.description,
          }
        : null,
      topic: mockTest.topic
        ? {
            id: topicId || '',
            name: topicDoc?.name || '',
          }
        : undefined,
      generationMode: obj.generationMode,
      marksPerQuestion: obj.marksPerQuestion,
      negativeMarking: obj.negativeMarking,
      passingScore: obj.passingScore,
      allowRetake: obj.allowRetake,
      shuffleOptions: obj.shuffleOptions,
      showResultsImmediately: obj.showResultsImmediately,
      isActive: obj.isActive,
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt,
      userAttemptAction: userAttemptAction || UserAttemptAction.START,
      resumeAttemptId,
    });
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

  private examIdOf(mockTest: MockTestDocument): string | null {
    const exam = mockTest.exam as unknown as
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
}
