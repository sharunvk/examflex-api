import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { CounselingService } from './counseling.service';
import { CounselingRequestStatus } from './enums/counseling-request-status.enum';
import { CounselingWhoWillJoin } from './enums/counseling-who-will-join.enum';
import { CounselingRequest } from './schemas/counseling-request.schema';

const USER_ID = '507f1f77bcf86cd799439011';
const ADMIN_ID = '507f1f77bcf86cd799439012';
const REQUEST_ID = '507f1f77bcf86cd799439013';

function baseUser(): UserResponseDto {
  return {
    id: USER_ID,
    name: 'Riya Sharma',
    email: 'riya@example.com',
    phoneNumber: '+919876543210',
  } as UserResponseDto;
}

function createDto() {
  return {
    studentName: 'Riya Sharma',
    whoWillJoin: CounselingWhoWillJoin.STUDENT,
    courseInterestedIn: 'NEET UG',
    expectedMark: '540 out of 720',
    contact: {
      emailEnabled: true,
      email: 'riya@example.com',
      phoneEnabled: false,
    },
  };
}

function listChain(result: unknown) {
  const query = {
    exec: jest.fn().mockResolvedValue(result),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
  };
  query.sort.mockReturnValue(query);
  query.skip.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function findOneChain(result: unknown) {
  const query = {
    exec: jest.fn().mockResolvedValue(result),
    sort: jest.fn(),
  };
  query.sort.mockReturnValue(query);
  return query;
}

describe('CounselingService', () => {
  let service: CounselingService;
  const counselingModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    exists: jest.fn(),
    countDocuments: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CounselingService,
        {
          provide: getModelToken(CounselingRequest.name),
          useValue: counselingModel,
        },
      ],
    }).compile();

    service = module.get(CounselingService);
    jest.clearAllMocks();
  });

  describe('getMe', () => {
    it('returns canRequest true when there is no active booking', async () => {
      counselingModel.findOne.mockReturnValue(findOneChain(null));

      await expect(service.getMe(USER_ID)).resolves.toEqual({
        canRequest: true,
        activeRequest: null,
      });
    });

    it('returns the active request when one exists', async () => {
      const createdAt = new Date('2026-04-01T00:00:00.000Z');
      counselingModel.findOne.mockReturnValue(
        findOneChain({
          id: REQUEST_ID,
          status: CounselingRequestStatus.ACKNOWLEDGED,
          createdAt,
        }),
      );

      await expect(service.getMe(USER_ID)).resolves.toEqual({
        canRequest: false,
        activeRequest: {
          id: REQUEST_ID,
          status: CounselingRequestStatus.ACKNOWLEDGED,
          createdAt,
        },
      });
    });

    it('rejects an invalid user id', async () => {
      await expect(service.getMe('bad')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('create', () => {
    it('stores a booking with account snapshot', async () => {
      const now = new Date('2026-04-01T00:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      counselingModel.exists.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      counselingModel.create.mockResolvedValue({
        id: REQUEST_ID,
        userId: new Types.ObjectId(USER_ID),
        accountSnapshot: {
          name: 'Riya Sharma',
          email: 'riya@example.com',
          phone: '+919876543210',
        },
        studentName: 'Riya Sharma',
        whoWillJoin: CounselingWhoWillJoin.STUDENT,
        courseInterestedIn: 'NEET UG',
        expectedMark: '540 out of 720',
        contact: {
          emailEnabled: true,
          email: 'riya@example.com',
          phoneEnabled: false,
        },
        status: CounselingRequestStatus.BOOKED,
        statusUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.create(baseUser(), createDto());

      expect(counselingModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: new Types.ObjectId(USER_ID),
          accountSnapshot: {
            name: 'Riya Sharma',
            email: 'riya@example.com',
            phone: '+919876543210',
          },
          status: CounselingRequestStatus.BOOKED,
          statusUpdatedAt: now,
        }),
      );
      expect(result.id).toBe(REQUEST_ID);
      expect(result.status).toBe(CounselingRequestStatus.BOOKED);
      jest.useRealTimers();
    });

    it('rejects when an active booking already exists', async () => {
      counselingModel.exists.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: REQUEST_ID }),
      });

      await expect(
        service.create(baseUser(), createDto()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(counselingModel.create).not.toHaveBeenCalled();
    });

    it('rejects when no contact channel is usable', async () => {
      await expect(
        service.create(baseUser(), {
          ...createDto(),
          contact: { emailEnabled: false, phoneEnabled: false },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(counselingModel.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('paginates and filters by status', async () => {
      const docs = [
        {
          id: REQUEST_ID,
          userId: new Types.ObjectId(USER_ID),
          accountSnapshot: { name: 'Riya' },
          whoWillJoin: CounselingWhoWillJoin.STUDENT,
          contact: {
            emailEnabled: true,
            email: 'a@b.com',
            phoneEnabled: false,
          },
          status: CounselingRequestStatus.BOOKED,
          statusUpdatedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      counselingModel.find.mockReturnValue(listChain(docs));
      counselingModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      });

      const result = await service.list(1, 12, CounselingRequestStatus.BOOKED);

      expect(counselingModel.find).toHaveBeenCalledWith({
        status: CounselingRequestStatus.BOOKED,
      });
      expect(result.data).toHaveLength(1);
      expect(result.pagination).toEqual({
        total: 1,
        page: 1,
        limit: 12,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
    });
  });

  describe('updateStatus', () => {
    it('advances booked to acknowledged', async () => {
      const doc: {
        id: string;
        userId: Types.ObjectId;
        accountSnapshot: Record<string, never>;
        whoWillJoin: CounselingWhoWillJoin;
        contact: {
          emailEnabled: boolean;
          email: string;
          phoneEnabled: boolean;
        };
        status: CounselingRequestStatus;
        statusUpdatedAt: Date;
        statusUpdatedBy?: Types.ObjectId;
        createdAt: Date;
        updatedAt: Date;
        save: jest.Mock;
      } = {
        id: REQUEST_ID,
        userId: new Types.ObjectId(USER_ID),
        accountSnapshot: {},
        whoWillJoin: CounselingWhoWillJoin.STUDENT,
        contact: { emailEnabled: true, email: 'a@b.com', phoneEnabled: false },
        status: CounselingRequestStatus.BOOKED,
        statusUpdatedAt: new Date('2026-04-01T00:00:00.000Z'),
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
        save: jest.fn().mockResolvedValue(undefined),
      };
      counselingModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      });

      const result = await service.updateStatus(
        REQUEST_ID,
        CounselingRequestStatus.ACKNOWLEDGED,
        ADMIN_ID,
      );

      expect(doc.status).toBe(CounselingRequestStatus.ACKNOWLEDGED);
      expect(doc.statusUpdatedBy).toEqual(new Types.ObjectId(ADMIN_ID));
      expect(doc.save).toHaveBeenCalled();
      expect(result.status).toBe(CounselingRequestStatus.ACKNOWLEDGED);
    });

    it('rejects skipping statuses', async () => {
      counselingModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          status: CounselingRequestStatus.BOOKED,
          save: jest.fn(),
        }),
      });

      await expect(
        service.updateStatus(
          REQUEST_ID,
          CounselingRequestStatus.RESPONDED,
          ADMIN_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects unknown ids', async () => {
      counselingModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.updateStatus(
          REQUEST_ID,
          CounselingRequestStatus.ACKNOWLEDGED,
          ADMIN_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
