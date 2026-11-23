import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { trimLowerString, trimString } from '../instance-config.transforms';

export class VectorSubjectMappingDto {
  @ApiProperty({
    description: 'Stable key subjects point to, e.g. physics.',
    example: 'physics',
  })
  @Transform(trimLowerString)
  @IsString()
  @Matches(/^[a-z0-9_-]{1,60}$/, {
    message: 'key must be 1-60 lowercase letters, digits, "-" or "_"',
  })
  key: string;

  @ApiProperty({ example: 'Physics' })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label: string;

  @ApiProperty({
    description: 'subjectId value stored on chunks in the vector collection.',
    example: '6afd6aa47d65768788984fed',
  })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  vectorSubjectId: string;
}

export class UpdateVectorSearchConfigDto {
  @ApiPropertyOptional({
    description: 'Weaviate collection name.',
    example: 'Ncert',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  collectionName?: string;

  @ApiPropertyOptional({
    type: [VectorSubjectMappingDto],
    description: 'Replaces the whole list when sent.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => VectorSubjectMappingDto)
  subjects?: VectorSubjectMappingDto[];
}
