/* eslint-disable prettier/prettier */
import {
  Controller,
  Post,
  Body,
  HttpStatus,
  HttpCode,
  UseGuards,
  Get,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, JwtPayload, StudentAuthResult } from './auth.service';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { GoogleSignInDto } from './dto/google-sign-in.dto';
import { GoogleMobileSignInDto } from './dto/google-mobile-sign-in.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { GetUser } from './decorators/get-user.decorator';
import { GetJwtPayload } from './decorators/get-jwt-payload.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import {
  assertCookieRequestOrigin,
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './session/auth-cookie';

@ApiTags('authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Verify OTP and authenticate user',
    description: `
    Verifies the access token received from MSG91 OTP widget and authenticates the user.
    Web clients receive an HttpOnly refresh cookie; mobile receives refreshToken in JSON.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'OTP verified successfully and user authenticated',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request data or missing access token',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token, or account deactivated',
  })
  async verifyOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    message: string;
    data: AuthResponseDto;
  }> {
    const result = await this.authService.verifyOtpAndAuthenticate(
      verifyOtpDto,
      this.sessionMeta(req),
    );
    this.applyRefreshCookie(res, result);

    const message = result.response.isNewUser
      ? 'Account created and authenticated successfully'
      : 'Authentication successful';

    return {
      message,
      data: result.response,
    };
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Sign in with Google',
    description: `
Verifies a Google authorization code and returns a student session.
Web: HttpOnly refresh cookie. Mobile body refresh is unused on this route.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Google sign-in succeeded',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Missing or malformed authorization code' })
  @ApiUnauthorizedResponse({
    description:
      'Invalid code, unrecognized redirect, bad ID token, or deactivated account',
  })
  @ApiConflictResponse({
    description: 'Email is already linked to a different Google account',
  })
  async signInWithGoogle(
    @Body() dto: GoogleSignInDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    message: string;
    data: AuthResponseDto;
  }> {
    const result = await this.authService.signInWithGoogle(
      dto,
      this.sessionMeta(req),
    );
    this.applyRefreshCookie(res, result);
    const message = result.response.isNewUser
      ? 'Account created and authenticated successfully'
      : 'Authentication successful';

    return {
      message,
      data: result.response,
    };
  }

  @Post('google/mobile')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Sign in with Google on the mobile app',
    description: `
Mobile-only. Verifies a Google ID token from the native Sign-In SDK.
Returns refreshToken in JSON (no HttpOnly cookie).
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Google sign-in succeeded',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Missing or malformed ID token' })
  @ApiUnauthorizedResponse({
    description: 'Invalid ID token, unverified email, or deactivated account',
  })
  @ApiConflictResponse({
    description: 'Email is already linked to a different Google account',
  })
  async signInWithGoogleMobile(
    @Body() dto: GoogleMobileSignInDto,
    @Req() req: Request,
  ): Promise<{
    message: string;
    data: AuthResponseDto;
  }> {
    const result = await this.authService.signInWithGoogleIdToken(
      dto,
      this.sessionMeta(req),
    );
    const message = result.response.isNewUser
      ? 'Account created and authenticated successfully'
      : 'Authentication successful';

    return {
      message,
      data: result.response,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Refresh a student access token',
    description:
      'Web: send HttpOnly examflex_rt cookie. Mobile: send refreshToken in JSON body. Rotates the refresh credential.',
  })
  @ApiResponse({
    status: 200,
    description: 'Tokens refreshed',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid, reused, or expired refresh token',
  })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    message: string;
    data: AuthResponseDto;
  }> {
    const fromCookie = readRefreshCookie(req);
    const refreshToken = fromCookie || dto.refreshToken;
    if (!refreshToken) {
      clearRefreshCookie(res);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (fromCookie) {
      assertCookieRequestOrigin(req);
    }

    try {
      const result = await this.authService.refreshStudentSession(refreshToken);
      this.applyRefreshCookie(res, result);
      return {
        message: 'Token refreshed',
        data: result.response,
      };
    } catch (error) {
      clearRefreshCookie(res);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Log out the current student session',
    description:
      'Revokes the Redis session bound to the access token (when present) and always clears the refresh cookie.',
  })
  @ApiResponse({ status: 200, description: 'Logged out' })
  async logout(
    @GetJwtPayload() payload: JwtPayload | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const refreshToken = readRefreshCookie(req);
    if (refreshToken) {
      assertCookieRequestOrigin(req);
    }
    await this.authService.logoutStudent(payload, refreshToken);
    clearRefreshCookie(res);
    return { message: 'Logged out' };
  }

  @Post('admins')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create an admin account',
    description: `
Creates an admin in the users collection (\`role: admin\`) with a username and password.

- **First admin (bootstrap):** no JWT required. Use this once from Postman.
- **Later admins:** send an existing admin JWT in \`Authorization: Bearer <token>\`.

OTP / student accounts are unchanged. Admins sign in via \`POST /auth/admin/login\`.
    `,
  })
  @ApiCreatedResponse({
    description: 'Admin created',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Username or email already in use' })
  @ApiForbiddenResponse({
    description: 'An admin already exists and the caller is not an admin',
  })
  async createAdmin(
    @Body() dto: CreateAdminDto,
    @GetUser() actor?: UserResponseDto,
  ): Promise<{ message: string; data: UserResponseDto }> {
    const admin = await this.authService.createAdmin(dto, actor);
    return {
      message: 'Admin created successfully',
      data: admin,
    };
  }

  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Admin username/password login',
    description:
      'Authenticates an admin account and returns a JWT. Student OTP login is unchanged (`POST /auth/verify-otp`).',
  })
  @ApiResponse({
    status: 200,
    description: 'Admin authenticated',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Invalid username or password' })
  async loginAdmin(@Body() dto: AdminLoginDto): Promise<{
    message: string;
    data: AuthResponseDto;
  }> {
    const authResponse = await this.authService.loginAdmin(dto);
    return {
      message: 'Authentication successful',
      data: authResponse,
    };
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Returns the profile information of the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: UserResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or missing JWT token',
  })
  async getProfile(@GetUser() user: UserResponseDto): Promise<{
    message: string;
    data: UserResponseDto;
  }> {
    return {
      message: 'Profile retrieved successfully',
      data: user,
    };
  }

  private applyRefreshCookie(res: Response, result: StudentAuthResult): void {
    if (result.refreshCookie) {
      setRefreshCookie(
        res,
        result.refreshCookie.token,
        result.refreshCookie.maxAgeSec,
      );
    }
  }

  private sessionMeta(req: Request) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : req.ip;
    const origin =
      typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    return {
      userAgent: req.headers['user-agent'],
      ip,
      origin,
    };
  }
}
