import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Query, Types } from 'mongoose';
import { RecommendationKind } from '../enums/recommendation-kind.enum';

export type RecommendationOfferingDocument = RecommendationOffering & Document;

@Schema({
  timestamps: true,
  versionKey: false,
  collection: 'recommendationofferings',
})
export class RecommendationOffering {
  /** Target exam this offering belongs to (e.g. NEET, JEE). */
  @Prop({
    type: Types.ObjectId,
    ref: 'Exam',
    required: true,
    index: true,
  })
  exam: Types.ObjectId;

  /**
   * COURSE today; INSTITUTION later for college targets under a COURSE.
   * Keep the discriminator so college recommendations need no schema rewrite.
   */
  @Prop({
    type: String,
    enum: Object.values(RecommendationKind),
    default: RecommendationKind.COURSE,
    index: true,
  })
  kind: RecommendationKind;

  /**
   * Optional parent COURSE when kind is INSTITUTION (future colleges).
   * Null/omitted for COURSE rows.
   */
  @Prop({
    type: Types.ObjectId,
    ref: 'RecommendationOffering',
    default: undefined,
  })
  parentOffering?: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 120 })
  title: string;

  @Prop({ trim: true, maxlength: 200 })
  subtitle?: string;

  @Prop({ trim: true, maxlength: 1000 })
  description?: string;

  /**
   * @deprecated Legacy threshold. Pathways now compare against per-mock cut-off
   * marks (MockTest.courseCutoffs). Kept optional so old rows stay valid.
   */
  @Prop({ min: 0, max: 100 })
  minPercent?: number;

  /** @deprecated Legacy comfort threshold; see minPercent. */
  @Prop({ min: 0, max: 100 })
  comfortPercent?: number;

  @Prop({ required: true, default: 0 })
  sortOrder: number;

  @Prop({ default: true, index: true })
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

export const RecommendationOfferingSchema = SchemaFactory.createForClass(
  RecommendationOffering,
);

RecommendationOfferingSchema.index({
  exam: 1,
  kind: 1,
  isDeleted: 1,
  isActive: 1,
  sortOrder: 1,
});
RecommendationOfferingSchema.index({
  exam: 1,
  parentOffering: 1,
  isDeleted: 1,
});

RecommendationOfferingSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

RecommendationOfferingSchema.set('toJSON', {
  virtuals: true,
  transform: function (_doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

RecommendationOfferingSchema.set('toObject', {
  virtuals: true,
  transform: function (_doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

RecommendationOfferingSchema.pre(
  /^find/,
  function (this: Query<unknown, RecommendationOfferingDocument>) {
    this.where({ isDeleted: { $ne: true } });
  },
);
