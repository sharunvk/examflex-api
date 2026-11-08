import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { INSTANCE_ID_PATTERN } from '../../commerce/commerce-config';
import { trimLowerString, trimString } from '../instance-config.transforms';
import { UpdateCommerceConfigFields } from './update-commerce-config.dto';

/**
 * Shared settings for every process of this database.
 * Omitted keys are left unchanged. A stored value applies on the next process start.
 */
export class UpdateOperationsConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  invoicesEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Integer hop count, 0 or greater.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  trustProxyHops?: number;

  @ApiPropertyOptional({ description: 'Integer of at least 1.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxOpenOrdersPerUser?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reconciliationEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Integer minutes, 0 or greater. 0 is a local pass.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  reconciliationMinAgeMinutes?: number;

  @ApiPropertyOptional({
    description: 'Integer milliseconds, at least 1000.',
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  reconciliationIntervalMs?: number;

  @ApiPropertyOptional({ description: 'Integer of at least 1.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  reconciliationBatch?: number;

  @ApiPropertyOptional({ description: 'Integer of at least 1.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  reconciliationMaxAttempts?: number;

  @ApiPropertyOptional({ description: 'Integer minutes, 0 or greater.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  webhookRetryWindowMinutes?: number;

  @ApiPropertyOptional({ description: 'Integer hours, 0 or greater.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  lateCaptureWatchHours?: number;

  @ApiPropertyOptional({ description: 'Integer minutes, 0 or greater.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  refundUnknownWindowMinutes?: number;
}

/** Optional Redis and import-queue overrides. Bounds match resolveRedisSettings. */
export class UpdateRedisConfigDto {
  @ApiPropertyOptional({ example: 'examflex' })
  @Transform(trimLowerString)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(63)
  @Matches(INSTANCE_ID_PATTERN, {
    message:
      'keyPrefix must be 1-63 characters of lowercase letters, numbers, "_" or "-"',
  })
  keyPrefix?: string;

  @ApiPropertyOptional({ example: '{examflex}:bull' })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/\{[^{}]+\}/, {
    message:
      'bullPrefix must include a non-empty Redis hash tag, for example {examflex}:bull',
  })
  bullPrefix?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(60_000)
  connectTimeoutMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(30_000)
  commandTimeoutMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(10_000)
  healthTimeoutMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300_000)
  keepAliveMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  parseConcurrency?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  enrichConcurrency?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  attempts?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300_000)
  backoffDelayMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(5_000)
  @Max(600_000)
  stalledIntervalMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxStalledCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(30_000)
  @Max(3_600_000)
  lockDurationMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(60_000)
  @Max(86_400_000)
  staleJobMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(5_000)
  @Max(3_600_000)
  recoveryIntervalMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(15_000)
  @Max(600_000)
  pollIntervalMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  removeOnCompleteCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(2_592_000)
  removeOnCompleteAgeSec?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  removeOnFailCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(7_776_000)
  removeOnFailAgeSec?: number;
}

export class UpdateRuntimeConfigFields extends UpdateCommerceConfigFields {
  @ApiPropertyOptional({
    type: UpdateOperationsConfigDto,
    description:
      'Stored values apply on the next process start. Omitted keys stay as they are.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateOperationsConfigDto)
  operations?: UpdateOperationsConfigDto;

  @ApiPropertyOptional({
    type: UpdateRedisConfigDto,
    description:
      'Optional Redis overrides. Omit a key to keep the code default. Applies on the next process start.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateRedisConfigDto)
  redis?: UpdateRedisConfigDto;
}
