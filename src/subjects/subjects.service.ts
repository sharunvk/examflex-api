import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Subject, SubjectDocument } from './schemas/subject.schema';
import { Topic, TopicDocument } from '../topics/schemas/topic.schema';
import { Exam, ExamDocument } from '../exams/schemas/exam.schema';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { SubjectResponseDto } from './dto/subject-response.dto';
import { SubjectForExamResponseDto } from './dto/subject-for-exam-response.dto';
import { PopulatedDocument } from '../common/types/populated-document.interface';
import {
  createdByFields,
  omitActorFields,
  updatedByFields,
} from '../common/types/to-actor-object-id';

@Injectable()
export class SubjectsService {
  constructor(
    @InjectModel(Subject.name)
    private subjectModel: Model<SubjectDocument>,
    @InjectModel(Topic.name)
    private topicModel: Model<TopicDocument>,
    @InjectModel(Exam.name)
    private examModel: Model<ExamDocument>,
  ) {}

  /**
   * Create a new subject
   */
  async create(
    createSubjectDto: CreateSubjectDto,
    actorUserId?: string,
  ): Promise<SubjectResponseDto> {
    // Check for duplicate name
    const existing = await this.subjectModel
      .findOne({ name: createSubjectDto.name })
      .exec();

    if (existing) {
      throw new ConflictException('Subject with this name already exists');
    }

    // Validate topics if provided
    if (createSubjectDto.topics && createSubjectDto.topics.length > 0) {
      const topicsExist = await this.topicModel
        .find({ _id: { $in: createSubjectDto.topics } })
        .exec();

      if (topicsExist.length !== createSubjectDto.topics.length) {
        throw new BadRequestException('One or more topic IDs are invalid');
      }
    }

    const subject = await this.subjectModel.create({
      ...createSubjectDto,
      ...createdByFields(actorUserId),
    });
    return this.toResponseDto(await subject.populate('topics', 'name'));
  }

  /**
   * Find all subjects
   */
  async findAll(): Promise<SubjectResponseDto[]> {
    const subjects = await this.subjectModel
      .find()
      .populate('topics', 'name')
      .sort({ name: 1 })
      .exec();
    return subjects.map(subject => this.toResponseDto(subject));
  }

  /**
   * Find one subject by ID
   */
  async findOne(id: string): Promise<SubjectResponseDto> {
    const subject = await this.subjectModel
      .findById(id)
      .populate('topics', 'name')
      .exec();

    if (!subject) {
      throw new NotFoundException(`Subject with ID "${id}" not found`);
    }

    return this.toResponseDto(subject);
  }

  /**
   * Update subject
   */
  async update(
    id: string,
    updateSubjectDto: UpdateSubjectDto,
    actorUserId?: string,
  ): Promise<SubjectResponseDto> {
    // Check for duplicate name if name is being updated
    if (updateSubjectDto.name) {
      const duplicate = await this.subjectModel
        .findOne({
          _id: { $ne: id },
          name: updateSubjectDto.name,
        })
        .exec();

      if (duplicate) {
        throw new ConflictException('Subject with this name already exists');
      }
    }

    // Validate topics if provided
    if (updateSubjectDto.topics && updateSubjectDto.topics.length > 0) {
      const topicsExist = await this.topicModel
        .find({ _id: { $in: updateSubjectDto.topics } })
        .exec();

      if (topicsExist.length !== updateSubjectDto.topics.length) {
        throw new BadRequestException('One or more topic IDs are invalid');
      }
    }

    const subject = await this.subjectModel
      .findByIdAndUpdate(
        id,
        { ...updateSubjectDto, ...updatedByFields(actorUserId) },
        {
          new: true,
          runValidators: true,
        },
      )
      .populate('topics', 'name')
      .exec();

    if (!subject) {
      throw new NotFoundException(`Subject with ID "${id}" not found`);
    }

    return this.toResponseDto(subject);
  }

  /**
   * Soft delete subject
   */
  async remove(id: string, actorUserId?: string): Promise<SubjectResponseDto> {
    const subject = await this.subjectModel
      .findByIdAndUpdate(
        id,
        { isDeleted: true, isActive: false, ...updatedByFields(actorUserId) },
        { new: true },
      )
      .populate('topics', 'name')
      .exec();

    if (!subject) {
      throw new NotFoundException(`Subject with ID "${id}" not found`);
    }

    return this.toResponseDto(subject);
  }

  /**
   * Find all subjects belonging to a specific exam
   * Uses aggregation to join exam.subjects[] with the subjects collection in one DB round-trip
   * @param examId - Exam ID
   * @returns Array of subjects (id, name, description)
   */
  async findByExam(examId: string): Promise<SubjectForExamResponseDto[]> {
    const results = await this.examModel
      .aggregate<{
        _id: Types.ObjectId;
        name: string;
        description?: string;
        topics: Array<{ _id: Types.ObjectId; name: string }>;
      }>([
        {
          $match: {
            _id: new Types.ObjectId(examId),
            isDeleted: { $ne: true },
          },
        },
        { $unwind: '$subjects' },
        // exam.subjects.subject may be stored as ObjectId or string; normalize for $lookup
        {
          $addFields: {
            'subjects.subject': {
              $convert: {
                input: '$subjects.subject',
                to: 'objectId',
                onError: null,
                onNull: null,
              },
            },
          },
        },
        {
          $match: {
            'subjects.subject': { $ne: null },
          },
        },
        {
          $lookup: {
            from: 'subjects',
            localField: 'subjects.subject',
            foreignField: '_id',
            as: 'subjectDoc',
          },
        },
        { $unwind: '$subjectDoc' },
        {
          $match: {
            'subjectDoc.isDeleted': { $ne: true },
            'subjectDoc.isActive': true,
          },
        },
        {
          $lookup: {
            from: 'topics',
            let: { topicIds: { $ifNull: ['$subjectDoc.topics', []] } },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ['$_id', '$$topicIds'] },
                  isDeleted: { $ne: true },
                  isActive: true,
                },
              },
              { $project: { _id: 1, name: 1 } },
              { $sort: { name: 1 } },
            ],
            as: 'topics',
          },
        },
        {
          $group: {
            _id: '$subjectDoc._id',
            name: { $first: '$subjectDoc.name' },
            description: { $first: '$subjectDoc.description' },
            topics: { $first: '$topics' },
          },
        },
        { $sort: { name: 1 } },
      ])
      .exec();

    if (!results.length) {
      // Verify the exam exists so we can return a meaningful error
      const examExists = await this.examModel
        .exists({ _id: new Types.ObjectId(examId), isDeleted: { $ne: true } })
        .exec();

      if (!examExists) {
        throw new NotFoundException(`Exam with ID "${examId}" not found`);
      }
    }

    return results.map(
      doc =>
        new SubjectForExamResponseDto({
          id: doc._id.toString(),
          name: doc.name,
          description: doc.description,
          topics: (doc.topics || []).map(topic => ({
            id: topic._id.toString(),
            name: topic.name,
          })),
        }),
    );
  }

  /**
   * Helper to convert document to DTO
   */
  private toResponseDto(subject: SubjectDocument): SubjectResponseDto {
    const obj = omitActorFields(subject.toObject());
    return new SubjectResponseDto({
      ...obj,
      id: obj._id?.toString() || obj.id,
      topics:
        obj.topics?.map((topic: unknown) => {
          const topicDoc = topic as PopulatedDocument;
          return {
            id:
              typeof topic === 'string'
                ? topic
                : topic instanceof Types.ObjectId
                  ? topic.toString()
                  : topicDoc._id?.toString?.() ||
                    (typeof topicDoc.id === 'string' ? topicDoc.id : ''),
            name: topicDoc.name || '',
          };
        }) || [],
    });
  }
}
