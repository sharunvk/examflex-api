import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    verifyOtpAndAuthenticate: jest.fn(),
    signInWithGoogle: jest.fn(),
    signInWithGoogleIdToken: jest.fn(),
    refreshStudentSession: jest.fn(),
    logoutStudent: jest.fn(),
    createAdmin: jest.fn(),
    loginAdmin: jest.fn(),
  };

  const mockReq = {
    headers: { 'user-agent': 'jest', origin: 'http://localhost:3001' },
    ip: '127.0.0.1',
  } as never;

  const mockRes = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as never;

  beforeEach(async () => {
    process.env.CORS_ORIGINS = 'http://localhost:3001';
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('verifyOtp', () => {
    const validDto = {
      accessToken: 'test-access-token',
    };

    it('should verify OTP and set refresh cookie for web', async () => {
      const authResponse = {
        accessToken: 'new-jwt-token',
        isNewUser: false,
        user: { id: '1' },
      };
      mockAuthService.verifyOtpAndAuthenticate.mockResolvedValue({
        response: authResponse,
        refreshCookie: { token: 'rt', maxAgeSec: 3600 },
      });

      const result = await controller.verifyOtp(validDto, mockReq, mockRes);

      expect(result).toEqual({
        message: 'Authentication successful',
        data: authResponse,
      });
      expect(authService.verifyOtpAndAuthenticate).toHaveBeenCalledWith(
        validDto,
        expect.objectContaining({ userAgent: 'jest', ip: '127.0.0.1' }),
      );
      expect((mockRes as { cookie: jest.Mock }).cookie).toHaveBeenCalled();
    });

    it('should handle authentication failure', async () => {
      mockAuthService.verifyOtpAndAuthenticate.mockRejectedValue(
        new UnauthorizedException('Invalid OTP'),
      );

      await expect(
        controller.verifyOtp(validDto, mockReq, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should use the new-user success message', async () => {
      mockAuthService.verifyOtpAndAuthenticate.mockResolvedValue({
        response: {
          accessToken: 'jwt',
          isNewUser: true,
          user: { id: '1' },
        },
      });

      const result = await controller.verifyOtp(validDto, mockReq, mockRes);

      expect(result.message).toBe(
        'Account created and authenticated successfully',
      );
    });
  });

  describe('signInWithGoogle', () => {
    const dto = {
      code: 'auth-code',
      redirectUri: 'http://localhost:3001',
      codeVerifier: 'a'.repeat(43),
    };

    it('should authenticate an existing Google user', async () => {
      const authResponse = {
        accessToken: 'jwt',
        isNewUser: false,
        user: { id: '1' },
      };
      mockAuthService.signInWithGoogle.mockResolvedValue({
        response: authResponse,
        refreshCookie: { token: 'rt', maxAgeSec: 3600 },
      });

      const result = await controller.signInWithGoogle(dto, mockReq, mockRes);

      expect(authService.signInWithGoogle).toHaveBeenCalledWith(
        dto,
        expect.objectContaining({ userAgent: 'jest' }),
      );
      expect(result).toEqual({
        message: 'Authentication successful',
        data: authResponse,
      });
    });
  });

  describe('createAdmin', () => {
    it('should create an admin and wrap the result', async () => {
      const dto = {
        name: 'Admin',
        username: 'admin',
        password: 'password1',
      };
      const admin = { id: 'a1', username: 'admin' };
      mockAuthService.createAdmin.mockResolvedValue(admin);

      const result = await controller.createAdmin(dto, undefined);

      expect(authService.createAdmin).toHaveBeenCalledWith(dto, undefined);
      expect(result).toEqual({
        message: 'Admin created successfully',
        data: admin,
      });
    });
  });

  describe('loginAdmin', () => {
    it('should wrap the admin auth response', async () => {
      const dto = { username: 'admin', password: 'secret' };
      const authResponse = {
        accessToken: 'jwt',
        isNewUser: false,
        user: { id: 'a1' },
      };
      mockAuthService.loginAdmin.mockResolvedValue(authResponse);

      const result = await controller.loginAdmin(dto);

      expect(result).toEqual({
        message: 'Authentication successful',
        data: authResponse,
      });
    });
  });

  describe('refresh', () => {
    it('refreshes from body for mobile and does not require Origin', async () => {
      const authResponse = {
        accessToken: 'next',
        refreshToken: 'rt2',
        expiresIn: 3600,
        isNewUser: false,
        user: { id: '1' },
      };
      mockAuthService.refreshStudentSession.mockResolvedValue({
        response: authResponse,
      });
      const req = { headers: { cookie: '' }, ip: '127.0.0.1' } as never;

      const result = await controller.refresh(
        { refreshToken: 'mobile-refresh-token-value' },
        req,
        mockRes,
      );

      expect(result.data).toEqual(authResponse);
      expect(authService.refreshStudentSession).toHaveBeenCalledWith(
        'mobile-refresh-token-value',
      );
    });

    it('refreshes from cookie and sets a new cookie', async () => {
      process.env.NODE_ENV = 'test';
      mockAuthService.refreshStudentSession.mockResolvedValue({
        response: {
          accessToken: 'next',
          expiresIn: 900,
          isNewUser: false,
          user: { id: '1' },
        },
        refreshCookie: { token: 'rotated', maxAgeSec: 1000 },
      });
      const req = {
        headers: {
          cookie: 'examflex_rt=old-refresh',
          origin: 'http://localhost:3001',
        },
        ip: '127.0.0.1',
      } as never;

      await controller.refresh({}, req, mockRes);

      expect(authService.refreshStudentSession).toHaveBeenCalledWith(
        'old-refresh',
      );
      expect((mockRes as { cookie: jest.Mock }).cookie).toHaveBeenCalled();
    });

    it('rejects cookie refresh from an evil origin', async () => {
      process.env.NODE_ENV = 'production';
      const req = {
        headers: {
          cookie: 'examflex_rt=old-refresh',
          origin: 'https://evil.example',
        },
        ip: '127.0.0.1',
      } as never;

      await expect(controller.refresh({}, req, mockRes)).rejects.toThrow();
      expect(authService.refreshStudentSession).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('clears the refresh cookie and revokes via cookie when JWT is absent', async () => {
      const req = {
        headers: {
          origin: 'http://localhost:3001',
          cookie: 'examflex_rt=still-valid-refresh',
        },
        ip: '127.0.0.1',
      } as never;

      const result = await controller.logout(undefined, req, mockRes);

      expect(result.message).toBe('Logged out');
      expect(authService.logoutStudent).toHaveBeenCalledWith(
        undefined,
        'still-valid-refresh',
      );
      expect(
        (mockRes as { clearCookie: jest.Mock }).clearCookie,
      ).toHaveBeenCalled();
    });
  });
});
