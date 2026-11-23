import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SafeQuestionDto } from '../../mock-test-attempts/dto/start-attempt-response.dto';
import { AccessMode } from '../../common/enums/access-mode.enum';

export class SprintQuestionItemDto extends SafeQuestionDto {
  @ApiProperty({ description: '0-based position across the whole paper' })
  position: number;

  @ApiProperty()
  marksPerQuestion: number;

  @ApiProperty()
  negativeMarking: number;

  @ApiPropertyOptional()
  replacedFrom?: string;

  @ApiPropertyOptional({
    description: 'Correct option id (admin-only review)',
  })
  correctAnswer?: string;
}

export class SprintDraftSubjectBlockDto {
  @ApiProperty()
  subjectId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: [SprintQuestionItemDto] })
  questions: SprintQuestionItemDto[];
}

export class SprintDraftSettingsDto {
  @ApiProperty()
  totalQuestions: number;

  @ApiProperty()
  durationInMinutes: number;

  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  marksPerQuestion: number;

  @ApiProperty()
  negativeMarking: number;

  @ApiPropertyOptional()
  passingScore?: number;

  @ApiProperty()
  allowRetake: boolean;

  @ApiProperty()
  shuffleOptions: boolean;

  @ApiProperty()
  showResultsImmediately: boolean;

  @ApiProperty({ enum: AccessMode })
  accessMode: AccessMode;
}

export class SprintDraftResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  examId: string;

  @ApiProperty()
  examName: string;

  @ApiProperty({
    enum: ['GENERATING', 'REVIEW', 'PUBLISHING', 'PUBLISHED', 'DISCARDED'],
  })
  status: string;

  @ApiProperty({ type: SprintDraftSettingsDto })
  settings: SprintDraftSettingsDto;

  @ApiProperty({
    description:
      'Questions grouped by the slot subject. Positions stay 0-based across the paper.',
    type: [SprintDraftSubjectBlockDto],
  })
  subjects: SprintDraftSubjectBlockDto[];

  @ApiPropertyOptional()
  publishedMockTestId?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class SprintDraftListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  examId: string;

  @ApiProperty()
  examName: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  totalQuestions: number;

  @ApiProperty()
  durationInMinutes: number;

  @ApiPropertyOptional()
  title?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class SprintSearchQuestionItemDto extends SafeQuestionDto {
  @ApiPropertyOptional()
  snippet?: string;
}

export class PublishSprintDraftResultDto {
  @ApiProperty()
  mockTestId: string;

  @ApiProperty({ type: SprintDraftResponseDto })
  draft: SprintDraftResponseDto;
}
