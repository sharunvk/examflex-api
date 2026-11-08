import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InstanceSellerResponseDto {
  @ApiProperty({ nullable: true })
  legalName: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Seller GSTIN snapshot source. Admin-only on this API.',
  })
  gstin: string | null;

  @ApiProperty({ nullable: true })
  registeredAddress: string | null;

  @ApiProperty({ nullable: true })
  state: string | null;

  @ApiProperty({ nullable: true })
  stateCode: string | null;

  @ApiProperty({ nullable: true })
  signatoryName: string | null;

  @ApiProperty({ nullable: true })
  signatoryDesignation: string | null;
}

export class InstanceTaxConfigResponseDto {
  @ApiProperty({ nullable: true })
  taxEnabled: boolean | null;

  @ApiProperty({ nullable: true })
  taxType: string | null;

  @ApiProperty({ nullable: true, description: 'Percent, for example 18.' })
  taxRate: number | null;

  @ApiProperty({ nullable: true })
  pricesAreTaxInclusive: boolean | null;

  @ApiProperty({ nullable: true })
  currency: string | null;

  @ApiProperty({ nullable: true })
  sacCode: string | null;

  @ApiProperty({ nullable: true })
  sacDescription: string | null;

  @ApiProperty({ nullable: true })
  invoiceSeriesPrefix: string | null;
}

export class InstanceOperationsResponseDto {
  @ApiProperty({ nullable: true })
  invoicesEnabled: boolean | null;

  @ApiProperty({ nullable: true })
  trustProxyHops: number | null;

  @ApiProperty({ nullable: true })
  maxOpenOrdersPerUser: number | null;

  @ApiProperty({ nullable: true })
  reconciliationEnabled: boolean | null;

  @ApiProperty({ nullable: true })
  reconciliationMinAgeMinutes: number | null;

  @ApiProperty({ nullable: true })
  reconciliationIntervalMs: number | null;

  @ApiProperty({ nullable: true })
  reconciliationBatch: number | null;

  @ApiProperty({ nullable: true })
  reconciliationMaxAttempts: number | null;

  @ApiProperty({ nullable: true })
  webhookRetryWindowMinutes: number | null;

  @ApiProperty({ nullable: true })
  lateCaptureWatchHours: number | null;

  @ApiProperty({ nullable: true })
  refundUnknownWindowMinutes: number | null;
}

export class InstanceRedisResponseDto {
  @ApiProperty({ nullable: true })
  keyPrefix: string | null;

  @ApiProperty({ nullable: true })
  bullPrefix: string | null;

  @ApiProperty({ nullable: true })
  connectTimeoutMs: number | null;

  @ApiProperty({ nullable: true })
  commandTimeoutMs: number | null;

  @ApiProperty({ nullable: true })
  healthTimeoutMs: number | null;

  @ApiProperty({ nullable: true })
  keepAliveMs: number | null;

  @ApiProperty({ nullable: true })
  parseConcurrency: number | null;

  @ApiProperty({ nullable: true })
  enrichConcurrency: number | null;

  @ApiProperty({ nullable: true })
  attempts: number | null;

  @ApiProperty({ nullable: true })
  backoffDelayMs: number | null;

  @ApiProperty({ nullable: true })
  stalledIntervalMs: number | null;

  @ApiProperty({ nullable: true })
  maxStalledCount: number | null;

  @ApiProperty({ nullable: true })
  lockDurationMs: number | null;

  @ApiProperty({ nullable: true })
  staleJobMs: number | null;

  @ApiProperty({ nullable: true })
  recoveryIntervalMs: number | null;

  @ApiProperty({ nullable: true })
  pollIntervalMs: number | null;

  @ApiProperty({ nullable: true })
  removeOnCompleteCount: number | null;

  @ApiProperty({ nullable: true })
  removeOnCompleteAgeSec: number | null;

  @ApiProperty({ nullable: true })
  removeOnFailCount: number | null;

  @ApiProperty({ nullable: true })
  removeOnFailAgeSec: number | null;
}

export class InstanceConfigResponseDto {
  @ApiProperty({ example: 'singleton' })
  id: string;

  @ApiProperty({
    description:
      'Stored shape version. Clients can ignore it until it changes.',
    example: 1,
  })
  schemaVersion: number;

  @ApiProperty({ example: 'ExamFlex' })
  name: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/logo.png',
    nullable: true,
  })
  logoUrl: string | null;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/favicon.png',
    nullable: true,
  })
  faviconUrl: string | null;

  @ApiPropertyOptional({ type: InstanceSellerResponseDto, nullable: true })
  seller: InstanceSellerResponseDto | null;

  @ApiPropertyOptional({ type: InstanceTaxConfigResponseDto, nullable: true })
  taxConfig: InstanceTaxConfigResponseDto | null;

  @ApiPropertyOptional({ type: InstanceOperationsResponseDto, nullable: true })
  operations: InstanceOperationsResponseDto | null;

  @ApiPropertyOptional({ type: InstanceRedisResponseDto, nullable: true })
  redis: InstanceRedisResponseDto | null;

  @ApiProperty({ example: '2026-09-28T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-09-28T00:00:00.000Z' })
  updatedAt: Date;

  constructor(partial: Partial<InstanceConfigResponseDto>) {
    Object.assign(this, partial);
  }
}
