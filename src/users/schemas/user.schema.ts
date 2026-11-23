import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Query, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { Gender } from '../../common/enums/gender.enum';
import { MembershipTier } from '../../common/enums/membership-tier.enum';
import { StudyTimePreference } from '../../common/enums/study-time-preference.enum';
import { MAX_TARGET_EXAMS } from '../target-exams.constants';

export type UserDocument = User & Document;

// ─── Embedded sub-schemas (declared as plain classes; _id suppressed) ─────────

@Schema({ _id: false })
export class UserLocation {
  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  state?: string;

  @Prop({ trim: true })
  country?: string;

  /** IANA timezone string, e.g. "Asia/Kolkata" */
  @Prop({ trim: true })
  timezone?: string;
}
export const UserLocationSchema = SchemaFactory.createForClass(UserLocation);

@Schema({ _id: false })
export class NotificationPreferences {
  @Prop({ default: true })
  email: boolean;

  @Prop({ default: true })
  push: boolean;

  @Prop({ default: false })
  sms: boolean;

  @Prop({ default: true })
  studyReminders: boolean;

  @Prop({ default: true })
  weeklyReport: boolean;

  @Prop({ default: false })
  promotionalOffers: boolean;
}
export const NotificationPreferencesSchema = SchemaFactory.createForClass(
  NotificationPreferences,
);

@Schema({ _id: false })
export class UserPreferences {
  @Prop({ type: String, enum: StudyTimePreference })
  studyTime?: StudyTimePreference;

  /** Target study hours per week (1–100) */
  @Prop({ min: 1, max: 100 })
  weeklyStudyGoalHours?: number;

  @Prop({ type: NotificationPreferencesSchema, default: () => ({}) })
  notifications: NotificationPreferences;
}
export const UserPreferencesSchema =
  SchemaFactory.createForClass(UserPreferences);

@Schema({ _id: false })
export class UserInteractions {
  /** Subjects the user has expressed interest in (max 20). Used for personalisation & targeted ads. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Subject' }], default: [] })
  interestedSubjects: Types.ObjectId[];

  /** Topics the user has liked (max 50). */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Topic' }], default: [] })
  likedTopics: Types.ObjectId[];

  /** Topics the user has disliked (max 50). */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Topic' }], default: [] })
  dislikedTopics: Types.ObjectId[];

  /** Exams the user is interested in (max 10). Sparse-indexed for targeted exam campaigns. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Exam' }], default: [] })
  interestedExams: Types.ObjectId[];
}
export const UserInteractionsSchema =
  SchemaFactory.createForClass(UserInteractions);

/** GST checkout identity. Separate from `location`, which is not a billing address. */
@Schema({ _id: false })
export class UserBillingProfile {
  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ required: true, trim: true })
  state: string;

  @Prop({ required: true, trim: true })
  stateCode: string;

  @Prop({ required: true, trim: true, maxlength: 200 })
  addressLine1: string;

  @Prop({ trim: true, maxlength: 200 })
  addressLine2?: string;

  @Prop({ required: true, trim: true, maxlength: 80 })
  city: string;

  @Prop({ required: true, trim: true })
  pincode: string;
}
export const UserBillingProfileSchema =
  SchemaFactory.createForClass(UserBillingProfile);

/** How many times the learner closed the "add this exam?" prompt. */
@Schema({ _id: false })
export class TargetExamPromptDismissal {
  @Prop({ type: Types.ObjectId, ref: 'Exam', required: true })
  exam: Types.ObjectId;

  @Prop({ required: true, min: 0, default: 1 })
  count: number;

  @Prop({ required: true })
  lastDismissedAt: Date;
}
export const TargetExamPromptDismissalSchema = SchemaFactory.createForClass(
  TargetExamPromptDismissal,
);

// ─── Main User schema ──────────────────────────────────────────────────────────

@Schema({
  timestamps: true,
  versionKey: false,
})
export class User {
  // ── Core identity ────────────────────────────────────────────────────────────
  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  })
  email: string;

  @Prop({
    required: false,
    match: /^[\+]?[1-9][\d]{0,15}$/,
  })
  phoneNumber?: string;

  /**
   * When ownership of `phoneNumber` was proven with an OTP (MSG91). Set at OTP
   * sign-in and by the verify-phone step of onboarding. A number without this
   * stamp (for example one typed into an old profile form) is not trusted.
   */
  @Prop()
  phoneVerifiedAt?: Date;

  /**
   * When ownership of `email` was proven with an email OTP (MSG91) from the
   * profile page. Google-linked accounts count as verified without it, because
   * Google only shares verified addresses.
   */
  @Prop()
  emailVerifiedAt?: Date;

  /** When the learner finished the mandatory name + mobile + target exam step. */
  @Prop()
  onboardingCompletedAt?: Date;

  @Prop({
    type: String,
    lowercase: true,
    trim: true,
  })
  username?: string;

  @Prop({ select: false })
  passwordHash?: string;

  /**
   * Stable Google account id (`sub` from a verified ID token).
   * Email can change; this value does not. Omitted for OTP-only accounts.
   */
  @Prop({ trim: true, maxlength: 255 })
  googleSub?: string;

  @Prop({
    type: String,
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isDeleted: boolean;

  /** Last time this user made an authenticated API request (throttled). */
  @Prop()
  lastActiveAt?: Date;

  // ── Group 1: Extended profile ─────────────────────────────────────────────
  @Prop({ trim: true, maxlength: 500 })
  bio?: string;

  @Prop({ trim: true })
  avatarUrl?: string;

  @Prop()
  dateOfBirth?: Date;

  @Prop({ type: String, enum: Gender })
  gender?: Gender;

  @Prop({ type: UserLocationSchema })
  location?: UserLocation;

  // ── Group 2: Target exams ─────────────────────────────────────────────────
  /**
   * Exams the learner is preparing for, from any category.
   * Order matters: the first entry is the primary exam and is mirrored in `targetExam`.
   */
  @Prop({
    type: [{ type: Types.ObjectId, ref: 'Exam' }],
    default: [],
  })
  targetExams: Types.ObjectId[];

  /** Primary target. Kept equal to `targetExams[0]` so older clients keep working. */
  @Prop({ type: Types.ObjectId, ref: 'Exam' })
  targetExam?: Types.ObjectId;

  @Prop()
  targetExamDate?: Date;

  @Prop({ type: [TargetExamPromptDismissalSchema], default: [] })
  targetExamPromptDismissals: TargetExamPromptDismissal[];

  // ── Achievement / gamification ────────────────────────────────────────────
  @Prop({
    type: String,
    enum: MembershipTier,
    default: MembershipTier.NONE,
  })
  membershipTier: MembershipTier;

  @Prop({ default: 0 })
  badgesEarnedCount: number;

  @Prop()
  lastTierUpdatedAt?: Date;

  // ── Group 5: Preferences ──────────────────────────────────────────────────
  @Prop({ type: UserPreferencesSchema, default: () => ({}) })
  preferences: UserPreferences;

  // ── Group 6: Interactions (personalisation & ads) ─────────────────────────
  @Prop({ type: UserInteractionsSchema, default: () => ({}) })
  interactions: UserInteractions;

  /** Last checkout billing identity. Omitted until the user saves one. */
  @Prop({ type: UserBillingProfileSchema })
  billingProfile?: UserBillingProfile;

  // Timestamps added automatically by mongoose (timestamps: true)
  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// ─── Indexes ───────────────────────────────────────────────────────────────────
// Unique across accounts. Partial so users without a number (and soft-deleted
// users, whose number is unset) never collide. Built by Mongoose on boot; that
// fails silently if duplicate numbers ever exist, so check `db.users.getIndexes()`.
UserSchema.index(
  { phoneNumber: 1 },
  {
    name: 'phoneNumber_unique',
    unique: true,
    partialFilterExpression: { phoneNumber: { $type: 'string' } },
  },
);
UserSchema.index({ username: 1 }, { unique: true, sparse: true });
UserSchema.index({ googleSub: 1 }, { unique: true, sparse: true });
UserSchema.index({ isActive: 1, isDeleted: 1 });
UserSchema.index({ lastActiveAt: 1 }, { sparse: true });
UserSchema.index({ membershipTier: 1 });
UserSchema.index({ targetExam: 1 }, { sparse: true });
UserSchema.index({ targetExams: 1 }, { sparse: true });
UserSchema.index({ 'interactions.interestedExams': 1 }, { sparse: true });

UserSchema.path('targetExams').validate(function (value: unknown) {
  if (!Array.isArray(value)) {
    return true;
  }
  return value.length <= MAX_TARGET_EXAMS;
}, `A learner can target at most ${MAX_TARGET_EXAMS} exams`);

// Virtual for id field (removes _id and adds id)
UserSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// Ensure virtual fields are serialised
UserSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
});

// Also set toObject to include virtuals
UserSchema.set('toObject', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
});

// Pre-find middleware to handle soft delete queries
UserSchema.pre(/^find/, function (this: Query<unknown, UserDocument>) {
  // Only return non-deleted users by default
  this.where({ isDeleted: { $ne: true } });
});
