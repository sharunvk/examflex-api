import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  normalizeOptionalUrl,
  trimString,
} from '../instance-config.transforms';
import { UpdateRuntimeConfigFields } from './update-runtime-config.dto';
import { UpdateVectorSearchConfigDto } from './update-vector-search-config.dto';

export class UpdateInstanceConfigDto extends UpdateRuntimeConfigFields {
  @ApiPropertyOptional({
    type: UpdateVectorSearchConfigDto,
    description:
      'NCERT citation search: collection name and subject mappings. Read live, no restart needed.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateVectorSearchConfigDto)
  vectorSearch?: UpdateVectorSearchConfigDto;

  @ApiPropertyOptional({
    description: 'Display name for this deployment',
    example: 'ExamFlex',
    minLength: 1,
    maxLength: 120,
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description: 'Absolute http(s) logo URL. Send null or "" to clear it.',
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
    description: 'Absolute http(s) favicon URL. Send null or "" to clear it.',
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
