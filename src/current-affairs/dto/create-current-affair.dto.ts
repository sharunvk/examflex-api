import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ImageMetadataDto } from '../../questions/dto/image-metadata.dto';
import { IsCalendarDate } from '../utils/calendar-date';
import {
  DESCRIPTION_MAX_POINTS,
  DESCRIPTION_POINT_MAX_LENGTH,
  DESCRIPTION_POINT_MIN_LENGTH,
  cleanDescriptionPoints,
} from '../utils/description-points';

export class CreateCurrentAffairDto {
  @ApiProperty({
    description:
      'Headline for the current affairs item. Trimmed on save. Unique per item, not globally.',
    example: 'India launches new satellite for weather monitoring',
    minLength: 2,
    maxLength: 200,
  })
  @IsString()
  @MinLength(2, { message: 'Title must be at least 2 characters long' })
  @MaxLength(200, { message: 'Title cannot exceed 200 characters' })
  @Transform(({ value }) => value?.trim())
  title: string;

  @ApiPropertyOptional({
    description:
      'Optional bullet points about the event. Up to 10 items. Empty strings are stripped on save. Order is preserved. Omit or send an empty array when unused.',
    type: [String],
    example: [
      'ISRO launched a meteorological satellite from Sriharikota.',
      'The mission improves short-range weather forecasting.',
    ],
    maxItems: DESCRIPTION_MAX_POINTS,
  })
  @IsOptional()
  @ValidateIf((_, value) => cleanDescriptionPoints(value).length > 0)
  @IsArray()
  @ArrayMaxSize(DESCRIPTION_MAX_POINTS, {
    message: `Description cannot have more than ${DESCRIPTION_MAX_POINTS} bullet points`,
  })
  @IsString({ each: true })
  @MinLength(DESCRIPTION_POINT_MIN_LENGTH, {
    each: true,
    message: `Each description bullet must be at least ${DESCRIPTION_POINT_MIN_LENGTH} characters long`,
  })
  @MaxLength(DESCRIPTION_POINT_MAX_LENGTH, {
    each: true,
    message: `Each description bullet cannot exceed ${DESCRIPTION_POINT_MAX_LENGTH} characters`,
  })
  @Transform(({ value }) => {
    const points = cleanDescriptionPoints(value);
    return points.length > 0 ? points : undefined;
  })
  description?: string[];

  @ApiProperty({
    description:
      'Calendar date this item belongs to. Must be a real YYYY-MM-DD date (e.g. 2026-02-31 is rejected). Timezone-safe: stored as a string, not a UTC Date. The admin client always sends this; the server does not default to "today".',
    example: '2026-08-14',
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  })
  @IsString()
  @IsCalendarDate()
  date: string;

  @ApiPropertyOptional({
    description:
      'Optional mnemonic or memory aid for exam revision. Trimmed on save. Omit if unused.',
    example: 'ISRO + weather = sky report from Sriharikota',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Memory trick cannot exceed 1000 characters' })
  @Transform(({ value }) => value?.trim())
  memoryTrick?: string;

  @ApiPropertyOptional({
    type: ImageMetadataDto,
    description:
      'Optional S3 object metadata from `POST /api/v1/files/upload` (JPEG/PNG). Persist `key`, `bucket`, and `region`. Do not store a long-lived public URL — reads return a short-lived `imageUrl`. Omit to create without an image.',
    example: {
      key: 'admin-images/1723654321-uuid.png',
      bucket: 'examflex-assets',
      region: 'ap-south-1',
      contentType: 'image/png',
      size: 48291,
    },
  })
  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @ValidateNested()
  @Type(() => ImageMetadataDto)
  image?: ImageMetadataDto | null;
}
