import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class ImageMetadataDto {
  @ApiProperty({ example: 'questions/stem.png' })
  @IsString()
  key: string;

  @ApiProperty({ example: 'examflex-assets' })
  @IsString()
  bucket: string;

  @ApiProperty({ example: 'ap-south-1' })
  @IsString()
  region: string;

  @ApiPropertyOptional({ example: 'image/png' })
  @IsOptional()
  @IsString()
  contentType?: string;

  @ApiPropertyOptional({ example: 48291 })
  @IsOptional()
  @IsNumber()
  size?: number;

  @ApiPropertyOptional()
  @IsOptional()
  lastModified?: Date | string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  url?: string;
}
