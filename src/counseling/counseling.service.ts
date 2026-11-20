import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginationMetaDto } from '../common/dto/api-response.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { clampLimit, clampPage } from './counseling.constants';
import { CreateCounselingRequestDto } from './dto/create-counseling-request.dto';
import {
  CounselingActiveRequestDto,
  CounselingMeDto,
  CounselingRequestDto,
} from './dto/counseling-response.dto';
import {
  ACTIVE_COUNSELING_STATUSES,
  COUNSELING_STATUS_TRANSITIONS,
  CounselingRequestStatus,
} from './enums/counseling-request-status.enum';
import {
  CounselingRequest,
  CounselingRequestDocument,
} from './schemas/counseling-request.schema';

@Injectable()
export class CounselingService {
  constructor(
    @InjectModel(CounselingRequest.name)
    private readonly counselingModel: Model<CounselingRequestDocument>,
  ) {}

  async getMe(userId: string): Promise<CounselingMeDto> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID format');
    }

    const active = await this.counselingModel
      .findOne({
        userId: new Types.ObjectId(userId),
        status: { $in: [...ACTIVE_COUNSELING_STATUSES] },
      })
      .sort({ createdAt: -1 })
      .exec();

    if (!active) {
      return { canRequest: true, activeRequest: null };
    }

    return {
      canRequest: false,
      activeRequest: this.toActiveRequest(active),
    };
  }

  async create(
    user: UserResponseDto,
    dto: CreateCounselingRequestDto,
  ): Promise<CounselingRequestDto> {
    if (!Types.ObjectId.isValid(user.id)) {
      throw new BadRequestException('Invalid user ID format');
    }

    this.assertContact(dto);

    const userObjectId = new Types.ObjectId(user.id);
    const existingActive = await this.counselingModel
      .exists({
        userId: userObjectId,
        status: { $in: [...ACTIVE_COUNSELING_STATUSES] },
      })
      .exec();

    if (existingActive) {
      throw new ConflictException(
        'You already have an active counseling request. We will contact you soon.',
      );
    }

    const now = new Date();
    const contact = {
      emailEnabled: dto.contact.emailEnabled === true,
      phoneEnabled: dto.contact.phoneEnabled === true,
      ...(dto.contact.emailEnabled && dto.contact.email
        ? { email: dto.contact.email.trim().toLowerCase() }
        : {}),
      ...(dto.contact.phoneEnabled && dto.contact.phone
        ? { phone: dto.contact.phone.trim() }
        : {}),
    };

    const created = await this.counselingModel.create({
      userId: userObjectId,
      accountSnapshot: {
        ...(user.name?.trim() ? { name: user.name.trim() } : {}),
        ...(user.email?.trim()
          ? { email: user.email.trim().toLowerCase() }
          : {}),
        ...(user.phoneNumber?.trim() ? { phone: user.phoneNumber.trim() } : {}),
      },
      ...(dto.studentName ? { studentName: dto.studentName } : {}),
      whoWillJoin: dto.whoWillJoin,
      ...(dto.courseInterestedIn
        ? { courseInterestedIn: dto.courseInterestedIn }
        : {}),
      ...(dto.expectedMark ? { expectedMark: dto.expectedMark } : {}),
      ...(dto.twelfthMarks ? { twelfthMarks: dto.twelfthMarks } : {}),
      ...(dto.state ? { state: dto.state } : {}),
      ...(dto.category ? { category: dto.category } : {}),
      ...(dto.preferredDayTime
        ? { preferredDayTime: dto.preferredDayTime }
        : {}),
      ...(dto.talkAbout ? { talkAbout: dto.talkAbout } : {}),
      contact,
      status: CounselingRequestStatus.BOOKED,
      statusUpdatedAt: now,
    });

    return this.toRequestDto(created);
  }

  async list(
    page = 1,
    limit = 12,
    status?: CounselingRequestStatus,
  ): Promise<{ data: CounselingRequestDto[]; pagination: PaginationMetaDto }> {
    const validPage = clampPage(page);
    const validLimit = clampLimit(limit);
    const skip = (validPage - 1) * validLimit;
    const query =
      status && Object.values(CounselingRequestStatus).includes(status)
        ? { status }
        : {};

    const [documents, total] = await Promise.all([
      this.counselingModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .exec(),
      this.counselingModel.countDocuments(query).exec(),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / validLimit);

    return {
      data: documents.map(doc => this.toRequestDto(doc)),
      pagination: {
        total,
        page: validPage,
        limit: validLimit,
        totalPages,
        hasNextPage: validPage < totalPages,
        hasPrevPage: validPage > 1 && totalPages > 0,
      },
    };
  }

  async updateStatus(
    id: string,
    nextStatus: CounselingRequestStatus,
    adminId: string,
  ): Promise<CounselingRequestDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid counseling request ID format');
    }
    if (!Types.ObjectId.isValid(adminId)) {
      throw new BadRequestException('Invalid admin ID format');
    }

    const doc = await this.counselingModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException('Counseling request not found');
    }

    const expected = COUNSELING_STATUS_TRANSITIONS[doc.status];
    if (!expected || expected !== nextStatus) {
      throw new BadRequestException(
        `Cannot move status from ${doc.status} to ${nextStatus}. Expected next status: ${expected ?? 'none'}.`,
      );
    }

    doc.status = nextStatus;
    doc.statusUpdatedAt = new Date();
    doc.statusUpdatedBy = new Types.ObjectId(adminId);
    await doc.save();

    return this.toRequestDto(doc);
  }

  private assertContact(dto: CreateCounselingRequestDto): void {
    const emailOk =
      dto.contact.emailEnabled === true &&
      typeof dto.contact.email === 'string' &&
      dto.contact.email.trim().length > 0;
    const phoneOk =
      dto.contact.phoneEnabled === true &&
      typeof dto.contact.phone === 'string' &&
      dto.contact.phone.trim().length > 0;
    if (!emailOk && !phoneOk) {
      throw new BadRequestException(
        'Pick email and/or phone and provide a value for each selected channel',
      );
    }
  }

  private toActiveRequest(
    doc: CounselingRequestDocument,
  ): CounselingActiveRequestDto {
    const status = doc.status;
    if (
      status !== CounselingRequestStatus.BOOKED &&
      status !== CounselingRequestStatus.ACKNOWLEDGED &&
      status !== CounselingRequestStatus.RESPONDED
    ) {
      throw new BadRequestException('Active request has an invalid status');
    }

    return {
      id: documentId(doc),
      status,
      createdAt: doc.createdAt ?? new Date(),
    };
  }

  private toRequestDto(doc: CounselingRequestDocument): CounselingRequestDto {
    return {
      id: documentId(doc),
      userId: String(doc.userId),
      accountSnapshot: {
        name: doc.accountSnapshot?.name ?? null,
        email: doc.accountSnapshot?.email ?? null,
        phone: doc.accountSnapshot?.phone ?? null,
      },
      studentName: doc.studentName ?? null,
      whoWillJoin: doc.whoWillJoin,
      courseInterestedIn: doc.courseInterestedIn ?? null,
      expectedMark: doc.expectedMark ?? null,
      twelfthMarks: doc.twelfthMarks ?? null,
      state: doc.state ?? null,
      category: doc.category ?? null,
      preferredDayTime: doc.preferredDayTime ?? null,
      talkAbout: doc.talkAbout ?? null,
      contact: {
        emailEnabled: doc.contact?.emailEnabled === true,
        email: doc.contact?.email ?? null,
        phoneEnabled: doc.contact?.phoneEnabled === true,
        phone: doc.contact?.phone ?? null,
      },
      status: doc.status,
      statusUpdatedAt: doc.statusUpdatedAt,
      createdAt: doc.createdAt ?? new Date(),
      updatedAt: doc.updatedAt ?? new Date(),
    };
  }
}

function documentId(doc: CounselingRequestDocument): string {
  if (typeof doc.id === 'string' && doc.id.length > 0) {
    return doc.id;
  }
  return String(doc._id);
}
