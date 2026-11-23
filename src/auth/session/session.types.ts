export type AuthClient = 'web' | 'mobile';

export interface PreviousRefresh {
  hash: string;
  rotatedAt: number;
}

export interface StudentSessionRecord {
  userId: string;
  refreshTokenHash: string;
  /** Rotated-out refresh hashes (newest first) for grace + reuse detection. */
  previousRefreshes?: PreviousRefresh[];
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  client: AuthClient;
  userAgent?: string;
  ip?: string;
}

export interface CreatedStudentSession {
  sid: string;
  refreshToken: string;
  expiresAt: Date;
  expiresInSec: number;
  client: AuthClient;
}

export interface ResolvedStudentSession {
  sid: string;
  userId: string;
  expiresAt: Date;
  client: AuthClient;
  /** True when served from the in-process sid cache. */
  fromCache: boolean;
}
