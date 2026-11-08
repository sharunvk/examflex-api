import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { Order } from '../orders/schemas/order.schema';
import { TaxInvoice } from '../invoices/schemas/tax-invoice.schema';
import { Exam } from '../exams/schemas/exam.schema';
import { MAX_TARGET_EXAMS } from './target-exams.constants';
import { Types } from 'mongoose';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../common/enums/user-role.enum';
import { MembershipTier } from '../common/enums/membership-tier.enum';
import { Gender } from '../common/enums/gender.enum';
import { StudyTimePreference } from '../common/enums/study-time-preference.enum';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

const OID = '507f1f77bcf86cd799439011';

function chain(result: unknown) {
  const q: any = {
    exec: jest.fn().mockResolvedValue(result),
    populate: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    select: jest.fn(),
  };
  q.populate.mockReturnValue(q);
  q.sort.mockReturnValue(q);
  q.skip.mockReturnValue(q);
  q.limit.mockReturnValue(q);
  q.lean.mockReturnValue(q);
  q.select.mockReturnValue(q);
  q.then = (resolve: any, reject: any) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

describe('UsersService', () => {
  let service: UsersService;

  const mockUserDocument = (data: any) => ({
    ...data,
    _id: data._id || OID,
    get: jest.fn((key: string) => data[key]),
    toObject: jest.fn().mockReturnValue({ ...data, id: data.id || OID }),
    save: jest.fn().mockResolvedValue({
      ...data,
      toObject: jest.fn().mockReturnValue({ ...data, id: data.id || OID }),
    }),
  });

  const mockUserModel: any = jest.fn().mockImplementation(() => ({
    save: jest.fn(),
  }));

  mockUserModel.findOne = jest.fn();
  mockUserModel.findById = jest.fn();
  mockUserModel.findByIdAndUpdate = jest.fn();
  mockUserModel.findByIdAndDelete = jest.fn();
  mockUserModel.find = jest.fn();
  mockUserModel.findOneAndUpdate = jest.fn();
  mockUserModel.deleteOne = jest.fn();
  mockUserModel.create = jest.fn();
  mockUserModel.findOneAndUpdate = jest.fn();
  mockUserModel.countDocuments = jest.fn();
  mockUserModel.updateOne = jest.fn();

  const mockExamModel = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: getModelToken(Order.name),
          useValue: {
            countDocuments: jest.fn().mockReturnValue(chain(0)),
          },
        },
        {
          provide: getModelToken(TaxInvoice.name),
          useValue: {
            countDocuments: jest.fn().mockReturnValue(chain(0)),
          },
        },
        {
          provide: getModelToken(Exam.name),
          useValue: mockExamModel,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createUserDto: CreateUserDto = {
      name: 'John Doe',
      email: 'john@example.com',
      phoneNumber: '+1234567890',
      role: UserRole.USER,
    };

    it('should create a user successfully', async () => {
      const savedUser = { ...createUserDto, _id: OID, id: OID };
      const mockDocument = mockUserDocument(savedUser);
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue(mockDocument),
      }));

      const result = await service.create(createUserDto);

      expect(result).toBeDefined();
      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        $or: [
          { email: createUserDto.email },
          { phoneNumber: createUserDto.phoneNumber },
        ],
      });
    });

    it('should throw BadRequestException when creating an admin via this method', async () => {
      await expect(
        service.create({ ...createUserDto, role: UserRole.ADMIN }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when user already exists', async () => {
      mockUserModel.findOne.mockResolvedValue({ email: createUserDto.email });

      await expect(service.create(createUserDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException on duplicate key error', async () => {
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.mockImplementation(() => ({
        save: jest.fn().mockRejectedValue({ code: 11000 }),
      }));

      await expect(service.create(createUserDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findOne', () => {
    it('should find user by ID successfully', async () => {
      const mockDocument = mockUserDocument({
        _id: OID,
        name: 'John Doe',
        email: 'john@example.com',
        role: 'user',
        isActive: true,
      });
      mockUserModel.findById.mockReturnValue(chain(mockDocument));

      const result = await service.findOne(OID);

      expect(result).toBeDefined();
      expect(mockUserModel.findById).toHaveBeenCalledWith(OID);
    });

    it('should map populated targetExam and remaining days', async () => {
      const future = new Date(Date.now() + 3 * 86_400_000);
      const mockDocument = mockUserDocument({
        _id: OID,
        name: 'John',
        email: 'j@example.com',
        targetExam: { id: OID, name: 'SSC CGL' },
        targetExamDate: future,
        interactions: {
          interestedSubjects: [OID],
          likedTopics: [OID],
          dislikedTopics: [],
          interestedExams: [OID],
        },
      });
      mockUserModel.findById.mockReturnValue(chain(mockDocument));

      const result = await service.findOne(OID);
      expect(result.targetExam).toEqual({ id: OID, name: 'SSC CGL' });
      expect(result.targetExamRemainingDays).toBeGreaterThanOrEqual(2);
    });

    it('should omit unpopulated targetExam', async () => {
      const mockDocument = mockUserDocument({
        _id: OID,
        name: 'John',
        email: 'j@example.com',
        targetExam: OID,
      });
      mockUserModel.findById.mockReturnValue(chain(mockDocument));

      const result = await service.findOne(OID);
      expect(result.targetExam).toBeUndefined();
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserModel.findById.mockReturnValue(chain(null));

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByEmail', () => {
    it('should return a user when found', async () => {
      mockUserModel.findOne.mockReturnValue(
        chain(mockUserDocument({ email: 'a@b.com', name: 'A' })),
      );
      const result = await service.findByEmail('a@b.com');
      expect(result).toBeDefined();
    });

    it('should return null when not found', async () => {
      mockUserModel.findOne.mockReturnValue(chain(null));
      await expect(service.findByEmail('x@y.com')).resolves.toBeNull();
    });
  });

  describe('findByPhone', () => {
    it('should find user by phone successfully', async () => {
      mockUserModel.findOne.mockReturnValue(
        chain(mockUserDocument({ phoneNumber: '+1234567890', name: 'John' })),
      );
      const result = await service.findByPhone('+1234567890');
      expect(result).toBeDefined();
    });

    it('should return null when user not found', async () => {
      mockUserModel.findOne.mockReturnValue(chain(null));
      await expect(service.findByPhone('missing')).resolves.toBeNull();
    });
  });

  describe('countPasswordAdmins', () => {
    it('should count admins with password hashes', async () => {
      mockUserModel.countDocuments.mockReturnValue(chain(2));
      await expect(service.countPasswordAdmins()).resolves.toBe(2);
    });
  });

  describe('findByUsernameForAuth', () => {
    it('should query lowercase username with passwordHash selected', async () => {
      mockUserModel.findOne.mockReturnValue(chain({ username: 'admin' }));
      await service.findByUsernameForAuth('  Admin ');
      expect(mockUserModel.findOne).toHaveBeenCalledWith({ username: 'admin' });
    });
  });

  describe('createAdmin', () => {
    it('should create an admin', async () => {
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockResolvedValue(
        mockUserDocument({
          name: 'Admin',
          email: 'admin@admin.examflex.local',
          username: 'admin',
          role: UserRole.ADMIN,
        }),
      );

      const result = await service.createAdmin({
        name: 'Admin',
        username: 'Admin',
        password: 'secret12',
      } as any);

      expect(result).toBeDefined();
      expect(mockUserModel.create).toHaveBeenCalled();
    });

    it('should throw ConflictException when username exists', async () => {
      mockUserModel.findOne.mockResolvedValue({ username: 'admin' });
      await expect(
        service.createAdmin({
          name: 'Admin',
          username: 'admin',
          password: 'secret12',
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException on duplicate key', async () => {
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.create.mockRejectedValue({ code: 11000 });
      await expect(
        service.createAdmin({
          name: 'Admin',
          username: 'admin',
          email: 'a@b.com',
          password: 'secret12',
        } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findByRole', () => {
    it('should return users for a role', async () => {
      mockUserModel.find.mockReturnValue(
        chain([mockUserDocument({ name: 'A', role: UserRole.USER })]),
      );
      const result = await service.findByRole(UserRole.USER);
      expect(result).toHaveLength(1);
    });
  });

  describe('update', () => {
    const updateUserDto: UpdateUserDto = { name: 'Updated Name' };

    it('should update user successfully', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(mockUserDocument({ _id: OID, name: 'Updated Name' })),
      );
      const result = await service.update(OID, updateUserDto);
      expect(result).toBeDefined();
    });

    it('should throw ConflictException when email already exists', async () => {
      mockUserModel.findOne.mockResolvedValue({ email: 'taken@example.com' });
      await expect(
        service.update(OID, { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(service.update('missing', updateUserDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('softDelete', () => {
    it('should soft delete a user and release identity fields', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(
          mockUserDocument({
            isDeleted: true,
            isActive: false,
            email: `deleted.${OID}@deleted.examflex.local`,
          }),
        ),
      );
      await expect(service.softDelete(OID)).resolves.toBeDefined();
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        OID,
        {
          $set: {
            isDeleted: true,
            isActive: false,
            email: `deleted.${OID}@deleted.examflex.local`,
          },
          $unset: {
            phoneNumber: 1,
            googleSub: 1,
          },
        },
        { new: true },
      );
    });

    it('should throw NotFoundException', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(service.softDelete('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('softDeleteMe', () => {
    it('delegates to softDelete for the current user', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(mockUserDocument({ isDeleted: true })),
      );
      await expect(service.softDeleteMe(OID)).resolves.toBeDefined();
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        OID,
        expect.objectContaining({
          $set: expect.objectContaining({ isDeleted: true }),
        }),
        { new: true },
      );
    });
  });

  describe('restore', () => {
    it('should restore a deleted user', async () => {
      mockUserModel.findOneAndUpdate.mockReturnValue(
        chain(mockUserDocument({ isDeleted: false })),
      );
      await expect(service.restore(OID)).resolves.toBeDefined();
    });

    it('should throw NotFoundException', async () => {
      mockUserModel.findOneAndUpdate.mockReturnValue(chain(null));
      await expect(service.restore('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('hardDelete', () => {
    it('should permanently delete a user', async () => {
      mockUserModel.findById.mockReturnValue(chain({ _id: OID }));
      mockUserModel.findByIdAndDelete.mockReturnValue(chain({ _id: OID }));
      await expect(service.hardDelete(OID)).resolves.toBeUndefined();
    });

    it('should throw NotFoundException', async () => {
      mockUserModel.findById.mockReturnValue(chain(null));
      await expect(service.hardDelete('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      mockUserModel.find.mockReturnValue(
        chain([
          mockUserDocument({ name: 'User 1' }),
          mockUserDocument({ name: 'User 2' }),
        ]),
      );
      const result = await service.findAll();
      expect(result).toHaveLength(2);
    });
  });

  describe('findAllWithDeleted', () => {
    it('should return all users including deleted', async () => {
      mockUserModel.find.mockReturnValue(
        chain([mockUserDocument({ name: 'User 1' })]),
      );
      const result = await service.findAllWithDeleted();
      expect(result).toHaveLength(1);
    });
  });

  describe('toggleUserStatus', () => {
    it('should toggle isActive', async () => {
      const user = mockUserDocument({ isActive: true, name: 'John' });
      user.save = jest
        .fn()
        .mockResolvedValue(mockUserDocument({ isActive: false, name: 'John' }));
      mockUserModel.findById.mockResolvedValue(user);
      const result = await service.toggleUserStatus(OID);
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException', async () => {
      mockUserModel.findById.mockResolvedValue(null);
      await expect(service.toggleUserStatus('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getUserStats', () => {
    it('should return aggregated stats', async () => {
      mockUserModel.countDocuments
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);

      const stats = await service.getUserStats();
      expect(stats).toEqual({
        totalUsers: 10,
        activeUsers: 7,
        adminUsers: 2,
        deletedUsers: 1,
        inactiveUsers: 3,
      });
    });
  });

  describe('updateMe', () => {
    it('should update profile fields', async () => {
      mockUserModel.findOne.mockResolvedValue(null);
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(
          mockUserDocument({
            name: 'New',
            email: 'n@e.com',
            bio: 'hi',
            gender: Gender.MALE,
          }),
        ),
      );

      const result = await service.updateMe(OID, {
        name: 'New',
        email: 'n@e.com',
        phoneNumber: '+111',
        bio: 'hi',
        avatarUrl: 'http://a',
        dateOfBirth: '2000-01-01',
        gender: Gender.MALE,
        location: { city: 'Kochi' },
        targetExamDate: '2027-01-01',
      } as any);

      expect(result).toBeDefined();
    });

    it('should throw ConflictException', async () => {
      mockUserModel.findOne.mockResolvedValue({ _id: 'other' });
      await expect(
        service.updateMe(OID, { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(service.updateMe(OID, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('clears targetExams when targetExam null is sent', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(mockUserDocument({ name: 'Ada', targetExams: [] })),
      );

      await service.updateMe(OID, { targetExam: null });

      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $set: { targetExams: [] }, $unset: { targetExam: 1 } },
        { new: true, runValidators: true },
      );
    });

    it('promotes targetExam to primary and keeps remaining targets', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(
          mockUserDocument({
            targetExams: [
              new Types.ObjectId('507f1f77bcf86cd799439012'),
              new Types.ObjectId(OID),
            ],
          }),
        ),
      );
      mockExamModel.find.mockReturnValue(
        chain([
          { _id: new Types.ObjectId(OID) },
          { _id: new Types.ObjectId('507f1f77bcf86cd799439012') },
        ]),
      );
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(mockUserDocument({ targetExams: [] })),
      );

      await service.updateMe(OID, { targetExam: OID });

      const update = mockUserModel.findByIdAndUpdate.mock.calls[0][1];
      expect(update.$set.targetExams.map(String)).toEqual([
        OID,
        '507f1f77bcf86cd799439012',
      ]);
      expect(String(update.$set.targetExam)).toBe(OID);
    });
  });

  describe('updateProfile', () => {
    it('should update extended profile', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(mockUserDocument({ bio: 'updated' })),
      );
      await expect(
        service.updateProfile(OID, {
          bio: 'updated',
          avatarUrl: 'http://a',
          dateOfBirth: '2000-01-01',
          gender: Gender.FEMALE,
          location: { city: 'Delhi' },
          targetExamDate: '2027-01-01',
        } as any),
      ).resolves.toBeDefined();
    });

    it('should throw NotFoundException', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(service.updateProfile(OID, { bio: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updatePreferences', () => {
    it('should update preferences and interactions', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(mockUserDocument({ name: 'John' })),
      );
      await expect(
        service.updatePreferences(OID, {
          studyTime: StudyTimePreference.MORNING,
          weeklyStudyGoalHours: 10,
          notifications: {
            email: true,
            push: false,
            sms: false,
            studyReminders: true,
            weeklyReport: true,
            promotionalOffers: false,
          },
          interactions: {
            interestedSubjects: [OID],
            likedTopics: [OID],
            dislikedTopics: [OID],
            interestedExams: [OID],
          },
        } as any),
      ).resolves.toBeDefined();
    });

    it('should throw NotFoundException', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(
        service.updatePreferences(OID, {
          studyTime: StudyTimePreference.NIGHT,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMembershipTier', () => {
    it('should update membership silently', async () => {
      mockUserModel.updateOne.mockReturnValue(chain({ acknowledged: true }));
      await expect(
        service.updateMembershipTier(OID, MembershipTier.GOLD, 5),
      ).resolves.toBeUndefined();
    });
  });

  describe('Google account linking', () => {
    it('should find an auth record by email and google sub', async () => {
      const doc = mockUserDocument({
        email: 'student@gmail.com',
        googleSub: 'sub-1',
        name: 'Student',
      });
      mockUserModel.findOne.mockReturnValue(chain(doc));

      const byEmail = await service.findAuthByEmail(' Student@Gmail.com ');
      expect(byEmail?.googleSub).toBe('sub-1');
      expect(byEmail?.user).not.toHaveProperty('googleSub');
      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        email: 'student@gmail.com',
      });

      mockUserModel.findOne.mockReturnValue(chain(null));
      await expect(service.findAuthByGoogleSub('missing')).resolves.toBeNull();
    });

    it('should create a Google user without a phone number', async () => {
      const doc = mockUserDocument({
        name: 'Student',
        email: 'student@gmail.com',
        googleSub: 'sub-1',
      });
      mockUserModel.create.mockResolvedValue(doc);

      const result = await service.createGoogleUser({
        name: 'Student',
        email: 'Student@Gmail.com',
        googleSub: 'sub-1',
        avatarUrl: 'https://lh3.googleusercontent.com/a',
      });

      expect(result.email).toBe('student@gmail.com');
      expect(result).not.toHaveProperty('googleSub');
      expect(mockUserModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'student@gmail.com',
          googleSub: 'sub-1',
          role: UserRole.USER,
        }),
      );
    });

    it('should throw ConflictException when the Google identity already exists', async () => {
      mockUserModel.create.mockRejectedValue({ code: 11000 });

      await expect(
        service.createGoogleUser({
          name: 'Student',
          email: 'student@gmail.com',
          googleSub: 'sub-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should rethrow unexpected create errors', async () => {
      mockUserModel.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.createGoogleUser({
          name: 'Student',
          email: 'student@gmail.com',
          googleSub: 'sub-1',
        }),
      ).rejects.toThrow('db down');
    });

    it('should link a Google subject only when it is free or already the same', async () => {
      mockUserModel.findOneAndUpdate.mockReturnValue(
        chain(mockUserDocument({ name: 'Student', googleSub: 'sub-1' })),
      );

      const linked = await service.linkGoogleAccount(
        OID,
        'sub-1',
        'https://example.com/a.png',
      );

      expect(linked).toBeDefined();
      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: [
            { googleSub: { $exists: false } },
            { googleSub: null },
            { googleSub: 'sub-1' },
          ],
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ googleSub: 'sub-1' }),
        }),
        { new: true },
      );

      mockUserModel.findOneAndUpdate.mockReturnValue(chain(null));
      await expect(service.linkGoogleAccount(OID, 'sub-2')).resolves.toBeNull();
    });

    it('should update a Google email only when it is not taken', async () => {
      mockUserModel.findOne.mockReturnValue(chain(null));
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(mockUserDocument({ email: 'next@gmail.com' })),
      );

      const updated = await service.updateEmailIfAvailable(
        OID,
        'Next@Gmail.com',
      );
      expect(updated?.email).toBe('next@gmail.com');

      mockUserModel.findOne.mockReturnValue(
        chain(mockUserDocument({ email: 'taken' })),
      );
      await expect(
        service.updateEmailIfAvailable(OID, 'taken@gmail.com'),
      ).resolves.toBeNull();
    });

    it('should keep the current email when a concurrent write takes it', async () => {
      mockUserModel.findOne.mockReturnValue(chain(null));
      mockUserModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockRejectedValue({ code: 11000 }),
      });

      await expect(
        service.updateEmailIfAvailable(OID, 'race@gmail.com'),
      ).resolves.toBeNull();
    });

    it('should rethrow unexpected email update errors', async () => {
      mockUserModel.findOne.mockReturnValue(chain(null));
      mockUserModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('db down')),
      });

      await expect(
        service.updateEmailIfAvailable(OID, 'next@gmail.com'),
      ).rejects.toThrow('db down');
    });
  });

  describe('target exams', () => {
    const EXAM_A = '507f1f77bcf86cd799439012';
    const EXAM_B = '507f1f77bcf86cd799439013';
    const EXAM_C = '507f1f77bcf86cd799439014';
    const EXAM_D = '507f1f77bcf86cd799439015';
    const EXAM_E = '507f1f77bcf86cd799439016';
    const EXAM_F = '507f1f77bcf86cd799439017';
    const five = [EXAM_A, EXAM_B, EXAM_C, EXAM_D, EXAM_E];

    function learner(data: Record<string, unknown> = {}) {
      return mockUserDocument({ _id: OID, targetExams: [], ...data });
    }

    function activeExams(ids: string[]) {
      const active = new Set(ids);
      mockExamModel.find.mockImplementation(
        (query: { _id?: { $in?: Types.ObjectId[] } }) => {
          const requested = (query?._id?.$in ?? []).map(String);
          const matched = requested
            .filter(id => active.has(id))
            .map(id => ({ _id: new Types.ObjectId(id) }));
          return chain(matched);
        },
      );
    }

    it('falls back to the legacy targetExam when the list has not been migrated', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(
          learner({
            targetExam: { id: EXAM_A, name: 'SSC CGL' },
            targetExams: [],
          }),
        ),
      );

      const result = await service.findOne(OID);

      expect(result.targetExams).toEqual([{ id: EXAM_A, name: 'SSC CGL' }]);
      expect(result.targetExam).toEqual({ id: EXAM_A, name: 'SSC CGL' });
    });

    it('uses the populated list and fills a missing primary from the first exam', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(
          learner({
            targetExam: EXAM_A,
            targetExams: [
              { id: EXAM_A, name: 'SSC CGL' },
              { id: EXAM_B, name: 'IBPS PO' },
            ],
          }),
        ),
      );

      const result = await service.findOne(OID);

      expect(result.targetExams).toEqual([
        { id: EXAM_A, name: 'SSC CGL' },
        { id: EXAM_B, name: 'IBPS PO' },
      ]);
      expect(result.targetExam).toEqual({ id: EXAM_A, name: 'SSC CGL' });
    });

    it('replaces the ordered list and keeps the first exam as the primary', async () => {
      mockUserModel.findById.mockReturnValue(chain(learner()));
      activeExams([EXAM_B, EXAM_A]);
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(
          learner({
            targetExam: { id: EXAM_B, name: 'IBPS PO' },
            targetExams: [
              { id: EXAM_B, name: 'IBPS PO' },
              { id: EXAM_A, name: 'SSC CGL' },
            ],
          }),
        ),
      );

      const result = await service.setTargetExams(OID, [
        EXAM_B,
        EXAM_A,
        EXAM_B,
      ]);

      const update = mockUserModel.findByIdAndUpdate.mock.calls[0][1];
      expect(update.$set.targetExams.map(String)).toEqual([EXAM_B, EXAM_A]);
      expect(String(update.$set.targetExam)).toBe(EXAM_B);
      expect(result.targetExams?.map(exam => exam.id)).toEqual([
        EXAM_B,
        EXAM_A,
      ]);
    });

    it('clears the primary exam when the replacement list is empty', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(learner({ targetExams: [EXAM_A] })),
      );
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(learner({ targetExams: [] })),
      );

      await service.setTargetExams(OID, []);

      expect(mockExamModel.find).not.toHaveBeenCalled();
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.any(Types.ObjectId),
        { $set: { targetExams: [] }, $unset: { targetExam: 1 } },
        { new: true, runValidators: true },
      );
    });

    it('rejects a replacement list that includes an inactive exam', async () => {
      mockUserModel.findById.mockReturnValue(chain(learner()));
      activeExams([]);

      await expect(service.setTargetExams(OID, [EXAM_A])).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('appends an exam and leaves an existing target untouched', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(learner({ targetExams: [EXAM_A] })),
      );
      activeExams([EXAM_A, EXAM_B]);
      mockUserModel.findByIdAndUpdate.mockReturnValue(
        chain(
          learner({
            targetExams: [
              { id: EXAM_A, name: 'SSC CGL' },
              { id: EXAM_B, name: 'IBPS PO' },
            ],
          }),
        ),
      );

      await service.addTargetExam(OID, EXAM_B);

      const update = mockUserModel.findByIdAndUpdate.mock.calls[0][1];
      expect(update.$set.targetExams.map(String)).toEqual([EXAM_A, EXAM_B]);
    });

    it('does not write when the exam is already targeted', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(
          learner({
            targetExams: [EXAM_A],
            targetExam: { id: EXAM_A, name: 'SSC CGL' },
          }),
        ),
      );
      activeExams([EXAM_A]);

      await service.addTargetExam(OID, EXAM_A);

      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects a sixth target exam', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(learner({ targetExams: five })),
      );
      activeExams(five);

      await expect(service.addTargetExam(OID, EXAM_F)).rejects.toThrow(
        ConflictException,
      );
      expect(five).toHaveLength(MAX_TARGET_EXAMS);
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('ignores inactive stored targets when checking the limit', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(learner({ targetExams: five })),
      );
      // Three stored ids plus the exam being added remain active.
      activeExams([EXAM_A, EXAM_B, EXAM_C, EXAM_F]);
      mockUserModel.findByIdAndUpdate.mockReturnValue(chain(learner()));

      await service.addTargetExam(OID, EXAM_F);

      const update = mockUserModel.findByIdAndUpdate.mock.calls[0][1];
      expect(update.$set.targetExams.map(String)).toEqual([
        EXAM_A,
        EXAM_B,
        EXAM_C,
        EXAM_F,
      ]);
    });

    it('carries the legacy single target into the list when adding another exam', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(
          learner({ targetExam: new Types.ObjectId(EXAM_A), targetExams: [] }),
        ),
      );
      activeExams([EXAM_A, EXAM_B]);
      mockUserModel.findByIdAndUpdate.mockReturnValue(chain(learner()));

      await service.addTargetExam(OID, EXAM_B);

      const update = mockUserModel.findByIdAndUpdate.mock.calls[0][1];
      expect(update.$set.targetExams.map(String)).toEqual([EXAM_A, EXAM_B]);
    });

    it('removes an exam and promotes the next one', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(learner({ targetExams: [EXAM_A, EXAM_B] })),
      );
      activeExams([EXAM_A, EXAM_B]);
      mockUserModel.findByIdAndUpdate.mockReturnValue(chain(learner()));

      await service.removeTargetExam(OID, EXAM_A);

      const update = mockUserModel.findByIdAndUpdate.mock.calls[0][1];
      expect(update.$set.targetExams.map(String)).toEqual([EXAM_B]);
      expect(String(update.$set.targetExam)).toBe(EXAM_B);
    });

    it('asks after a mock when the exam is active and has not been dismissed', async () => {
      mockUserModel.findById.mockReturnValue(chain(learner()));
      activeExams([EXAM_A]);

      await expect(
        service.shouldPromptForTargetExam(OID, EXAM_A),
      ).resolves.toEqual({ shouldPrompt: true });
    });

    it('does not ask when the exam is already a target', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(learner({ targetExams: [EXAM_A] })),
      );
      activeExams([EXAM_A]);

      await expect(
        service.shouldPromptForTargetExam(OID, EXAM_A),
      ).resolves.toEqual({ shouldPrompt: false });
    });

    it('does not ask when the target list is full', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(learner({ targetExams: five })),
      );
      activeExams(five);

      await expect(
        service.shouldPromptForTargetExam(OID, EXAM_F),
      ).resolves.toEqual({ shouldPrompt: false });
    });

    it('does not ask during the 14 day cooldown', async () => {
      mockUserModel.findById.mockReturnValue(
        chain(
          learner({
            targetExamPromptDismissals: [
              { exam: EXAM_A, count: 1, lastDismissedAt: new Date() },
            ],
          }),
        ),
      );

      await expect(
        service.shouldPromptForTargetExam(OID, EXAM_A),
      ).resolves.toEqual({ shouldPrompt: false });
      expect(mockExamModel.find).not.toHaveBeenCalled();
    });

    it('asks again after the cooldown when the learner has skipped fewer than 3 times', async () => {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      mockUserModel.findById.mockReturnValue(
        chain(
          learner({
            targetExamPromptDismissals: [
              { exam: EXAM_A, count: 2, lastDismissedAt: fifteenDaysAgo },
            ],
          }),
        ),
      );
      activeExams([EXAM_A]);

      await expect(
        service.shouldPromptForTargetExam(OID, EXAM_A),
      ).resolves.toEqual({ shouldPrompt: true });
    });

    it('stops asking after 3 dismissals even when the cooldown has passed', async () => {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      mockUserModel.findById.mockReturnValue(
        chain(
          learner({
            targetExamPromptDismissals: [
              { exam: EXAM_A, count: 3, lastDismissedAt: fifteenDaysAgo },
            ],
          }),
        ),
      );

      await expect(
        service.shouldPromptForTargetExam(OID, EXAM_A),
      ).resolves.toEqual({ shouldPrompt: false });
      expect(mockExamModel.find).not.toHaveBeenCalled();
    });

    it('does not ask for an inactive exam', async () => {
      mockUserModel.findById.mockReturnValue(chain(learner()));
      activeExams([]);

      await expect(
        service.shouldPromptForTargetExam(OID, EXAM_A),
      ).resolves.toEqual({ shouldPrompt: false });
    });

    it('records the first dismissal and increments later ones', async () => {
      mockUserModel.findById.mockReturnValue(chain(learner()));
      activeExams([EXAM_A]);
      mockUserModel.findByIdAndUpdate.mockReturnValue(chain(learner()));

      await service.dismissTargetExamPrompt(OID, EXAM_A);

      const created =
        mockUserModel.findByIdAndUpdate.mock.calls[0][1].$set
          .targetExamPromptDismissals;
      expect(created).toHaveLength(1);
      expect(String(created[0].exam)).toBe(EXAM_A);
      expect(created[0].count).toBe(1);

      mockUserModel.findById.mockReturnValue(
        chain(
          learner({
            targetExamPromptDismissals: [
              {
                exam: EXAM_A,
                count: 1,
                lastDismissedAt: new Date('2026-01-01'),
              },
            ],
          }),
        ),
      );

      await service.dismissTargetExamPrompt(OID, EXAM_A);

      const incremented =
        mockUserModel.findByIdAndUpdate.mock.calls[1][1].$set
          .targetExamPromptDismissals;
      expect(incremented[0].count).toBe(2);
    });
  });
});
