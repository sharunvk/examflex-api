import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  normalizeOptionalUrl,
  trimString,
} from '../instance-config.transforms';

export class CreateInstanceConfigDto {
  @ApiProperty({
    description: 'Display name for this deployment (for example, ExamFlex)',
    example: 'ExamFlex',
    minLength: 1,
    maxLength: 120,
  })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    description:
      'Absolute http(s) URL of the logo. Omit or send null to leave it unset.',
    example: 'https://cdn.example.com/logo.png',
    nullable: true,
  })
  @Transform(normalizeOptionalUrl)
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUrl(
    {
      require_protocol: true,
      protocols: ['http', 'https'],
      require_tld: true,
    },
    { message: 'logoUrl must be an http or https URL' },
  )
  @MaxLength(2048)
  logoUrl?: string | null;

  @ApiPropertyOptional({
    description:
      'Absolute http(s) URL of the favicon. Omit or send null to leave it unset.',
    example: 'https://cdn.example.com/favicon.png',
    nullable: true,
  })
  @Transform(normalizeOptionalUrl)
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUrl(
    {
      require_protocol: true,
      protocols: ['http', 'https'],
      require_tld: true,
    },
    { message: 'faviconUrl must be an http or https URL' },
  )
  @MaxLength(2048)
  faviconUrl?: string | null;
}
