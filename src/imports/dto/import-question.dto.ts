import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsMongoId,
  IsOptional,
  ValidateNested,
} from 'class-validator';

export class ImportImageMetadataDto {
  @Allow()
  @ApiProperty({ example: 'imports/507f1f77bcf86cd799439015/q1/stem.png' })
  key: string;

  @Allow()
  @ApiProperty({ example: 'examflex-assets' })
  bucket: string;

  @Allow()
  @ApiProperty({ example: 'ap-south-1' })
  region: string;

  @Allow()
  @ApiPropertyOptional({ example: 'image/png' })
  contentType?: string;

  @Allow()
  @ApiPropertyOptional({ example: 48291 })
  size?: number;

  @Allow()
  @ApiPropertyOptional()
  lastModified?: Date;

  @Allow()
  @ApiPropertyOptional({ example: 'https://example.com/presigned-url' })
  url?: string;
}

export class ImportQuestionOptionDto {
  @Allow()
  id: string;

  @Allow()
  type: 'text' | 'image';

  @Allow()
  en?: string | null;

  @Allow()
  ml?: null;

  @Allow()
  image?: ImportImageMetadataDto | null;
}

/** Mongo-ready question payload for import / failed-question correction. */
export class ImportQuestionPayloadDto {
  @Allow()
  @ApiProperty({
    type: 'object',
    description: 'Question stem. `ml` is always empty for PDF imports.',
    example: {
      en: { text: 'Which of the following is correct?', image: null },
      ml: { text: null, image: null },
    },
    additionalProperties: true,
  })
  questionText: {
    en: { text?: string | null; image?: ImportImageMetadataDto | null };
    ml: { text: null; image: null };
  };

  @Allow()
  @ApiProperty({ enum: ['text', 'image'] })
  optionType: 'text' | 'image';

  @ValidateNested({ each: true })
  @Type(() => ImportQuestionOptionDto)
  @ApiProperty({
    type: 'array',
    description: 'Exactly 4 options for NEET imports',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        type: { type: 'string', enum: ['text', 'image'] },
        en: { type: 'string', nullable: true },
        ml: { type: 'string', nullable: true },
        image: { type: 'object', nullable: true },
      },
    },
  })
  options: ImportQuestionOptionDto[];

  @Allow()
  @ApiProperty({
    type: 'object',
    description:
      'Solution/explanation. Primary diagram is `image`; additional diagrams are in `images` (excludes the primary).',
    example: {
      en: 'Explanation text',
      ml: null,
      image: {
        key: 'imports/507f1f77bcf86cd799439015/q1/explanation-0.png',
        bucket: 'examflex-assets',
        region: 'ap-south-1',
        url: 'https://example.com/presigned-url',
      },
      images: [
        {
          key: 'imports/507f1f77bcf86cd799439015/q1/explanation-1.png',
          bucket: 'examflex-assets',
          region: 'ap-south-1',
          url: 'https://example.com/presigned-url-2',
        },
      ],
    },
    additionalProperties: true,
  })
  explanation: {
    en: string;
    ml?: null;
    image?: ImportImageMetadataDto | null;
    images?: ImportImageMetadataDto[];
  };

  @Allow()
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Must match one of the option ids',
  })
  correctAnswer: string;

  @Allow()
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Subject ObjectId from the upload metadata',
  })
  subject: string;

  @Allow()
  @ApiProperty({
    example: '507f1f77bcf86cd799439012',
    description: 'Topic ObjectId from the upload metadata',
  })
  topic: string;

  @Allow()
  @ApiProperty({
    type: [String],
    example: ['507f1f77bcf86cd799439013'],
    description: 'Exam ObjectIds from the upload metadata',
  })
  exams: string[];

  @Allow()
  @ApiProperty({ enum: ['easy', 'medium', 'hard'] })
  difficultyLevel: 'easy' | 'medium' | 'hard';

  @Allow()
  @ApiProperty({ example: true })
  isActive: boolean;

  @Allow()
  @ApiProperty({ example: false })
  isDeleted: boolean;

  @Allow()
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ApiPropertyOptional({
    description:
      'All tag ObjectIds selected for this PDF import. Omit when no tag was selected.',
    type: [String],
  })
  tags?: string[];

  @Allow()
  @IsOptional()
  @ApiProperty({
    example: 'PDF_UPLOAD',
    enum: ['PDF_UPLOAD'],
    description: 'Applied automatically when omitted',
  })
  source?: 'PDF_UPLOAD';

  @Allow()
  @IsOptional()
  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439015',
    description:
      'Question upload ID this question was imported from. Set automatically during PDF import persist.',
  })
  uploadId?: string;
}

export class ImportFailedQuestionResponseDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439021',
    description: 'MongoDB id of the saved question',
  })
  questionId: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439020',
    description: 'Failed question document id that was deleted',
  })
  failedQuestionId: string;
}

export class DeleteFailedQuestionResponseDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439020',
    description: 'MongoDB id of the deleted failed question document',
  })
  failedQuestionId: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439015',
    description: 'Upload ID the failed question belonged to',
  })
  uploadId: string;

  @ApiProperty({
    example: 3,
    description: 'Question number within the upload',
  })
  questionNumber: number;
}
