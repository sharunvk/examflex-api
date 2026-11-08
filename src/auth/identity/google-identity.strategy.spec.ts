import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { TokenPayload } from 'google-auth-library';
import {
  GoogleIdentityStrategy,
  assertGooglePayload,
  displayNameFromGoogle,
  readGoogleClientIds,
  safeHttpsAvatar,
} from './google-identity.strategy';
import { StudentAuthProvider } from './verified-student-identity';

describe('GoogleIdentityStrategy', () => {
  const verifier = { verify: jest.fn() };
  const config = { get: jest.fn() };
  const strategy = new GoogleIdentityStrategy(
    config as unknown as ConfigService,
    verifier as never,
  );

  const audiences = ['web.apps.googleusercontent.com'];

  function payload(overrides: Record<string, unknown> = {}): TokenPayload {
    return {
      iss: 'https://accounts.google.com',
      aud: audiences[0],
      sub: 'google-sub',
      email: 'Student@Gmail.com',
      email_verified: true,
      azp: audiences[0],
      name: 'Asha Nair',
      picture: 'https://lh3.googleusercontent.com/a',
      iat: 1,
      exp: 2,
      ...overrides,
    } as TokenPayload;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation((key: string) =>
      key === 'GOOGLE_CLIENT_IDS' ? audiences.join(',') : undefined,
    );
  });

  it('reads comma-separated client ids from either env var without duplicates', () => {
    const service = {
      get: (key: string) => {
        if (key === 'GOOGLE_CLIENT_IDS') {
          return ' web.apps.googleusercontent.com, android.apps.googleusercontent.com ';
        }
        if (key === 'GOOGLE_CLIENT_ID') {
          return 'web.apps.googleusercontent.com, ios.apps.googleusercontent.com';
        }
        return undefined;
      },
    } as ConfigService;

    expect(readGoogleClientIds(service)).toEqual([
      'web.apps.googleusercontent.com',
      'android.apps.googleusercontent.com',
      'ios.apps.googleusercontent.com',
    ]);
    expect(
      readGoogleClientIds({ get: () => '  ' } as unknown as ConfigService),
    ).toEqual([]);
    expect(
      readGoogleClientIds({ get: () => undefined } as unknown as ConfigService),
    ).toEqual([]);
  });

  it('verifies the ID token against the configured audiences', async () => {
    verifier.verify.mockResolvedValue(payload());

    const identity = await strategy.verify('id-token');

    expect(verifier.verify).toHaveBeenCalledWith('id-token', audiences);
    expect(identity).toEqual({
      provider: StudentAuthProvider.GOOGLE,
      googleSub: 'google-sub',
      email: 'student@gmail.com',
      name: 'Asha Nair',
      avatarUrl: 'https://lh3.googleusercontent.com/a',
    });
  });

  it('fails closed when Google sign-in is not configured', async () => {
    config.get.mockReturnValue(undefined);

    await expect(strategy.verify('id-token')).rejects.toThrow(/not configured/);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects tokens that fail Googles required claims', () => {
    expect(() =>
      assertGooglePayload(payload({ iss: 'https://evil.example' }), audiences),
    ).toThrow(UnauthorizedException);

    expect(() =>
      assertGooglePayload(payload({ aud: 'other-client' }), audiences),
    ).toThrow(UnauthorizedException);

    expect(() =>
      assertGooglePayload(payload({ azp: 'other-client' }), audiences),
    ).toThrow(UnauthorizedException);

    expect(() =>
      assertGooglePayload(
        payload({ azp: 'android.apps.googleusercontent.com' }),
        audiences,
        { androidClientIds: ['android.apps.googleusercontent.com'] },
      ),
    ).not.toThrow();

    expect(() =>
      assertGooglePayload(
        payload({ azp: 'android.apps.googleusercontent.com' }),
        audiences,
        { androidClientIds: [] },
      ),
    ).not.toThrow();

    expect(() =>
      assertGooglePayload(payload({ sub: '  ' }), audiences),
    ).toThrow(UnauthorizedException);

    expect(() =>
      assertGooglePayload(
        payload({ aud: undefined, azp: undefined }),
        audiences,
      ),
    ).toThrow(UnauthorizedException);

    expect(() =>
      assertGooglePayload(payload({ sub: 'x'.repeat(256) }), audiences),
    ).toThrow(UnauthorizedException);

    expect(() =>
      assertGooglePayload(payload({ iss: undefined }), audiences),
    ).toThrow(UnauthorizedException);

    expect(() => assertGooglePayload(payload({ sub: 12 }), audiences)).toThrow(
      UnauthorizedException,
    );

    expect(() =>
      assertGooglePayload(payload({ email: null }), audiences),
    ).toThrow(/verified email/);

    expect(() =>
      assertGooglePayload(payload({ email: 'not-an-email' }), audiences),
    ).toThrow(/verified email/);

    expect(() =>
      assertGooglePayload(payload({ email_verified: false }), audiences),
    ).toThrow(/not verified/);
  });

  it('accepts the accounts.google.com issuer and an audience array', () => {
    expect(() =>
      assertGooglePayload(
        payload({
          iss: 'accounts.google.com',
          aud: audiences,
          azp: undefined,
        }),
        audiences,
      ),
    ).not.toThrow();
  });

  it('builds a display name and ignores unsafe avatars', () => {
    expect(displayNameFromGoogle(null, 'asha.nair@gmail.com')).toBe(
      'asha.nair',
    );
    expect(displayNameFromGoogle(null, null)).toBe('ExamFlex User');
    expect(displayNameFromGoogle('  ', 'asha.nair@gmail.com')).toBe(
      'asha.nair',
    );
    expect(displayNameFromGoogle('', 'a@gmail.com')).toBe('ExamFlex User');
    expect(displayNameFromGoogle('  Asha   Nair  ')).toBe('Asha Nair');
    expect(safeHttpsAvatar('http://example.com/a.png')).toBeUndefined();
    expect(safeHttpsAvatar('not a url')).toBeUndefined();
    expect(
      safeHttpsAvatar(`https://example.com/${'a'.repeat(2100)}`),
    ).toBeUndefined();
    expect(safeHttpsAvatar(null)).toBeUndefined();
  });

  it('drops a non-https picture from the verified identity', async () => {
    verifier.verify.mockResolvedValue(
      payload({ picture: 'http://evil.example/a.png', name: '' }),
    );

    const identity = await strategy.verify('id-token');

    expect(identity.avatarUrl).toBeUndefined();
    expect(identity.name).toBe('Student');
  });
});
