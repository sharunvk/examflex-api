import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from '../auth.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  const mockAuthService = {
    validateJwtPayload: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn().mockReturnValue('test-secret'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  it('should return the user when payload is valid', async () => {
    const payload = { sub: '1', phoneNumber: '+1', role: 'user', sid: 's1' };
    const user = { id: '1' };
    mockAuthService.validateJwtPayload.mockResolvedValue(user);

    await expect(strategy.validate(payload as never)).resolves.toEqual(user);
    expect(mockAuthService.validateJwtPayload).toHaveBeenCalledWith(payload);
  });

  it('should throw UnauthorizedException when user is missing', async () => {
    mockAuthService.validateJwtPayload.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'missing' } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
