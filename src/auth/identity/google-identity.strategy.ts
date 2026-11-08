import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenPayload } from 'google-auth-library';
import { GoogleIdTokenVerifier } from './google-id-token.verifier';
import {
  StudentAuthProvider,
  VerifiedStudentIdentity,
} from './verified-student-identity';

const GOOGLE_ISSUERS = new Set([
  'accounts.google.com',
  'https://accounts.google.com',
]);

@Injectable()
export class GoogleIdentityStrategy {
  constructor(
    private readonly configService: ConfigService,
    private readonly verifier: GoogleIdTokenVerifier,
  ) {}

  async verify(idToken: string): Promise<VerifiedStudentIdentity> {
    const audiences = readGoogleClientIds(this.configService);
    if (audiences.length === 0) {
      throw new ServiceUnavailableException('Google sign-in is not configured');
    }

    const payload = await this.verifier.verify(idToken, audiences);
    assertGooglePayload(payload, audiences);
    return identityFromPayload(payload);
  }

  /**
   * Verifies an ID token from the mobile Google Sign-In SDK.
   * Audience stays the web client id. The Android client is the `azp` and is
   * not required to equal the web client id.
   */
  async verifyMobile(idToken: string): Promise<VerifiedStudentIdentity> {
    const audiences = readGoogleClientIds(this.configService);
    if (audiences.length === 0) {
      throw new ServiceUnavailableException('Google sign-in is not configured');
    }

    const payload = await this.verifier.verify(idToken, audiences);
    assertGooglePayload(payload, audiences, {
      androidClientIds: readGoogleAndroidClientIds(this.configService),
    });
    return identityFromPayload(payload);
  }
}

function identityFromPayload(payload: TokenPayload): VerifiedStudentIdentity {
  return {
    provider: StudentAuthProvider.GOOGLE,
    googleSub: payload.sub,
    email: payload.email!.trim().toLowerCase(),
    name: displayNameFromGoogle(payload.name, payload.email),
    avatarUrl: safeHttpsAvatar(payload.picture),
  };
}

export function readGoogleClientIds(configService: ConfigService): string[] {
  const combined = [
    configService.get<string>('GOOGLE_CLIENT_IDS'),
    configService.get<string>('GOOGLE_CLIENT_ID'),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(',');

  const seen = new Set<string>();
  for (const part of combined.split(',')) {
    const id = part.trim();
    if (id) {
      seen.add(id);
    }
  }
  return [...seen];
}

export function readGoogleAndroidClientIds(
  configService: ConfigService,
): string[] {
  const raw = configService.get<string>('GOOGLE_ANDROID_CLIENT_IDS') ?? '';
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id) {
      seen.add(id);
    }
  }
  return [...seen];
}

export function assertGooglePayload(
  payload: TokenPayload,
  audiences: string[],
  options?: { androidClientIds?: string[] },
): void {
  if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) {
    throw new UnauthorizedException('Invalid Google sign-in');
  }

  const audClaim = payload.aud;
  const auds = Array.isArray(audClaim) ? audClaim : audClaim ? [audClaim] : [];
  if (!auds.some(aud => audiences.includes(aud))) {
    throw new UnauthorizedException('Invalid Google sign-in');
  }

  const androidClientIds = options?.androidClientIds ?? [];
  if (payload.azp) {
    const azpAllowed =
      audiences.includes(payload.azp) || androidClientIds.includes(payload.azp);
    const allowUnlistedAndroidClient =
      options !== undefined && androidClientIds.length === 0;
    if (!azpAllowed && !allowUnlistedAndroidClient) {
      throw new UnauthorizedException('Invalid Google sign-in');
    }
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub || sub.length > 255) {
    throw new UnauthorizedException('Invalid Google sign-in');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new UnauthorizedException(
      'Google did not share a verified email address',
    );
  }

  if (payload.email_verified !== true) {
    throw new UnauthorizedException('Google email address is not verified');
  }
}

export function displayNameFromGoogle(
  name?: string | null,
  email?: string | null,
): string {
  const cleaned = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (cleaned.length >= 1) {
    return cleaned;
  }

  const local = (email ?? '').split('@')[0]?.trim().slice(0, 100);
  if (local && local.length >= 2) {
    return local;
  }

  return 'ExamFlex User';
}

export function safeHttpsAvatar(url?: string | null): string | undefined {
  if (!url || url.length > 2048) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}
