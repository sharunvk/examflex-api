import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  assertCookieRequestOrigin,
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './auth-cookie';

describe('auth-cookie', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.CORS_ORIGINS = 'http://localhost:3001,https://www.examflex.in';
    process.env.NODE_ENV = 'test';
    delete process.env.AUTH_COOKIE_DOMAIN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('readRefreshCookie', () => {
    it('reads examflex_rt from the Cookie header', () => {
      const req = {
        headers: {
          cookie: `other=1; ${REFRESH_COOKIE_NAME}=opaque-refresh; x=y`,
        },
      } as Request;
      expect(readRefreshCookie(req)).toBe('opaque-refresh');
    });

    it('returns undefined when missing', () => {
      expect(readRefreshCookie({ headers: {} } as Request)).toBeUndefined();
    });
  });

  describe('setRefreshCookie / clearRefreshCookie', () => {
    it('sets HttpOnly Lax cookie with auth path', () => {
      const cookie = jest.fn();
      const res = { cookie } as unknown as Response;
      setRefreshCookie(res, 'rt-value', 3600);
      expect(cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'rt-value',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: REFRESH_COOKIE_PATH,
          maxAge: 3600_000,
        }),
      );
    });

    it('applies AUTH_COOKIE_DOMAIN when set', () => {
      process.env.AUTH_COOKIE_DOMAIN = '.examflex.in';
      const cookie = jest.fn();
      setRefreshCookie({ cookie } as unknown as Response, 'rt', 10);
      expect(cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'rt',
        expect.objectContaining({ domain: '.examflex.in' }),
      );
    });

    it('clears with matching path/domain options', () => {
      process.env.AUTH_COOKIE_DOMAIN = '.examflex.in';
      const clearCookie = jest.fn();
      clearRefreshCookie({ clearCookie } as unknown as Response);
      expect(clearCookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        expect.objectContaining({
          path: REFRESH_COOKIE_PATH,
          domain: '.examflex.in',
          httpOnly: true,
        }),
      );
    });
  });

  describe('assertCookieRequestOrigin', () => {
    it('allows an Origin in CORS_ORIGINS', () => {
      expect(() =>
        assertCookieRequestOrigin({
          headers: { origin: 'https://www.examflex.in' },
        } as Request),
      ).not.toThrow();
    });

    it('rejects an evil Origin', () => {
      expect(() =>
        assertCookieRequestOrigin({
          headers: { origin: 'https://evil.example' },
        } as Request),
      ).toThrow(ForbiddenException);
    });

    it('allows a matching Referer when Origin is absent', () => {
      expect(() =>
        assertCookieRequestOrigin({
          headers: { referer: 'http://localhost:3001/login' },
        } as Request),
      ).not.toThrow();
    });

    it('requires Origin/Referer in production', () => {
      process.env.NODE_ENV = 'production';
      expect(() =>
        assertCookieRequestOrigin({ headers: {} } as Request),
      ).toThrow(ForbiddenException);
    });
  });
});
