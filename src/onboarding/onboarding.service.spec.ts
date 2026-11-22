import {
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  const msg91 = { verifyAccessToken: jest.fn() };
  const users = {
    setVerifiedPhone: jest.fn(),
    completeOnboarding: jest.fn(),
  };
  let service: OnboardingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OnboardingService(msg91 as never, users as never);
  });

  describe('verifyPhone', () => {
    it('attaches the number MSG91 reports, never one from the client', async () => {
      msg91.verifyAccessToken.mockResolvedValue('+919876543210');
      users.setVerifiedPhone.mockResolvedValue({ id: 'u1' });

      await service.verifyPhone('u1', 'token');

      expect(msg91.verifyAccessToken).toHaveBeenCalledWith('token');
      expect(users.setVerifiedPhone).toHaveBeenCalledWith(
        'u1',
        '+919876543210',
      );
    });

    it('turns an invalid/expired token into 400, not 401', async () => {
      msg91.verifyAccessToken.mockRejectedValue(
        new HttpException(
          'Invalid or expired access token',
          HttpStatus.UNAUTHORIZED,
        ),
      );
      const error = await service
        .verifyPhone('u1', 'bad')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect(users.setVerifiedPhone).not.toHaveBeenCalled();
    });

    it('reports a MSG91 outage as 503', async () => {
      msg91.verifyAccessToken.mockRejectedValue(
        new HttpException('boom', HttpStatus.INTERNAL_SERVER_ERROR),
      );
      await expect(service.verifyPhone('u1', 't')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('rejects an implausible number from MSG91', async () => {
      msg91.verifyAccessToken.mockResolvedValue('+1234');
      await expect(service.verifyPhone('u1', 't')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(users.setVerifiedPhone).not.toHaveBeenCalled();
    });

    it('propagates the "already linked" conflict', async () => {
      msg91.verifyAccessToken.mockResolvedValue('+919876543210');
      users.setVerifiedPhone.mockRejectedValue(new Error('PHONE_IN_USE'));
      await expect(service.verifyPhone('u1', 't')).rejects.toThrow(
        'PHONE_IN_USE',
      );
    });
  });

  it('completeOnboarding passes only name and exam through', async () => {
    users.completeOnboarding.mockResolvedValue({ id: 'u1' });
    await service.completeOnboarding('u1', {
      name: 'Rahul Sharma',
      targetExamId: 'e1',
    });
    expect(users.completeOnboarding).toHaveBeenCalledWith('u1', {
      name: 'Rahul Sharma',
      targetExamId: 'e1',
    });
  });
});
