import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { PaperType } from '../../common/enums/paper-type.enum';
import {
  MISTAKE_KINDS,
  MISTAKE_TRIP_REASONS,
  MistakeKind,
  MistakeTripReason,
} from '../mistake-book.constants';

export type MistakeBookEntryDocument = MistakeBookEntry & Document;

@Schema({
  timestamps: true,
  versionKey: false,
  collection: 'mistakebookentries',
})
export class MistakeBookEntry {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MockTest', required: true })
  mockTest: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MockTestAttempt', required: true })
  attempt: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Question', required: true })
  question: Types.ObjectId;

  @Prop({ type: String, enum: MISTAKE_KINDS, required: true })
  kind: MistakeKind;

  @Prop({ type: String, default: null })
  selectedOptionId: string | null;

  @Prop({
    type: String,
    enum: MISTAKE_TRIP_REASONS,
    default: 'concept-gap',
  })
  tripReason: MistakeTripReason;

  @Prop({ required: true, trim: true })
  mockTitle: string;

  @Prop({ type: String, enum: Object.values(PaperType), required: true })
  paperType: PaperType;

  @Prop({ type: Types.ObjectId, ref: 'Exam' })
  exam?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Subject' })
  subject?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Topic' })
  topic?: Types.ObjectId;

  /** 1-based order of the question in the attempt paper. */
  @Prop({ type: Number, required: true, min: 1 })
  questionOrder: number;

  @Prop({ type: Date, required: true })
  attemptSubmittedAt: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const MistakeBookEntrySchema =
  SchemaFactory.createForClass(MistakeBookEntry);

MistakeBookEntrySchema.index(
  { user: 1, mockTest: 1, question: 1 },
  { unique: true },
);
MistakeBookEntrySchema.index({ user: 1, attemptSubmittedAt: -1 });
MistakeBookEntrySchema.index({ user: 1, mockTest: 1, subject: 1, topic: 1 });
MistakeBookEntrySchema.index({ user: 1, mockTest: 1 });

MistakeBookEntrySchema.virtual('id').get(function () {
  return this._id.toHexString();
});

MistakeBookEntrySchema.set('toJSON', {
  virtuals: true,
  transform: function (_doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

MistakeBookEntrySchema.set('toObject', {
  virtuals: true,
  transform: function (_doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
