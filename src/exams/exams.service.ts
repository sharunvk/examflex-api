import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, FilterQuery } from 'mongoose';
import { Exam, ExamDocument } from './schemas/exam.schema';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { ExamResponseDto } from './dto/exam-response.dto';
import {
  CategoryGroupDto,
  ExamsByCategoryPageDto,
} from './dto/exams-by-category-response.dto';
import { compareByDashboardPriority } from '../categories/category-priority';
import { PaginatedExamsResponseDto } from './dto/paginated-exams-response.dto';
import {
  Category,
  CategoryDocument,
} from '../categories/schemas/category.schema';
import {
  ExamGroup,
  ExamGroupDocument,
} from '../exam-groups/schemas/exam-group.schema';
import {
  createdByFields,
  omitActorFields,
  updatedByFields,
} from '../common/types/to-actor-object-id';
import { PaginationMetaDto } from '../common/dto/api-response.dto';
import { PaperType } from '../common/enums/paper-type.enum';
import { buildExamStatsLabel } from './exam-stats-label';

@Injectable()
export class ExamsService {
  constructor(
    @InjectModel(Exam.name)
    private examModel: Model<ExamDocument>,
    @InjectModel(Category.name)
    private categoryModel: Model<CategoryDocument>,
    @InjectModel(ExamGroup.name)
    private examGroupModel: Model<ExamGroupDocument>,
  ) {}

  /**
   * Create a new exam
   */
  async create(
    createExamDto: CreateExamDto,
    actorUserId?: string,
  ): Promise<ExamResponseDto> {
    // Verify category exists
    const category = await this.categoryModel
      .findById(createExamDto.category)
      .exec();

    if (!category) {
      throw new BadRequestException(
        `Category with ID "${createExamDto.category}" not found`,
      );
    }

    const examGroup = await this.examGroupModel
      .findById(createExamDto.examGroup)
      .exec();
    if (!examGroup) {
      throw new BadRequestException(
        `Exam group with ID "${createExamDto.examGroup}" not found`,
      );
    }

    this.assertCategoryMatchesExamGroup(
      createExamDto.category,
      examGroup.category,
    );

    // Check for duplicate name within same category
    const existing = await this.examModel
      .findOne({
        name: createExamDto.name,
        category: createExamDto.category,
      })
      .exec();

    if (existing) {
      throw new ConflictException(
        'Exam with this name already exists in this category',
      );
    }

    const exam = await this.examModel.create({
      ...this.withComputedTotals(createExamDto),
      ...createdByFields(actorUserId),
    });
    return this.toResponseDto(exam);
  }

  /**
   * Find all exams with pagination and search
   */
  async findAll(
    page: number = 1,
    limit: number = 10,
    search?: string,
    categoryId?: string,
    activeOnly: boolean = false,
  ): Promise<PaginatedExamsResponseDto> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<Exam> = { isDeleted: { $ne: true } };

    if (activeOnly) {
      query.isActive = true;
    }

    if (categoryId) {
      query.category = new Types.ObjectId(categoryId);
    }

    if (search && search.trim()) {
      query.$text = { $search: search.trim() };
    }

    const [exams, total] = await Promise.all([
      this.examModel
        .find(query)
        .populate('category')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .exec(),
      this.examModel.countDocuments(query).exec(),
    ]);

    const totalPages = Math.ceil(total / validLimit);

    return {
      data: exams.map(exam => this.toResponseDto(exam)),
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
   * Get exams grouped by category (PUBLIC API) for the student mocks hub.
   * Returns one category page by default; skips categories with no showInApp exams.
   */
  async getExamsByCategory(
    page: number = 1,
    limit: number = 1,
  ): Promise<ExamsByCategoryPageDto> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 50);

    const categoryQuery: FilterQuery<Category> = { isActive: true };
    const examQuery: FilterQuery<Exam> = {
      isActive: true,
      isDeleted: { $ne: true },
      showInApp: true,
    };

    const categories = (
      await this.categoryModel
        .find(categoryQuery)
        .sort({ priority: -1, name: 1 })
        .lean()
        .exec()
    ).sort(compareByDashboardPriority);

    const exams = await this.examModel.find(examQuery).lean().exec();

    const paperCountRows = await this.examModel
      .aggregate<{
        _id: Types.ObjectId;
        paperCounts: Array<{ _id: string; count: number }>;
      }>([
        { $match: examQuery },
        {
          $lookup: {
            from: 'mocktests',
            let: { examId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$exam', '$$examId'] },
                  isActive: true,
                  isDeleted: false,
                  paperType: {
                    $in: [
                      PaperType.TOPIC_WISE,
                      PaperType.FULL_EXAM,
                      PaperType.SPRINT,
                    ],
                  },
                },
              },
              { $group: { _id: '$paperType', count: { $sum: 1 } } },
            ],
            as: 'paperCounts',
          },
        },
        { $project: { _id: 1, paperCounts: 1 } },
      ])
      .exec();

    const paperCountMap = new Map(
      paperCountRows.map(row => {
        const counts = { chapterWise: 0, fullMocks: 0, sprint: 0 };
        for (const entry of row.paperCounts || []) {
          if (entry._id === PaperType.TOPIC_WISE) {
            counts.chapterWise = entry.count;
          } else if (entry._id === PaperType.FULL_EXAM) {
            counts.fullMocks = entry.count;
          } else if (entry._id === PaperType.SPRINT) {
            counts.sprint = entry.count;
          }
        }
        return [row._id.toString(), counts] as const;
      }),
    );

    const allGroups: CategoryGroupDto[] = [];

    for (const category of categories) {
      const categoryExams = exams.filter(
        exam =>
          exam.category && exam.category.toString() === category._id.toString(),
      );
      if (categoryExams.length === 0) {
        continue;
      }

      allGroups.push({
        id: category._id.toString(),
        name: category.name,
        shortName: category.shortName,
        imageUrl: category.imageUrl,
        description: category.description,
        priority: category.priority ?? 0,
        exams: categoryExams.map(exam => {
          const paperCounts = paperCountMap.get(exam._id.toString()) || {
            chapterWise: 0,
            fullMocks: 0,
            sprint: 0,
          };
          const description = exam.description;
          return {
            id: exam._id.toString(),
            title: exam.name,
            description,
            imageUrl: category.imageUrl,
            fullName: description,
            duration: exam.duration
              ? this.formatDuration(exam.duration)
              : undefined,
            totalQuestions: exam.totalQuestions,
            totalMarks: exam.totalMarks,
            statsLabel: buildExamStatsLabel({
              totalQuestions: exam.totalQuestions,
              duration: exam.duration,
              totalMarks: exam.totalMarks,
              subjects: exam.subjects,
            }),
            testsCount: paperCounts.chapterWise,
            paperCounts,
            subjectsCount: exam.subjects?.length || 0,
            trending: exam.trending === true,
          };
        }),
      });
    }

    const total = allGroups.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / validLimit);
    const skip = (validPage - 1) * validLimit;
    const data = allGroups.slice(skip, skip + validLimit);

    const pagination: PaginationMetaDto = {
      total,
      page: validPage,
      limit: validLimit,
      totalPages,
      hasNextPage: validPage < totalPages,
      hasPrevPage: validPage > 1 && totalPages > 0,
    };

    return { data, pagination };
  }

  /**
   * Find one exam by ID
   */
  async findOne(id: string): Promise<ExamResponseDto> {
    const exam = await this.examModel
      .findById(id)
      .populate('category')
      .populate('subjects.subject')
      .exec();

    if (!exam) {
      throw new NotFoundException(`Exam with ID "${id}" not found`);
    }

    return this.toResponseDto(exam);
  }

  /**
   * Find exams by category
   */
  async findByCategory(
    categoryId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedExamsResponseDto> {
    return this.findAll(page, limit, undefined, categoryId, false);
  }

  /**
   * Update exam
   */
  async update(
    id: string,
    updateExamDto: UpdateExamDto,
    actorUserId?: string,
  ): Promise<ExamResponseDto> {
    // If category is being updated, verify it exists
    if (updateExamDto.category) {
      const category = await this.categoryModel
        .findById(updateExamDto.category)
        .exec();

      if (!category) {
        throw new BadRequestException(
          `Category with ID "${updateExamDto.category}" not found`,
        );
      }
    }

    let examGroupDoc: ExamGroupDocument | null = null;
    if (updateExamDto.examGroup) {
      examGroupDoc = await this.examGroupModel
        .findById(updateExamDto.examGroup)
        .exec();
      if (!examGroupDoc) {
        throw new BadRequestException(
          `Exam group with ID "${updateExamDto.examGroup}" not found`,
        );
      }
    }

    // When category and/or examGroup change, enforce category === examGroup.category
    if (updateExamDto.category || updateExamDto.examGroup) {
      const existingExam = await this.examModel.findById(id).exec();
      if (!existingExam) {
        throw new NotFoundException(`Exam with ID "${id}" not found`);
      }

      const effectiveCategoryId = (
        updateExamDto.category || existingExam.category
      )?.toString();
      if (!effectiveCategoryId) {
        throw new BadRequestException(
          'Exam category is required and must match the exam group category',
        );
      }

      if (!examGroupDoc) {
        const examGroupId = (
          updateExamDto.examGroup || existingExam.examGroup
        )?.toString();
        if (!examGroupId) {
          throw new BadRequestException(
            'Exam group is required when updating category; set examGroup as well',
          );
        }
        examGroupDoc = await this.examGroupModel.findById(examGroupId).exec();
        if (!examGroupDoc) {
          throw new BadRequestException(
            `Exam group with ID "${examGroupId}" not found`,
          );
        }
      }

      this.assertCategoryMatchesExamGroup(
        effectiveCategoryId,
        examGroupDoc.category,
      );
    }

    // Check for duplicate name if name or category is being updated
    if (updateExamDto.name || updateExamDto.category) {
      const existingExam = await this.examModel.findById(id).exec();
      if (!existingExam) {
        throw new NotFoundException(`Exam with ID "${id}" not found`);
      }

      const duplicate = await this.examModel
        .findOne({
          _id: { $ne: id },
          name: updateExamDto.name || existingExam.name,
          category: updateExamDto.category || existingExam.category,
        })
        .exec();

      if (duplicate) {
        throw new ConflictException(
          'Exam with this name already exists in this category',
        );
      }
    }

    const exam = await this.examModel
      .findByIdAndUpdate(
        id,
        {
          ...this.withComputedTotals(updateExamDto),
          ...updatedByFields(actorUserId),
        },
        {
          new: true,
        },
      )
      .populate('category')
      .populate('examGroup')
      .exec();

    if (!exam) {
      throw new NotFoundException(`Exam with ID "${id}" not found`);
    }

    return this.toResponseDto(exam);
  }

  /**
   * Soft delete exam
   */
  async remove(id: string, actorUserId?: string): Promise<ExamResponseDto> {
    const exam = await this.examModel
      .findByIdAndUpdate(
        id,
        { isDeleted: true, isActive: false, ...updatedByFields(actorUserId) },
        { new: true },
      )
      .populate('category')
      .exec();

    if (!exam) {
      throw new NotFoundException(`Exam with ID "${id}" not found`);
    }

    return this.toResponseDto(exam);
  }

  /**
   * EXAM_GROUP entitlements require exam.category === examGroup.category (R-04).
   */
  private assertCategoryMatchesExamGroup(
    examCategoryId: string | Types.ObjectId,
    examGroupCategoryId: string | Types.ObjectId | undefined | null,
  ): void {
    if (!examGroupCategoryId) {
      throw new BadRequestException(
        'Exam group is missing a category; cannot validate exam category invariant',
      );
    }
    if (examCategoryId.toString() !== examGroupCategoryId.toString()) {
      throw new BadRequestException(
        `Exam category "${examCategoryId.toString()}" must match exam group category "${examGroupCategoryId.toString()}"`,
      );
    }
  }

  private withComputedTotals<
    T extends {
      subjects?: Array<{
        numberOfQuestions?: number;
        marksPerQuestion?: number;
      }>;
      totalQuestions?: number;
      totalMarks?: number;
    },
  >(payload: T): T {
    if (!payload.subjects) {
      return payload;
    }

    const totalQuestions = payload.subjects.reduce(
      (sum, subject) => sum + (subject.numberOfQuestions || 0),
      0,
    );
    const totalMarks = payload.subjects.reduce(
      (sum, subject) =>
        sum +
        (subject.numberOfQuestions || 0) * (subject.marksPerQuestion || 0),
      0,
    );

    return {
      ...payload,
      totalQuestions,
      totalMarks,
    };
  }

  private toRefId(value: unknown): string | undefined {
    if (value == null) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object') {
      const row = value as { id?: unknown; _id?: { toString(): string } };
      if (typeof row.id === 'string' && row.id) {
        return row.id;
      }
      if (row._id) {
        return row._id.toString();
      }
    }
    return String(value);
  }

  private toRefName(value: unknown): string | undefined {
    if (value && typeof value === 'object') {
      const row = value as { name?: unknown };
      if (typeof row.name === 'string' && row.name) {
        return row.name;
      }
    }
    return undefined;
  }

  /**
   * Helper: Format duration from minutes to human-readable string
   */
  private formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${minutes}min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  }

  /**
   * Helper to convert document to DTO
   */
  private toResponseDto(exam: ExamDocument): ExamResponseDto {
    const obj = omitActorFields(exam.toObject());
    return new ExamResponseDto({
      ...obj,
      id: obj.id || exam._id.toString(),
      trending: obj.trending === true,
      showInApp: obj.showInApp === true,
      category: this.toRefId(obj.category) || '',
      examGroup: this.toRefId(obj.examGroup) || '',
      subjects: obj.subjects?.map(s => ({
        ...s,
        subject: this.toRefId(s.subject) || String(s.subject),
        name: this.toRefName(s.subject),
      })),
    });
  }
}
