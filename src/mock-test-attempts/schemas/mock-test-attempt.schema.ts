import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { PaperType } from '../../common/enums/paper-type.enum';

export type MockTestAttemptDocument = MockTestAttempt & Document;

@Schema({ _id: false })
export class AttemptQuestion {
  @Prop({ type: Types.ObjectId, ref: 'Question' })
  question: Types.ObjectId;

  @Prop({ type: String, default: null })
  selectedOption: string | null;

  @Prop({ type: Boolean, default: null })
  isCorrect: boolean | null;

  @Prop({ type: Number, default: 0 })
  marksAwarded: number;

  @Prop({ type: Number })
  marksPerQuestion?: number;

  @Prop({ type: Number })
  negativeMarking?: number;

  /** Session-wise only: matches AttemptSession.order. Omitted for topic-wise papers. */
  @Prop({ type: Number, min: 0 })
  sessionOrder?: number;
}

export const AttemptQuestionSchema =
  SchemaFactory.createForClass(AttemptQuestion);

@Schema({ _id: false })
export class AttemptDifficultyDistribution {
  @Prop({ type: Number, default: 0 })
  easy: number;

  @Prop({ type: Number, default: 0 })
  medium: number;

  @Prop({ type: Number, default: 0 })
  hard: number;
}

export const AttemptDifficultyDistributionSchema = SchemaFactory.createForClass(
  AttemptDifficultyDistribution,
);

@Schema({ _id: false })
export class PauseResumeEvent {
  @Prop({ type: String, enum: ['PAUSE', 'RESUME'], required: true })
  action: string;

  @Prop({ type: Date, required: true })
  timestamp: Date;

  @Prop({ type: Number })
  timeConsumedAtPause?: number; // Time consumed when paused (in seconds)
}

export const PauseResumeEventSchema =
  SchemaFactory.createForClass(PauseResumeEvent);

export const ATTEMPT_SESSION_STATUSES = [
  'LOCKED',
  'IN_PROGRESS',
  'PAUSED',
  'SUBMITTED',
  'EXPIRED',
] as const;

@Schema({ _id: false })
export class AttemptSession {
  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true })
  subject: Types.ObjectId;

  @Prop()
  name?: string;

  @Prop({ required: true, min: 0 })
  order: number;

  @Prop({ required: true, min: 1 })
  durationInMinutes: number;

  @Prop({ required: true, min: 0 })
  startIndex: number;

  @Prop({ required: true, min: 0 })
  endIndex: number;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'Question' }],
    default: undefined,
  })
  questionIds?: Types.ObjectId[];

  @Prop({
    type: String,
    enum: ATTEMPT_SESSION_STATUSES,
    default: 'LOCKED',
  })
  status: string;

  @Prop()
  startedAt?: Date;

  @Prop()
  submittedAt?: Date;

  @Prop({ type: Number, default: 0 })
  timeConsumed: number;
}

export const AttemptSessionSchema =
  SchemaFactory.createForClass(AttemptSession);

@Schema({
  timestamps: true,
  versionKey: false,
})
export class MockTestAttempt {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'MockTest',
    required: true,
    index: true,
  })
  mockTest: Types.ObjectId;

  // Freeze configuration snapshot from the mock test
  @Prop()
  testTitle: string;

  @Prop()
  totalQuestions: number;

  @Prop()
  durationInMinutes: number;

  @Prop({ type: Types.ObjectId, ref: 'Exam' })
  exam: Types.ObjectId;

  /**
   * Frozen from the paper at start so analysis can filter FULL_EXAM /
   * TOPIC_WISE / SPRINT without joining mocktests.
   */
  @Prop({
    type: String,
    enum: Object.values(PaperType),
    index: true,
  })
  paperType?: PaperType;

  @Prop({ type: Types.ObjectId, ref: 'Subject' })
  subject: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Topic' })
  topic?: Types.ObjectId;

  @Prop()
  marksPerQuestion: number;

  @Prop()
  negativeMarking: number;

  @Prop()
  passingScore?: number;

  @Prop()
  shuffleOptions: boolean;

  @Prop()
  showResultsImmediately: boolean;

  @Prop({ type: AttemptDifficultyDistributionSchema })
  difficultyDistribution?: AttemptDifficultyDistribution;

  // Locked question set
  @Prop({ type: [AttemptQuestionSchema], default: [] })
  questions: AttemptQuestion[];

  @Prop({ default: 0 })
  score: number;

  @Prop({
    type: String,
    enum: ['IN_PROGRESS', 'PAUSED', 'SUBMITTED', 'EXPIRED'],
    default: 'IN_PROGRESS',
    index: true,
  })
  status: string;

  @Prop({ default: Date.now })
  startedAt: Date;

  @Prop()
  submittedAt?: Date;

  // Pause/Resume tracking
  // Time spent on the paper in seconds, excluding paused time. Frozen on pause,
  // session completion and submit/expiry; for session-wise papers it holds the
  // sum of every section timer. Analytics reads this field.
  @Prop({ type: Number, default: 0 })
  timeConsumed: number;

  @Prop()
  pausedAt?: Date; // When the attempt was last paused

  @Prop({ type: [PauseResumeEventSchema], default: [] })
  pauseResumeHistory: PauseResumeEvent[]; // Track all pause/resume events

  @Prop({ default: false })
  isSessionWise: boolean;

  @Prop({ type: [AttemptSessionSchema], default: undefined })
  sessions?: AttemptSession[];

  @Prop({ type: Number, default: 0 })
  currentSessionIndex: number;

  // Timestamps are automatically added by mongoose when timestamps: true
  createdAt?: Date;
  updatedAt?: Date;
}

export const MockTestAttemptSchema =
  SchemaFactory.createForClass(MockTestAttempt);

// Compound indexes for better query performance
MockTestAttemptSchema.index({ user: 1, mockTest: 1 });

// Analytics-optimized index: covers all per-user dashboard aggregation $match stages
MockTestAttemptSchema.index({ user: 1, status: 1, submittedAt: -1 });

// Analysis overview: last N full mocks / chapter-wise by exam
MockTestAttemptSchema.index({
  user: 1,
  exam: 1,
  paperType: 1,
  status: 1,
  submittedAt: -1,
});

// Virtual for id field (removes _id and adds id)
MockTestAttemptSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// Ensure virtual fields are serialised
MockTestAttemptSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

// Also set toObject to include virtuals
MockTestAttemptSchema.set('toObject', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
