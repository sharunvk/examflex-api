import {
  IsString,
  IsOptional,
  IsMongoId,
  IsArray,
  ArrayMinSize,
  IsObject,
  Allow,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PROMPT_ENHANCER_IDS } from '../prompt-enhancers/prompt-enhancer.ids';

function parseOptionalJsonField(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'object') {
    return value;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

/**
 * DTO for uploading a question paper PDF
 * Includes file upload and metadata for categorization
 */
export class UploadQuestionPdfDto {
  /**
   * Whitelisted so global ValidationPipe does not reject multipart `file`
   * (actual file bytes are handled by Multer via @UploadedFile()).
   */
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'PDF file to upload (max 50MB)',
  })
  @Allow()
  file?: unknown;

  @ApiPropertyOptional({
    description:
      'Title/name for the PDF (user-friendly identifier). If not provided, a UUID will be generated.',
    example: 'NEET 2023 Physics Paper',
  })
  @IsOptional()
  @IsString({ message: 'Title must be a string' })
  title?: string;

  @ApiPropertyOptional({
    description: 'Subject ID for the question paper',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Subject ID must be a valid MongoDB ObjectId' })
  subjectId?: string;

  @ApiPropertyOptional({
    description: 'Topic ID for the question paper',
    example: '507f1f77bcf86cd799439012',
  })
  @IsOptional()
  @IsMongoId({ message: 'Topic ID must be a valid MongoDB ObjectId' })
  topicId?: string;

  @ApiPropertyOptional({
    description: 'Array of Exam IDs this question paper belongs to',
    example: ['507f1f77bcf86cd799439013', '507f1f77bcf86cd799439014'],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => {
    const parsed = parseOptionalJsonField(value);
    if (parsed === undefined) {
      return undefined;
    }
    return Array.isArray(parsed) ? parsed : [parsed];
  })
  @IsArray({ message: 'Exam IDs must be an array' })
  @ArrayMinSize(1, { message: 'At least one exam ID is required if provided' })
  @IsMongoId({
    each: true,
    message: 'Each exam ID must be a valid MongoDB ObjectId',
  })
  examIds?: string[];

  @ApiPropertyOptional({
    description:
      'Optional tag IDs applied to every question imported from this PDF. Omit when no tag is selected.',
    example: ['507f1f77bcf86cd799439016'],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => {
    const parsed = parseOptionalJsonField(value);
    if (parsed === undefined) {
      return undefined;
    }
    return Array.isArray(parsed) ? parsed : [parsed];
  })
  @IsArray({ message: 'Tag IDs must be an array' })
  @IsMongoId({
    each: true,
    message: 'Each tag ID must be a valid MongoDB ObjectId',
  })
  tagIds?: string[];

  @ApiPropertyOptional({
    description:
      'Optional prompt enhancer ids applied during AI enrich (e.g. shared-passage). ' +
      'Omit or pass an empty list for the default pipeline with no additive prompts.',
    example: ['shared-passage'],
    type: [String],
    enum: PROMPT_ENHANCER_IDS,
  })
  @IsOptional()
  @Transform(({ value }) => {
    const parsed = parseOptionalJsonField(value);
    if (parsed === undefined) {
      return undefined;
    }
    return Array.isArray(parsed) ? parsed : [parsed];
  })
  @IsArray({ message: 'Prompt enhancers must be an array' })
  @IsIn([...PROMPT_ENHANCER_IDS], {
    each: true,
    message: `Each prompt enhancer must be one of: ${PROMPT_ENHANCER_IDS.join(', ')}`,
  })
  promptEnhancers?: string[];

  @ApiPropertyOptional({
    description: 'Additional metadata as key-value pairs',
    example: { examYear: '2023', testSeries: 'NEET Mock Test' },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @Transform(({ value }) => parseOptionalJsonField(value))
  @IsObject({ message: 'Metadata must be a JSON object' })
  metadata?: Record<string, string>;
}

/**
 * Response DTO for successful PDF upload
 */
export class UploadQuestionPdfResponseDto {
  @ApiProperty({
    description: 'Upload ID (MongoDB document ID)',
    example: '507f1f77bcf86cd799439015',
  })
  uploadId: string;

  @ApiProperty({
    description: 'Title of the PDF',
    example: 'NEET 2023 Physics Paper',
  })
  title: string;

  @ApiProperty({
    description: 'Original filename',
    example: 'neet-2023-physics-paper.pdf',
  })
  filename: string;

  @ApiProperty({
    description: 'S3 object key (path)',
    example: 'question-uploads/pdfs/neet-2023-physics-paper.pdf',
  })
  s3Key: string;

  @ApiProperty({
    description: 'S3 bucket name',
    example: 'examflex-question-uploads',
  })
  s3Bucket: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 2048576,
  })
  fileSize: number;

  @ApiProperty({
    description: 'Upload status',
    enum: [
      'uploaded',
      'parsing',
      'parsed',
      'processing',
      'enriched',
      'completed',
      'failed',
    ],
    example: 'uploaded',
  })
  status: string;

  @ApiProperty({
    description: 'Upload timestamp',
    example: '2023-06-29T10:30:00.000Z',
  })
  uploadedAt: Date;
}
