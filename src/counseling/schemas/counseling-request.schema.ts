import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CounselingRequestStatus } from '../enums/counseling-request-status.enum';
import { CounselingWhoWillJoin } from '../enums/counseling-who-will-join.enum';

export type CounselingRequestDocument = CounselingRequest & Document;

@Schema({ _id: false })
export class CounselingAccountSnapshot {
  @Prop({ trim: true })
  name?: string;

  @Prop({ trim: true, lowercase: true })
  email?: string;

  @Prop({ trim: true })
  phone?: string;
}

export const CounselingAccountSnapshotSchema = SchemaFactory.createForClass(
  CounselingAccountSnapshot,
);

@Schema({ _id: false })
export class CounselingContact {
  @Prop({ required: true, default: false })
  emailEnabled: boolean;

  @Prop({ trim: true, lowercase: true })
  email?: string;

  @Prop({ required: true, default: false })
  phoneEnabled: boolean;

  @Prop({ trim: true })
  phone?: string;
}

export const CounselingContactSchema =
  SchemaFactory.createForClass(CounselingContact);

@Schema({
  timestamps: true,
  versionKey: false,
  collection: 'counselingrequests',
})
export class CounselingRequest {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: CounselingAccountSnapshotSchema, required: true })
  accountSnapshot: CounselingAccountSnapshot;

  @Prop({ trim: true, maxlength: 120 })
  studentName?: string;

  @Prop({
    type: String,
    enum: Object.values(CounselingWhoWillJoin),
    required: true,
  })
  whoWillJoin: CounselingWhoWillJoin;

  @Prop({ trim: true, maxlength: 120 })
  courseInterestedIn?: string;

  @Prop({ trim: true, maxlength: 80 })
  expectedMark?: string;

  @Prop({ trim: true, maxlength: 80 })
  twelfthMarks?: string;

  @Prop({ trim: true, maxlength: 80 })
  state?: string;

  @Prop({ trim: true, maxlength: 80 })
  category?: string;

  @Prop({ trim: true, maxlength: 160 })
  preferredDayTime?: string;

  @Prop({ trim: true, maxlength: 2000 })
  talkAbout?: string;

  @Prop({ type: CounselingContactSchema, required: true })
  contact: CounselingContact;

  @Prop({
    type: String,
    enum: Object.values(CounselingRequestStatus),
    required: true,
    default: CounselingRequestStatus.BOOKED,
    index: true,
  })
  status: CounselingRequestStatus;

  @Prop({ type: Date, required: true })
  statusUpdatedAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  statusUpdatedBy?: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CounselingRequestSchema =
  SchemaFactory.createForClass(CounselingRequest);

CounselingRequestSchema.index({ userId: 1, status: 1 });
CounselingRequestSchema.index({ status: 1, createdAt: -1 });
CounselingRequestSchema.index({ createdAt: -1 });

CounselingRequestSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

CounselingRequestSchema.set('toJSON', {
  virtuals: true,
  transform: function (_doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

CounselingRequestSchema.set('toObject', {
  virtuals: true,
  transform: function (_doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
