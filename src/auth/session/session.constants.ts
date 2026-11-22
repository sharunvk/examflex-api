import type { AuthClient } from './session.types';

/**
 * Session lifetime model (both clients):
 * - idle window: slides forward on every successful refresh, so an active user
 *   is never asked to sign in again;
 * - absolute cap: measured from login, never extended. Bounds the life of a
 *   stolen-but-rotating refresh credential.
 * Access JWTs are short-lived and silently renewed from the refresh credential.
 */
export const WEB_ACCESS_TTL_SEC = 15 * 60;
export const WEB_SESSION_IDLE_TTL_SEC = 30 * 24 * 60 * 60;
export const WEB_SESSION_ABSOLUTE_TTL_SEC = 90 * 24 * 60 * 60;

export const MOBILE_ACCESS_TTL_SEC = 30 * 60;
export const MOBILE_SESSION_IDLE_TTL_SEC = 90 * 24 * 60 * 60;
export const MOBILE_SESSION_ABSOLUTE_TTL_SEC = 365 * 24 * 60 * 60;

export interface SessionPolicy {
  accessTtlSec: number;
  idleTtlSec: number;
  absoluteTtlSec: number;
}

export function sessionPolicyFor(client: AuthClient): SessionPolicy {
  return client === 'mobile'
    ? {
        accessTtlSec: MOBILE_ACCESS_TTL_SEC,
        idleTtlSec: MOBILE_SESSION_IDLE_TTL_SEC,
        absoluteTtlSec: MOBILE_SESSION_ABSOLUTE_TTL_SEC,
      }
    : {
        accessTtlSec: WEB_ACCESS_TTL_SEC,
        idleTtlSec: WEB_SESSION_IDLE_TTL_SEC,
        absoluteTtlSec: WEB_SESSION_ABSOLUTE_TTL_SEC,
      };
}

/**
 * After a rotation, the previous refresh token stays acceptable this long.
 * Covers a response lost on a flaky network (client retries with the old
 * token) and two refreshes racing. Outside this window an old token is
 * treated as theft and the whole session is revoked.
 */
export const REFRESH_GRACE_MS = 60_000;

/** How many rotated-out refresh hashes are remembered for reuse detection. */
export const MAX_PREVIOUS_REFRESH_HASHES = 10;

/**
 * Positive sid cache. Cache hit → zero Redis commands.
 * Revocation may lag up to this window on another instance.
 */
export const SESSION_SID_CACHE_TTL_MS = 90_000;

/**
 * How often we may write Redis lastSeenAt / Mongo lastActiveAt per sid/user.
 * Keeps Upstash under the free command budget.
 */
export const SESSION_ACTIVITY_TOUCH_MS = 12 * 60 * 1000;
