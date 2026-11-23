import {
  IsOptional,
  IsString,
  IsEnum,
  IsDateString,
  MinLength,
  MaxLength,
  IsMongoId,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { sanitizePersonName } from '../../common/person-name';
import { IsPersonName } from '../../common/validators/is-person-name.validator';
import { Gender } from '../../common/enums/gender.enum';
import { LocationDto } from './update-profile.dto';

/**
 * Unified DTO for the authenticated user to update their own profile.
 * Covers both core identity fields (name / email) and extended
 * profile fields (bio, avatar, location, target exam, etc.) in a single
 * request — so the frontend needs just one PATCH /users/me call.
 *
 * Note: the phone number is intentionally absent. It can only be set by
 * proving ownership with an OTP (POST /users/me/phone/verify). The email is
 * likewise only set through POST /users/me/email/verify; it stays on this DTO
 * so older clients that still send it get a clear EMAIL_VERIFICATION_REQUIRED.
 */
export class UpdateMeDto {
  // ── Core identity ─────────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Full name', example: 'Rahul Sharma' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @IsPersonName()
  @Transform(({ value }) =>
    typeof value === 'string' ? sanitizePersonName(value) : value,
  )
  name?: string;

  @ApiPropertyOptional({
    description:
      'Not accepted: always rejected with EMAIL_VERIFICATION_REQUIRED. Use POST /users/me/email/verify.',
    deprecated: true,
  })
  @IsOptional()
  email?: unknown;

  // ── Extended profile ──────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Short bio (max 500 characters)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({ description: 'Avatar / profile picture URL' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional({
    description: 'Date of birth (ISO 8601)',
    example: '2000-05-12',
  })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ description: 'Gender', enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ description: 'Location details', type: LocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;

  @ApiPropertyOptional({
    description:
      'Primary target exam id. Sets/reorders targetExams so this exam is first. Send null to clear all target exams. Prefer PUT /users/me/target-exams for multi-target edits.',
    example: '64f123456789abcdef123456',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsMongoId()
  targetExam?: string | null;

  @ApiPropertyOptional({
    description: 'Target exam date (ISO 8601)',
    example: '2026-06-15',
  })
  @IsOptional()
  @IsDateString()
  targetExamDate?: string;
}
