import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import {
  COUNSELING_CATEGORY_MAX,
  COUNSELING_COURSE_MAX,
  COUNSELING_EMAIL_MAX,
  COUNSELING_EXPECTED_MARK_MAX,
  COUNSELING_PHONE_MAX,
  COUNSELING_PREFERRED_DAY_TIME_MAX,
  COUNSELING_STATE_MAX,
  COUNSELING_STUDENT_NAME_MAX,
  COUNSELING_TALK_ABOUT_MAX,
  COUNSELING_TWELFTH_MARKS_MAX,
} from '../counseling.constants';
import { CounselingWhoWillJoin } from '../enums/counseling-who-will-join.enum';

function trimToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

@ValidatorConstraint({ name: 'CounselingContactChannel', async: false })
export class CounselingContactChannelConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown, _args: ValidationArguments): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const contact = value as CreateCounselingContactDto;
    const emailOk =
      contact.emailEnabled === true &&
      typeof contact.email === 'string' &&
      contact.email.trim().length > 0;
    const phoneOk =
      contact.phoneEnabled === true &&
      typeof contact.phone === 'string' &&
      contact.phone.trim().length > 0;
    return emailOk || phoneOk;
  }

  defaultMessage(): string {
    return 'Pick email and/or phone and provide a value for each selected channel';
  }
}

export class CreateCounselingContactDto {
  @ApiProperty({
    description: 'Whether the student wants to be reached by email',
  })
  @IsBoolean()
  emailEnabled: boolean;

  @ApiPropertyOptional({ maxLength: COUNSELING_EMAIL_MAX })
  @IsOptional()
  @IsEmail()
  @MaxLength(COUNSELING_EMAIL_MAX)
  @Transform(({ value }) => trimToUndefined(value))
  email?: string;

  @ApiProperty({
    description: 'Whether the student wants to be reached by phone',
  })
  @IsBoolean()
  phoneEnabled: boolean;

  @ApiPropertyOptional({ maxLength: COUNSELING_PHONE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(COUNSELING_PHONE_MAX)
  @Transform(({ value }) => trimToUndefined(value))
  phone?: string;
}

export class CreateCounselingRequestDto {
  @ApiPropertyOptional({ maxLength: COUNSELING_STUDENT_NAME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(COUNSELING_STUDENT_NAME_MAX)
  @Transform(({ value }) => trimToUndefined(value))
  studentName?: string;

  @ApiProperty({ enum: CounselingWhoWillJoin })
  @IsEnum(CounselingWhoWillJoin)
  whoWillJoin: CounselingWhoWillJoin;

  @ApiPropertyOptional({ maxLength: COUNSELING_COURSE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(COUNSELING_COURSE_MAX)
  @Transform(({ value }) => trimToUndefined(value))
  courseInterestedIn?: string;

  @ApiPropertyOptional({ maxLength: COUNSELING_EXPECTED_MARK_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(COUNSELING_EXPECTED_MARK_MAX)
  @Transform(({ value }) => trimToUndefined(value))
  expectedMark?: string;

  @ApiPropertyOptional({ maxLength: COUNSELING_TWELFTH_MARKS_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(COUNSELING_TWELFTH_MARKS_MAX)
  @Transform(({ value }) => trimToUndefined(value))
  twelfthMarks?: string;

  @ApiPropertyOptional({ maxLength: COUNSELING_STATE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(COUNSELING_STATE_MAX)
  @Transform(({ value }) => trimToUndefined(value))
  state?: string;

  @ApiPropertyOptional({ maxLength: COUNSELING_CATEGORY_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(COUNSELING_CATEGORY_MAX)
  @Transform(({ value }) => trimToUndefined(value))
  category?: string;

  @ApiPropertyOptional({ maxLength: COUNSELING_PREFERRED_DAY_TIME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(COUNSELING_PREFERRED_DAY_TIME_MAX)
  @Transform(({ value }) => trimToUndefined(value))
  preferredDayTime?: string;

  @ApiPropertyOptional({ maxLength: COUNSELING_TALK_ABOUT_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(COUNSELING_TALK_ABOUT_MAX)
  @Transform(({ value }) => trimToUndefined(value))
  talkAbout?: string;

  @ApiProperty({ type: CreateCounselingContactDto })
  @ValidateNested()
  @Type(() => CreateCounselingContactDto)
  @Validate(CounselingContactChannelConstraint)
  contact: CreateCounselingContactDto;
}
