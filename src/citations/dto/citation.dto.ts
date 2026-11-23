import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CITATION_SELECTED_BY,
  CITATION_STATUSES,
  CitationSelectedBy,
  CitationStatus,
} from '../../mock-test-attempts/schemas/question.schema';
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SAVED_CITATIONS,
} from '../citations.constants';

/** One NCERT chunk, as saved on a question or returned by a search. */
export class CitationDto {
  @ApiProperty({ description: 'Weaviate object uuid' })
  chunkId: string;

  @ApiProperty({ description: '1-based rank', example: 1 })
  rank: number;

  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional({ description: 'Full chunk text' })
  content?: string;

  @ApiPropertyOptional()
  chunkIndex?: number;

  @ApiPropertyOptional({ type: [String] })
  images?: string[];

  @ApiPropertyOptional({ example: 'LAWS_OF_MOTION.pdf' })
  sourceDoc?: string;

  @ApiPropertyOptional({
    description: 'sourceDoc without ".pdf" and with spaces for underscores',
    example: 'LAWS OF MOTION',
  })
  chapterName?: string;

  @ApiPropertyOptional()
  documentType?: string;

  @ApiPropertyOptional({ example: 'XI' })
  grade?: string;

  @ApiPropertyOptional({ description: 'Page inside the source PDF' })
  pageStart?: number;

  @ApiPropertyOptional()
  ncertPageOffset?: number;

  @ApiPropertyOptional({
    description: 'Printed NCERT page: pageStart + ncertPageOffset',
  })
  pageNumber?: number;

  @ApiPropertyOptional({ description: 'Relative hybrid score' })
  score?: number;

  @ApiPropertyOptional({ description: 'Vector similarity' })
  similarity?: number;

  @ApiPropertyOptional({ enum: CITATION_SELECTED_BY })
  selectedBy?: CitationSelectedBy;
}

export class QuestionCitationsResponseDto {
  @ApiPropertyOptional({ enum: CITATION_STATUSES, nullable: true })
  citationStatus: CitationStatus | null;

  @ApiProperty({ type: [CitationDto] })
  citations: CitationDto[];

  @ApiPropertyOptional({ nullable: true })
  citationsUpdatedAt: Date | null;
}

export class CitationSearchQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_SEARCH_LIMIT,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Custom query text. Defaults to the question text + correct answer.',
    maxLength: 1000,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  q?: string;
}

export class CitationSearchResponseDto {
  @ApiProperty({
    description: 'False when the question subject has no NCERT mapping',
  })
  mapped: boolean;

  @ApiPropertyOptional({ nullable: true, example: 'physics' })
  vectorSubjectKey: string | null;

  @ApiProperty({ description: 'Query text that was searched' })
  query: string;

  @ApiProperty({ type: [CitationDto] })
  results: CitationDto[];
}

export class SaveCitationsDto {
  @ApiProperty({
    type: [String],
    description: `Ordered chunk ids (rank 1 first), at most ${MAX_SAVED_CITATIONS}. An empty list clears the citations.`,
  })
  @IsArray()
  @ArrayMaxSize(MAX_SAVED_CITATIONS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  chunkIds: string[];
}
