import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS_SETTINGS } from '../../redis/redis.constants';
import { RedisConnectionRegistry } from '../../redis/redis-connection.registry';
import { RedisKeyBuilder } from '../../redis/redis-key.builder';
import { errorMessage } from '../../redis/redis-log';
import { RedisSettings } from '../../redis/redis.settings';
import {
  MAX_PREVIOUS_REFRESH_HASHES,
  MOBILE_SESSION_ABSOLUTE_TTL_SEC,
  WEB_SESSION_ABSOLUTE_TTL_SEC,
  REFRESH_GRACE_MS,
  SESSION_ACTIVITY_TOUCH_MS,
  SESSION_SID_CACHE_TTL_MS,
  sessionPolicyFor,
} from './session.constants';
import {
  AuthClient,
  CreatedStudentSession,
  ResolvedStudentSession,
  StudentSessionRecord,
} from './session.types';

interface SidCacheEntry {
  userId: string;
  expiresAtMs: number;
  client: AuthClient;
  cachedAtMs: number;
}

export interface CreateSessionInput {
  userId: string;
  client: AuthClient;
  userAgent?: string;
  ip?: string;
}

export interface RefreshSessionResult {
  sid: string;
  refreshToken: string;
  expiresAt: Date;
  expiresInSec: number;
  client: AuthClient;
  userId: string;
}

/**
 * Atomic compare-and-set: write the new session JSON only if the stored value
 * is still exactly what the caller read. Stops concurrent refreshes and
 * activity touches from overwriting each other's token rotation.
 */
const CAS_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0
`;

const MAX_CAS_ATTEMPTS = 3;

/** Longest any session can live; a shorter login must not shrink the user's session set. */
const USER_SESSIONS_TTL_SEC = Math.max(
  WEB_SESSION_ABSOLUTE_TTL_SEC,
  MOBILE_SESSION_ABSOLUTE_TTL_SEC,
);

/** Bounds for the in-process maps (entries are otherwise only removed on lookup). */
const MAX_TRACKED_ENTRIES = 5_000;

/** Refresh token format: `<sid>.<secret>`; only the secret's hash is stored. */
const REFRESH_TOKEN_PATTERN = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,})$/;

type RotateOutcome = RefreshSessionResult | null | 'retry';

/**
 * Redis-backed student sessions with an in-process positive sid cache so
 * authenticated traffic does not burn Upstash commands on every request.
 *
 * Fails closed: when Redis cannot confirm or write a session, session-bearing
 * operations throw 503 instead of issuing or accepting unverifiable tokens.
 * See docs/REDIS.md § Student sessions.
 */
@Injectable()
export class StudentSessionService {
  private readonly logger = new Logger(StudentSessionService.name);
  private clientPromise: Promise<Redis> | null = null;
  private readonly sidCache = new Map<string, SidCacheEntry>();
  private readonly lastTouchAt = new Map<string, number>();

  constructor(
    @Inject(REDIS_SETTINGS) private readonly settings: RedisSettings,
    private readonly registry: RedisConnectionRegistry,
    private readonly keys: RedisKeyBuilder,
  ) {}

  /**
   * Create a session in Redis. Throws 503 when the store is unavailable;
   * a login is never completed without a revocable session.
   */
  async create(input: CreateSessionInput): Promise<CreatedStudentSession> {
    const client = input.client === 'mobile' ? 'mobile' : 'web';
    const policy = sessionPolicyFor(client);
    const expiresInSec = policy.idleTtlSec;
    const now = Date.now();
    const expiresAt = new Date(now + expiresInSec * 1000);
    const sid = randomUUID();
    const refreshToken = this.newRefreshToken(sid);

    const record: StudentSessionRecord = {
      userId: input.userId,
      refreshTokenHash: this.hashRefresh(refreshToken),
      previousRefreshes: [],
      createdAt: new Date(now).toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      client,
      userAgent: input.userAgent,
      ip: input.ip,
    };

    try {
      const redis = await this.requireRedis();
      const userKey = this.userSessionsKey(input.userId);
      const pipeline = redis.pipeline();
      pipeline.set(
        this.sessionKey(sid),
        JSON.stringify(record),
        'EX',
        expiresInSec,
      );
      pipeline.sadd(userKey, sid);
      pipeline.expire(userKey, USER_SESSIONS_TTL_SEC);
      await this.execPipeline(pipeline);
    } catch (error) {
      throw this.asUnavailable('create', error);
    }

    this.rememberSid(sid, {
      userId: input.userId,
      expiresAtMs: expiresAt.getTime(),
      client,
      cachedAtMs: now,
    });

    return { sid, refreshToken, expiresAt, expiresInSec, client };
  }

  /**
   * Confirm a live session for a JWT sid. Returns null if revoked/expired.
   * Throws 503 when Redis cannot answer (cache hits still succeed).
   */
  async assertActive(
    sid: string,
    userId: string,
  ): Promise<ResolvedStudentSession | null> {
    if (!sid) {
      return null;
    }

    const cached = this.sidCache.get(sid);
    const now = Date.now();
    if (
      cached &&
      cached.userId === userId &&
      cached.expiresAtMs > now &&
      now - cached.cachedAtMs < SESSION_SID_CACHE_TTL_MS
    ) {
      return {
        sid,
        userId: cached.userId,
        expiresAt: new Date(cached.expiresAtMs),
        client: cached.client,
        fromCache: true,
      };
    }

    let raw: string | null;
    try {
      const redis = await this.requireRedis();
      raw = await redis.get(this.sessionKey(sid));
    } catch (error) {
      throw this.asUnavailable('assertActive', error);
    }

    if (!raw) {
      this.sidCache.delete(sid);
      return null;
    }

    const record = this.parseRecord(raw);
    if (!record || record.userId !== userId) {
      this.sidCache.delete(sid);
      return null;
    }

    const expiresAtMs = Date.parse(record.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      this.sidCache.delete(sid);
      return null;
    }

    this.rememberSid(sid, {
      userId: record.userId,
      expiresAtMs,
      client: record.client,
      cachedAtMs: now,
    });

    return {
      sid,
      userId: record.userId,
      expiresAt: new Date(expiresAtMs),
      client: record.client,
      fromCache: false,
    };
  }

  /**
   * Rotate the refresh token and slide the idle window (never past the
   * absolute cap measured from login).
   *
   * - A token that matches the live one rotates normally.
   * - The token rotated out most recently stays valid for REFRESH_GRACE_MS, so
   *   a lost response or two racing refreshes do not sign the user out.
   * - An older rotated-out token is treated as theft: the session is revoked.
   *
   * Returns null for an invalid/expired token; throws 503 when Redis cannot
   * answer so callers never mistake an outage for a bad credential.
   */
  async refresh(refreshToken: string): Promise<RefreshSessionResult | null> {
    const sid = this.sidFromRefreshToken(refreshToken);
    if (!sid) {
      return null;
    }

    try {
      const redis = await this.requireRedis();
      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
        const outcome = await this.tryRotate(redis, sid, refreshToken);
        if (outcome !== 'retry') {
          return outcome;
        }
      }
      throw new Error('refresh lost the rotation race repeatedly');
    } catch (error) {
      throw this.asUnavailable('refresh', error);
    }
  }

  /**
   * Delete one session. Idempotent. Best-effort when Redis is down: used by
   * logout, which must still clear client credentials.
   */
  async revoke(sid: string, userId?: string): Promise<void> {
    try {
      await this.deleteSession(sid, userId);
    } catch (error) {
      // The session stays in Redis until its TTL, so make the failure loud.
      this.logger.error(
        `auth.session: revoke failed for sid ${sid}: ${errorMessage(error)}`,
      );
    }
  }

  /** Delete one session and propagate Redis failures (strict). */
  private async deleteSession(sid: string, userId?: string): Promise<void> {
    this.sidCache.delete(sid);
    if (!sid) {
      return;
    }

    const redis = await this.requireRedis();
    const sessionKey = this.sessionKey(sid);
    const raw = await redis.get(sessionKey);
    const record = raw ? this.parseRecord(raw) : null;
    const owner = userId || record?.userId;

    const pipeline = redis.pipeline();
    pipeline.del(sessionKey);
    if (owner) {
      pipeline.srem(this.userSessionsKey(owner), sid);
    }
    await this.execPipeline(pipeline);
  }

  /**
   * Revoke the session a refresh token belongs to. Used when logout has the
   * HttpOnly cookie but the short-lived access JWT is already expired. The
   * secret must match (current or rotated-out) so a forged `<sid>.<junk>`
   * cannot sign another user out.
   */
  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    const sid = this.sidFromRefreshToken(refreshToken);
    if (!sid) {
      return;
    }

    try {
      const redis = await this.requireRedis();
      const raw = await redis.get(this.sessionKey(sid));
      const record = raw ? this.parseRecord(raw) : null;
      if (!record) {
        return;
      }
      const hash = this.hashRefresh(refreshToken);
      const known =
        record.refreshTokenHash === hash ||
        (record.previousRefreshes ?? []).some(entry => entry.hash === hash);
      if (known) {
        await this.revoke(sid, record.userId);
      }
    } catch (error) {
      this.logger.error(
        `auth.session: revokeByRefreshToken failed: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Throttled last-seen write. Returns true when the caller should also
   * persist Mongo lastActiveAt for this user.
   */
  async touchActivity(
    sid: string,
    userId: string,
  ): Promise<{ shouldUpdateMongo: boolean }> {
    const touchKey = `sid:${sid}`;
    const userKey = `user:${userId}`;
    const now = Date.now();
    const lastSid = this.lastTouchAt.get(touchKey) || 0;
    const lastUser = this.lastTouchAt.get(userKey) || 0;

    if (now - lastSid < SESSION_ACTIVITY_TOUCH_MS) {
      return { shouldUpdateMongo: false };
    }

    this.pruneTouches(now);
    this.lastTouchAt.set(touchKey, now);
    const shouldUpdateMongo = now - lastUser >= SESSION_ACTIVITY_TOUCH_MS;
    if (shouldUpdateMongo) {
      this.lastTouchAt.set(userKey, now);
    }

    try {
      const redis = await this.requireRedis();
      const sessionKey = this.sessionKey(sid);
      const raw = await redis.get(sessionKey);
      const record = raw ? this.parseRecord(raw) : null;
      if (!raw || !record) {
        return { shouldUpdateMongo };
      }

      const expiresAtMs = Date.parse(record.expiresAt);
      const remainingSec = Math.max(1, Math.floor((expiresAtMs - now) / 1000));
      const updated: StudentSessionRecord = {
        ...record,
        lastSeenAt: new Date(now).toISOString(),
      };
      // CAS: if a refresh rotated the token in the meantime, skip this touch
      // rather than writing the stale record back over the new token hash.
      await this.compareAndSet(
        redis,
        sessionKey,
        raw,
        JSON.stringify(updated),
        remainingSec,
      );
    } catch (error) {
      this.logger.warn(
        `auth.session: touchActivity failed for sid ${sid}: ${errorMessage(error)}`,
      );
    }

    return { shouldUpdateMongo };
  }

  private async tryRotate(
    redis: Redis,
    sid: string,
    refreshToken: string,
  ): Promise<RotateOutcome> {
    const sessionKey = this.sessionKey(sid);
    const raw = await redis.get(sessionKey);
    const record = raw ? this.parseRecord(raw) : null;
    if (!raw || !record) {
      return null;
    }

    const now = Date.now();
    const hash = this.hashRefresh(refreshToken);

    if (record.refreshTokenHash !== hash) {
      const previous = (record.previousRefreshes ?? []).find(
        entry => entry.hash === hash,
      );
      if (!previous) {
        return null;
      }
      if (now - previous.rotatedAt > REFRESH_GRACE_MS) {
        // A token rotated out earlier is being replayed: assume theft.
        this.logger.warn(
          `auth.session: refresh reuse for sid ${sid}; revoking session`,
        );
        await this.deleteSession(sid, record.userId);
        return null;
      }
    }

    const expiresAtMs = Date.parse(record.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      await this.deleteSession(sid, record.userId);
      return null;
    }

    const policy = sessionPolicyFor(record.client);
    const createdAtMs = Date.parse(record.createdAt);
    const absoluteEndMs = Number.isFinite(createdAtMs)
      ? createdAtMs + policy.absoluteTtlSec * 1000
      : now + policy.idleTtlSec * 1000;
    const nextExpiresAtMs = Math.min(
      now + policy.idleTtlSec * 1000,
      absoluteEndMs,
    );
    if (nextExpiresAtMs <= now) {
      await this.deleteSession(sid, record.userId);
      return null;
    }

    const ttlSec = Math.max(1, Math.floor((nextExpiresAtMs - now) / 1000));
    const nextRefresh = this.newRefreshToken(sid);
    const updated: StudentSessionRecord = {
      ...record,
      refreshTokenHash: this.hashRefresh(nextRefresh),
      previousRefreshes: [
        { hash: record.refreshTokenHash, rotatedAt: now },
        ...(record.previousRefreshes ?? []),
      ].slice(0, MAX_PREVIOUS_REFRESH_HASHES),
      expiresAt: new Date(nextExpiresAtMs).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
    };

    const written = await this.compareAndSet(
      redis,
      sessionKey,
      raw,
      JSON.stringify(updated),
      ttlSec,
    );
    if (!written) {
      return 'retry';
    }

    this.rememberSid(sid, {
      userId: record.userId,
      expiresAtMs: nextExpiresAtMs,
      client: record.client,
      cachedAtMs: now,
    });

    return {
      sid,
      refreshToken: nextRefresh,
      expiresAt: new Date(nextExpiresAtMs),
      expiresInSec: Math.min(policy.accessTtlSec, ttlSec),
      client: record.client,
      userId: record.userId,
    };
  }

  private async compareAndSet(
    redis: Redis,
    key: string,
    expectedRaw: string,
    nextRaw: string,
    ttlSec: number,
  ): Promise<boolean> {
    const result = await redis.eval(
      CAS_SCRIPT,
      1,
      key,
      expectedRaw,
      nextRaw,
      String(ttlSec),
    );
    return Number(result) === 1;
  }

  private newRefreshToken(sid: string): string {
    return `${sid}.${randomBytes(48).toString('base64url')}`;
  }

  private sidFromRefreshToken(token: string): string | null {
    if (!token) {
      return null;
    }
    const match = REFRESH_TOKEN_PATTERN.exec(token);
    return match ? match[1] : null;
  }

  private rememberSid(sid: string, entry: SidCacheEntry): void {
    this.sidCache.set(sid, entry);
    if (this.sidCache.size > MAX_TRACKED_ENTRIES) {
      const now = Date.now();
      for (const [key, value] of this.sidCache) {
        if (
          value.expiresAtMs <= now ||
          now - value.cachedAtMs >= SESSION_SID_CACHE_TTL_MS
        ) {
          this.sidCache.delete(key);
        }
      }
    }
  }

  private pruneTouches(now: number): void {
    if (this.lastTouchAt.size <= MAX_TRACKED_ENTRIES) {
      return;
    }
    for (const [key, at] of this.lastTouchAt) {
      if (now - at >= SESSION_ACTIVITY_TOUCH_MS) {
        this.lastTouchAt.delete(key);
      }
    }
  }

  private hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private sessionKey(sid: string): string {
    return this.keys.key('session', sid);
  }

  private userSessionsKey(userId: string): string {
    return this.keys.key('user-sessions', userId);
  }

  private parseRecord(raw: string): StudentSessionRecord | null {
    try {
      const parsed = JSON.parse(raw) as StudentSessionRecord;
      if (
        !parsed?.userId ||
        !parsed.refreshTokenHash ||
        !parsed.expiresAt ||
        !parsed.client
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /** Connected client, or throws; callers translate to 503. */
  private async requireRedis(): Promise<Redis> {
    if (!this.settings.enabled) {
      throw new Error('Redis is not configured');
    }
    if (!this.clientPromise) {
      this.clientPromise = this.connect();
    }
    return this.clientPromise;
  }

  private async connect(): Promise<Redis> {
    const client = this.registry.create('command');
    try {
      if (client.status === 'wait') {
        await client.connect();
      }
      return client;
    } catch (error) {
      // Do not cache the failure: the next request retries on a fresh client.
      this.clientPromise = null;
      client.disconnect();
      throw error;
    }
  }

  /** ioredis pipelines resolve per-command errors instead of rejecting. */
  private async execPipeline(pipeline: ReturnType<Redis['pipeline']>) {
    const results = await pipeline.exec();
    const failed = results?.find(([err]) => err);
    if (failed?.[0]) {
      throw failed[0];
    }
  }

  private asUnavailable(op: string, error: unknown): Error {
    if (error instanceof ServiceUnavailableException) {
      return error;
    }
    this.logger.error(
      `auth.session: Redis unavailable during ${op}: ${errorMessage(error)}`,
    );
    return new ServiceUnavailableException(
      'Sign-in is temporarily unavailable. Please try again shortly.',
    );
  }
}
