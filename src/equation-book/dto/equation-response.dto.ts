import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EquationNamedRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

/** Raw stored image metadata. Admins only; students get `imageUrl`. */
export class EquationImageDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  bucket: string;

  @ApiPropertyOptional()
  region?: string;

  @ApiPropertyOptional()
  contentType?: string;

  @ApiPropertyOptional()
  size?: number;

  @ApiPropertyOptional()
  lastModified?: Date | string;
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

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Pre-signed URL (1 hour) of the equation picture. Absent when the equation has no image.',
  })
  imageUrl?: string | null;

  @ApiPropertyOptional({
    type: EquationImageDto,
    description: 'Stored image metadata. Returned to admins only.',
  })
  image?: EquationImageDto;

  @ApiProperty({ type: EquationNamedRefDto })
  subject: EquationNamedRefDto | string;

  @ApiProperty({ type: EquationNamedRefDto })
  topic: EquationNamedRefDto | string;

  @ApiProperty({ type: [EquationNamedRefDto] })
  exams: Array<EquationNamedRefDto | string>;

  @ApiProperty({
    description: 'Display priority; higher numbers are listed first.',
    default: 0,
  })
  sortOrder: number;

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
