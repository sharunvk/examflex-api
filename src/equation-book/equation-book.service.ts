import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  createdByFields,
  updatedByFields,
} from '../common/types/to-actor-object-id';
import { AwsConfigService } from '../aws/config/aws.config';
import { ImageUrlResolver } from '../aws/s3/image-url.resolver';
import {
  assertAllowedBucket,
  assertSafeImageKey,
} from '../aws/s3/s3-access.util';
import { Exam, ExamDocument } from '../exams/schemas/exam.schema';
import { ImageMetadataDto } from '../questions/dto/image-metadata.dto';
import { Subject, SubjectDocument } from '../subjects/schemas/subject.schema';
import { Topic, TopicDocument } from '../topics/schemas/topic.schema';
import { CreateEquationDto } from './dto/create-equation.dto';
import {
  EquationImageDto,
  EquationNamedRefDto,
  EquationResponseDto,
  PaginatedEquationsResponseDto,
} from './dto/equation-response.dto';
import { UpdateEquationDto } from './dto/update-equation.dto';
import { Equation, EquationDocument } from './schemas/equation.schema';

/** `toObject()` adds the virtual `id` on top of the stored fields. */
type EquationObject = Equation & { id?: string };

@Injectable()
export class EquationBookService {
  constructor(
    @InjectModel(Equation.name)
    private readonly equationModel: Model<EquationDocument>,
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Topic.name) private readonly topicModel: Model<TopicDocument>,
    @InjectModel(Exam.name) private readonly examModel: Model<ExamDocument>,
    private readonly awsConfig: AwsConfigService,
    private readonly imageUrlResolver: ImageUrlResolver,
  ) {}

  async create(
    dto: CreateEquationDto,
    actorUserId?: string,
  ): Promise<EquationResponseDto> {
    await this.assertCatalogRefs(dto.subject, dto.topic, dto.exams);
    const image = this.sanitizeImage(dto.image);

    const equation = new this.equationModel({
      title: dto.title.trim(),
      shortDescription: dto.shortDescription.trim(),
      equation: dto.equation.trim(),
      longDescription: dto.longDescription?.trim() || undefined,
      mnemonic: dto.mnemonic?.trim() || undefined,
      bulletPoints: this.normalizeBulletPoints(dto.bulletPoints),
      subject: new Types.ObjectId(dto.subject),
      topic: new Types.ObjectId(dto.topic),
      exams: dto.exams.map(id => new Types.ObjectId(id)),
      sortOrder: dto.sortOrder ?? 0,
      ...(image ? { image } : {}),
      ...createdByFields(actorUserId),
    });

    await equation.save();
    const populated = await this.equationModel
      .findById(equation._id)
      .populate('subject', 'name')
      .populate('topic', 'name')
      .populate('exams', 'name')
      .exec();

    if (!populated) {
      throw new NotFoundException('Equation not found after create');
    }

    return this.toResponseDto(populated, true);
  }

  async findAll(
    page = 1,
    limit = 10,
    filters: {
      examId?: string;
      subjectId?: string;
      topicId?: string;
      search?: string;
    } = {},
    includeImageMetadata = false,
  ): Promise<PaginatedEquationsResponseDto> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<Equation> = {};

    if (filters.examId) {
      query.exams = new Types.ObjectId(filters.examId);
    }
    if (filters.subjectId) {
      query.subject = new Types.ObjectId(filters.subjectId);
    }
    if (filters.topicId) {
      query.topic = new Types.ObjectId(filters.topicId);
    }
    if (filters.search?.trim()) {
      query.title = { $regex: filters.search.trim(), $options: 'i' };
    }

    const [rows, total] = await Promise.all([
      this.equationModel
        .find(query)
        .sort({ sortOrder: -1, updatedAt: -1, title: 1 })
        .skip(skip)
        .limit(validLimit)
        .populate('subject', 'name')
        .populate('topic', 'name')
        .populate('exams', 'name')
        .exec(),
      this.equationModel.countDocuments(query).exec(),
    ]);

    const totalPages = Math.ceil(total / validLimit) || 0;

    return {
      data: await this.toResponseDtos(rows, includeImageMetadata),
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

  async findOne(
    id: string,
    includeImageMetadata = false,
  ): Promise<EquationResponseDto> {
    const equation = await this.equationModel
      .findById(id)
      .populate('subject', 'name')
      .populate('topic', 'name')
      .populate('exams', 'name')
      .exec();

    if (!equation) {
      throw new NotFoundException(`Equation with ID "${id}" not found`);
    }

    return this.toResponseDto(equation, includeImageMetadata);
  }

  async update(
    id: string,
    dto: UpdateEquationDto,
    actorUserId?: string,
  ): Promise<EquationResponseDto> {
    const existing = await this.equationModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException(`Equation with ID "${id}" not found`);
    }

    const nextSubject = dto.subject ?? existing.subject.toString();
    const nextTopic = dto.topic ?? existing.topic.toString();
    const nextExams =
      dto.exams ?? existing.exams.map(examId => examId.toString());

    if (dto.subject || dto.topic || dto.exams) {
      await this.assertCatalogRefs(nextSubject, nextTopic, nextExams);
    }

    const updateData: Record<string, unknown> = {
      ...updatedByFields(actorUserId),
    };

    if (dto.title !== undefined) updateData.title = dto.title.trim();
    if (dto.shortDescription !== undefined) {
      updateData.shortDescription = dto.shortDescription.trim();
    }
    if (dto.equation !== undefined) updateData.equation = dto.equation.trim();
    if (dto.longDescription !== undefined) {
      updateData.longDescription = dto.longDescription.trim() || undefined;
    }
    if (dto.mnemonic !== undefined) {
      updateData.mnemonic = dto.mnemonic.trim() || undefined;
    }
    if (dto.bulletPoints !== undefined) {
      updateData.bulletPoints = this.normalizeBulletPoints(dto.bulletPoints);
    }
    // undefined = leave as is; null / empty = remove; metadata = replace
    if (dto.image !== undefined) {
      updateData.image = this.sanitizeImage(dto.image);
    }
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.subject) updateData.subject = new Types.ObjectId(dto.subject);
    if (dto.topic) updateData.topic = new Types.ObjectId(dto.topic);
    if (dto.exams) {
      updateData.exams = dto.exams.map(examId => new Types.ObjectId(examId));
    }

    const updated = await this.equationModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .populate('subject', 'name')
      .populate('topic', 'name')
      .populate('exams', 'name')
      .exec();

    if (!updated) {
      throw new NotFoundException(`Equation with ID "${id}" not found`);
    }

    return this.toResponseDto(updated, true);
  }

  async remove(id: string, actorUserId?: string): Promise<{ message: string }> {
    const equation = await this.equationModel
      .findByIdAndUpdate(
        id,
        {
          isDeleted: true,
          isActive: false,
          ...updatedByFields(actorUserId),
        },
        { new: true },
      )
      .exec();

    if (!equation) {
      throw new NotFoundException(`Equation with ID "${id}" not found`);
    }

    return { message: 'Equation deleted successfully' };
  }

  private async assertCatalogRefs(
    subjectId: string,
    topicId: string,
    examIds: string[],
  ): Promise<void> {
    const subject = await this.subjectModel.findById(subjectId).exec();
    if (!subject) {
      throw new BadRequestException(`Subject with ID "${subjectId}" not found`);
    }

    const topic = await this.topicModel.findById(topicId).exec();
    if (!topic) {
      throw new BadRequestException(`Topic with ID "${topicId}" not found`);
    }

    const topicOnSubject = (subject.topics || []).some(
      id => id.toString() === topicId,
    );
    if (!topicOnSubject) {
      throw new BadRequestException(
        `Topic "${topicId}" does not belong to subject "${subjectId}"`,
      );
    }

    if (!examIds.length) {
      throw new BadRequestException('At least one exam is required');
    }

    const uniqueExamIds = [...new Set(examIds)];
    const exams = await this.examModel
      .find({ _id: { $in: uniqueExamIds.map(id => new Types.ObjectId(id)) } })
      .exec();

    if (exams.length !== uniqueExamIds.length) {
      throw new BadRequestException(
        'One or more exam IDs are invalid or deleted',
      );
    }
  }

  /** Same rules as question images: allowed key prefix + image bucket only. */
  private sanitizeImage(
    image?: ImageMetadataDto | null,
  ): Omit<ImageMetadataDto, 'url'> | null {
    if (!image?.key || !image.bucket) {
      return null;
    }
    return {
      key: assertSafeImageKey(image.key),
      bucket: assertAllowedBucket(
        image.bucket,
        this.awsConfig.allowedImageBuckets,
      ),
      region: image.region || this.awsConfig.region,
      contentType: image.contentType,
      size: image.size,
      lastModified: image.lastModified,
    };
  }

  private normalizeBulletPoints(points?: string[]): string[] {
    if (!points) return [];
    return points.map(point => point.trim()).filter(Boolean);
  }

  private toNamedRef(value: unknown): EquationNamedRefDto | string | undefined {
    if (value == null) return undefined;
    if (typeof value === 'string') return value;
    if (value instanceof Types.ObjectId) return value.toString();

    const row = value as {
      id?: string;
      _id?: { toString(): string };
      name?: string;
    };
    const id = row.id || row._id?.toString();
    if (id && row.name) {
      return { id, name: row.name };
    }
    return id;
  }

  private async toResponseDto(
    equation: EquationDocument,
    includeImageMetadata: boolean,
  ): Promise<EquationResponseDto> {
    const [dto] = await this.toResponseDtos([equation], includeImageMetadata);
    return dto;
  }

  /** Signs every picture in one batch so list pages stay cheap. */
  private async toResponseDtos(
    equations: EquationDocument[],
    includeImageMetadata: boolean,
  ): Promise<EquationResponseDto[]> {
    const objects = equations.map(
      equation => equation.toObject() as EquationObject,
    );
    const urls = await this.imageUrlResolver.resolveMany(
      objects.map(obj => obj.image),
    );

    return equations.map((equation, index) =>
      this.buildResponse(
        equation,
        objects[index],
        urls[index],
        includeImageMetadata,
      ),
    );
  }

  private buildResponse(
    equation: EquationDocument,
    obj: EquationObject,
    imageUrl: string | null | undefined,
    includeImageMetadata: boolean,
  ): EquationResponseDto {
    const subject = this.toNamedRef(obj.subject);
    const topic = this.toNamedRef(obj.topic);
    const exams = Array.isArray(obj.exams)
      ? obj.exams
          .map(exam => this.toNamedRef(exam))
          .filter((exam): exam is EquationNamedRefDto | string => Boolean(exam))
      : [];
    const image = obj.image as EquationImageDto | null | undefined;
    const hasImage = Boolean(image?.key && image.bucket);

    return {
      id: obj.id || equation._id.toString(),
      title: obj.title,
      shortDescription: obj.shortDescription,
      equation: obj.equation,
      longDescription: obj.longDescription,
      mnemonic: obj.mnemonic,
      bulletPoints: Array.isArray(obj.bulletPoints) ? obj.bulletPoints : [],
      ...(hasImage ? { imageUrl: imageUrl ?? null } : {}),
      ...(hasImage && includeImageMetadata && image
        ? {
            image: {
              key: image.key,
              bucket: image.bucket,
              region: image.region,
              contentType: image.contentType,
              size: image.size,
              lastModified: image.lastModified,
            },
          }
        : {}),
      subject: subject ?? '',
      topic: topic ?? '',
      exams,
      sortOrder: obj.sortOrder ?? 0,
      isActive: obj.isActive,
      createdAt: obj.createdAt as Date,
      updatedAt: obj.updatedAt as Date,
    };
  }
}
