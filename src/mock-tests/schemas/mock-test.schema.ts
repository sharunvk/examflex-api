import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Query } from 'mongoose';
import { AccessMode } from '../../common/enums/access-mode.enum';
import { PaperType } from '../../common/enums/paper-type.enum';

export type MockTestDocument = MockTest & Document;

@Schema({ _id: false })
export class MockTestSubjectConfig {
  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true })
  subject: Types.ObjectId;

  @Prop({ trim: true })
  name: string;

  @Prop({ required: true, min: 1 })
  numberOfQuestions: number;

  @Prop({ required: true, min: 0 })
  marksPerQuestion: number;

  @Prop({ required: true, default: false })
  hasNegativeMarking: boolean;

  @Prop({ min: 0, default: 0 })
  negativeMarksPerQuestion: number;

  @Prop({ min: 0 })
  sessionTime?: number;

  @Prop({ required: true, min: 0 })
  questionStartIndex: number;

  @Prop({ required: true, min: 0 })
  questionEndIndex: number;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'Question' }],
    default: undefined,
  })
  questionIds?: Types.ObjectId[];
}

export const MockTestSubjectConfigSchema = SchemaFactory.createForClass(
  MockTestSubjectConfig,
);

/**
 * Cut-off marks an admin expects for one recommendation course on a
 * FULL_EXAM paper. Absolute marks on the paper's own scale (e.g. 620 of 720).
 */
@Schema({ _id: false })
export class MockTestCourseCutoff {
  @Prop({
    type: Types.ObjectId,
    ref: 'RecommendationOffering',
    required: true,
  })
  offering: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  cutoffMarks: number;
}

export const MockTestCourseCutoffSchema =
  SchemaFactory.createForClass(MockTestCourseCutoff);

@Schema({ _id: false })
export class DifficultyDistribution {
  @Prop({ type: Number, default: 0 })
  easy: number;

  @Prop({ type: Number, default: 0 })
  medium: number;

  @Prop({ type: Number, default: 0 })
  hard: number;
}

export const DifficultyDistributionSchema = SchemaFactory.createForClass(
  DifficultyDistribution,
);

@Schema({
  timestamps: true,
  versionKey: false,
  collection: 'mocktests', // Use existing collection name
})
export class MockTest {
  @Prop({
    type: String,
    enum: Object.values(PaperType),
    default: PaperType.TOPIC_WISE,
    index: true,
  })
  paperType: PaperType;

  /** FREE unless an admin marks the paper ENTITLED. */
  @Prop({
    type: String,
    enum: Object.values(AccessMode),
    default: AccessMode.FREE,
    index: true,
  })
  accessMode: AccessMode;

  @Prop({ required: true, min: 1 })
  totalQuestions: number;

  @Prop({ required: true, min: 1 })
  durationInMinutes: number;

  @Prop({
    type: Types.ObjectId,
    ref: 'Exam',
    required: true,
    index: true,
  })
  exam: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Subject',
    index: true,
  })
  subject?: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Topic',
    index: true,
  })
  topic?: Types.ObjectId;

  @Prop({ trim: true })
  title: string;

  @Prop({ trim: true })
  description: string;

  @Prop({
    type: String,
    enum: ['STATIC', 'DYNAMIC'],
    default: 'STATIC',
  })
  generationMode: string;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'Question' }],
  })
  questionIds: Types.ObjectId[];

  @Prop({ default: 1 })
  marksPerQuestion: number;

  @Prop({ default: 0 })
  negativeMarking: number;

  @Prop({ min: 0 })
  totalMarks?: number;

  @Prop({ default: false })
  isSessionWise: boolean;

  @Prop({ type: [MockTestSubjectConfigSchema], default: undefined })
  subjectConfig?: MockTestSubjectConfig[];

  /**
   * FULL_EXAM only. Optional per-course cut-off marks used by the student
   * Analysis pathways. `default: undefined` keeps every other document
   * untouched.
   */
  @Prop({ type: [MockTestCourseCutoffSchema], default: undefined })
  courseCutoffs?: MockTestCourseCutoff[];

  @Prop()
  passingScore?: number;

  @Prop({ default: true })
  allowRetake: boolean;

  @Prop({ default: false })
  shuffleOptions: boolean;

  @Prop({ default: true })
  showResultsImmediately: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;

  @Prop({ type: DifficultyDistributionSchema, default: () => ({}) })
  difficultyDistribution: DifficultyDistribution;

  // Timestamps are automatically added by mongoose when timestamps: true
  createdAt?: Date;
  updatedAt?: Date;
}

export const MockTestSchema = SchemaFactory.createForClass(MockTest);

// Indexes for better query performance
MockTestSchema.index({ title: 'text' }); // Text index for search
MockTestSchema.index({ isActive: 1, isDeleted: 1 });
MockTestSchema.index({ createdAt: -1 }); // For sorting by newest
MockTestSchema.index({ exam: 1, subject: 1 }); // For filtering by exam and subject
MockTestSchema.index({ exam: 1, subject: 1, topic: 1 }); // For filtering with topic
MockTestSchema.index({ paperType: 1, exam: 1, isActive: 1, isDeleted: 1 });

// Virtual for id field (removes _id and adds id)
MockTestSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// Ensure virtual fields are serialised
MockTestSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

// Also set toObject to include virtuals
MockTestSchema.set('toObject', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

// Pre-find middleware to handle soft delete queries
MockTestSchema.pre(/^find/, function (this: Query<unknown, MockTestDocument>) {
  // Only return non-deleted mock tests by default
  this.where({ isDeleted: { $ne: true } });
});
