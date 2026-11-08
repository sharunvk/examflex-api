import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parseCorsOrigins } from '../../common/config/security.config';

export const REFRESH_COOKIE_NAME = 'examflex_rt';

/** Cookie path limited to auth routes so it is not sent on every API call. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== REFRESH_COOKIE_NAME) continue;
    const raw = trimmed.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

export function setRefreshCookie(
  res: Response,
  refreshToken: string,
  maxAgeSec: number,
): void {
  const secure = process.env.NODE_ENV === 'production';
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: Math.max(1, Math.floor(maxAgeSec)) * 1000,
    ...(domain ? { domain } : {}),
  });
}

export function clearRefreshCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production';
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    ...(domain ? { domain } : {}),
  });
}

/**
 * CSRF guard for cookie-authenticated auth mutations.
 * Allows missing Origin in non-browser clients; when Origin/Referer is present
 * it must match CORS_ORIGINS.
 */
export function assertCookieRequestOrigin(req: Request): void {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (!origin && !referer) {
    // Same-site navigations sometimes omit Origin; cookie+Lax still applies.
    // Require at least one signal in production when a cookie is used.
    if (process.env.NODE_ENV === 'production') {
      throwForbiddenOrigin();
    }
    return;
  }

  const allowed = new Set(parseCorsOrigins(process.env.CORS_ORIGINS));
  if (origin && allowed.has(origin)) {
    return;
  }
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (allowed.has(refOrigin)) {
        return;
      }
    } catch {
      // fall through
    }
  }
  throwForbiddenOrigin();
}

function throwForbiddenOrigin(): void {
  throw new ForbiddenException('Invalid request origin');
}
