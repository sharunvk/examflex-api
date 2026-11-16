import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

export class ExamPaperCountsDto {
  @ApiProperty({
    description: 'Active TOPIC_WISE (Chapter Wise) paper count',
    example: 12,
  })
  chapterWise: number;

  @ApiProperty({
    description: 'Active FULL_EXAM (Full Mocks) paper count',
    example: 1,
  })
  fullMocks: number;

  @ApiProperty({
    description: 'Active SPRINT paper count',
    example: 0,
  })
  sprint: number;
}

export class ExamsByCategoryItemDto {
  @ApiProperty({
    description: 'Exam ID',
    example: '64f123456789abcdef123456',
  })
  id: string;

  @ApiProperty({
    description: 'Exam name/title',
    example: 'SBI PO',
  })
  title: string;

  @ApiPropertyOptional({
    description:
      'Exam description (same as fullName; preferred for new clients)',
    example: 'The medical entrance for MBBS, BDS and more.',
  })
  description?: string;

  @ApiPropertyOptional({
    description:
      'Icon/image URL for the hub card avatar. Currently the parent category image when set.',
    example: 'https://cdn.example.com/nta.png',
  })
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Full name/description (legacy alias of description)',
    example: 'State Bank of India Probationary Officer',
  })
  fullName?: string;

  @ApiPropertyOptional({
    description: 'Total duration (legacy short format)',
    example: '3h',
  })
  duration?: string;

  @ApiPropertyOptional({
    description: 'Total questions',
    example: 100,
  })
  totalQuestions?: number;

  @ApiPropertyOptional({
    description: 'Total marks',
    example: 200,
  })
  totalMarks?: number;

  @ApiProperty({
    description:
      'Display string for the hub card stats row (questions, minutes, marks, marking)',
    example: '180 QUESTIONS · 180 MINUTES · 720 MARKS · +4 / -1',
  })
  statsLabel: string;

  @ApiPropertyOptional({
    description:
      'Topic-wise mock test count (legacy; same as paperCounts.chapterWise)',
    example: 45,
  })
  testsCount?: number;

  @ApiProperty({
    description: 'Active paper counts by type for hub chips',
    type: ExamPaperCountsDto,
  })
  paperCounts: ExamPaperCountsDto;

  @ApiPropertyOptional({
    description: 'Number of subjects',
    example: 4,
  })
  subjectsCount?: number;

  @ApiProperty({
    description:
      'Whether this exam is trending — nearby, or widely signed up. False when unset.',
    example: false,
  })
  trending: boolean;
}

export class CategoryGroupDto {
  @ApiProperty({
    description: 'Category ID',
    example: '64f123456789abcdef123456',
  })
  id: string;

  @ApiProperty({
    description: 'Category name',
    example: 'Staff Selection Commission',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Category short name',
    example: 'SSC',
  })
  shortName: string;

  @ApiPropertyOptional({
    description: 'Category image URL',
    example: 'https://example.com/ssc.png',
  })
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Category description',
    example: 'Government recruitment for various posts',
  })
  description?: string;

  @ApiProperty({
    description:
      'Dashboard display priority. Higher values appear first. Defaults to 0.',
    example: 0,
  })
  priority: number;

  @ApiProperty({
    description: 'List of exams under this category',
    type: [ExamsByCategoryItemDto],
  })
  exams: ExamsByCategoryItemDto[];
}

/** Paginated hub payload: one (or more) category groups plus page meta. */
export class ExamsByCategoryPageDto {
  @ApiProperty({ type: [CategoryGroupDto] })
  data: CategoryGroupDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

/** @deprecated Prefer ExamsByCategoryPageDto — kept for type aliases in older imports. */
export type ExamsByCategoryResponseDto = CategoryGroupDto[];
