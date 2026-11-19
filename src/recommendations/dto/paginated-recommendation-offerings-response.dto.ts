import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';
import { RecommendationOfferingResponseDto } from './recommendation-offering-response.dto';

export class PaginatedRecommendationOfferingsResponseDto {
  @ApiProperty({ type: [RecommendationOfferingResponseDto] })
  data: RecommendationOfferingResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class RecommendationOfferingApiResponseDto {
  @ApiProperty({ example: 'Recommendation offering created successfully' })
  message: string;

  @ApiProperty({ type: RecommendationOfferingResponseDto })
  data: RecommendationOfferingResponseDto;
}

export class RecommendationOfferingsListApiResponseDto {
  @ApiProperty({ example: 'Recommendation offerings retrieved successfully' })
  message: string;

  @ApiProperty({ type: [RecommendationOfferingResponseDto] })
  data: RecommendationOfferingResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}
