import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImageMetadataDto } from './image-metadata.dto';
import { CitationDto } from '../../citations/dto/citation.dto';
import {
  CITATION_STATUSES,
  CitationStatus,
} from '../../mock-test-attempts/schemas/question.schema';

export class NamedRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class QuestionTextLocaleResponseDto {
  @ApiPropertyOptional()
  text?: string | null;

  @ApiPropertyOptional({ type: ImageMetadataDto })
  image?: ImageMetadataDto | null;
}

export class QuestionOptionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  type: string;

  @ApiPropertyOptional()
  en?: string | null;

  @ApiPropertyOptional()
  ml?: string | null;

  @ApiPropertyOptional({ type: ImageMetadataDto })
  image?: ImageMetadataDto | null;
}

export class QuestionExplanationResponseDto {
  @ApiPropertyOptional()
  en?: string | null;

  @ApiPropertyOptional()
  ml?: string | null;

  @ApiPropertyOptional({ type: ImageMetadataDto })
  image?: ImageMetadataDto | null;

  @ApiPropertyOptional({ type: [ImageMetadataDto] })
  images?: ImageMetadataDto[];
}

export class QuestionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  questionText: {
    en?: QuestionTextLocaleResponseDto;
    ml?: QuestionTextLocaleResponseDto;
  };

  @ApiPropertyOptional()
  optionType?: string;

  @ApiProperty({ type: [QuestionOptionResponseDto] })
  options: QuestionOptionResponseDto[];

  @ApiPropertyOptional({ type: QuestionExplanationResponseDto })
  explanation?: QuestionExplanationResponseDto;

  @ApiProperty()
  correctAnswer: string;

  @ApiPropertyOptional()
  subject?: NamedRefDto | string | null;

  @ApiPropertyOptional()
  topic?: NamedRefDto | string | null;

  @ApiPropertyOptional({ type: [NamedRefDto] })
  exams?: Array<NamedRefDto | string>;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Tag ids on this question, in selection order. Empty when the question has no tag.',
  })
  tagIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Tag names on this question. Empty when the question has no tag.',
  })
  tags?: string[];

  @ApiPropertyOptional()
  difficultyLevel?: string;

  @ApiPropertyOptional()
  source?: string;

  @ApiPropertyOptional({
    type: [CitationDto],
    description: 'Ranked NCERT citations (full chunk text). Empty when none.',
  })
  citations?: CitationDto[];

  @ApiPropertyOptional({ enum: CITATION_STATUSES, nullable: true })
  citationStatus?: CitationStatus | null;

  @ApiPropertyOptional({ nullable: true })
  citationsUpdatedAt?: Date | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
