import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { indianStateByCode } from '../common/commerce/indian-states';
import { CheckoutBillingDto } from '../orders/dto/create-checkout-order.dto';
import { User, UserBillingProfile, UserDocument } from './schemas/user.schema';
import { Exam, ExamDocument } from '../exams/schemas/exam.schema';
import {
  MAX_TARGET_EXAM_PROMPT_DISMISSALS,
  MAX_TARGET_EXAMS,
  TARGET_EXAM_PROMPT_COOLDOWN_MS,
} from './target-exams.constants';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateAdminDto } from '../auth/dto/create-admin.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { OrderStatus } from '../common/enums/order-status.enum';
import { TaxInvoiceStatus } from '../common/enums/tax-invoice-status.enum';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import {
  TaxInvoice,
  TaxInvoiceDocument,
} from '../invoices/schemas/tax-invoice.schema';
import { MembershipTier } from '../common/enums/membership-tier.enum';

export interface UserWithGoogleLink {
  user: UserResponseDto;
  googleSub?: string;
}

export interface BillingProfileView {
  name: string;
  state: string;
  stateCode: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  pincode: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(TaxInvoice.name)
    private invoiceModel: Model<TaxInvoiceDocument>,
    @InjectModel(Exam.name) private examModel: Model<ExamDocument>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserResponseDto> {
    if (createUserDto.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Admin accounts must be created via POST /auth/admins',
      );
    }

    try {
      // Check if user already exists
      const existingUser = await this.userModel.findOne({
        $or: [
          { email: createUserDto.email },
          { phoneNumber: createUserDto.phoneNumber },
        ],
      });

      if (existingUser) {
        throw new ConflictException(
          'User with this email or phone number already exists',
        );
      }

      const createdUser = new this.userModel(createUserDto);
      const savedUser = await createdUser.save();

      return this.toResponseDto(savedUser);
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          'User with this email or phone number already exists',
        );
      }
      throw error;
    }
  }

  async findAll(): Promise<UserResponseDto[]> {
    const users = await this.userModel.find().exec();
    return users.map(user => this.toResponseDto(user));
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.userModel
      .findById(id)
      .populate('targetExam', 'name')
      .populate('targetExams', 'name')
      .exec();
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
    return this.toResponseDto(user);
  }

  async findByEmail(email: string): Promise<UserResponseDto | null> {
    const user = await this.userModel.findOne({ email }).exec();
    return user ? this.toResponseDto(user) : null;
  }

  async findAuthByEmail(email: string): Promise<UserWithGoogleLink | null> {
    const user = await this.userModel
      .findOne({ email: email.trim().toLowerCase() })
      .exec();
    return user ? this.toGoogleLink(user) : null;
  }

  async findAuthByGoogleSub(
    googleSub: string,
  ): Promise<UserWithGoogleLink | null> {
    const user = await this.userModel.findOne({ googleSub }).exec();
    return user ? this.toGoogleLink(user) : null;
  }

  async createGoogleUser(input: {
    name: string;
    email: string;
    googleSub: string;
    avatarUrl?: string;
  }): Promise<UserResponseDto> {
    try {
      const created = await this.userModel.create({
        name: input.name,
        email: input.email.trim().toLowerCase(),
        googleSub: input.googleSub,
        ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
        role: UserRole.USER,
        isActive: true,
        isDeleted: false,
      });
      return this.toResponseDto(created);
    } catch (error) {
      if (error?.code === 11000) {
        throw new ConflictException(
          'An account with this Google identity already exists',
        );
      }
      throw error;
    }
  }

  /**
   * Attach a Google subject to an account that does not already have a different one.
   * Returns null when another request linked a different Google account first.
   */
  async linkGoogleAccount(
    id: string,
    googleSub: string,
    avatarUrl?: string,
  ): Promise<UserResponseDto | null> {
    const updated = await this.userModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          $or: [
            { googleSub: { $exists: false } },
            { googleSub: null },
            { googleSub },
          ],
        },
        {
          $set: {
            googleSub,
            ...(avatarUrl ? { avatarUrl } : {}),
          },
        },
        { new: true },
      )
      .exec();

    return updated ? this.toResponseDto(updated) : null;
  }

  /**
   * Keep the stored email aligned with a verified Google email when nobody else owns it.
   * Returns null when the address is taken; the caller keeps the existing email.
   */
  async updateEmailIfAvailable(
    id: string,
    email: string,
  ): Promise<UserResponseDto | null> {
    const normalized = email.trim().toLowerCase();
    const taken = await this.userModel
      .findOne({
        email: normalized,
        _id: { $ne: new Types.ObjectId(id) },
      })
      .exec();

    if (taken) {
      return null;
    }

    try {
      const updated = await this.userModel
        .findByIdAndUpdate(id, { $set: { email: normalized } }, { new: true })
        .exec();
      return updated ? this.toResponseDto(updated) : null;
    } catch (error) {
      if (error?.code === 11000) {
        return null;
      }
      throw error;
    }
  }

  async findByPhone(phoneNumber: string): Promise<UserResponseDto | null> {
    const user = await this.userModel.findOne({ phoneNumber }).exec();
    return user ? this.toResponseDto(user) : null;
  }

  async countPasswordAdmins(): Promise<number> {
    return this.userModel
      .countDocuments({
        role: UserRole.ADMIN,
        passwordHash: { $exists: true, $ne: null },
      })
      .exec();
  }

  async findByUsernameForAuth(username: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ username: username.trim().toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  async createAdmin(dto: CreateAdminDto): Promise<UserResponseDto> {
    const username = dto.username.trim().toLowerCase();
    const email = (dto.email || `${username}@admin.examflex.local`)
      .trim()
      .toLowerCase();

    const existing = await this.userModel.findOne({
      $or: [{ username }, { email }],
    });

    if (existing) {
      throw new ConflictException('Username or email is already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    try {
      const created = await this.userModel.create({
        name: dto.name,
        email,
        username,
        passwordHash,
        role: UserRole.ADMIN,
        isActive: true,
        isDeleted: false,
      });
      return this.toResponseDto(created);
    } catch (error) {
      if (error?.code === 11000) {
        throw new ConflictException('Username or email is already in use');
      }
      throw error;
    }
  }

  async findByRole(role: UserRole): Promise<UserResponseDto[]> {
    const users = await this.userModel.find({ role }).exec();
    return users.map(user => this.toResponseDto(user));
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    // Check if email or phone is being updated and already exists
    if (updateUserDto.email || updateUserDto.phoneNumber) {
      const existingUser = await this.userModel.findOne({
        _id: { $ne: id },
        $or: [
          ...(updateUserDto.email ? [{ email: updateUserDto.email }] : []),
          ...(updateUserDto.phoneNumber
            ? [{ phoneNumber: updateUserDto.phoneNumber }]
            : []),
        ],
      });

      if (existingUser) {
        throw new ConflictException(
          'User with this email or phone number already exists',
        );
      }
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(id, updateUserDto, { new: true })
      .exec();

    if (!updatedUser) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return this.toResponseDto(updatedUser);
  }

  /**
   * Soft-delete a user and release unique identity fields so the same phone /
   * email / Google account can create a new student later.
   * Email stays required+unique on the schema, so it is tombstoned rather than unset.
   */
  async softDelete(id: string): Promise<UserResponseDto> {
    const tombstoneEmail = `deleted.${id}@deleted.examflex.local`;
    const deletedUser = await this.userModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            isDeleted: true,
            isActive: false,
            email: tombstoneEmail,
          },
          $unset: {
            phoneNumber: 1,
            googleSub: 1,
          },
        },
        { new: true },
      )
      .exec();

    if (!deletedUser) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return this.toResponseDto(deletedUser);
  }

  /** Authenticated student deletes their own account (Play / in-app deletion). */
  async softDeleteMe(userId: string): Promise<UserResponseDto> {
    return this.softDelete(userId);
  }

  async restore(id: string): Promise<UserResponseDto> {
    // Use findOneAndUpdate to bypass the soft delete middleware
    const restoredUser = await this.userModel
      .findOneAndUpdate(
        { _id: id, isDeleted: true },
        { isDeleted: false, isActive: true },
        { new: true },
      )
      .exec();

    if (!restoredUser) {
      throw new NotFoundException(`Deleted user with ID "${id}" not found`);
    }

    return this.toResponseDto(restoredUser);
  }

  async hardDelete(id: string): Promise<void> {
    const user = await this.userModel.findById(id).select('_id').exec();
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
    const userId = new Types.ObjectId(id);
    const [orders, invoices] = await Promise.all([
      this.orderModel
        .countDocuments({
          userId,
          status: { $in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
        })
        .exec(),
      this.invoiceModel
        .countDocuments({ userId, status: TaxInvoiceStatus.ISSUED })
        .exec(),
    ]);
    if (orders > 0 || invoices > 0) {
      throw new ConflictException(
        'User has paid orders or issued invoices and cannot be hard-deleted',
      );
    }
    await this.userModel.findByIdAndDelete(id).exec();
  }

  // Admin-specific methods
  async findAllWithDeleted(): Promise<UserResponseDto[]> {
    const users = await this.userModel.find({}).exec();
    return users.map(user => this.toResponseDto(user));
  }

  async toggleUserStatus(id: string): Promise<UserResponseDto> {
    const user = await this.userModel.findById(id);
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    user.isActive = !user.isActive;
    const updatedUser = await user.save();

    return this.toResponseDto(updatedUser);
  }

  /**
   * Fire-and-forget friendly. Updates lastActiveAt without loading the full user.
   * Callers throttle so this is not invoked on every request.
   */
  async touchLastActiveAt(
    userId: string,
    at: Date = new Date(),
  ): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(userId) },
        { $set: { lastActiveAt: at } },
      )
      .exec();
  }

  async getUserStats() {
    const [totalUsers, activeUsers, adminUsers, deletedUsers] =
      await Promise.all([
        this.userModel.countDocuments({}),
        this.userModel.countDocuments({ isActive: true }),
        this.userModel.countDocuments({ role: UserRole.ADMIN }),
        this.userModel.countDocuments({ isDeleted: true }),
      ]);

    return {
      totalUsers,
      activeUsers,
      adminUsers,
      deletedUsers,
      inactiveUsers: totalUsers - activeUsers,
    };
  }

  // ── Billing profile (checkout prefill; not the profile location) ─────────

  async getBillingProfile(userId: string): Promise<BillingProfileView | null> {
    const user = await this.requireUser(userId);
    return toBillingProfileView(user.billingProfile);
  }

  async updateBillingProfile(
    userId: string,
    dto: CheckoutBillingDto,
  ): Promise<BillingProfileView> {
    const state = indianStateByCode(dto.stateCode);
    if (!state) {
      throw new BadRequestException('Unknown billing stateCode');
    }

    const addressLine2 = dto.addressLine2?.trim();
    const billingProfile: UserBillingProfile = {
      name: dto.name.trim(),
      state: state.name,
      stateCode: state.code,
      addressLine1: dto.addressLine1.trim(),
      city: dto.city.trim(),
      pincode: dto.pincode,
      ...(addressLine2 ? { addressLine2 } : {}),
    };

    const user = await this.userModel
      .findByIdAndUpdate(userId, { $set: { billingProfile } }, { new: true })
      .exec();

    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    const view = toBillingProfileView(user.billingProfile);
    if (!view) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }
    return view;
  }

  // ── Extended profile ──────────────────────────────────────────────────────

  /**
   * Single-call update for the authenticated user's own profile.
   * Handles both core identity fields (name, email, phone) and extended
   * profile fields (bio, avatar, location, target exam, etc.) in one DB write.
   */
  async updateMe(id: string, dto: UpdateMeDto): Promise<UserResponseDto> {
    // Uniqueness check for email / phone (exclude the caller's own document)
    if (dto.email || dto.phoneNumber) {
      const conflict = await this.userModel.findOne({
        _id: { $ne: id },
        $or: [
          ...(dto.email ? [{ email: dto.email }] : []),
          ...(dto.phoneNumber ? [{ phoneNumber: dto.phoneNumber }] : []),
        ],
      });
      if (conflict) {
        throw new ConflictException(
          'Another account already uses this email or phone number',
        );
      }
    }

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, 1> = {};

    // Core identity
    if (dto.name !== undefined) $set.name = dto.name;
    if (dto.email !== undefined) $set.email = dto.email;
    if (dto.phoneNumber !== undefined) $set.phoneNumber = dto.phoneNumber;

    // Extended profile
    if (dto.bio !== undefined) $set.bio = dto.bio;
    if (dto.avatarUrl !== undefined) $set.avatarUrl = dto.avatarUrl;
    if (dto.dateOfBirth !== undefined)
      $set.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.gender !== undefined) $set.gender = dto.gender;
    if (dto.location !== undefined) $set.location = dto.location;
    // targetExam is handled after the profile write so it stays in sync with
    // targetExams via writeTargetExams / setPrimaryTargetExam.
    if (dto.targetExamDate !== undefined)
      $set.targetExamDate = new Date(dto.targetExamDate);

    const update: Record<string, unknown> = {};
    if (Object.keys($set).length > 0) {
      update.$set = $set;
    }
    if (Object.keys($unset).length > 0) {
      update.$unset = $unset;
    }

    if (Object.keys(update).length > 0) {
      const user = await this.userModel
        .findByIdAndUpdate(new Types.ObjectId(id), update, { new: true })
        .populate('targetExam', 'name')
        .populate('targetExams', 'name')
        .exec();

      if (!user) {
        throw new NotFoundException(`User with ID "${id}" not found`);
      }

      if (dto.targetExam === undefined) {
        return this.toResponseDto(user);
      }
    } else if (dto.targetExam === undefined) {
      return this.findOne(id);
    }

    if (dto.targetExam === null) {
      return this.writeTargetExams(id, []);
    }
    return this.setPrimaryTargetExam(id, dto.targetExam);
  }

  async updateProfile(
    id: string,
    dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    const update: FilterQuery<UserDocument> = {};

    if (dto.bio !== undefined) update.bio = dto.bio;
    if (dto.avatarUrl !== undefined) update.avatarUrl = dto.avatarUrl;
    if (dto.dateOfBirth !== undefined)
      update.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.gender !== undefined) update.gender = dto.gender;
    if (dto.location !== undefined) update.location = dto.location;
    if (dto.targetExamDate !== undefined) {
      update.targetExamDate = new Date(dto.targetExamDate);
    }

    if (Object.keys(update).length > 0) {
      const user = await this.userModel
        .findByIdAndUpdate(
          new Types.ObjectId(id),
          { $set: update },
          { new: true },
        )
        .populate('targetExam', 'name')
        .populate('targetExams', 'name')
        .exec();

      if (!user) {
        throw new NotFoundException(`User with ID "${id}" not found`);
      }

      if (dto.targetExam === undefined) {
        return this.toResponseDto(user);
      }
    } else if (dto.targetExam === undefined) {
      return this.findOne(id);
    }

    return this.setPrimaryTargetExam(id, dto.targetExam);
  }

  // ── Preferences & interactions ────────────────────────────────────────────

  async updatePreferences(
    id: string,
    dto: UpdatePreferencesDto,
  ): Promise<UserResponseDto> {
    // Build a flat $set map so we only touch the provided nested keys
    const $set: Record<string, unknown> = {};

    if (dto.studyTime !== undefined)
      $set['preferences.studyTime'] = dto.studyTime;
    if (dto.weeklyStudyGoalHours !== undefined) {
      $set['preferences.weeklyStudyGoalHours'] = dto.weeklyStudyGoalHours;
    }

    if (dto.notifications) {
      const n = dto.notifications;
      if (n.email !== undefined)
        $set['preferences.notifications.email'] = n.email;
      if (n.push !== undefined) $set['preferences.notifications.push'] = n.push;
      if (n.sms !== undefined) $set['preferences.notifications.sms'] = n.sms;
      if (n.studyReminders !== undefined) {
        $set['preferences.notifications.studyReminders'] = n.studyReminders;
      }
      if (n.weeklyReport !== undefined) {
        $set['preferences.notifications.weeklyReport'] = n.weeklyReport;
      }
      if (n.promotionalOffers !== undefined) {
        $set['preferences.notifications.promotionalOffers'] =
          n.promotionalOffers;
      }
    }

    if (dto.interactions) {
      const i = dto.interactions;
      if (i.interestedSubjects !== undefined) {
        $set['interactions.interestedSubjects'] = i.interestedSubjects.map(
          s => new Types.ObjectId(s),
        );
      }
      if (i.likedTopics !== undefined) {
        $set['interactions.likedTopics'] = i.likedTopics.map(
          t => new Types.ObjectId(t),
        );
      }
      if (i.dislikedTopics !== undefined) {
        $set['interactions.dislikedTopics'] = i.dislikedTopics.map(
          t => new Types.ObjectId(t),
        );
      }
      if (i.interestedExams !== undefined) {
        $set['interactions.interestedExams'] = i.interestedExams.map(
          e => new Types.ObjectId(e),
        );
      }
    }

    const user = await this.userModel
      .findByIdAndUpdate(new Types.ObjectId(id), { $set }, { new: true })
      .populate('targetExam', 'name')
      .populate('targetExams', 'name')
      .exec();

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return this.toResponseDto(user);
  }

  // ── Membership tier (fire-and-forget from analytics) ─────────────────────

  /**
   * Silently updates the membership tier and badge count.
   * Designed to be called fire-and-forget; never throws externally.
   */
  async updateMembershipTier(
    id: string,
    tier: MembershipTier,
    earnedCount: number,
  ): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(id) },
        {
          $set: {
            membershipTier: tier,
            badgesEarnedCount: earnedCount,
            lastTierUpdatedAt: new Date(),
          },
        },
      )
      .exec();
  }

  // ── Target exams ──────────────────────────────────────────────────────────

  async setTargetExams(
    userId: string,
    examIds: string[],
  ): Promise<UserResponseDto> {
    const ids = normalizeExamIds(examIds);
    if (ids.length > MAX_TARGET_EXAMS) {
      throw new BadRequestException(
        `You can target at most ${MAX_TARGET_EXAMS} exams`,
      );
    }
    await this.requireUser(userId);
    await this.assertActiveExams(ids);
    return this.writeTargetExams(userId, ids);
  }

  async addTargetExam(
    userId: string,
    examId: string,
  ): Promise<UserResponseDto> {
    const [id] = normalizeExamIds([examId]);
    const user = await this.requireUser(userId);
    // Drop inactive/deleted ids so they do not consume slots or block adds.
    const current = await this.activeTargetExamIds(user);
    if (current.includes(id)) {
      if (current.length !== currentTargetExamIds(user).length) {
        return this.writeTargetExams(userId, current);
      }
      return this.findOne(userId);
    }
    if (current.length >= MAX_TARGET_EXAMS) {
      throw new ConflictException(
        `You can target at most ${MAX_TARGET_EXAMS} exams`,
      );
    }
    await this.assertActiveExams([id]);
    return this.writeTargetExams(userId, [...current, id]);
  }

  async removeTargetExam(
    userId: string,
    examId: string,
  ): Promise<UserResponseDto> {
    const [id] = normalizeExamIds([examId]);
    const user = await this.requireUser(userId);
    const current = await this.activeTargetExamIds(user);
    const next = current.filter(existing => existing !== id);
    return this.writeTargetExams(userId, next);
  }

  async shouldPromptForTargetExam(
    userId: string,
    examId: string,
  ): Promise<{ shouldPrompt: boolean }> {
    let id: string;
    try {
      [id] = normalizeExamIds([examId]);
    } catch {
      return { shouldPrompt: false };
    }
    const user = await this.requireUser(userId);
    const current = await this.activeTargetExamIds(user);
    if (current.includes(id) || current.length >= MAX_TARGET_EXAMS) {
      return { shouldPrompt: false };
    }
    const dismissal = (user.targetExamPromptDismissals ?? []).find(
      entry => String(entry.exam) === id,
    );
    if (dismissal) {
      if (dismissal.count >= MAX_TARGET_EXAM_PROMPT_DISMISSALS) {
        return { shouldPrompt: false };
      }
      const dismissedAt = new Date(dismissal.lastDismissedAt).getTime();
      if (
        Number.isFinite(dismissedAt) &&
        Date.now() - dismissedAt < TARGET_EXAM_PROMPT_COOLDOWN_MS
      ) {
        return { shouldPrompt: false };
      }
    }
    const active = await this.findActiveExamIds([id]);
    return { shouldPrompt: active.length === 1 };
  }

  async dismissTargetExamPrompt(userId: string, examId: string): Promise<void> {
    const [id] = normalizeExamIds([examId]);
    const user = await this.requireUser(userId);
    await this.assertActiveExams([id]);
    const dismissals = [...(user.targetExamPromptDismissals ?? [])];
    const index = dismissals.findIndex(entry => String(entry.exam) === id);
    const now = new Date();
    if (index === -1) {
      dismissals.push({
        exam: new Types.ObjectId(id),
        count: 1,
        lastDismissedAt: now,
      });
    } else {
      dismissals[index] = {
        exam: new Types.ObjectId(id),
        count: (dismissals[index].count ?? 0) + 1,
        lastDismissedAt: now,
      };
    }

    const updated = await this.userModel
      .findByIdAndUpdate(
        new Types.ObjectId(userId),
        { $set: { targetExamPromptDismissals: dismissals } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async setPrimaryTargetExam(
    userId: string,
    examId: string,
  ): Promise<UserResponseDto> {
    const [id] = normalizeExamIds([examId]);
    await this.assertActiveExams([id]);
    const user = await this.requireUser(userId);
    const current = await this.activeTargetExamIds(user);
    const without = current.filter(existing => existing !== id);
    const next = [id, ...without].slice(0, MAX_TARGET_EXAMS);
    return this.writeTargetExams(userId, next);
  }

  private async assertActiveExams(examIds: string[]): Promise<void> {
    if (examIds.length === 0) {
      return;
    }
    const active = await this.findActiveExamIds(examIds);
    if (active.length !== examIds.length) {
      throw new BadRequestException('One or more exams are not available');
    }
  }

  private async findActiveExamIds(examIds: string[]): Promise<string[]> {
    if (examIds.length === 0) {
      return [];
    }
    const docs = await this.examModel
      .find({
        _id: { $in: examIds.map(id => new Types.ObjectId(id)) },
        isActive: true,
      })
      .select('_id')
      .exec();
    const active = new Set(docs.map(doc => String(doc._id)));
    // Preserve caller order; find() does not.
    return examIds.filter(id => active.has(id));
  }

  /** Active exams only, in stored order. Inactive/deleted ids are omitted. */
  private async activeTargetExamIds(user: UserDocument): Promise<string[]> {
    const raw = currentTargetExamIds(user);
    if (raw.length === 0) {
      return [];
    }
    return this.findActiveExamIds(raw);
  }

  private async writeTargetExams(
    userId: string,
    examIds: string[],
  ): Promise<UserResponseDto> {
    const objectIds = examIds.map(id => new Types.ObjectId(id));
    const update =
      objectIds.length === 0
        ? { $set: { targetExams: [] }, $unset: { targetExam: 1 as const } }
        : {
            $set: {
              targetExams: objectIds,
              targetExam: objectIds[0],
            },
          };

    const user = await this.userModel
      .findByIdAndUpdate(new Types.ObjectId(userId), update, {
        new: true,
        runValidators: true,
      })
      .populate('targetExam', 'name')
      .populate('targetExams', 'name')
      .exec();

    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }
    return this.toResponseDto(user);
  }

  private toResponseDto(user: UserDocument): UserResponseDto {
    const obj = user.toObject() as Record<string, unknown>;

    // Map targetExam: if populated (has name), extract id + name; otherwise omit
    const mappedPrimary = mapPopulatedExam(obj.targetExam);
    if (mappedPrimary) {
      obj.targetExam = mappedPrimary;
    } else {
      delete obj.targetExam;
    }

    const mappedTargets = Array.isArray(obj.targetExams)
      ? obj.targetExams
          .map(item => mapPopulatedExam(item))
          .filter((item): item is { id: string; name: string } => item != null)
      : [];
    if (mappedTargets.length > 0) {
      obj.targetExams = mappedTargets;
      if (!obj.targetExam) {
        obj.targetExam = mappedTargets[0];
      }
    } else if (obj.targetExam) {
      // Rows written before targetExams existed still have the single field.
      obj.targetExams = [obj.targetExam];
    } else {
      obj.targetExams = [];
    }

    // Stringify ObjectId arrays in interactions
    const interactions = obj.interactions as
      | Record<string, unknown[]>
      | undefined;
    if (interactions) {
      for (const key of [
        'interestedSubjects',
        'likedTopics',
        'dislikedTopics',
        'interestedExams',
      ] as const) {
        if (Array.isArray(interactions[key])) {
          interactions[key] = interactions[key].map(String);
        }
      }
    }

    // Compute remaining days to target exam date (not persisted)
    if (obj.targetExamDate instanceof Date) {
      const now = new Date();
      const diff = (obj.targetExamDate as Date).getTime() - now.getTime();
      obj.targetExamRemainingDays = Math.max(0, Math.ceil(diff / 86_400_000));
    }

    // Never leak password hashes, the Google subject, checkout billing,
    // or the prompt-dismissal counters.
    delete obj.passwordHash;
    delete obj.googleSub;
    delete obj.billingProfile;
    delete obj.targetExamPromptDismissals;

    return new UserResponseDto(obj);
  }

  private async requireUser(userId: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }
    return user;
  }

  private toGoogleLink(user: UserDocument): UserWithGoogleLink {
    const raw = user.get('googleSub');
    const googleSub = typeof raw === 'string' && raw ? raw : undefined;
    return {
      user: this.toResponseDto(user),
      googleSub,
    };
  }
}

function currentTargetExamIds(user: UserDocument): string[] {
  const listed = (user.targetExams ?? [])
    .map(id => String(id))
    .filter(id => Types.ObjectId.isValid(id));
  if (listed.length > 0) {
    return listed;
  }
  const legacy = user.targetExam ? String(user.targetExam) : '';
  if (Types.ObjectId.isValid(legacy)) {
    return [legacy];
  }
  return [];
}

function normalizeExamIds(examIds: string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of examIds) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid exam id');
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function mapPopulatedExam(
  value: unknown,
): { id: string; name: string } | undefined {
  if (value == null || typeof value !== 'object') {
    return undefined;
  }
  const exam = value as Record<string, unknown>;
  if (typeof exam.name !== 'string' || exam.name.length === 0) {
    return undefined;
  }
  const rawId = exam.id ?? exam._id;
  if (rawId == null || rawId === '') {
    return undefined;
  }
  return { id: String(rawId), name: exam.name };
}

function toBillingProfileView(
  profile: UserBillingProfile | null | undefined,
): BillingProfileView | null {
  if (!profile?.name || !profile.stateCode) {
    return null;
  }
  const addressLine2 = profile.addressLine2?.trim();
  return {
    name: profile.name,
    state: profile.state,
    stateCode: profile.stateCode,
    addressLine1: profile.addressLine1,
    ...(addressLine2 ? { addressLine2 } : {}),
    city: profile.city,
    pincode: profile.pincode,
  };
}
