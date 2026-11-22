import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isValidPhoneNumber } from 'libphonenumber-js';
import { Msg91Service } from '../auth/services/msg91.service';
import { UsersService } from '../users/users.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly msg91: Msg91Service,
    private readonly users: UsersService,
  ) {}

  /**
   * Prove ownership of a mobile number with the MSG91 access token and attach it
   * to the caller. The number comes from MSG91's reply, never from the client.
   */
  async verifyPhone(
    userId: string,
    accessToken: string,
  ): Promise<UserResponseDto> {
    let phoneNumber: string;
    try {
      phoneNumber = await this.msg91.verifyAccessToken(accessToken);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        // Not 401: the web client treats 401 as "session expired" and would
        // needlessly rotate tokens and bounce the learner to login.
        throw new BadRequestException({
          statusCode: 400,
          error: 'OTP_VERIFICATION_FAILED',
          message:
            'We could not verify that code. It may have expired, so please request a new one.',
        });
      }
      this.logger.error(
        `MSG91 verification unavailable: ${(error as Error)?.message}`,
      );
      throw new ServiceUnavailableException(
        'Mobile verification is temporarily unavailable. Please try again shortly.',
      );
    }

    if (!isValidPhoneNumber(phoneNumber)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'OTP_VERIFICATION_FAILED',
        message: 'That mobile number is not valid.',
      });
    }

    return this.users.setVerifiedPhone(userId, phoneNumber);
  }

  /**
   * Prove ownership of an email address with the MSG91 email-OTP access token
   * and attach it to the caller. The address comes from MSG91's reply, never
   * from the client. Not a sign-in method: only for adding an email.
   */
  async verifyEmail(
    userId: string,
    accessToken: string,
  ): Promise<UserResponseDto> {
    let email: string;
    try {
      email = await this.msg91.verifyEmailAccessToken(accessToken);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        // Not 401: the web client treats 401 as "session expired".
        throw new BadRequestException({
          statusCode: 400,
          error: 'OTP_VERIFICATION_FAILED',
          message:
            'We could not verify that code. It may have expired, so please request a new one.',
        });
      }
      this.logger.error(
        `MSG91 email verification unavailable: ${(error as Error)?.message}`,
      );
      throw new ServiceUnavailableException(
        'Email verification is temporarily unavailable. Please try again shortly.',
      );
    }

    return this.users.setVerifiedEmail(userId, email);
  }

  completeOnboarding(
    userId: string,
    dto: CompleteOnboardingDto,
  ): Promise<UserResponseDto> {
    return this.users.completeOnboarding(userId, {
      name: dto.name,
      targetExamId: dto.targetExamId,
    });
  }
}
