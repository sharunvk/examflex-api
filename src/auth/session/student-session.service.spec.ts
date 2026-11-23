import { ServiceUnavailableException } from '@nestjs/common';
import { StudentSessionService } from './student-session.service';
import { resolveRedisSettings } from '../../redis/redis.settings';
import {
  MOBILE_ACCESS_TTL_SEC,
  MOBILE_SESSION_ABSOLUTE_TTL_SEC,
  MOBILE_SESSION_IDLE_TTL_SEC,
  REFRESH_GRACE_MS,
  WEB_ACCESS_TTL_SEC,
  WEB_SESSION_ABSOLUTE_TTL_SEC,
  WEB_SESSION_IDLE_TTL_SEC,
} from './session.constants';

const DAY_MS = 86_400_000;

describe('StudentSessionService', () => {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const expireCalls: Array<[string, number]> = [];

  const redis = {
    status: 'ready',
    connect: jest.fn(),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    // Mirrors CAS_SCRIPT: write only when the stored value is unchanged.
    eval: jest.fn(
      async (
        _script: string,
        _numKeys: number,
        key: string,
        expected: string,
        next: string,
      ) => {
        if (store.get(key) === expected) {
          store.set(key, next);
          return 1;
        }
        return 0;
      },
    ),
    pipeline: jest.fn(() => {
      const ops: Array<() => void> = [];
      const api = {
        set: (key: string, value: string) => {
          ops.push(() => store.set(key, value));
          return api;
        },
        sadd: (key: string, member: string) => {
          ops.push(() => {
            const set = sets.get(key) ?? new Set<string>();
            set.add(member);
            sets.set(key, set);
          });
          return api;
        },
        expire: (key: string, ttl: number) => {
          expireCalls.push([key, ttl]);
          return api;
        },
        del: (...keys: string[]) => {
          ops.push(() => keys.forEach(key => store.delete(key)));
          return api;
        },
        srem: (key: string, member: string) => {
          ops.push(() => sets.get(key)?.delete(member));
          return api;
        },
        exec: async () => {
          ops.forEach(op => op());
          return ops.map(() => [null, 'OK']);
        },
      };
      return api;
    }),
  };

  const registry = { create: jest.fn(() => redis) };
  const keys = { key: (...parts: string[]) => ['ezprep', ...parts].join(':') };
  const settings = resolveRedisSettings({
    REDIS_URL: 'rediss://default:secret@example.upstash.io:6379',
    INSTANCE_ID: 'ezprep',
  });

  let service: StudentSessionService;

  const sessionKeyOf = (sid: string) => keys.key('session', sid);
  const readRecord = (sid: string) => JSON.parse(store.get(sessionKeyOf(sid))!);
  const writeRecord = (sid: string, record: unknown) =>
    store.set(sessionKeyOf(sid), JSON.stringify(record));

  beforeEach(() => {
    store.clear();
    sets.clear();
    expireCalls.length = 0;
    jest.clearAllMocks();
    service = new StudentSessionService(
      settings,
      registry as never,
      keys as never,
    );
  });

  describe('create', () => {
    it('creates a web session with a sid-bound refresh token', async () => {
      const created = await service.create({ userId: 'user-1', client: 'web' });

      expect(created.expiresInSec).toBe(WEB_SESSION_IDLE_TTL_SEC);
      expect(created.refreshToken.startsWith(`${created.sid}.`)).toBe(true);
      // Only a hash of the secret is stored.
      expect(store.get(sessionKeyOf(created.sid))).not.toContain(
        created.refreshToken,
      );
      const active = await service.assertActive(created.sid, 'user-1');
      expect(active?.userId).toBe('user-1');
    });

    it('uses the mobile idle window for mobile sessions', async () => {
      const created = await service.create({
        userId: 'user-1',
        client: 'mobile',
      });
      expect(created.expiresInSec).toBe(MOBILE_SESSION_IDLE_TTL_SEC);
    });
  });

  describe('refresh', () => {
    it('rotates the token and keeps the same session', async () => {
      const created = await service.create({ userId: 'user-1', client: 'web' });
      const next = await service.refresh(created.refreshToken);

      expect(next?.sid).toBe(created.sid);
      expect(next?.refreshToken).not.toBe(created.refreshToken);
      expect(next?.expiresInSec).toBe(WEB_ACCESS_TTL_SEC);
      // The new token keeps working.
      expect(await service.refresh(next!.refreshToken)).not.toBeNull();
    });

    it('issues a short access lifetime for mobile', async () => {
      const created = await service.create({
        userId: 'user-1',
        client: 'mobile',
      });
      const next = await service.refresh(created.refreshToken);
      expect(next?.expiresInSec).toBe(MOBILE_ACCESS_TTL_SEC);
    });

    it('slides the web idle window forward on refresh', async () => {
      const created = await service.create({ userId: 'user-1', client: 'web' });
      // Pretend the user has been away 20 days (session half used).
      const record = readRecord(created.sid);
      record.createdAt = new Date(Date.now() - 20 * DAY_MS).toISOString();
      record.expiresAt = new Date(Date.now() + 10 * DAY_MS).toISOString();
      writeRecord(created.sid, record);

      const next = await service.refresh(created.refreshToken);
      const remainingDays = (next!.expiresAt.getTime() - Date.now()) / DAY_MS;
      expect(remainingDays).toBeGreaterThan(29.9);
      expect(remainingDays).toBeLessThanOrEqual(30);
    });

    it.each([
      ['web', WEB_SESSION_ABSOLUTE_TTL_SEC],
      ['mobile', MOBILE_SESSION_ABSOLUTE_TTL_SEC],
    ] as const)(
      'never slides a %s session past its absolute cap',
      async (client, absoluteSec) => {
        const created = await service.create({ userId: 'user-1', client });
        const record = readRecord(created.sid);
        // 10 days of absolute lifetime remain.
        record.createdAt = new Date(
          Date.now() - (absoluteSec * 1000 - 10 * DAY_MS),
        ).toISOString();
        writeRecord(created.sid, record);

        const next = await service.refresh(created.refreshToken);
        const remainingDays = (next!.expiresAt.getTime() - Date.now()) / DAY_MS;
        expect(remainingDays).toBeLessThanOrEqual(10);
        expect(remainingDays).toBeGreaterThan(9.9);
      },
    );

    it('revokes and refuses once the absolute cap has passed', async () => {
      const created = await service.create({ userId: 'user-1', client: 'web' });
      const record = readRecord(created.sid);
      record.createdAt = new Date(
        Date.now() - (WEB_SESSION_ABSOLUTE_TTL_SEC * 1000 + DAY_MS),
      ).toISOString();
      writeRecord(created.sid, record);

      expect(await service.refresh(created.refreshToken)).toBeNull();
      expect(store.has(sessionKeyOf(created.sid))).toBe(false);
    });

    it('rejects malformed, foreign and unknown tokens without side effects', async () => {
      const created = await service.create({ userId: 'user-1', client: 'web' });
      expect(await service.refresh('')).toBeNull();
      expect(await service.refresh('not-a-token')).toBeNull();
      expect(
        await service.refresh(`${created.sid}.${'x'.repeat(64)}`),
      ).toBeNull();
      expect(
        await service.refresh(
          `00000000-0000-4000-8000-000000000000.${'x'.repeat(64)}`,
        ),
      ).toBeNull();
      // The real session survives forged attempts.
      expect(await service.refresh(created.refreshToken)).not.toBeNull();
    });

    describe('grace window and reuse detection', () => {
      it('accepts the just-rotated token once more within the grace window', async () => {
        const created = await service.create({
          userId: 'user-1',
          client: 'mobile',
        });
        const first = await service.refresh(created.refreshToken);
        // Response lost: the client retries with the token it still holds.
        const retry = await service.refresh(created.refreshToken);

        expect(retry).not.toBeNull();
        expect(retry?.sid).toBe(created.sid);
        // Both issued tokens stay usable within grace; the session survives.
        expect(await service.refresh(retry!.refreshToken)).not.toBeNull();
        expect(first).not.toBeNull();
      });

      it('treats a rotated-out token replayed after the grace window as theft', async () => {
        const created = await service.create({
          userId: 'user-1',
          client: 'web',
        });
        const next = await service.refresh(created.refreshToken);
        const record = readRecord(created.sid);
        record.previousRefreshes[0].rotatedAt =
          Date.now() - REFRESH_GRACE_MS - 1000;
        writeRecord(created.sid, record);

        expect(await service.refresh(created.refreshToken)).toBeNull();
        // The session is gone, including for the legitimate newest token.
        expect(await service.refresh(next!.refreshToken)).toBeNull();
        expect(await service.assertActive(created.sid, 'user-1')).toBeNull();
      });

      it('does not report theft as handled when the revoke itself fails', async () => {
        const created = await service.create({
          userId: 'user-1',
          client: 'web',
        });
        await service.refresh(created.refreshToken);
        const record = readRecord(created.sid);
        record.previousRefreshes[0].rotatedAt =
          Date.now() - REFRESH_GRACE_MS - 1000;
        writeRecord(created.sid, record);

        const failing = {
          del() {
            return this;
          },
          srem() {
            return this;
          },
          exec: async () => [[new Error('READONLY'), null]],
        };
        redis.pipeline.mockImplementationOnce(() => failing as never);

        // Must surface as 503 so the stolen session is not silently left alive.
        await expect(service.refresh(created.refreshToken)).rejects.toThrow(
          ServiceUnavailableException,
        );
        expect(store.has(sessionKeyOf(created.sid))).toBe(true);
      });

      it('survives two refreshes racing with the same token', async () => {
        const created = await service.create({
          userId: 'user-1',
          client: 'mobile',
        });
        const [a, b] = await Promise.all([
          service.refresh(created.refreshToken),
          service.refresh(created.refreshToken),
        ]);

        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(
          await service.assertActive(created.sid, 'user-1'),
        ).not.toBeNull();
        // Whichever token the store holds as current still refreshes.
        const tokens = [a!.refreshToken, b!.refreshToken];
        const results = await Promise.all(
          tokens.map(token => service.refresh(token)),
        );
        expect(results.some(result => result !== null)).toBe(true);
      });

      it('caps remembered previous tokens', async () => {
        const created = await service.create({
          userId: 'user-1',
          client: 'web',
        });
        let token = created.refreshToken;
        for (let i = 0; i < 15; i += 1) {
          token = (await service.refresh(token))!.refreshToken;
        }
        expect(readRecord(created.sid).previousRefreshes).toHaveLength(10);
      });
    });
  });

  it('never shortens the per-user session set when a shorter session logs in', async () => {
    await service.create({ userId: 'user-1', client: 'mobile' });
    await service.create({ userId: 'user-1', client: 'web' });
    const ttls = expireCalls.map(([, ttl]) => ttl);
    expect(new Set(ttls).size).toBe(1);
    expect(ttls[0]).toBe(MOBILE_SESSION_ABSOLUTE_TTL_SEC);
  });

  describe('revoke', () => {
    it('revokes only the targeted session', async () => {
      const a = await service.create({ userId: 'user-1', client: 'web' });
      const b = await service.create({ userId: 'user-1', client: 'mobile' });

      await service.revoke(a.sid, 'user-1');

      expect(await service.assertActive(a.sid, 'user-1')).toBeNull();
      expect((await service.assertActive(b.sid, 'user-1'))?.sid).toBe(b.sid);
    });

    it('revokes by refresh token (current or rotated-out) but not by a forged one', async () => {
      const created = await service.create({ userId: 'user-1', client: 'web' });
      await service.revokeByRefreshToken(`${created.sid}.${'x'.repeat(64)}`);
      expect(store.has(sessionKeyOf(created.sid))).toBe(true);

      const next = await service.refresh(created.refreshToken);
      await service.revokeByRefreshToken(created.refreshToken); // rotated-out
      expect(store.has(sessionKeyOf(created.sid))).toBe(false);
      expect(next).not.toBeNull();
    });
  });

  describe('touchActivity', () => {
    it('throttles activity touches', async () => {
      const created = await service.create({ userId: 'user-1', client: 'web' });
      const first = await service.touchActivity(created.sid, 'user-1');
      const second = await service.touchActivity(created.sid, 'user-1');
      expect(first.shouldUpdateMongo).toBe(true);
      expect(second.shouldUpdateMongo).toBe(false);
    });

    it('does not roll back a rotation that happens during the touch', async () => {
      const created = await service.create({ userId: 'user-1', client: 'web' });
      // A refresh lands between the touch reading the record and writing it.
      redis.get.mockImplementationOnce(async (key: string) => {
        const stale = store.get(key) ?? null;
        await service.refresh(created.refreshToken);
        return stale;
      });

      await service.touchActivity(created.sid, 'user-1');

      const record = readRecord(created.sid);
      expect(record.previousRefreshes).toHaveLength(1); // rotation survived
    });
  });

  describe('when Redis is unavailable (fails closed)', () => {
    it('refuses to create a session', async () => {
      registry.create.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      await expect(
        service.create({ userId: 'user-1', client: 'web' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('refuses to create a session when the write fails', async () => {
      const failing = {
        set() {
          return this;
        },
        sadd() {
          return this;
        },
        expire() {
          return this;
        },
        exec: async () => [[new Error('READONLY'), null]],
      };
      redis.pipeline.mockImplementationOnce(() => failing as never);
      await expect(
        service.create({ userId: 'user-1', client: 'web' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('does not trust an unknown sid when Redis cannot answer', async () => {
      redis.get.mockRejectedValueOnce(new Error('timeout'));
      await expect(
        service.assertActive('sid-not-cached', 'user-1'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('reports an outage on refresh as 503, not as an invalid token', async () => {
      const created = await service.create({ userId: 'user-1', client: 'web' });
      redis.get.mockRejectedValueOnce(new Error('timeout'));
      await expect(service.refresh(created.refreshToken)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('is not configured at all: refuses rather than skipping the check', async () => {
      const unconfigured = new StudentSessionService(
        resolveRedisSettings({}),
        registry as never,
        keys as never,
      );
      await expect(
        unconfigured.create({ userId: 'user-1', client: 'web' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('retries the connection after a failed connect instead of caching the failure', async () => {
      const lazy = {
        ...redis,
        status: 'wait',
        connect: jest
          .fn()
          .mockRejectedValueOnce(new Error('ECONNREFUSED'))
          .mockResolvedValue(undefined),
        disconnect: jest.fn(),
      };
      registry.create
        .mockReturnValueOnce(lazy as never)
        .mockReturnValueOnce(lazy as never);

      await expect(
        service.create({ userId: 'user-1', client: 'web' }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(lazy.disconnect).toHaveBeenCalled();

      const created = await service.create({ userId: 'user-1', client: 'web' });
      expect(created.sid).toBeTruthy();
    });
  });
});
