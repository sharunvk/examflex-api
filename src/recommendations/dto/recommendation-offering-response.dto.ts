import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { RecommendationKind } from '../enums/recommendation-kind.enum';

export class RecommendationExamRefDto {
  @ApiProperty({ example: '64f123456789abcdef123456' })
  @Expose()
  id: string;

  @ApiProperty({ example: 'NEET UG' })
  @Expose()
  name: string;
}

export class RecommendationOfferingResponseDto {
  @ApiProperty({ example: '64f123456789abcdef123456' })
  @Expose()
  id: string;

  @ApiProperty({ type: RecommendationExamRefDto })
  @Expose()
  @Type(() => RecommendationExamRefDto)
  exam: RecommendationExamRefDto;

  @ApiProperty({ enum: RecommendationKind })
  @Expose()
  kind: RecommendationKind;

  @ApiPropertyOptional({
    description: 'Parent COURSE id when kind is INSTITUTION',
    example: '64f123456789abcdef123457',
  })
  @Expose()
  parentOfferingId?: string;

  @ApiProperty({ example: 'MBBS' })
  @Expose()
  title: string;

  @ApiPropertyOptional({ example: 'Medicine' })
  @Expose()
  subtitle?: string;

  @ApiPropertyOptional()
  @Expose()
  description?: string;

  @ApiPropertyOptional({
    example: 75,
    deprecated: true,
    description:
      'DEPRECATED legacy value; pathways use per-mock cut-off marks.',
  })
  @Expose()
  minPercent?: number;

  @ApiPropertyOptional({ example: 85, deprecated: true })
  @Expose()
  comfortPercent?: number;

  @ApiProperty({ example: 0 })
  @Expose()
  sortOrder: number;

  @ApiProperty({ example: true })
  @Expose()
  isActive: boolean;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;

  @Exclude()
  isDeleted?: boolean;

  constructor(partial: Partial<RecommendationOfferingResponseDto>) {
    Object.assign(this, partial);
  }
}
