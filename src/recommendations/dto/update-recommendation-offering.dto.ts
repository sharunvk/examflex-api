import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
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

export class UpdateRecommendationOfferingDto {
  @ApiPropertyOptional({
    description: 'Exam this offering belongs to',
    example: '64f123456789abcdef123456',
  })
  @IsOptional()
  @IsMongoId()
  exam?: string;

  @ApiPropertyOptional({
    enum: RecommendationKind,
    description: 'Offering kind',
  })
  @IsOptional()
  @IsEnum(RecommendationKind)
  kind?: RecommendationKind;

  @ApiPropertyOptional({
    description:
      'Parent COURSE id for INSTITUTION rows. Send null to clear (COURSE only).',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  parentOffering?: string | null;

  @ApiPropertyOptional({
    example: 'MBBS',
    minLength: 2,
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  subtitle?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minPercent?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    nullable: true,
    description: 'Send null to clear and fall back to min + 10pp.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  @Max(100)
  comfortPercent?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    description: 'Hide from student lists without deleting',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
