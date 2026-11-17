import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaperType } from '../../common/enums/paper-type.enum';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';
import { MistakeKind, MistakeTripReason } from '../mistake-book.constants';

export class MistakeBookSessionDto {
  @ApiProperty()
  mockTestId: string;

  @ApiProperty()
  attemptId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: PaperType })
  paperType: PaperType;

  @ApiProperty({ example: 5 })
  remainingCount: number;

  @ApiProperty()
  attemptSubmittedAt: Date;

  @ApiPropertyOptional()
  subjectId?: string;

  @ApiPropertyOptional()
  subjectLabel?: string;

  @ApiPropertyOptional()
  topicId?: string;

  @ApiPropertyOptional()
  topicLabel?: string;

  constructor(partial: Partial<MistakeBookSessionDto>) {
    Object.assign(this, partial);
  }
}

export class MistakeBookSessionsResponseDto {
  @ApiProperty({ type: [MistakeBookSessionDto] })
  data: MistakeBookSessionDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;

  constructor(data: MistakeBookSessionDto[], pagination: PaginationMetaDto) {
    this.data = data;
    this.pagination = pagination;
  }
}

export class MistakeBookFilterOptionDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  label: string;

  constructor(partial: Partial<MistakeBookFilterOptionDto>) {
    Object.assign(this, partial);
  }
}

export class MistakeBookChapterOptionDto extends MistakeBookFilterOptionDto {
  @ApiProperty()
  subjectId: string;

  constructor(partial: Partial<MistakeBookChapterOptionDto>) {
    super(partial);
    Object.assign(this, partial);
  }
}

export class MistakeBookEntryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['incorrect', 'unattended'] })
  kind: MistakeKind;

  @ApiProperty()
  questionId: string;

  @ApiProperty({ example: 'Q34' })
  questionNumber: string;

  @ApiProperty()
  subjectId: string;

  @ApiProperty()
  subjectLabel: string;

  @ApiPropertyOptional()
  topicId?: string;

  @ApiPropertyOptional()
  topicLabel?: string;

  @ApiProperty()
  prompt: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Presigned question figure URL when the stem has an image',
  })
  imageUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Absent when the student left the question unattended',
  })
  yourAnswerLabel?: string;

  @ApiPropertyOptional()
  yourAnswer?: string;

  @ApiProperty()
  correctAnswerLabel: string;

  @ApiProperty()
  correctAnswer: string;

  @ApiProperty()
  insightTitle: string;

  @ApiProperty()
  insightBody: string;

  @ApiProperty({
    description: 'Reserved for formula enrichment; empty in v1',
    example: '',
  })
  insightFormula: string;

  @ApiProperty({
    description: 'Reserved for NCERT source; empty in v1',
    example: '',
  })
  sourceLabel: string;

  @ApiProperty({
    description: 'Reserved for NCERT source; empty in v1',
    example: '',
  })
  sourceHref: string;

  @ApiProperty()
  sourceHint: string;

  @ApiProperty({ enum: ['concept-gap', 'calculation', 'time'] })
  tripReason: MistakeTripReason;

  constructor(partial: Partial<MistakeBookEntryDto>) {
    Object.assign(this, partial);
  }
}

export class MistakeBookSessionDetailDto {
  @ApiProperty()
  mockTestId: string;

  @ApiProperty()
  attemptId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: PaperType })
  paperType: PaperType;

  @ApiProperty()
  remainingCount: number;

  @ApiProperty()
  attemptSubmittedAt: Date;

  @ApiProperty({ type: [MistakeBookFilterOptionDto] })
  subjects: MistakeBookFilterOptionDto[];

  @ApiProperty({ type: [MistakeBookChapterOptionDto] })
  chapters: MistakeBookChapterOptionDto[];

  @ApiProperty({ type: [MistakeBookEntryDto] })
  entries: MistakeBookEntryDto[];

  constructor(partial: Partial<MistakeBookSessionDetailDto>) {
    Object.assign(this, partial);
  }
}
