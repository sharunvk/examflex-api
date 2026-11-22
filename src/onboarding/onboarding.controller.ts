import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AllowIncompleteProfile } from '../auth/decorators/allow-incomplete-profile.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { VerifyPhoneDto } from './dto/verify-phone.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('onboarding')
@ApiBearerAuth('JWT-auth')
@Controller('users/me')
@UseGuards(JwtAuthGuard)
@AllowIncompleteProfile()
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('phone/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Verify and attach a mobile number',
    description:
      'Takes the access token from the MSG91 OTP widget, verifies it with MSG91 and attaches the verified number to the caller. The number is read from MSG91, never from the request.',
  })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid or expired verification' })
  @ApiConflictResponse({
    description:
      'Number belongs to another account, or the account already has a different verified number',
  })
  async verifyPhone(
    @GetUser() user: UserResponseDto,
    @Body() dto: VerifyPhoneDto,
  ): Promise<{ message: string; data: UserResponseDto }> {
    const data = await this.onboarding.verifyPhone(user.id, dto.accessToken);
    return { message: 'Mobile number verified', data };
  }

  @Post('onboarding')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Finish first-run setup',
    description:
      'Saves the learner name and their one target exam and marks onboarding complete. Requires a verified mobile number.',
  })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid name or exam' })
  @ApiForbiddenResponse({ description: 'Mobile number not verified yet' })
  async complete(
    @GetUser() user: UserResponseDto,
    @Body() dto: CompleteOnboardingDto,
  ): Promise<{ message: string; data: UserResponseDto }> {
    const data = await this.onboarding.completeOnboarding(user.id, dto);
    return { message: 'Profile completed', data };
  }
}
