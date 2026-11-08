import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ImageMetadataDto } from '../../questions/dto/image-metadata.dto';

export class CurrentAffairResponseDto {
  @ApiProperty({
    description: 'Unique identifier',
    example: '64f123456789abcdef123456',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Headline',
    example: 'India launches new satellite for weather monitoring',
  })
  @Expose()
  title: string;

  @ApiPropertyOptional({
    description:
      'Optional bullet points about the event. Absent when the item has none. Legacy string records are returned as a one-item array.',
    type: [String],
    example: [
      'ISRO successfully launched a meteorological satellite from Sriharikota.',
      'The mission improves short-range weather forecasting.',
    ],
  })
  @Expose()
  description?: string[];

  @ApiPropertyOptional({
    description: 'Optional mnemonic or memory aid',
    example: 'ISRO + weather = sky report from Sriharikota',
  })
  @Expose()
  memoryTrick?: string;

  @ApiProperty({
    description:
      'Calendar date this item belongs to (YYYY-MM-DD). Mapped from stored `dateKey`.',
    example: '2026-08-14',
  })
  @Expose()
  date: string;

  @ApiPropertyOptional({
    type: ImageMetadataDto,
    description:
      'Stored S3 metadata used to refresh a signed URL. Absent when the item has no image.',
  })
  @Expose()
  image?: ImageMetadataDto;

  @ApiPropertyOptional({
    description:
      'Short-lived (≈1 hour) presigned GET URL for `image`. Prefer this for display. Refresh via `POST /api/v1/files/signed-url` if it expires.',
    example:
      'https://examflex-assets.s3.ap-south-1.amazonaws.com/admin-images/file.png?X-Amz-Signature=...',
  })
  @Expose()
  imageUrl?: string;

  @ApiProperty({
    description:
      'Display order within the same calendar date. Sorted ascending, then by `createdAt`.',
    example: 0,
  })
  @Expose()
  sortOrder: number;

  @ApiProperty({
    description:
      'Whether the item is visible when listing with `activeOnly=true`',
    example: true,
  })
  @Expose()
  isActive: boolean;

  @ApiProperty({
    description: 'Creation timestamp (ISO 8601)',
    example: '2026-08-14T10:00:00.000Z',
  })
  @Expose()
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp (ISO 8601)',
    example: '2026-08-14T10:00:00.000Z',
  })
  @Expose()
  updatedAt: Date;

  @Exclude()
  isDeleted: boolean;

  constructor(partial: Partial<CurrentAffairResponseDto>) {
    Object.assign(this, partial);
  }
}
