import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EquationNamedRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class EquationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  shortDescription: string;

  @ApiProperty()
  equation: string;

  @ApiPropertyOptional()
  longDescription?: string;

  @ApiPropertyOptional()
  mnemonic?: string;

  @ApiProperty({ type: [String] })
  bulletPoints: string[];

  @ApiProperty({ type: EquationNamedRefDto })
  subject: EquationNamedRefDto | string;

  @ApiProperty({ type: EquationNamedRefDto })
  topic: EquationNamedRefDto | string;

  @ApiProperty({ type: [EquationNamedRefDto] })
  exams: Array<EquationNamedRefDto | string>;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedEquationsResponseDto {
  @ApiProperty({ type: [EquationResponseDto] })
  data: EquationResponseDto[];

  @ApiProperty()
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}
