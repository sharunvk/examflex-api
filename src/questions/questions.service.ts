import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  DEFAULT_QUESTION_SOURCE,
  Question,
  QuestionDocument,
} from '../mock-test-attempts/schemas/question.schema';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { NamedRefDto, QuestionResponseDto } from './dto/question-response.dto';
import { PaginationMetaDto } from '../common/dto/api-response.dto';
import { ImageMetadataDto } from './dto/image-metadata.dto';
import { AwsConfigService } from '../aws/config/aws.config';
import {
  assertAllowedBucket,
  assertSafeImageKey,
} from '../aws/s3/s3-access.util';
import {
  createdByFields,
  updatedByFields,
} from '../common/types/to-actor-object-id';
import { questionTagIds, questionTagNames } from './question-tag-names';
import { QuestionCitationsService } from '../citations/question-citations.service';
import { toChapterName } from '../citations/chapter-name';

const VISIBLE_QUESTION: FilterQuery<Question> = {
  isDeleted: { $ne: true },
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
}

@Injectable()
export class QuestionsService {
  constructor(
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
    private readonly awsConfig: AwsConfigService,
    private readonly citations: QuestionCitationsService,
  ) {}

  async create(
    dto: CreateQuestionDto,
    actorUserId?: string,
  ): Promise<QuestionResponseDto> {
    this.assertCorrectAnswer(dto);
    const question = await this.questionModel.create({
      ...this.toDocument(dto),
      source: DEFAULT_QUESTION_SOURCE,
      isActive: true,
      isDeleted: false,
      ...createdByFields(actorUserId),
    });

    // Background lookup: never blocks or fails the create.
    void this.citations.autoAttach(question.id);

    return this.findOne(question.id);
  }

  async findAll(
    page = 1,
    limit = 10,
    subjectId?: string,
    topicId?: string,
    examId?: string,
    search?: string,
  ): Promise<{ data: QuestionResponseDto[]; pagination: PaginationMetaDto }> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    const query: FilterQuery<Question> = { ...VISIBLE_QUESTION };

    if (subjectId) {
      if (!Types.ObjectId.isValid(subjectId)) {
        throw new BadRequestException('Invalid subject ID');
      }
      query.subject = new Types.ObjectId(subjectId);
    }
    if (topicId) {
      if (!Types.ObjectId.isValid(topicId)) {
        throw new BadRequestException('Invalid topic ID');
      }
      query.topic = new Types.ObjectId(topicId);
    }
    if (examId) {
      if (!Types.ObjectId.isValid(examId)) {
        throw new BadRequestException('Invalid exam ID');
      }
      query.exams = new Types.ObjectId(examId);
    }
    if (search?.trim()) {
      query['questionText.en.text'] = {
        $regex: escapeRegex(search.trim()),
        $options: 'i',
      };
    }

    const [questions, total] = await Promise.all([
      this.questionModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .populate('subject', 'name')
        .populate('topic', 'name')
        .populate('exams', 'name')
        .populate('tags', 'name')
        .exec(),
      this.questionModel.countDocuments(query).exec(),
    ]);

    const totalPages = Math.ceil(total / validLimit) || 1;

    return {
      data: questions.map(question => this.toResponseDto(question)),
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

  async findOne(id: string): Promise<QuestionResponseDto> {
    const question = await this.questionModel
      .findOne({ _id: id, ...VISIBLE_QUESTION })
      .populate('subject', 'name')
      .populate('topic', 'name')
      .populate('exams', 'name')
      .populate('tags', 'name')
      .exec();

    if (!question) {
      throw new NotFoundException(`Question with ID "${id}" not found`);
    }

    return this.toResponseDto(question);
  }

  async update(
    id: string,
    dto: UpdateQuestionDto,
    actorUserId?: string,
  ): Promise<QuestionResponseDto> {
    if (dto.options && dto.options.length !== 4) {
      throw new BadRequestException('Exactly 4 options are required');
    }
    this.assertCorrectAnswer(dto);

    const document = this.toDocument(dto);
    const patch = {
      ...document,
      ...updatedByFields(actorUserId),
    };
    const clearTags = dto.tagIds !== undefined && !('tags' in document);

    // Only a real subject change re-runs automatic citations.
    const previous =
      dto.subject !== undefined
        ? await this.questionModel
            .findOne({ _id: id, ...VISIBLE_QUESTION })
            .select('subject')
            .lean<{ subject?: Types.ObjectId }>()
            .exec()
        : null;

    const question = await this.questionModel
      .findOneAndUpdate(
        { _id: id, ...VISIBLE_QUESTION },
        {
          $set: patch,
          ...(clearTags ? { $unset: { tags: '' } } : {}),
        },
        { new: true },
      )
      .populate('subject', 'name')
      .populate('topic', 'name')
      .populate('exams', 'name')
      .populate('tags', 'name')
      .exec();

    if (!question) {
      throw new NotFoundException(`Question with ID "${id}" not found`);
    }

    if (
      previous &&
      String(previous.subject ?? '') !== this.refId(question.subject)
    ) {
      // autoAttach leaves admin-picked citations alone.
      void this.citations.autoAttach(question.id);
    }

    return this.toResponseDto(question);
  }

  /** Id of a ref that may be populated. */
  private refId(value: unknown): string {
    if (!value) {
      return '';
    }
    const row = value as { _id?: { toString(): string }; id?: unknown };
    if (row._id) {
      return row._id.toString();
    }
    return typeof row.id === 'string' ? row.id : String(value);
  }

  async remove(id: string, actorUserId?: string): Promise<{ message: string }> {
    const question = await this.questionModel
      .findOneAndUpdate(
        { _id: id, isDeleted: { $ne: true } },
        { isDeleted: true, isActive: false, ...updatedByFields(actorUserId) },
        { new: true },
      )
      .exec();

    if (!question) {
      throw new NotFoundException(`Question with ID "${id}" not found`);
    }

    return { message: 'Question deleted successfully' };
  }

  private toDocument(
    dto: CreateQuestionDto | UpdateQuestionDto,
  ): Record<string, unknown> {
    const document: Record<string, unknown> = {};

    if (dto.questionText) {
      document.questionText = {
        en: {
          text: dto.questionText.en?.text ?? null,
          image: this.sanitizeImage(dto.questionText.en?.image),
        },
        ml: {
          text: dto.questionText.ml?.text ?? null,
          image: this.sanitizeImage(dto.questionText.ml?.image),
        },
      };
    }

    if (dto.optionType) {
      document.optionType = dto.optionType;
    }

    if (dto.options) {
      document.options = dto.options.map(option => ({
        id: option.id,
        type: option.type || 'text',
        en: option.en ?? null,
        ml: option.ml ?? null,
        image: this.sanitizeImage(option.image),
      }));
    }

    if (dto.explanation) {
      document.explanation = {
        en: dto.explanation.en ?? null,
        ml: dto.explanation.ml ?? null,
        image: this.sanitizeImage(dto.explanation.image),
        images: Array.isArray(dto.explanation.images)
          ? dto.explanation.images
              .map(image => this.sanitizeImage(image))
              .filter((image): image is ImageMetadataDto => Boolean(image))
          : undefined,
      };
    }

    if (dto.correctAnswer) {
      document.correctAnswer = dto.correctAnswer;
    }

    if (dto.subject) {
      document.subject = new Types.ObjectId(dto.subject);
    }
    if (dto.topic) {
      document.topic = new Types.ObjectId(dto.topic);
    } else if (dto.topic === null) {
      document.topic = null;
    }
    if (dto.exams) {
      document.exams = dto.exams.map(id => new Types.ObjectId(id));
    }
    if (dto.tagIds !== undefined) {
      const ids = [
        ...new Set(
          dto.tagIds
            .map(id => (typeof id === 'string' ? id.trim() : ''))
            .filter(id => id.length > 0),
        ),
      ];
      if (ids.length > 0) {
        document.tags = ids.map(id => new Types.ObjectId(id));
      }
    }
    if (dto.difficultyLevel) {
      document.difficultyLevel = dto.difficultyLevel;
    }

    return document;
  }

  private assertCorrectAnswer(
    dto: CreateQuestionDto | UpdateQuestionDto,
  ): void {
    if (!dto.options || !dto.correctAnswer) {
      return;
    }
    if (!dto.options.some(option => option.id === dto.correctAnswer)) {
      throw new BadRequestException(
        'correctAnswer must match one of the option ids',
      );
    }
  }

  private sanitizeImage(
    image?: ImageMetadataDto | null,
  ): Omit<ImageMetadataDto, 'url'> | null {
    if (!image?.key || !image.bucket) {
      return null;
    }

    const key = assertSafeImageKey(image.key);
    const bucket = assertAllowedBucket(
      image.bucket,
      this.awsConfig.allowedImageBuckets,
    );

    return {
      key,
      bucket,
      region: image.region || this.awsConfig.region,
      contentType: image.contentType,
      size: image.size,
      lastModified: image.lastModified,
    };
  }

  private toNamedRef(value: unknown): NamedRefDto | string | undefined {
    if (!value) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
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

  private toResponseDto(question: QuestionDocument): QuestionResponseDto {
    const obj = question.toObject();
    return {
      id: obj.id || question._id.toString(),
      questionText: obj.questionText,
      optionType: obj.optionType,
      options: obj.options || [],
      explanation: obj.explanation,
      correctAnswer: obj.correctAnswer,
      subject: this.toNamedRef(obj.subject),
      topic: this.toNamedRef(obj.topic),
      exams: Array.isArray(obj.exams)
        ? obj.exams
            .map(exam => this.toNamedRef(exam))
            .filter((exam): exam is NamedRefDto | string => Boolean(exam))
        : [],
      tagIds: questionTagIds(obj),
      tags: questionTagNames(obj),
      difficultyLevel: obj.difficultyLevel,
      source: obj.source,
      citations: (obj.citations ?? [])
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map(c => ({
          ...c,
          // Citations saved before chapterName existed get it derived on read.
          chapterName: c.chapterName ?? toChapterName(c.sourceDoc),
        })),
      citationStatus: obj.citationStatus ?? null,
      citationsUpdatedAt: obj.citationsUpdatedAt ?? null,
      isActive: obj.isActive,
      createdAt: obj.createdAt as Date,
      updatedAt: obj.updatedAt as Date,
    };
  }
}
