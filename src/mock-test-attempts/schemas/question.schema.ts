import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Query } from 'mongoose';

export type QuestionDocument = Question & Document;

export const QUESTION_SOURCES = [
  'PDF_UPLOAD',
  'AI_GENERATED',
  'MANUAL_INPUT',
] as const;

export type QuestionSource = (typeof QUESTION_SOURCES)[number];

export const DEFAULT_QUESTION_SOURCE: QuestionSource = 'MANUAL_INPUT';

// ImageMetadata sub-schema for S3 stored images
@Schema({ _id: false })
export class ImageMetadata {
  @Prop({ type: String, required: true })
  key: string; // S3 object key

  @Prop({ type: String, required: true })
  bucket: string; // S3 bucket name

  @Prop({ type: String, required: true })
  region: string; // AWS region

  @Prop({ type: String })
  contentType?: string; // File MIME type

  @Prop({ type: Number })
  size?: number; // File size in bytes

  @Prop({ type: Date })
  lastModified?: Date; // Upload timestamp

  @Prop({ type: String })
  url?: string; // Pre-signed URL (will need periodic refresh)
}

export const ImageMetadataSchema = SchemaFactory.createForClass(ImageMetadata);

// QuestionText sub-schema
@Schema({ _id: false })
export class QuestionTextLanguage {
  @Prop({ type: String })
  text?: string;

  @Prop({ type: ImageMetadataSchema })
  image?: ImageMetadata;
}

export const QuestionTextLanguageSchema =
  SchemaFactory.createForClass(QuestionTextLanguage);

@Schema({ _id: false })
export class QuestionText {
  @Prop({ type: QuestionTextLanguageSchema })
  en: QuestionTextLanguage;

  @Prop({ type: QuestionTextLanguageSchema })
  ml: QuestionTextLanguage;
}

export const QuestionTextSchema = SchemaFactory.createForClass(QuestionText);

// Option sub-schema
@Schema({ _id: false })
export class QuestionOption {
  @Prop({ type: String })
  id: string;

  @Prop({ type: String, enum: ['text', 'image'] })
  type: string;

  @Prop({ type: String })
  en?: string | null;

  @Prop({ type: String })
  ml?: string | null;

  @Prop({ type: ImageMetadataSchema })
  image?: ImageMetadata;
}

export const QuestionOptionSchema =
  SchemaFactory.createForClass(QuestionOption);

// Explanation sub-schema
@Schema({ _id: false })
export class Explanation {
  @Prop({ type: String })
  en?: string;

  @Prop({ type: String })
  ml?: string;

  @Prop({ type: ImageMetadataSchema })
  image?: ImageMetadata;

  /** Extra explanation images beyond the primary `image` (excludes the primary). */
  @Prop({ type: [ImageMetadataSchema], default: undefined })
  images?: ImageMetadata[];
}

export const ExplanationSchema = SchemaFactory.createForClass(Explanation);

// Read-only schema for questions created by external application
@Schema({
  collection: 'questions', // Use existing collection name
  timestamps: true,
  versionKey: false,
})
export class Question {
  @Prop({ type: QuestionTextSchema, required: true })
  questionText: QuestionText;

  @Prop({ type: String, enum: ['text', 'image'] })
  optionType?: string;

  @Prop({ type: [QuestionOptionSchema], required: true })
  options: QuestionOption[];

  @Prop({ type: ExplanationSchema })
  explanation?: Explanation;

  @Prop({ type: String })
  correctAnswer: string;

  @Prop({ type: Types.ObjectId, ref: 'Subject', index: true })
  subject?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Topic', index: true })
  topic?: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Exam' }] })
  exams?: Types.ObjectId[];

  /**
   * Tags selected for this question. Absent when none were selected.
   * `default: undefined` stops Mongoose from storing an empty array on questions
   * that were saved without a tag.
   */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Tag' }], default: undefined })
  tags?: Types.ObjectId[];

  @Prop({ type: String, enum: ['easy', 'medium', 'hard'] })
  difficultyLevel?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({
    type: String,
    enum: QUESTION_SOURCES,
    default: DEFAULT_QUESTION_SOURCE,
  })
  source?: QuestionSource;

  @Prop({
    type: Types.ObjectId,
    ref: 'QuestionUpload',
    index: true,
  })
  uploadId?: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0 })
  fullMockUsageCount?: number;

  @Prop({ type: Date })
  lastUsedInFullMockAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const QuestionSchema = SchemaFactory.createForClass(Question);

// Sprint drafts pick the newest exam-tagged questions with a single limit.
QuestionSchema.index({ exams: 1, createdAt: -1 });
QuestionSchema.index({ exams: 1, updatedAt: -1 });

// Virtual for id field
QuestionSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// Ensure virtual fields are serialised
QuestionSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

QuestionSchema.set('toObject', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

// Pre-find middleware to handle soft delete queries.
// Locked attempt papers pass `{ includeDeleted: true }` so a question soft-deleted
// after the paper was built still loads for in-progress / resume / start payloads.
QuestionSchema.pre(/^find/, function (this: Query<unknown, QuestionDocument>) {
  const options = this.getOptions() as { includeDeleted?: boolean };
  if (options.includeDeleted === true) {
    return;
  }
  this.where({ isDeleted: { $ne: true } });
});
