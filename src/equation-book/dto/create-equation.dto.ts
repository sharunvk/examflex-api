import {
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImageMetadataDto } from '../../questions/dto/image-metadata.dto';

export class CreateEquationDto {
  @ApiProperty({
    description: 'Recall prompt / list title',
    example: 'Net force on a free body?',
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({
    description: 'Short cue shown before the equation is revealed',
    example: 'Start from ΣF before writing a.',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  shortDescription: string;

  @ApiProperty({
    description: 'Equation body as Mathpix markdown / LaTeX',
    example: '$$\\Sigma F = ma$$',
  })
  @IsString()
  @IsNotEmpty()
  equation: string;

  @ApiPropertyOptional({
    description: 'Longer coaching note shown after reveal',
    example: 'Resolve axes carefully when friction or incline appears.',
  })
  @IsOptional()
  @IsString()
  longDescription?: string;

  @ApiPropertyOptional({
    description: 'Memory trick / mnemonic shown after reveal',
    example: 'Sigma first — sum the forces, then write a.',
  })
  @IsOptional()
  @IsString()
  mnemonic?: string;

  @ApiPropertyOptional({
    description: 'Optional bullet points (Mathpix markdown / LaTeX each)',
    type: [String],
    example: ['$$F = ma$$', 'Inertia resists change in motion'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bulletPoints?: string[];

  @ApiPropertyOptional({
    type: ImageMetadataDto,
    nullable: true,
    description:
      'Optional picture for the equation, as uploaded through the admin file upload (key + bucket). Send null on update to remove it; omit to leave it unchanged.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageMetadataDto)
  image?: ImageMetadataDto | null;

  @ApiProperty({
    description: 'Subject ID',
    example: '64f123456789abcdef123456',
  })
  @IsMongoId()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({
    description: 'Topic (chapter) ID',
    example: '64f123456789abcdef123457',
  })
  @IsMongoId()
  @IsNotEmpty()
  topic: string;

  @ApiProperty({
    description: 'Exam IDs this equation belongs to (at least one)',
    type: [String],
    example: ['64f123456789abcdef123458'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  exams: string[];
}
