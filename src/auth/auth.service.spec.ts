import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { Msg91Service } from './services/msg91.service';
import { OtpIdentityStrategy } from './identity/otp-identity.strategy';
import { GoogleIdentityStrategy } from './identity/google-identity.strategy';
import { GoogleCodeExchangeService } from './identity/google-code-exchange.service';
import { StudentAccountResolver } from './identity/student-account.resolver';
import { StudentAuthProvider } from './identity/verified-student-identity';
import { StudentSessionService } from './session/student-session.service';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '../common/enums/user-role.enum';
import {
  mockJwtService,
  mockMsg91Service,
  mockUsers,
} from '../../test/fixtures';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;
  let msg91Service: Msg91Service;

  // Mock UsersService
  const mockUsersService = {
    findByPhone: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
    countPasswordAdmins: jest.fn(),
    createAdmin: jest.fn(),
    findByUsernameForAuth: jest.fn(),
    findAuthByGoogleSub: jest.fn(),
    findAuthByEmail: jest.fn(),
    createGoogleUser: jest.fn(),
    linkGoogleAccount: jest.fn(),
    updateEmailIfAvailable: jest.fn(),
    touchLastActiveAt: jest.fn(),
  };

  const mockGoogleIdentity = {
    verify: jest.fn(),
    verifyMobile: jest.fn(),
  };

  const mockGoogleCodes = {
    exchange: jest.fn(),
  };

  const mockStudentSessions = {
    create: jest.fn(),
    assertActive: jest.fn(),
    touchActivity: jest.fn(),
    refresh: jest.fn(),
    revoke: jest.fn(),
    revokeByRefreshToken: jest.fn(),
    isDegraded: jest.fn().mockReturnValue(false),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: Msg91Service,
          useValue: mockMsg91Service,
        },
        OtpIdentityStrategy,
        StudentAccountResolver,
        {
          provide: GoogleIdentityStrategy,
          useValue: mockGoogleIdentity,
        },
        {
          provide: GoogleCodeExchangeService,
          useValue: mockGoogleCodes,
        },
        {
          provide: StudentSessionService,
          useValue: mockStudentSessions,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);
    msg91Service = module.get<Msg91Service>(Msg91Service);

    // Reset all mocks before each test
    jest.clearAllMocks();
    mockStudentSessions.create.mockResolvedValue({
      sid: 'sid-1',
      refreshToken: 'refresh-1',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      expiresInSec: 7 * 24 * 60 * 60,
      client: 'web',
    });
    mockStudentSessions.assertActive.mockResolvedValue({
      sid: 'sid-1',
      userId: mockUsers.validStudent.id,
      expiresAt: new Date(Date.now() + 60_000),
      client: 'web',
      fromCache: true,
    });
    mockStudentSessions.touchActivity.mockResolvedValue({
      shouldUpdateMongo: false,
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('verifyOtpAndAuthenticate', () => {
    const validDto = {
      accessToken: 'test-access-token',
    };

    describe('existing user login', () => {
      it('should authenticate existing user successfully', async () => {
        const existingUser = mockUsers.validStudent;

        mockMsg91Service.verifyAccessToken.mockResolvedValue('+1234567890');
        mockUsersService.findByPhone.mockResolvedValue(existingUser);
        mockJwtService.sign.mockReturnValue('mock-jwt-token');

        const result = await service.verifyOtpAndAuthenticate(validDto);

        expect(msg91Service.verifyAccessToken).toHaveBeenCalledWith(
          validDto.accessToken,
        );
        expect(usersService.findByPhone).toHaveBeenCalledWith('+1234567890');
        expect(jwtService.sign).toHaveBeenCalledWith(
          {
            sub: existingUser.id,
            phoneNumber: existingUser.phoneNumber,
            role: existingUser.role,
            sid: 'sid-1',
          },
          { expiresIn: 15 * 60 },
        );
        expect(result.response.user).toEqual(existingUser);
        expect(result.response.accessToken).toBe('mock-jwt-token');
        expect(result.response.refreshToken).toBeUndefined();
        expect(result.refreshCookie?.token).toBe('refresh-1');
      });

      it('should throw UnauthorizedException for inactive user', async () => {
        const inactiveUser = { ...mockUsers.inactiveUser, isActive: false };

        mockMsg91Service.verifyAccessToken.mockResolvedValue('+1234567893');
        mockUsersService.findByPhone.mockResolvedValue(inactiveUser);

        await expect(
          service.verifyOtpAndAuthenticate(validDto),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('should reject admin accounts on OTP login', async () => {
        mockMsg91Service.verifyAccessToken.mockResolvedValue('+1234567892');
        mockUsersService.findByPhone.mockResolvedValue({
          ...mockUsers.validAdmin,
          role: UserRole.ADMIN,
          isActive: true,
        });

        await expect(
          service.verifyOtpAndAuthenticate(validDto),
        ).rejects.toThrow(/username and password/);
      });
    });

    describe('new user registration', () => {
      it('should register new user successfully', async () => {
        const newUser = mockUsers.validStudent;

        mockMsg91Service.verifyAccessToken.mockResolvedValue('+1234567890');
        mockUsersService.findByPhone.mockResolvedValue(null);
        mockUsersService.create.mockResolvedValue(newUser);
        mockJwtService.sign.mockReturnValue('mock-jwt-token');

        const result = await service.verifyOtpAndAuthenticate(validDto);

        expect(usersService.create).toHaveBeenCalledWith(
          expect.objectContaining({
            phoneNumber: '+1234567890',
          }),
        );
        expect(result.response.user).toEqual(newUser);
        expect(result.response.accessToken).toBe('mock-jwt-token');
        expect(result.response.isNewUser).toBe(true);
      });

      it('should handle user creation failure', async () => {
        mockMsg91Service.verifyAccessToken.mockResolvedValue('+1234567890');
        mockUsersService.findByPhone.mockResolvedValue(null);
        mockUsersService.create.mockRejectedValue(new Error('Creation failed'));

        await expect(
          service.verifyOtpAndAuthenticate(validDto),
        ).rejects.toThrow(UnauthorizedException);
      });
    });

    describe('OTP verification failures', () => {
      it('should throw UnauthorizedException for invalid OTP', async () => {
        mockMsg91Service.verifyAccessToken.mockResolvedValue(null);

        await expect(
          service.verifyOtpAndAuthenticate(validDto),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('should handle MSG91 service errors during verification', async () => {
        mockMsg91Service.verifyAccessToken.mockRejectedValue(
          new Error('Verification failed'),
        );

        await expect(
          service.verifyOtpAndAuthenticate(validDto),
        ).rejects.toThrow(UnauthorizedException);
      });
    });
  });

  describe('signInWithGoogle', () => {
    const dto = {
      code: 'auth-code',
      redirectUri: 'http://localhost:3001',
      codeVerifier: 'a'.repeat(43),
    };
    const googleUser = {
      ...mockUsers.validStudent,
      email: 'student@gmail.com',
      phoneNumber: undefined,
    };

    beforeEach(() => {
      mockGoogleCodes.exchange.mockResolvedValue('header.payload.signature');
    });

    it('verifies the ID token returned by Google, not a token from the browser', async () => {
      mockGoogleIdentity.verify.mockResolvedValue({
        provider: StudentAuthProvider.GOOGLE,
        googleSub: 'google-sub-1',
        email: 'student@gmail.com',
        name: 'Student',
      });
      mockUsersService.findAuthByGoogleSub.mockResolvedValue({
        user: googleUser,
        googleSub: 'google-sub-1',
      });
      mockJwtService.sign.mockReturnValue('mock-jwt-token');

      const result = await service.signInWithGoogle(dto);

      expect(mockGoogleCodes.exchange).toHaveBeenCalledWith({
        code: dto.code,
        redirectUri: dto.redirectUri,
        codeVerifier: dto.codeVerifier,
      });
      expect(mockGoogleIdentity.verify).toHaveBeenCalledWith(
        'header.payload.signature',
      );
      expect(result.response.accessToken).toBe('mock-jwt-token');
      expect(result.response.isNewUser).toBe(false);
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: googleUser.id,
          role: googleUser.role,
          sid: 'sid-1',
        }),
        { expiresIn: 15 * 60 },
      );
      expect(result.refreshCookie?.token).toBe('refresh-1');
    });

    it('does not create an account when the ID token is rejected', async () => {
      mockGoogleIdentity.verify.mockRejectedValue(
        new UnauthorizedException('Invalid Google sign-in'),
      );

      await expect(service.signInWithGoogle(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUsersService.findAuthByGoogleSub).not.toHaveBeenCalled();
      expect(mockUsersService.createGoogleUser).not.toHaveBeenCalled();
    });

    it('preserves conflict errors from account linking', async () => {
      mockGoogleIdentity.verify.mockResolvedValue({
        provider: StudentAuthProvider.GOOGLE,
        googleSub: 'new-sub',
        email: 'taken@gmail.com',
      });
      mockUsersService.findAuthByGoogleSub.mockResolvedValue(null);
      mockUsersService.findAuthByEmail.mockResolvedValue({
        user: { ...googleUser, isActive: true, role: UserRole.USER },
        googleSub: 'other-sub',
      });

      await expect(service.signInWithGoogle(dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('wraps unexpected failures', async () => {
      mockGoogleCodes.exchange.mockRejectedValue(new Error('network'));

      await expect(service.signInWithGoogle(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('signInWithGoogleIdToken', () => {
    const dto = { idToken: 'mobile-id-token' };
    const googleUser = {
      ...mockUsers.validStudent,
      email: 'student@gmail.com',
      phoneNumber: undefined,
    };

    it('verifies the mobile ID token and does not exchange an authorization code', async () => {
      mockGoogleIdentity.verifyMobile.mockResolvedValue({
        provider: StudentAuthProvider.GOOGLE,
        googleSub: 'google-sub-1',
        email: 'student@gmail.com',
        name: 'Student',
      });
      mockUsersService.findAuthByGoogleSub.mockResolvedValue({
        user: googleUser,
        googleSub: 'google-sub-1',
      });
      mockJwtService.sign.mockReturnValue('mock-jwt-token');

      const result = await service.signInWithGoogleIdToken(dto);

      expect(mockGoogleCodes.exchange).not.toHaveBeenCalled();
      expect(mockGoogleIdentity.verify).not.toHaveBeenCalled();
      expect(mockGoogleIdentity.verifyMobile).toHaveBeenCalledWith(dto.idToken);
      expect(result.response.accessToken).toBe('mock-jwt-token');
    });

    it('does not create an account when the ID token is rejected', async () => {
      mockGoogleIdentity.verifyMobile.mockRejectedValue(
        new UnauthorizedException('Invalid Google sign-in'),
      );

      await expect(service.signInWithGoogleIdToken(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUsersService.findAuthByGoogleSub).not.toHaveBeenCalled();
    });
  });

  describe('createAdmin', () => {
    const dto = {
      name: 'Site Admin',
      username: 'siteadmin',
      password: 'long-pass',
    };

    it('bootstraps the first admin without an actor', async () => {
      mockUsersService.countPasswordAdmins.mockResolvedValue(0);
      mockUsersService.createAdmin.mockResolvedValue({
        id: 'a1',
        username: 'siteadmin',
      });

      const result = await service.createAdmin(dto);

      expect(result.username).toBe('siteadmin');
    });

    it('forbids a non-admin actor', async () => {
      await expect(
        service.createAdmin(dto, mockUsers.validStudent as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('forbids bootstrap after an admin already exists', async () => {
      mockUsersService.countPasswordAdmins.mockResolvedValue(1);

      await expect(service.createAdmin(dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows an existing admin to create another', async () => {
      mockUsersService.countPasswordAdmins.mockResolvedValue(1);
      mockUsersService.createAdmin.mockResolvedValue({
        id: 'a2',
        username: 'second',
      });

      const result = await service.createAdmin(dto, {
        ...mockUsers.validAdmin,
        role: UserRole.ADMIN,
      } as never);

      expect(result.username).toBe('second');
    });
  });

  describe('loginAdmin', () => {
    const dto = { username: 'admin', password: 'secret' };

    it('authenticates an active admin with a matching password', async () => {
      mockUsersService.findByUsernameForAuth.mockResolvedValue({
        _id: { toString: () => mockUsers.validAdmin.id },
        role: UserRole.ADMIN,
        passwordHash: 'hash',
        isActive: true,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockUsersService.findOne.mockResolvedValue({
        ...mockUsers.validAdmin,
        role: UserRole.ADMIN,
        username: 'admin',
      });
      mockJwtService.sign.mockReturnValue('admin-jwt');

      const result = await service.loginAdmin(dto);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'admin',
          role: UserRole.ADMIN,
        }),
        { expiresIn: '30d' },
      );
      expect(result.accessToken).toBe('admin-jwt');
      expect(result.isNewUser).toBe(false);
    });

    it('rejects unknown, inactive, or non-admin users', async () => {
      mockUsersService.findByUsernameForAuth.mockResolvedValue(null);
      await expect(service.loginAdmin(dto)).rejects.toThrow(
        UnauthorizedException,
      );

      mockUsersService.findByUsernameForAuth.mockResolvedValue({
        role: UserRole.USER,
        passwordHash: 'hash',
        isActive: true,
      });
      await expect(service.loginAdmin(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a wrong password', async () => {
      mockUsersService.findByUsernameForAuth.mockResolvedValue({
        _id: { toString: () => 'id' },
        role: UserRole.ADMIN,
        passwordHash: 'hash',
        isActive: true,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.loginAdmin(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('validateJwtPayload', () => {
    it('should validate JWT payload successfully', async () => {
      const user = mockUsers.validStudent;
      const payload = {
        sub: user.id,
        phoneNumber: user.phoneNumber,
        role: user.role,
        sid: 'sid-1',
      };
      mockUsersService.findOne.mockResolvedValue(user);

      const result = await service.validateJwtPayload(payload);

      expect(usersService.findOne).toHaveBeenCalledWith(payload.sub);
      expect(result).toEqual(user);
      expect(mockStudentSessions.assertActive).toHaveBeenCalledWith(
        'sid-1',
        user.id,
      );
    });

    it('rejects a student token without a sid', async () => {
      const user = mockUsers.validStudent;
      mockUsersService.findOne.mockResolvedValue(user);

      await expect(
        service.validateJwtPayload({ sub: user.id, role: user.role }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockStudentSessions.assertActive).not.toHaveBeenCalled();
    });

    it('reports a deleted user as 401, not 404', async () => {
      mockUsersService.findOne.mockRejectedValue(new NotFoundException());

      await expect(
        service.validateJwtPayload({
          sub: 'gone',
          role: 'student',
          sid: 'sid-1',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('passes a session-store outage through as 503, not 401', async () => {
      const user = mockUsers.validStudent;
      mockUsersService.findOne.mockResolvedValue(user);
      mockStudentSessions.assertActive.mockRejectedValue(
        new ServiceUnavailableException(),
      );

      await expect(
        service.validateJwtPayload({
          sub: user.id,
          role: user.role,
          sid: 'sid-1',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('requires a live Redis session when sid is present', async () => {
      const user = mockUsers.validStudent;
      mockUsersService.findOne.mockResolvedValue(user);
      mockStudentSessions.assertActive.mockResolvedValue(null);

      await expect(
        service.validateJwtPayload({
          sub: user.id,
          role: user.role,
          sid: 'sid-1',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('skips Redis for admin tokens', async () => {
      const admin = { ...mockUsers.validAdmin, role: UserRole.ADMIN };
      mockUsersService.findOne.mockResolvedValue(admin);

      const result = await service.validateJwtPayload({
        sub: admin.id,
        role: UserRole.ADMIN,
        sid: 'should-be-ignored',
      });

      expect(result).toEqual(admin);
      expect(mockStudentSessions.assertActive).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for invalid user ID', async () => {
      const payload = {
        sub: 'invalid-id',
        phoneNumber: '+1234567890',
        role: 'USER',
      };
      mockUsersService.findOne.mockRejectedValue(new Error('User not found'));

      await expect(service.validateJwtPayload(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for inactive user', async () => {
      const inactiveUser = { ...mockUsers.inactiveUser, isActive: false };
      const payload = {
        sub: inactiveUser.id,
        phoneNumber: inactiveUser.phoneNumber,
        role: inactiveUser.role,
      };
      mockUsersService.findOne.mockResolvedValue(inactiveUser);

      await expect(service.validateJwtPayload(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle database errors gracefully', async () => {
      mockUsersService.findByPhone.mockRejectedValue(
        new Error('Database connection failed'),
      );
      mockMsg91Service.verifyAccessToken.mockResolvedValue('+1234567890');

      await expect(
        service.verifyOtpAndAuthenticate({
          accessToken: 'test-token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should handle JWT signing errors', async () => {
      const user = mockUsers.validStudent;

      mockMsg91Service.verifyAccessToken.mockResolvedValue('+1234567890');
      mockUsersService.findByPhone.mockResolvedValue(user);
      mockJwtService.sign.mockImplementation(() => {
        throw new Error('JWT signing failed');
      });

      await expect(
        service.verifyOtpAndAuthenticate({
          accessToken: 'test-token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('resolveStudentClient', () => {
    it('forces web when Origin is an allowed CORS browser origin', () => {
      process.env.CORS_ORIGINS = 'https://ezprep.in,https://www.ezprep.in';
      expect(
        service.resolveStudentClient('mobile', 'https://www.ezprep.in', 'web'),
      ).toBe('web');
    });

    it('honours requested client when Origin is absent (native)', () => {
      expect(service.resolveStudentClient('mobile', undefined, 'web')).toBe(
        'mobile',
      );
    });
  });

  describe('logoutStudent', () => {
    it('revokes by sid when access payload is present', async () => {
      await service.logoutStudent({
        sub: mockUsers.validStudent.id,
        role: UserRole.USER,
        sid: 'sid-1',
      });
      expect(mockStudentSessions.revoke).toHaveBeenCalledWith(
        'sid-1',
        mockUsers.validStudent.id,
      );
    });

    it('revokes both the bearer session and the cookie session', async () => {
      mockStudentSessions.revokeByRefreshToken = jest.fn();
      await service.logoutStudent(
        { sub: mockUsers.validStudent.id, role: UserRole.USER, sid: 'sid-1' },
        'cookie-refresh',
      );
      expect(mockStudentSessions.revoke).toHaveBeenCalledWith(
        'sid-1',
        mockUsers.validStudent.id,
      );
      expect(mockStudentSessions.revokeByRefreshToken).toHaveBeenCalledWith(
        'cookie-refresh',
      );
    });

    it('revokes by refresh token when access JWT is missing', async () => {
      mockStudentSessions.revokeByRefreshToken = jest.fn();
      await service.logoutStudent(undefined, 'cookie-refresh');
      expect(mockStudentSessions.revokeByRefreshToken).toHaveBeenCalledWith(
        'cookie-refresh',
      );
    });
  });

  describe('readBearerPayload', () => {
    it('returns claims for a signed token even when it has expired', () => {
      mockJwtService.verify = jest
        .fn()
        .mockReturnValue({ sub: 'u1', role: 'student', sid: 'sid-1' });
      expect(service.readBearerPayload('Bearer abc.def.ghi')).toEqual({
        sub: 'u1',
        role: 'student',
        sid: 'sid-1',
      });
      expect(mockJwtService.verify).toHaveBeenCalledWith('abc.def.ghi', {
        ignoreExpiration: true,
      });
    });

    it('returns undefined for missing, malformed or forged tokens', () => {
      mockJwtService.verify = jest.fn(() => {
        throw new Error('invalid signature');
      });
      expect(service.readBearerPayload(undefined)).toBeUndefined();
      expect(service.readBearerPayload('Basic abc')).toBeUndefined();
      expect(service.readBearerPayload('Bearer forged')).toBeUndefined();
    });
  });

  describe('refreshStudentSession', () => {
    it('returns a web cookie and omits refreshToken from JSON', async () => {
      mockStudentSessions.refresh.mockResolvedValue({
        sid: 'sid-1',
        refreshToken: 'rotated-rt',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        expiresInSec: 15 * 60,
        client: 'web',
        userId: mockUsers.validStudent.id,
      });
      mockUsersService.findOne.mockResolvedValue(mockUsers.validStudent);
      mockJwtService.sign.mockReturnValue('next-access');

      const result = await service.refreshStudentSession('old-rt');

      expect(result.response.accessToken).toBe('next-access');
      expect(result.response.refreshToken).toBeUndefined();
      expect(result.refreshCookie?.token).toBe('rotated-rt');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sid: 'sid-1' }),
        { expiresIn: 15 * 60 },
      );
    });

    it('keeps refreshToken in JSON for mobile', async () => {
      mockStudentSessions.refresh.mockResolvedValue({
        sid: 'sid-m',
        refreshToken: 'mobile-rt',
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        expiresInSec: 90 * 24 * 60 * 60,
        client: 'mobile',
        userId: mockUsers.validStudent.id,
      });
      mockUsersService.findOne.mockResolvedValue(mockUsers.validStudent);
      mockJwtService.sign.mockReturnValue('mobile-access');

      const result = await service.refreshStudentSession('old-mobile-rt');

      expect(result.response.refreshToken).toBe('mobile-rt');
      expect(result.refreshCookie).toBeUndefined();
    });
  });

  describe('integration scenarios', () => {
    it('should handle concurrent authentication requests', async () => {
      const user = mockUsers.validStudent;
      mockMsg91Service.verifyAccessToken.mockResolvedValue('+1234567890');
      mockUsersService.findByPhone.mockResolvedValue(user);
      mockJwtService.sign.mockReturnValue('mock-jwt-token');

      const requests = Array(5)
        .fill(null)
        .map(() =>
          service.verifyOtpAndAuthenticate({
            accessToken: 'test-token',
          }),
        );

      const results = await Promise.all(requests);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.response.accessToken).toBe('mock-jwt-token');
        expect(result.response.user).toEqual(user);
      });
    });

    it('should maintain phone number format consistency', async () => {
      const phoneVariations = ['+1234567890', '1234567890', '+91-9876543210'];

      for (const phone of phoneVariations) {
        mockMsg91Service.verifyAccessToken.mockResolvedValue(phone);
        mockUsersService.findByPhone.mockResolvedValue(null);
        mockUsersService.create.mockResolvedValue(mockUsers.validStudent);

        await service.verifyOtpAndAuthenticate({
          accessToken: 'test-token',
        });

        expect(usersService.create).toHaveBeenCalledWith(
          expect.objectContaining({ phoneNumber: phone }),
        );
      }
    });
  });
});
