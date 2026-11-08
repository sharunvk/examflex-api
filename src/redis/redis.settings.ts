import { InstanceRedisSnapshot } from '../instance-config/instance-runtime.snapshot';

export interface RedisEnv {
  NODE_ENV?: string;
  INSTANCE_ID?: string;
  REDIS_URL?: string;
  REDIS_KEY_PREFIX?: string;
  BULLMQ_PREFIX?: string;
  QUEUE_WORKER_ENABLED?: string;
  IMPORT_QUEUE_DRIVER?: string;
  REDIS_CONNECT_TIMEOUT_MS?: string;
  REDIS_COMMAND_TIMEOUT_MS?: string;
  REDIS_HEALTH_TIMEOUT_MS?: string;
  REDIS_KEEP_ALIVE_MS?: string;
  IMPORT_PARSE_CONCURRENCY?: string;
  IMPORT_ENRICH_CONCURRENCY?: string;
  IMPORT_QUEUE_ATTEMPTS?: string;
  IMPORT_QUEUE_BACKOFF_MS?: string;
  IMPORT_QUEUE_STALLED_INTERVAL_MS?: string;
  IMPORT_QUEUE_MAX_STALLED_COUNT?: string;
  IMPORT_QUEUE_LOCK_DURATION_MS?: string;
  IMPORT_QUEUE_STALE_MS?: string;
  IMPORT_QUEUE_RECOVERY_INTERVAL_MS?: string;
  IMPORT_QUEUE_POLL_INTERVAL_MS?: string;
  IMPORT_QUEUE_REMOVE_ON_COMPLETE_COUNT?: string;
  IMPORT_QUEUE_REMOVE_ON_COMPLETE_AGE_SEC?: string;
  IMPORT_QUEUE_REMOVE_ON_FAIL_COUNT?: string;
  IMPORT_QUEUE_REMOVE_ON_FAIL_AGE_SEC?: string;
}

export type ImportQueueDriver = 'memory' | 'bullmq';

export interface RedisSettings {
  enabled: boolean;
  url: string;
  instanceId: string;
  keyPrefix: string;
  bullPrefix: string;
  queueDriver: ImportQueueDriver;
  workerEnabled: boolean;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  healthTimeoutMs: number;
  keepAliveMs: number;
  parseConcurrency: number;
  enrichConcurrency: number;
  attempts: number;
  backoffDelayMs: number;
  stalledIntervalMs: number;
  maxStalledCount: number;
  lockDurationMs: number;
  staleJobMs: number;
  recoveryIntervalMs: number;
  pollIntervalMs: number;
  removeOnCompleteCount: number;
  removeOnCompleteAgeSec: number;
  removeOnFailCount: number;
  removeOnFailAgeSec: number;
}

const INSTANCE_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function resolveRedisSettings(env: RedisEnv): RedisSettings {
  const url = env.REDIS_URL?.trim() ?? '';
  const enabled = url.length > 0;
  if (enabled) {
    assertRedisUrl(url);
  }

  const instanceId = normalizeInstanceId(env.INSTANCE_ID, enabled);
  const queueDriver = resolveQueueDriver(env, enabled);
  const keyPrefix = env.REDIS_KEY_PREFIX?.trim()
    ? assertNamespace(env.REDIS_KEY_PREFIX, 'REDIS_KEY_PREFIX')
    : instanceId;
  const bullPrefix = env.BULLMQ_PREFIX?.trim()
    ? assertBullPrefix(env.BULLMQ_PREFIX.trim())
    : `{${keyPrefix}}:bull`;

  return {
    enabled,
    url,
    instanceId,
    keyPrefix,
    bullPrefix,
    queueDriver,
    workerEnabled: resolveWorkerEnabled(env, queueDriver === 'bullmq'),
    connectTimeoutMs: readBoundedInt(
      'REDIS_CONNECT_TIMEOUT_MS',
      env.REDIS_CONNECT_TIMEOUT_MS,
      10_000,
      100,
      60_000,
    ),
    commandTimeoutMs: readBoundedInt(
      'REDIS_COMMAND_TIMEOUT_MS',
      env.REDIS_COMMAND_TIMEOUT_MS,
      5_000,
      100,
      30_000,
    ),
    healthTimeoutMs: readBoundedInt(
      'REDIS_HEALTH_TIMEOUT_MS',
      env.REDIS_HEALTH_TIMEOUT_MS,
      1_000,
      100,
      10_000,
    ),
    keepAliveMs: readBoundedInt(
      'REDIS_KEEP_ALIVE_MS',
      env.REDIS_KEEP_ALIVE_MS,
      30_000,
      0,
      300_000,
    ),
    parseConcurrency: readBoundedInt(
      'IMPORT_PARSE_CONCURRENCY',
      env.IMPORT_PARSE_CONCURRENCY,
      2,
      1,
      20,
    ),
    enrichConcurrency: readBoundedInt(
      'IMPORT_ENRICH_CONCURRENCY',
      env.IMPORT_ENRICH_CONCURRENCY,
      2,
      1,
      20,
    ),
    attempts: readBoundedInt(
      'IMPORT_QUEUE_ATTEMPTS',
      env.IMPORT_QUEUE_ATTEMPTS,
      3,
      1,
      10,
    ),
    backoffDelayMs: readBoundedInt(
      'IMPORT_QUEUE_BACKOFF_MS',
      env.IMPORT_QUEUE_BACKOFF_MS,
      5_000,
      0,
      300_000,
    ),
    stalledIntervalMs: readBoundedInt(
      'IMPORT_QUEUE_STALLED_INTERVAL_MS',
      env.IMPORT_QUEUE_STALLED_INTERVAL_MS,
      30_000,
      5_000,
      600_000,
    ),
    maxStalledCount: readBoundedInt(
      'IMPORT_QUEUE_MAX_STALLED_COUNT',
      env.IMPORT_QUEUE_MAX_STALLED_COUNT,
      2,
      0,
      10,
    ),
    lockDurationMs: readBoundedInt(
      'IMPORT_QUEUE_LOCK_DURATION_MS',
      env.IMPORT_QUEUE_LOCK_DURATION_MS,
      180_000,
      30_000,
      3_600_000,
    ),
    staleJobMs: readBoundedInt(
      'IMPORT_QUEUE_STALE_MS',
      env.IMPORT_QUEUE_STALE_MS,
      1_800_000,
      60_000,
      86_400_000,
    ),
    recoveryIntervalMs: readBoundedInt(
      'IMPORT_QUEUE_RECOVERY_INTERVAL_MS',
      env.IMPORT_QUEUE_RECOVERY_INTERVAL_MS,
      60_000,
      5_000,
      3_600_000,
    ),
    pollIntervalMs: readBoundedInt(
      'IMPORT_QUEUE_POLL_INTERVAL_MS',
      env.IMPORT_QUEUE_POLL_INTERVAL_MS,
      60_000,
      15_000,
      600_000,
    ),
    removeOnCompleteCount: readBoundedInt(
      'IMPORT_QUEUE_REMOVE_ON_COMPLETE_COUNT',
      env.IMPORT_QUEUE_REMOVE_ON_COMPLETE_COUNT,
      1_000,
      1,
      100_000,
    ),
    removeOnCompleteAgeSec: readBoundedInt(
      'IMPORT_QUEUE_REMOVE_ON_COMPLETE_AGE_SEC',
      env.IMPORT_QUEUE_REMOVE_ON_COMPLETE_AGE_SEC,
      86_400,
      60,
      2_592_000,
    ),
    removeOnFailCount: readBoundedInt(
      'IMPORT_QUEUE_REMOVE_ON_FAIL_COUNT',
      env.IMPORT_QUEUE_REMOVE_ON_FAIL_COUNT,
      5_000,
      1,
      100_000,
    ),
    removeOnFailAgeSec: readBoundedInt(
      'IMPORT_QUEUE_REMOVE_ON_FAIL_AGE_SEC',
      env.IMPORT_QUEUE_REMOVE_ON_FAIL_AGE_SEC,
      604_800,
      60,
      7_776_000,
    ),
  };
}

/**
 * Stored redis overrides replace the matching environment values.
 * REDIS_URL, QUEUE_WORKER_ENABLED, and IMPORT_QUEUE_DRIVER are never taken from here.
 */
export function overlayRedisEnv(
  env: RedisEnv,
  redis: InstanceRedisSnapshot | null | undefined,
): RedisEnv {
  if (!redis) {
    return env;
  }
  const next: RedisEnv = { ...env };
  setString(next, 'REDIS_KEY_PREFIX', redis.keyPrefix);
  setString(next, 'BULLMQ_PREFIX', redis.bullPrefix);
  setNumber(next, 'REDIS_CONNECT_TIMEOUT_MS', redis.connectTimeoutMs);
  setNumber(next, 'REDIS_COMMAND_TIMEOUT_MS', redis.commandTimeoutMs);
  setNumber(next, 'REDIS_HEALTH_TIMEOUT_MS', redis.healthTimeoutMs);
  setNumber(next, 'REDIS_KEEP_ALIVE_MS', redis.keepAliveMs);
  setNumber(next, 'IMPORT_PARSE_CONCURRENCY', redis.parseConcurrency);
  setNumber(next, 'IMPORT_ENRICH_CONCURRENCY', redis.enrichConcurrency);
  setNumber(next, 'IMPORT_QUEUE_ATTEMPTS', redis.attempts);
  setNumber(next, 'IMPORT_QUEUE_BACKOFF_MS', redis.backoffDelayMs);
  setNumber(next, 'IMPORT_QUEUE_STALLED_INTERVAL_MS', redis.stalledIntervalMs);
  setNumber(next, 'IMPORT_QUEUE_MAX_STALLED_COUNT', redis.maxStalledCount);
  setNumber(next, 'IMPORT_QUEUE_LOCK_DURATION_MS', redis.lockDurationMs);
  setNumber(next, 'IMPORT_QUEUE_STALE_MS', redis.staleJobMs);
  setNumber(
    next,
    'IMPORT_QUEUE_RECOVERY_INTERVAL_MS',
    redis.recoveryIntervalMs,
  );
  setNumber(next, 'IMPORT_QUEUE_POLL_INTERVAL_MS', redis.pollIntervalMs);
  setNumber(
    next,
    'IMPORT_QUEUE_REMOVE_ON_COMPLETE_COUNT',
    redis.removeOnCompleteCount,
  );
  setNumber(
    next,
    'IMPORT_QUEUE_REMOVE_ON_COMPLETE_AGE_SEC',
    redis.removeOnCompleteAgeSec,
  );
  setNumber(next, 'IMPORT_QUEUE_REMOVE_ON_FAIL_COUNT', redis.removeOnFailCount);
  setNumber(
    next,
    'IMPORT_QUEUE_REMOVE_ON_FAIL_AGE_SEC',
    redis.removeOnFailAgeSec,
  );
  return next;
}

function setString(
  env: RedisEnv,
  key: keyof RedisEnv,
  value: string | undefined,
): void {
  if (value !== undefined) {
    env[key] = value;
  }
}

function setNumber(
  env: RedisEnv,
  key: keyof RedisEnv,
  value: number | undefined,
): void {
  if (value !== undefined) {
    env[key] = String(value);
  }
}

export function readRedisEnv(config: {
  get: (key: string) => string | undefined;
}): RedisEnv {
  const keys: (keyof RedisEnv)[] = [
    'NODE_ENV',
    'INSTANCE_ID',
    'REDIS_URL',
    'REDIS_KEY_PREFIX',
    'BULLMQ_PREFIX',
    'QUEUE_WORKER_ENABLED',
    'IMPORT_QUEUE_DRIVER',
    'REDIS_CONNECT_TIMEOUT_MS',
    'REDIS_COMMAND_TIMEOUT_MS',
    'REDIS_HEALTH_TIMEOUT_MS',
    'REDIS_KEEP_ALIVE_MS',
    'IMPORT_PARSE_CONCURRENCY',
    'IMPORT_ENRICH_CONCURRENCY',
    'IMPORT_QUEUE_ATTEMPTS',
    'IMPORT_QUEUE_BACKOFF_MS',
    'IMPORT_QUEUE_STALLED_INTERVAL_MS',
    'IMPORT_QUEUE_MAX_STALLED_COUNT',
    'IMPORT_QUEUE_LOCK_DURATION_MS',
    'IMPORT_QUEUE_STALE_MS',
    'IMPORT_QUEUE_RECOVERY_INTERVAL_MS',
    'IMPORT_QUEUE_POLL_INTERVAL_MS',
    'IMPORT_QUEUE_REMOVE_ON_COMPLETE_COUNT',
    'IMPORT_QUEUE_REMOVE_ON_COMPLETE_AGE_SEC',
    'IMPORT_QUEUE_REMOVE_ON_FAIL_COUNT',
    'IMPORT_QUEUE_REMOVE_ON_FAIL_AGE_SEC',
  ];
  const env: RedisEnv = {};
  for (const key of keys) {
    const value = config.get(key);
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function resolveQueueDriver(
  env: RedisEnv,
  redisEnabled: boolean,
): ImportQueueDriver {
  const raw = env.IMPORT_QUEUE_DRIVER?.trim().toLowerCase() ?? '';
  if (raw === '' || raw === 'auto') {
    return redisEnabled ? 'bullmq' : 'memory';
  }
  if (raw === 'memory' || raw === 'in-memory' || raw === 'inmemory') {
    return 'memory';
  }
  if (raw === 'bullmq' || raw === 'redis') {
    if (!redisEnabled) {
      throw new Error('IMPORT_QUEUE_DRIVER=bullmq requires REDIS_URL');
    }
    return 'bullmq';
  }
  throw new Error('IMPORT_QUEUE_DRIVER must be memory or bullmq');
}

function resolveWorkerEnabled(env: RedisEnv, queueUsesRedis: boolean): boolean {
  if (!queueUsesRedis) {
    return false;
  }
  const raw = env.QUEUE_WORKER_ENABLED?.trim() ?? '';
  if (raw.length > 0) {
    return readBool('QUEUE_WORKER_ENABLED', raw);
  }
  return env.NODE_ENV !== 'test';
}

function normalizeInstanceId(
  raw: string | undefined,
  required: boolean,
): string {
  const value = raw?.trim().toLowerCase() ?? '';
  if (!value) {
    if (required) {
      throw new Error('INSTANCE_ID is required when REDIS_URL is set');
    }
    return 'local';
  }
  if (!INSTANCE_ID.test(value)) {
    throw new Error(
      'INSTANCE_ID must be 1-63 characters of lowercase letters, numbers, "_" or "-"',
    );
  }
  return value;
}

function assertNamespace(raw: string, name: string): string {
  const value = raw.trim().toLowerCase();
  if (!INSTANCE_ID.test(value)) {
    throw new Error(
      `${name} must be 1-63 characters of lowercase letters, numbers, "_" or "-"`,
    );
  }
  return value;
}

function assertBullPrefix(prefix: string): string {
  const tag = prefix.match(/\{([^{}]*)\}/);
  if (!tag || tag[1].length === 0) {
    throw new Error(
      'BULLMQ_PREFIX must include a non-empty Redis hash tag, for example {examflex}:bull',
    );
  }
  return prefix;
}

function assertRedisUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('REDIS_URL is not a valid URL');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use the redis:// or rediss:// scheme');
  }
  if (!parsed.hostname) {
    throw new Error('REDIS_URL must include a host');
  }
}

function readBool(name: string, raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`${name} must be a boolean`);
}

function readBoundedInt(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be an integer`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}
