import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { RecommendationKind } from '../enums/recommendation-kind.enum';

export class CreateRecommendationOfferingDto {
  @ApiProperty({
    description: 'Exam this offering belongs to',
    example: '64f123456789abcdef123456',
  })
  @IsMongoId()
  @IsNotEmpty()
  exam: string;

  @ApiPropertyOptional({
    description:
      'Offering kind. COURSE is the only supported value today; INSTITUTION is reserved for future college targets.',
    enum: RecommendationKind,
    default: RecommendationKind.COURSE,
  })
  @IsOptional()
  @IsEnum(RecommendationKind)
  kind?: RecommendationKind;

  @ApiPropertyOptional({
    description:
      'Parent COURSE offering id. Required when kind is INSTITUTION (future). Omit for COURSE.',
    example: '64f123456789abcdef123457',
  })
  @IsOptional()
  @ValidateIf(
    (dto: CreateRecommendationOfferingDto) =>
      dto.kind === RecommendationKind.INSTITUTION,
  )
  @IsMongoId()
  parentOffering?: string;

  @ApiProperty({
    description: 'Display title (e.g. MBBS, B.Tech)',
    example: 'MBBS',
    minLength: 2,
    maxLength: 120,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title: string;

  @ApiPropertyOptional({
    description: 'Short subtitle shown under the title',
    example: 'Medicine · sample outlook',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  subtitle?: string;

  @ApiPropertyOptional({
    description: 'Longer description for admin / future detail views',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description?: string;

  @ApiPropertyOptional({
    deprecated: true,
    description:
      'DEPRECATED and ignored by pathway calculations. Cut-offs are now entered per full mock (absolute marks). Still accepted and stored for backwards compatibility.',
    example: 75,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minPercent?: number;

  @ApiPropertyOptional({
    description:
      'DEPRECATED and ignored by pathway calculations. Must be >= minPercent when both are sent.',
    example: 85,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  comfortPercent?: number;

  @ApiPropertyOptional({
    description:
      'Display order within the exam (ascending). Auto-assigned if omitted.',
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
