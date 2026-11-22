/* eslint-disable prettier/prettier */
import {
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { GoogleSignInDto } from './dto/google-sign-in.dto';
import { GoogleMobileSignInDto } from './dto/google-mobile-sign-in.dto';
import { OtpIdentityStrategy } from './identity/otp-identity.strategy';
import { GoogleIdentityStrategy } from './identity/google-identity.strategy';
import { GoogleCodeExchangeService } from './identity/google-code-exchange.service';
import { StudentAccountResolver } from './identity/student-account.resolver';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { StudentSessionService } from './session/student-session.service';
import { AuthClient } from './session/session.types';
import { sessionPolicyFor } from './session/session.constants';
import { parseCorsOrigins } from '../common/config/security.config';

export interface JwtPayload {
  sub: string; // user id
  phoneNumber?: string;
  username?: string;
  role: string;
  /** Student Redis session id. Absent on admin and legacy student tokens. */
  sid?: string;
  iat?: number;
  exp?: number;
}

export interface StudentSessionRequestMeta {
  userAgent?: string;
  ip?: string;
  /** Browser Origin when present; used to force web session semantics. */
  origin?: string;
}

/** Login/refresh result; web sets HttpOnly refresh via refreshCookie. */
export interface StudentAuthResult {
  response: AuthResponseDto;
  refreshCookie?: { token: string; maxAgeSec: number };
}

/**
 * Errors that keep their own status: bad credentials stay 401, and a
 * session-store outage stays 503. Anything else is reported as a generic 401.
 */
function isPassThroughAuthError(error: unknown): boolean {
  return (
    error instanceof UnauthorizedException ||
    error instanceof ServiceUnavailableException
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly otpIdentity: OtpIdentityStrategy,
    private readonly googleCodes: GoogleCodeExchangeService,
    private readonly googleIdentity: GoogleIdentityStrategy,
    private readonly studentAccounts: StudentAccountResolver,
    private readonly studentSessions: StudentSessionService,
  ) {}

  /**
   * Verify OTP access token and authenticate user
   * This method handles both login and signup in a single flow
   * @param verifyOtpDto - Contains the access token from MSG91 widget
   * @returns AuthResponseDto with JWT token and user information
   */
  async verifyOtpAndAuthenticate(
    verifyOtpDto: VerifyOtpDto,
    meta: StudentSessionRequestMeta = {},
  ): Promise<StudentAuthResult> {
    try {
      this.logger.log('Starting OTP verification and authentication process');
      const identity = await this.otpIdentity.verify(verifyOtpDto.accessToken);
      const { user, isNewUser } = await this.studentAccounts.resolve(identity);
      return await this.issueStudentSession(
        user,
        isNewUser,
        this.resolveStudentClient(verifyOtpDto.client, meta.origin, 'web'),
        meta,
      );
    } catch (error) {
      if (isPassThroughAuthError(error)) {
        throw error;
      }

      this.logger.error(
        'Unexpected error during authentication:',
        error.message,
      );
      throw new UnauthorizedException('Authentication failed');
    }
  }

  /**
   * Exchange a Google authorization code, verify the ID token Google returns,
   * then issue the same student JWT used by OTP login.
   * A token supplied by the browser is never accepted in place of that check.
   */
  async signInWithGoogle(
    dto: GoogleSignInDto,
    meta: StudentSessionRequestMeta = {},
  ): Promise<StudentAuthResult> {
    try {
      const idToken = await this.googleCodes.exchange({
        code: dto.code,
        redirectUri: dto.redirectUri,
        codeVerifier: dto.codeVerifier,
      });
      const identity = await this.googleIdentity.verify(idToken);
      const { user, isNewUser } = await this.studentAccounts.resolve(identity);
      return await this.issueStudentSession(
        user,
        isNewUser,
        this.resolveStudentClient(dto.client, meta.origin, 'web'),
        meta,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Unexpected error during Google sign-in:', error.message);
      throw new UnauthorizedException('Authentication failed');
    }
  }

  /**
   * Mobile-only Google sign-in. Verifies the SDK ID token with Google and
   * issues the same student JWT. The web code + PKCE endpoint is not used.
   * Defaults client to mobile (90d session) unless overridden.
   */
  async signInWithGoogleIdToken(
    dto: GoogleMobileSignInDto,
    meta: StudentSessionRequestMeta = {},
  ): Promise<StudentAuthResult> {
    try {
      const identity = await this.googleIdentity.verifyMobile(dto.idToken);
      const { user, isNewUser } = await this.studentAccounts.resolve(identity);
      return await this.issueStudentSession(
        user,
        isNewUser,
        this.resolveStudentClient(dto.client, meta.origin, 'mobile'),
        meta,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Unexpected error during mobile Google sign-in');
      throw new UnauthorizedException('Authentication failed');
    }
  }

  /** Rotate refresh and issue a new access token. */
  async refreshStudentSession(refreshToken: string): Promise<StudentAuthResult> {
    const rotated = await this.studentSessions.refresh(refreshToken);
    if (!rotated) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findOne(rotated.userId);
    if (!user.isActive) {
      await this.studentSessions.revoke(rotated.sid, rotated.userId);
      throw new UnauthorizedException('Account is deactivated');
    }

    const jwtPayload: JwtPayload = {
      sub: user.id,
      role: user.role,
      sid: rotated.sid,
    };
    if (user.phoneNumber) {
      jwtPayload.phoneNumber = user.phoneNumber;
    }

    const accessToken = this.jwtService.sign(jwtPayload, {
      expiresIn: rotated.expiresInSec,
    });

    const sessionRemainingSec = Math.max(
      1,
      Math.floor((rotated.expiresAt.getTime() - Date.now()) / 1000),
    );

    const isWeb = rotated.client === 'web';

    return {
      response: new AuthResponseDto(accessToken, user, false, {
        refreshToken: isWeb ? undefined : rotated.refreshToken,
        expiresIn: rotated.expiresInSec,
      }),
      refreshCookie: isWeb
        ? { token: rotated.refreshToken, maxAgeSec: sessionRemainingSec }
        : undefined,
    };
  }

  /**
   * Revoke the current student Redis session. Idempotent.
   * Revokes the access token's session and, when present, the refresh cookie's session.
   * Admin tokens and legacy JWTs without sid are a no-op for the JWT path.
   */
  async logoutStudent(
    payload?: JwtPayload,
    refreshToken?: string,
  ): Promise<void> {
    if (payload?.sid && payload.role !== UserRole.ADMIN) {
      await this.studentSessions.revoke(payload.sid, payload.sub);
    }
    // Also revoke the cookie's session: a stale Bearer from another session
    // must not leave the live refresh credential valid. Already-gone sessions
    // cost one GET and no-op.
    if (refreshToken) {
      await this.studentSessions.revokeByRefreshToken(refreshToken);
    }
  }

  /**
   * Read the session claims from a Bearer header for logout. The signature is
   * verified but expiry is ignored, and no Redis/Mongo lookup happens, so an
   * expired, revoked or store-outage session can still be signed out.
   */
  readBearerPayload(authorization?: string): JwtPayload | undefined {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
    if (!match) {
      return undefined;
    }
    try {
      return this.jwtService.verify<JwtPayload>(match[1], {
        ignoreExpiration: true,
      });
    } catch {
      return undefined;
    }
  }

  /**
   * Browser origins listed in CORS_ORIGINS cannot opt into mobile session
   * semantics (JSON refresh + long access). Native apps typically send no Origin.
   */
  resolveStudentClient(
    requested: AuthClient | undefined,
    origin: string | undefined,
    fallback: AuthClient = 'web',
  ): AuthClient {
    if (origin) {
      const allowed = parseCorsOrigins(process.env.CORS_ORIGINS);
      if (allowed.includes(origin)) {
        return 'web';
      }
    }
    return requested || fallback;
  }

  private async issueStudentSession(
    user: UserResponseDto,
    isNewUser: boolean,
    client: AuthClient,
    meta: StudentSessionRequestMeta,
  ): Promise<StudentAuthResult> {
    const session = await this.studentSessions.create({
      userId: user.id,
      client,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });

    const jwtPayload: JwtPayload = {
      sub: user.id,
      role: user.role,
      sid: session.sid,
    };
    if (user.phoneNumber) {
      jwtPayload.phoneNumber = user.phoneNumber;
    }

    const accessExpiresIn = Math.min(
      sessionPolicyFor(client).accessTtlSec,
      session.expiresInSec,
    );
    const accessToken = this.jwtService.sign(jwtPayload, {
      expiresIn: accessExpiresIn,
    });

    this.logger.log(
      `Student session created for user ${user.id} client=${session.client} sid=${session.sid} isNewUser=${isNewUser}`,
    );

    const isWeb = client === 'web';
    return {
      response: new AuthResponseDto(accessToken, user, isNewUser, {
        refreshToken: isWeb ? undefined : session.refreshToken,
        expiresIn: accessExpiresIn,
      }),
      refreshCookie: isWeb
        ? { token: session.refreshToken, maxAgeSec: session.expiresInSec }
        : undefined,
    };
  }

  /**
   * Create an admin account (username + password).
   * The first admin may be created with no token (bootstrap).
   * After that, only an authenticated admin may create more.
   */
  async createAdmin(
    dto: CreateAdminDto,
    actor?: UserResponseDto,
  ): Promise<UserResponseDto> {
    if (actor && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only an existing admin can create another admin',
      );
    }

    const passwordAdminCount = await this.usersService.countPasswordAdmins();
    if (passwordAdminCount > 0 && actor?.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only an existing admin can create another admin',
      );
    }

    const admin = await this.usersService.createAdmin(dto);
    this.logger.log(`Admin account created: ${admin.username} (${admin.id})`);
    return admin;
  }

  /**
   * Username/password login for admin accounts only.
   */
  async loginAdmin(dto: AdminLoginDto): Promise<AuthResponseDto> {
    const userDoc = await this.usersService.findByUsernameForAuth(dto.username);

    if (
      !userDoc ||
      userDoc.role !== UserRole.ADMIN ||
      !userDoc.passwordHash ||
      !userDoc.isActive
    ) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      userDoc.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const user = await this.usersService.findOne(userDoc._id.toString());
    const jwtPayload: JwtPayload = {
      sub: user.id,
      phoneNumber: user.phoneNumber,
      username: user.username,
      role: user.role,
    };
    const accessToken = this.jwtService.sign(jwtPayload, {
      expiresIn: '30d',
    });

    this.logger.log(`Admin login successful: ${user.username} (${user.id})`);
    return new AuthResponseDto(accessToken, user, false);
  }

  /**
   * Validate JWT token and return user payload
   * Used by JWT strategy for route protection
   * @param payload - JWT payload
   * @returns User information if valid
   */
  async validateJwtPayload(payload: JwtPayload): Promise<UserResponseDto> {
    try {
      this.logger.log(`Validating JWT payload for user: ${payload.sub}`);

      const user = await this.usersService.findOne(payload.sub);

      if (!user.isActive) {
        this.logger.warn(`Inactive user attempted to use JWT: ${payload.sub}`);
        throw new UnauthorizedException('Account is deactivated');
      }

      // Admin tokens never use Redis sessions.
      if (user.role === UserRole.ADMIN || payload.role === UserRole.ADMIN) {
        return user;
      }

      // Student tokens must carry a sid that maps to a live Redis session.
      // Tokens without one (pre-session era) are no longer accepted.
      if (!payload.sid) {
        throw new UnauthorizedException('Session has ended');
      }

      const session = await this.studentSessions.assertActive(
        payload.sid,
        payload.sub,
      );
      if (!session) {
        throw new UnauthorizedException('Session has ended');
      }

      const touch = await this.studentSessions.touchActivity(
        payload.sid,
        payload.sub,
      );
      if (touch.shouldUpdateMongo) {
        void this.usersService.touchLastActiveAt(payload.sub).catch(error => {
          this.logger.warn(
            `Failed to touch lastActiveAt for ${payload.sub}: ${error?.message}`,
          );
        });
      }

      return user;
    } catch (error) {
      if (isPassThroughAuthError(error)) {
        throw error;
      }
      this.logger.error('JWT payload validation failed:', error.message);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
