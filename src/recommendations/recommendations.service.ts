import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types, UpdateQuery } from 'mongoose';
import { PaginationMetaDto } from '../common/dto/api-response.dto';
import {
  createdByFields,
  updatedByFields,
} from '../common/types/to-actor-object-id';
import { Exam, ExamDocument } from '../exams/schemas/exam.schema';
import { CreateRecommendationOfferingDto } from './dto/create-recommendation-offering.dto';
import { PaginatedRecommendationOfferingsResponseDto } from './dto/paginated-recommendation-offerings-response.dto';
import { RecommendationOfferingResponseDto } from './dto/recommendation-offering-response.dto';
import { UpdateRecommendationOfferingDto } from './dto/update-recommendation-offering.dto';
import { RecommendationKind } from './enums/recommendation-kind.enum';
import {
  RecommendationOffering,
  RecommendationOfferingDocument,
} from './schemas/recommendation-offering.schema';

type PopulatedExam = { _id: Types.ObjectId; name?: string };

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectModel(RecommendationOffering.name)
    private readonly offeringModel: Model<RecommendationOfferingDocument>,
    @InjectModel(Exam.name)
    private readonly examModel: Model<ExamDocument>,
  ) {}

  async create(
    dto: CreateRecommendationOfferingDto,
    actorUserId?: string,
  ): Promise<RecommendationOfferingResponseDto> {
    const kind = dto.kind ?? RecommendationKind.COURSE;
    await this.assertExam(dto.exam);
    this.assertThresholds(dto.minPercent, dto.comfortPercent);
    await this.assertKindRules(kind, dto.parentOffering, dto.exam);

    const sortOrder =
      dto.sortOrder ?? (await this.nextSortOrder(dto.exam, kind));

    const created = await this.offeringModel.create({
      exam: new Types.ObjectId(dto.exam),
      kind,
      ...(dto.parentOffering
        ? { parentOffering: new Types.ObjectId(dto.parentOffering) }
        : {}),
      title: dto.title,
      subtitle: dto.subtitle,
      description: dto.description,
      minPercent: dto.minPercent,
      ...(dto.comfortPercent !== undefined
        ? { comfortPercent: dto.comfortPercent }
        : {}),
      sortOrder,
      ...createdByFields(actorUserId),
    });

    const populated = await this.offeringModel
      .findById(created._id)
      .populate('exam', 'name')
      .exec();
    if (!populated) {
      throw new NotFoundException(
        'Recommendation offering not found after create',
      );
    }
    return this.toResponseDto(populated);
  }

  async findAll(
    page = 1,
    limit = 20,
    filters: {
      examId?: string;
      kind?: RecommendationKind;
      activeOnly?: boolean;
      search?: string;
    } = {},
  ): Promise<PaginatedRecommendationOfferingsResponseDto> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<RecommendationOffering> = {
      isDeleted: { $ne: true },
    };

    if (filters.examId) {
      if (!Types.ObjectId.isValid(filters.examId)) {
        throw new BadRequestException('examId must be a valid ObjectId');
      }
      query.exam = new Types.ObjectId(filters.examId);
    }
    if (filters.kind) {
      query.kind = filters.kind;
    }
    if (filters.activeOnly) {
      query.isActive = true;
    }
    if (filters.search?.trim()) {
      query.title = { $regex: filters.search.trim(), $options: 'i' };
    }

    const [rows, total] = await Promise.all([
      this.offeringModel
        .find(query)
        .populate('exam', 'name')
        .sort({ sortOrder: 1, createdAt: 1 })
        .skip(skip)
        .limit(validLimit)
        .exec(),
      this.offeringModel.countDocuments(query).exec(),
    ]);

    const totalPages = Math.ceil(total / validLimit) || 0;
    const pagination: PaginationMetaDto = {
      total,
      page: validPage,
      limit: validLimit,
      totalPages,
      hasNextPage: validPage < totalPages,
      hasPrevPage: validPage > 1,
    };

    return {
      data: rows.map(row => this.toResponseDto(row)),
      pagination,
    };
  }

  /** Active COURSE offerings for an exam (student analysis). */
  async listActiveCoursesForExam(
    examId: string,
  ): Promise<RecommendationOfferingResponseDto[]> {
    if (!Types.ObjectId.isValid(examId)) {
      throw new BadRequestException('examId must be a valid ObjectId');
    }
    const rows = await this.offeringModel
      .find({
        exam: new Types.ObjectId(examId),
        kind: RecommendationKind.COURSE,
        isActive: true,
        isDeleted: { $ne: true },
      })
      .populate('exam', 'name')
      .sort({ sortOrder: 1, createdAt: 1 })
      .exec();
    return rows.map(row => this.toResponseDto(row));
  }

  async findOne(id: string): Promise<RecommendationOfferingResponseDto> {
    const item = await this.offeringModel
      .findById(id)
      .populate('exam', 'name')
      .exec();
    if (!item) {
      throw new NotFoundException(
        `Recommendation offering with ID "${id}" not found`,
      );
    }
    return this.toResponseDto(item);
  }

  async update(
    id: string,
    dto: UpdateRecommendationOfferingDto,
    actorUserId?: string,
  ): Promise<RecommendationOfferingResponseDto> {
    const existing = await this.offeringModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException(
        `Recommendation offering with ID "${id}" not found`,
      );
    }

    const nextExamId = dto.exam ?? existing.exam.toString();
    const nextKind = dto.kind ?? existing.kind;
    const nextMin =
      dto.minPercent !== undefined ? dto.minPercent : existing.minPercent;
    const nextComfort =
      dto.comfortPercent === null
        ? undefined
        : dto.comfortPercent !== undefined
          ? dto.comfortPercent
          : existing.comfortPercent;

    if (dto.exam) {
      await this.assertExam(dto.exam);
    }
    this.assertThresholds(nextMin, nextComfort);

    const nextParent =
      dto.parentOffering === null
        ? undefined
        : dto.parentOffering !== undefined
          ? dto.parentOffering
          : existing.parentOffering?.toString();
    await this.assertKindRules(nextKind, nextParent, nextExamId, id);

    const $set: Record<string, unknown> = {
      ...updatedByFields(actorUserId),
    };
    const $unset: Record<string, 1> = {};

    if (dto.exam !== undefined) $set.exam = new Types.ObjectId(dto.exam);
    if (dto.kind !== undefined) $set.kind = dto.kind;
    if (dto.title !== undefined) $set.title = dto.title;
    if (dto.subtitle !== undefined) $set.subtitle = dto.subtitle;
    if (dto.description !== undefined) $set.description = dto.description;
    if (dto.minPercent !== undefined) $set.minPercent = dto.minPercent;
    if (dto.sortOrder !== undefined) $set.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) $set.isActive = dto.isActive;

    if (dto.comfortPercent === null) {
      $unset.comfortPercent = 1;
    } else if (dto.comfortPercent !== undefined) {
      $set.comfortPercent = dto.comfortPercent;
    }

    if (dto.parentOffering === null) {
      $unset.parentOffering = 1;
    } else if (dto.parentOffering !== undefined) {
      $set.parentOffering = new Types.ObjectId(dto.parentOffering);
    }

    const updateQuery: UpdateQuery<RecommendationOffering> = {};
    if (Object.keys($set).length > 0) updateQuery.$set = $set;
    if (Object.keys($unset).length > 0) updateQuery.$unset = $unset;

    const updated = await this.offeringModel
      .findByIdAndUpdate(id, updateQuery, { new: true })
      .populate('exam', 'name')
      .exec();
    if (!updated) {
      throw new NotFoundException(
        `Recommendation offering with ID "${id}" not found`,
      );
    }
    return this.toResponseDto(updated);
  }

  async remove(
    id: string,
    actorUserId?: string,
  ): Promise<RecommendationOfferingResponseDto> {
    const updated = await this.offeringModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            isDeleted: true,
            isActive: false,
            ...updatedByFields(actorUserId),
          },
        },
        { new: true },
      )
      .populate('exam', 'name')
      .exec();
    if (!updated) {
      throw new NotFoundException(
        `Recommendation offering with ID "${id}" not found`,
      );
    }
    return this.toResponseDto(updated);
  }

  private async assertExam(examId: string): Promise<void> {
    if (!Types.ObjectId.isValid(examId)) {
      throw new BadRequestException('exam must be a valid ObjectId');
    }
    const exam = await this.examModel.findById(examId).select('_id').exec();
    if (!exam) {
      throw new BadRequestException(`Exam with ID "${examId}" not found`);
    }
  }

  private assertThresholds(
    minPercent: number,
    comfortPercent?: number | null,
  ): void {
    if (
      comfortPercent !== undefined &&
      comfortPercent !== null &&
      comfortPercent < minPercent
    ) {
      throw new BadRequestException(
        'comfortPercent must be greater than or equal to minPercent',
      );
    }
  }

  private async assertKindRules(
    kind: RecommendationKind,
    parentOfferingId: string | undefined,
    examId: string,
    selfId?: string,
  ): Promise<void> {
    if (kind === RecommendationKind.COURSE) {
      if (parentOfferingId) {
        throw new BadRequestException(
          'COURSE offerings cannot have a parentOffering',
        );
      }
      return;
    }

    // INSTITUTION (future): require a COURSE parent under the same exam
    if (!parentOfferingId) {
      throw new BadRequestException(
        'INSTITUTION offerings require a parentOffering COURSE id',
      );
    }
    if (selfId && parentOfferingId === selfId) {
      throw new BadRequestException('parentOffering cannot reference itself');
    }
    const parent = await this.offeringModel.findById(parentOfferingId).exec();
    if (!parent) {
      throw new BadRequestException(
        `Parent offering with ID "${parentOfferingId}" not found`,
      );
    }
    if (parent.kind !== RecommendationKind.COURSE) {
      throw new BadRequestException('parentOffering must be a COURSE offering');
    }
    if (parent.exam.toString() !== examId) {
      throw new BadRequestException(
        'parentOffering must belong to the same exam',
      );
    }
  }

  private async nextSortOrder(
    examId: string,
    kind: RecommendationKind,
  ): Promise<number> {
    const last = await this.offeringModel
      .findOne({
        exam: new Types.ObjectId(examId),
        kind,
        isDeleted: { $ne: true },
      })
      .sort({ sortOrder: -1 })
      .select('sortOrder')
      .exec();
    return last ? last.sortOrder + 1 : 0;
  }

  private toResponseDto(
    doc: RecommendationOfferingDocument,
  ): RecommendationOfferingResponseDto {
    const exam = doc.exam as unknown as PopulatedExam | Types.ObjectId;
    const examRef =
      exam &&
      typeof exam === 'object' &&
      '_id' in exam &&
      !(exam instanceof Types.ObjectId)
        ? {
            id: (exam as PopulatedExam)._id.toHexString(),
            name: (exam as PopulatedExam).name ?? '',
          }
        : {
            id: (doc.exam as Types.ObjectId).toHexString(),
            name: '',
          };

    return new RecommendationOfferingResponseDto({
      id: doc.id,
      exam: examRef,
      kind: doc.kind,
      ...(doc.parentOffering
        ? { parentOfferingId: doc.parentOffering.toHexString() }
        : {}),
      title: doc.title,
      ...(doc.subtitle ? { subtitle: doc.subtitle } : {}),
      ...(doc.description ? { description: doc.description } : {}),
      minPercent: doc.minPercent,
      ...(doc.comfortPercent !== undefined
        ? { comfortPercent: doc.comfortPercent }
        : {}),
      sortOrder: doc.sortOrder,
      isActive: doc.isActive,
      createdAt: doc.createdAt as Date,
      updatedAt: doc.updatedAt as Date,
    });
  }
}
