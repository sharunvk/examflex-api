import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Query } from 'mongoose';

export type EquationDocument = Equation & Document;

@Schema({
  timestamps: true,
  versionKey: false,
  collection: 'equations',
})
export class Equation {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  shortDescription: string;

  @Prop({ required: true, trim: true })
  equation: string;

  @Prop({ trim: true })
  longDescription?: string;

  @Prop({ trim: true })
  mnemonic?: string;

  @Prop({ type: [String], default: [] })
  bulletPoints: string[];

  @Prop({
    type: Types.ObjectId,
    ref: 'Subject',
    required: true,
    index: true,
  })
  subject: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Topic',
    required: true,
    index: true,
  })
  topic: Types.ObjectId;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'Exam' }],
    required: true,
    validate: {
      validator: (value: Types.ObjectId[]) =>
        Array.isArray(value) && value.length > 0,
      message: 'At least one exam is required',
    },
  })
  exams: Types.ObjectId[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EquationSchema = SchemaFactory.createForClass(Equation);

EquationSchema.index({ isDeleted: 1, exams: 1, subject: 1, topic: 1 });
EquationSchema.index({ title: 'text' });

EquationSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

EquationSchema.set('toJSON', {
  virtuals: true,
  transform: function (_doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

EquationSchema.set('toObject', {
  virtuals: true,
  transform: function (_doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

EquationSchema.pre(/^find/, function (this: Query<unknown, EquationDocument>) {
  this.where({ isDeleted: { $ne: true } });
});
