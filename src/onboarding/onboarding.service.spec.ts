import {
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  const msg91 = {
    verifyAccessToken: jest.fn(),
    verifyEmailAccessToken: jest.fn(),
  };
  const users = {
    setVerifiedPhone: jest.fn(),
    setVerifiedEmail: jest.fn(),
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

  describe('verifyEmail', () => {
    it('attaches the address MSG91 reports, never one from the client', async () => {
      msg91.verifyEmailAccessToken.mockResolvedValue('riya@example.com');
      users.setVerifiedEmail.mockResolvedValue({ id: 'u1' });

      await expect(service.verifyEmail('u1', 'token')).resolves.toEqual({
        id: 'u1',
      });

      expect(msg91.verifyEmailAccessToken).toHaveBeenCalledWith('token');
      expect(msg91.verifyAccessToken).not.toHaveBeenCalled();
      expect(users.setVerifiedEmail).toHaveBeenCalledWith(
        'u1',
        'riya@example.com',
      );
    });

    it('turns an invalid/expired token into 400, not 401', async () => {
      msg91.verifyEmailAccessToken.mockRejectedValue(
        new HttpException('Invalid', HttpStatus.UNAUTHORIZED),
      );
      const error = await service
        .verifyEmail('u1', 'bad')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        error: 'OTP_VERIFICATION_FAILED',
      });
      expect(users.setVerifiedEmail).not.toHaveBeenCalled();
    });

    it('reports a MSG91 outage as 503', async () => {
      msg91.verifyEmailAccessToken.mockRejectedValue(new Error('network'));
      await expect(service.verifyEmail('u1', 't')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('propagates the "already linked" conflict', async () => {
      msg91.verifyEmailAccessToken.mockResolvedValue('taken@example.com');
      users.setVerifiedEmail.mockRejectedValue(new Error('EMAIL_IN_USE'));
      await expect(service.verifyEmail('u1', 't')).rejects.toThrow(
        'EMAIL_IN_USE',
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
