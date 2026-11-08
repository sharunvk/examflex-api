import { Inject, Injectable } from '@nestjs/common';
import { REDIS_SETTINGS } from './redis.constants';
import { RedisSettings } from './redis.settings';

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export function assertKeySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SEGMENT.test(trimmed)) {
    throw new Error(
      `${label} must contain only letters, numbers, ".", "_" or "-"`,
    );
  }
  return trimmed;
}

/**
 * Builds instance-scoped Redis keys. Callers pass logical parts only.
 * A later session or cache feature uses the same builder so keys cannot
 * collide across deployments that share one Redis database.
 */
@Injectable()
export class RedisKeyBuilder {
  private readonly prefix: string;

  constructor(@Inject(REDIS_SETTINGS) settings: RedisSettings) {
    this.prefix = assertKeySegment(settings.keyPrefix, 'key prefix');
  }

  key(...parts: string[]): string {
    if (parts.length === 0) {
      throw new Error('A Redis key needs at least one segment');
    }
    const segments = parts.map((part, index) =>
      assertKeySegment(part, `key segment ${index + 1}`),
    );
    return [this.prefix, ...segments].join(':');
  }
}
