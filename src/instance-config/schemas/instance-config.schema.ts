import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  INSTANCE_CONFIG_ID,
  INSTANCE_CONFIG_SCHEMA_VERSION,
} from '../instance-config.constants';

export type InstanceConfigDocument = InstanceConfig & Document;

/**
 * Commerce tax settings. Values come from the database seed, not from code.
 * Owner confirmed 18% and SAC 999293 on 2026-10-09. Change them in config, not in code.
 */
@Schema({ _id: false })
export class InstanceTaxConfig {
  @Prop({ type: Boolean })
  taxEnabled?: boolean;

  @Prop({ trim: true })
  taxType?: string;

  /** Percent, e.g. 18. Not a per-offer field. */
  @Prop({ type: Number })
  taxRate?: number;

  @Prop({ type: Boolean })
  pricesAreTaxInclusive?: boolean;

  @Prop({ trim: true })
  currency?: string;

  @Prop({ trim: true })
  sacCode?: string;

  @Prop({ trim: true })
  sacDescription?: string;

  @Prop({ trim: true })
  invoiceSeriesPrefix?: string;
}

export const InstanceTaxConfigSchema =
  SchemaFactory.createForClass(InstanceTaxConfig);

/** Seller identity for tax snapshots. Production values are U-OPS-01. */
@Schema({ _id: false })
export class InstanceSeller {
  @Prop({ trim: true })
  legalName?: string;

  @Prop({ trim: true })
  gstin?: string;

  @Prop({ trim: true })
  registeredAddress?: string;

  @Prop({ trim: true })
  state?: string;

  @Prop({ trim: true })
  stateCode?: string;

  /** Printed on new invoices only. */
  @Prop({ trim: true })
  signatoryName?: string;

  @Prop({ trim: true })
  signatoryDesignation?: string;
}

export const InstanceSellerSchema =
  SchemaFactory.createForClass(InstanceSeller);

/**
 * Shared process settings. Absent fields fall back to the environment, then
 * to the code default. GST and seller stay on their own subdocuments.
 */
@Schema({ _id: false })
export class InstanceOperationsConfig {
  @Prop({ type: Boolean })
  invoicesEnabled?: boolean;

  @Prop({ type: Number })
  trustProxyHops?: number;

  @Prop({ type: Number })
  maxOpenOrdersPerUser?: number;

  @Prop({ type: Boolean })
  reconciliationEnabled?: boolean;

  @Prop({ type: Number })
  reconciliationMinAgeMinutes?: number;

  @Prop({ type: Number })
  reconciliationIntervalMs?: number;

  @Prop({ type: Number })
  reconciliationBatch?: number;

  @Prop({ type: Number })
  reconciliationMaxAttempts?: number;

  @Prop({ type: Number })
  webhookRetryWindowMinutes?: number;

  @Prop({ type: Number })
  lateCaptureWatchHours?: number;

  @Prop({ type: Number })
  refundUnknownWindowMinutes?: number;
}

export const InstanceOperationsConfigSchema = SchemaFactory.createForClass(
  InstanceOperationsConfig,
);

/** Optional Redis and import-queue overrides. Connection URL stays in the environment. */
@Schema({ _id: false })
export class InstanceRedisConfig {
  @Prop({ trim: true })
  keyPrefix?: string;

  @Prop({ trim: true })
  bullPrefix?: string;

  @Prop({ type: Number })
  connectTimeoutMs?: number;

  @Prop({ type: Number })
  commandTimeoutMs?: number;

  @Prop({ type: Number })
  healthTimeoutMs?: number;

  @Prop({ type: Number })
  keepAliveMs?: number;

  @Prop({ type: Number })
  parseConcurrency?: number;

  @Prop({ type: Number })
  enrichConcurrency?: number;

  @Prop({ type: Number })
  attempts?: number;

  @Prop({ type: Number })
  backoffDelayMs?: number;

  @Prop({ type: Number })
  stalledIntervalMs?: number;

  @Prop({ type: Number })
  maxStalledCount?: number;

  @Prop({ type: Number })
  lockDurationMs?: number;

  @Prop({ type: Number })
  staleJobMs?: number;

  @Prop({ type: Number })
  recoveryIntervalMs?: number;

  @Prop({ type: Number })
  pollIntervalMs?: number;

  @Prop({ type: Number })
  removeOnCompleteCount?: number;

  @Prop({ type: Number })
  removeOnCompleteAgeSec?: number;

  @Prop({ type: Number })
  removeOnFailCount?: number;

  @Prop({ type: Number })
  removeOnFailAgeSec?: number;
}

export const InstanceRedisConfigSchema =
  SchemaFactory.createForClass(InstanceRedisConfig);

@Schema({ _id: false })
export class InstanceVectorSubject {
  @Prop({ required: true, trim: true, lowercase: true, maxlength: 60 })
  key: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  label: string;

  /** Value of the `subjectId` property on chunks in the vector collection. */
  @Prop({ required: true, trim: true, maxlength: 120 })
  vectorSubjectId: string;
}

export const InstanceVectorSubjectSchema = SchemaFactory.createForClass(
  InstanceVectorSubject,
);

/** NCERT citation search. Credentials stay in the environment. */
@Schema({ _id: false })
export class InstanceVectorSearchConfig {
  /** Weaviate collection name, e.g. Ncert. (`collection` is reserved by Mongoose.) */
  @Prop({ trim: true, maxlength: 120 })
  collectionName?: string;

  @Prop({ type: [InstanceVectorSubjectSchema], default: undefined })
  subjects?: InstanceVectorSubject[];
}

export const InstanceVectorSearchConfigSchema = SchemaFactory.createForClass(
  InstanceVectorSearchConfig,
);

@Schema({
  timestamps: true,
  versionKey: false,
  collection: 'instance_configs',
})
export class InstanceConfig {
  @Prop({ type: String, default: INSTANCE_CONFIG_ID })
  _id: string;

  @Prop({ required: true, default: INSTANCE_CONFIG_SCHEMA_VERSION })
  schemaVersion: number;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ trim: true, maxlength: 2048 })
  logoUrl?: string;

  @Prop({ trim: true, maxlength: 2048 })
  faviconUrl?: string;

  /** Optional until a local/prod commerce seed writes it. Admins edit it here. */
  @Prop({ type: InstanceTaxConfigSchema })
  taxConfig?: InstanceTaxConfig;

  /** Optional until a local/prod commerce seed writes it. Admins edit it here. */
  @Prop({ type: InstanceSellerSchema })
  seller?: InstanceSeller;

  /** Optional. Each field overrides the environment only when it is stored. */
  @Prop({ type: InstanceOperationsConfigSchema })
  operations?: InstanceOperationsConfig;

  /** Optional Redis tunables. REDIS_URL and per-process queue role stay in the environment. */
  @Prop({ type: InstanceRedisConfigSchema })
  redis?: InstanceRedisConfig;

  /** Optional. Absent fields fall back to DEFAULT_VECTOR_SEARCH. Read live. */
  @Prop({ type: InstanceVectorSearchConfigSchema })
  vectorSearch?: InstanceVectorSearchConfig;

  createdAt?: Date;
  updatedAt?: Date;
}

export const InstanceConfigSchema =
  SchemaFactory.createForClass(InstanceConfig);
