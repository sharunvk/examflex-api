import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, UpdateQuery } from 'mongoose';
import { CreateInstanceConfigDto } from './dto/create-instance-config.dto';
import {
  InstanceConfigResponseDto,
  InstanceOperationsResponseDto,
  InstanceRedisResponseDto,
  InstanceSellerResponseDto,
  InstanceTaxConfigResponseDto,
} from './dto/instance-config-response.dto';
import { UpdateInstanceConfigDto } from './dto/update-instance-config.dto';
import {
  INSTANCE_CONFIG_ID,
  INSTANCE_CONFIG_SCHEMA_VERSION,
} from './instance-config.constants';
import {
  InstanceConfig,
  InstanceConfigDocument,
  InstanceOperationsConfig,
  InstanceRedisConfig,
  InstanceSeller,
  InstanceTaxConfig,
} from './schemas/instance-config.schema';
import { resolveVectorSearch } from './vector-search.settings';

@Injectable()
export class InstanceConfigService {
  constructor(
    @InjectModel(InstanceConfig.name)
    private readonly instanceConfigModel: Model<InstanceConfigDocument>,
  ) {}

  async get(): Promise<InstanceConfigResponseDto | null> {
    const config = await this.instanceConfigModel
      .findById(INSTANCE_CONFIG_ID)
      .exec();
    return config ? this.toResponse(config) : null;
  }

  async create(
    dto: CreateInstanceConfigDto,
  ): Promise<InstanceConfigResponseDto> {
    const existing = await this.instanceConfigModel
      .findById(INSTANCE_CONFIG_ID)
      .exec();
    if (existing) {
      throw new ConflictException('Instance configuration already exists');
    }

    try {
      const created = await this.instanceConfigModel.create({
        _id: INSTANCE_CONFIG_ID,
        schemaVersion: INSTANCE_CONFIG_SCHEMA_VERSION,
        name: dto.name,
        ...this.presentUrls(dto),
      });
      return this.toResponse(created);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException('Instance configuration already exists');
      }
      throw error;
    }
  }

  async update(
    dto: UpdateInstanceConfigDto,
  ): Promise<InstanceConfigResponseDto> {
    const update = this.toUpdateQuery(dto);
    if (!update) {
      throw new BadRequestException('Provide at least one field to update');
    }

    const updated = await this.instanceConfigModel
      .findByIdAndUpdate(INSTANCE_CONFIG_ID, update, { new: true })
      .exec();

    if (!updated) {
      throw new NotFoundException(
        'Instance configuration has not been created',
      );
    }

    return this.toResponse(updated);
  }

  private presentUrls(dto: {
    logoUrl?: string | null;
    faviconUrl?: string | null;
  }): { logoUrl?: string; faviconUrl?: string } {
    return {
      ...(dto.logoUrl ? { logoUrl: dto.logoUrl } : {}),
      ...(dto.faviconUrl ? { faviconUrl: dto.faviconUrl } : {}),
    };
  }

  private toUpdateQuery(
    dto: UpdateInstanceConfigDto,
  ): UpdateQuery<InstanceConfigDocument> | null {
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, 1> = {};

    if (dto.name !== undefined) {
      $set.name = dto.name;
    }

    this.assignOptionalUrl($set, $unset, 'logoUrl', dto.logoUrl);
    this.assignOptionalUrl($set, $unset, 'faviconUrl', dto.faviconUrl);
    this.assignNested($set, 'seller', dto.seller);
    this.assignNested($set, 'taxConfig', dto.taxConfig);
    this.assignNested($set, 'operations', dto.operations);
    this.assignNested($set, 'redis', dto.redis);
    if (dto.vectorSearch) {
      if (dto.vectorSearch.collectionName !== undefined) {
        $set['vectorSearch.collectionName'] = dto.vectorSearch.collectionName;
      }
      if (dto.vectorSearch.subjects !== undefined) {
        this.assertUniqueVectorKeys(dto.vectorSearch.subjects);
        // The list is replaced as a whole so removed mappings disappear.
        $set['vectorSearch.subjects'] = dto.vectorSearch.subjects.map(s => ({
          key: s.key,
          label: s.label,
          vectorSubjectId: s.vectorSubjectId,
        }));
      }
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      return null;
    }

    return {
      ...(Object.keys($set).length > 0 ? { $set } : {}),
      ...(Object.keys($unset).length > 0 ? { $unset } : {}),
    };
  }

  private assertUniqueVectorKeys(subjects: { key: string }[]): void {
    const seen = new Set<string>();
    for (const { key } of subjects) {
      if (seen.has(key)) {
        throw new BadRequestException(
          `vectorSearch.subjects has a duplicate key: ${key}`,
        );
      }
      seen.add(key);
    }
  }

  private assignOptionalUrl(
    $set: Record<string, unknown>,
    $unset: Record<string, 1>,
    field: 'logoUrl' | 'faviconUrl',
    value: string | null | undefined,
  ): void {
    if (value === undefined) {
      return;
    }
    if (value === null) {
      $unset[field] = 1;
      return;
    }
    $set[field] = value;
  }

  private assignNested(
    $set: Record<string, unknown>,
    prefix: 'seller' | 'taxConfig' | 'operations' | 'redis',
    value: object | undefined,
  ): void {
    if (!value) {
      return;
    }
    for (const [key, field] of Object.entries(value)) {
      if (field !== undefined) {
        $set[`${prefix}.${key}`] = field;
      }
    }
  }

  private toResponse(
    config: InstanceConfigDocument,
  ): InstanceConfigResponseDto {
    return new InstanceConfigResponseDto({
      id: String(config._id),
      schemaVersion: config.schemaVersion ?? INSTANCE_CONFIG_SCHEMA_VERSION,
      name: config.name,
      logoUrl: config.logoUrl ?? null,
      faviconUrl: config.faviconUrl ?? null,
      seller: this.toSeller(config.seller),
      taxConfig: this.toTaxConfig(config.taxConfig),
      operations: this.toOperations(config.operations),
      redis: this.toRedis(config.redis),
      vectorSearch: resolveVectorSearch(config.vectorSearch),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  }

  private toSeller(
    seller?: InstanceSeller | null,
  ): InstanceSellerResponseDto | null {
    if (!seller) {
      return null;
    }
    return {
      legalName: seller.legalName ?? null,
      gstin: seller.gstin ?? null,
      registeredAddress: seller.registeredAddress ?? null,
      state: seller.state ?? null,
      stateCode: seller.stateCode ?? null,
      signatoryName: seller.signatoryName ?? null,
      signatoryDesignation: seller.signatoryDesignation ?? null,
    };
  }

  private toOperations(
    operations?: InstanceOperationsConfig | null,
  ): InstanceOperationsResponseDto | null {
    if (!operations) {
      return null;
    }
    return {
      invoicesEnabled: operations.invoicesEnabled ?? null,
      trustProxyHops: operations.trustProxyHops ?? null,
      maxOpenOrdersPerUser: operations.maxOpenOrdersPerUser ?? null,
      reconciliationEnabled: operations.reconciliationEnabled ?? null,
      reconciliationMinAgeMinutes:
        operations.reconciliationMinAgeMinutes ?? null,
      reconciliationIntervalMs: operations.reconciliationIntervalMs ?? null,
      reconciliationBatch: operations.reconciliationBatch ?? null,
      reconciliationMaxAttempts: operations.reconciliationMaxAttempts ?? null,
      webhookRetryWindowMinutes: operations.webhookRetryWindowMinutes ?? null,
      lateCaptureWatchHours: operations.lateCaptureWatchHours ?? null,
      refundUnknownWindowMinutes: operations.refundUnknownWindowMinutes ?? null,
    };
  }

  private toRedis(
    redis?: InstanceRedisConfig | null,
  ): InstanceRedisResponseDto | null {
    if (!redis) {
      return null;
    }
    return {
      keyPrefix: redis.keyPrefix ?? null,
      bullPrefix: redis.bullPrefix ?? null,
      connectTimeoutMs: redis.connectTimeoutMs ?? null,
      commandTimeoutMs: redis.commandTimeoutMs ?? null,
      healthTimeoutMs: redis.healthTimeoutMs ?? null,
      keepAliveMs: redis.keepAliveMs ?? null,
      parseConcurrency: redis.parseConcurrency ?? null,
      enrichConcurrency: redis.enrichConcurrency ?? null,
      attempts: redis.attempts ?? null,
      backoffDelayMs: redis.backoffDelayMs ?? null,
      stalledIntervalMs: redis.stalledIntervalMs ?? null,
      maxStalledCount: redis.maxStalledCount ?? null,
      lockDurationMs: redis.lockDurationMs ?? null,
      staleJobMs: redis.staleJobMs ?? null,
      recoveryIntervalMs: redis.recoveryIntervalMs ?? null,
      pollIntervalMs: redis.pollIntervalMs ?? null,
      removeOnCompleteCount: redis.removeOnCompleteCount ?? null,
      removeOnCompleteAgeSec: redis.removeOnCompleteAgeSec ?? null,
      removeOnFailCount: redis.removeOnFailCount ?? null,
      removeOnFailAgeSec: redis.removeOnFailAgeSec ?? null,
    };
  }

  private toTaxConfig(
    tax?: InstanceTaxConfig | null,
  ): InstanceTaxConfigResponseDto | null {
    if (!tax) {
      return null;
    }
    return {
      taxEnabled: tax.taxEnabled ?? null,
      taxType: tax.taxType ?? null,
      taxRate: tax.taxRate ?? null,
      pricesAreTaxInclusive: tax.pricesAreTaxInclusive ?? null,
      currency: tax.currency ?? null,
      sacCode: tax.sacCode ?? null,
      sacDescription: tax.sacDescription ?? null,
      invoiceSeriesPrefix: tax.invoiceSeriesPrefix ?? null,
    };
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}
