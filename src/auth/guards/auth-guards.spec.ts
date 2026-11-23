import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { AuthService } from '../auth.service';

describe('Auth Guards and Strategies', () => {
  let jwtAuthGuard: JwtAuthGuard;
  let rolesGuard: RolesGuard;
  let jwtStrategy: JwtStrategy;
  let authService: AuthService;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
    get: jest.fn(),
  };

  const mockAuthService = {
    validateJwtPayload: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockUser = {
    id: '507f1f77bcf86cd799439011',
    name: 'John Doe',
    email: 'john@example.com',
    phoneNumber: '+1234567890',
    role: 'user',
    isActive: true,
  };

  beforeEach(async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret';
      return null;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        RolesGuard,
        JwtStrategy,
        {
          provide: Reflector,
          useValue: mockReflector,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    jwtAuthGuard = module.get<JwtAuthGuard>(JwtAuthGuard);
    rolesGuard = module.get<RolesGuard>(RolesGuard);
    jwtStrategy = module.get<JwtStrategy>(JwtStrategy);
    authService = module.get<AuthService>(AuthService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('JwtAuthGuard', () => {
    it('should be defined', () => {
      expect(jwtAuthGuard).toBeDefined();
    });
  });

  describe('RolesGuard', () => {
    const mockExecutionContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          user: mockUser,
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;

    it('should be defined', () => {
      expect(rolesGuard).toBeDefined();
    });

    it('should allow access when no roles are required', async () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);

      const result = await rolesGuard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should allow access when user has required role', async () => {
      mockReflector.getAllAndOverride.mockReturnValue(['user']);

      const result = await rolesGuard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should deny access when user does not have required role', async () => {
      mockReflector.getAllAndOverride.mockReturnValue(['admin']);

      const result = await rolesGuard.canActivate(mockExecutionContext);

      expect(result).toBe(false);
    });
  });

  describe('JwtStrategy', () => {
    it('should be defined', () => {
      expect(jwtStrategy).toBeDefined();
    });

    it('should validate JWT payload successfully', async () => {
      const payload = {
        sub: mockUser.id,
        phoneNumber: mockUser.phoneNumber,
        role: mockUser.role,
      };
      mockAuthService.validateJwtPayload.mockResolvedValue(mockUser);

      const result = await jwtStrategy.validate(payload);

      expect(result).toEqual(mockUser);
      expect(authService.validateJwtPayload).toHaveBeenCalledWith(payload);
    });

    it('should throw UnauthorizedException for invalid payload', async () => {
      const payload = {
        sub: 'invalid-id',
        phoneNumber: 'invalid-phone',
        role: 'invalid-role',
      };
      mockAuthService.validateJwtPayload.mockRejectedValue(
        new UnauthorizedException(),
      );

      await expect(jwtStrategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
