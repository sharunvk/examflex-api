import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccessMode } from '../../common/enums/access-mode.enum';
import { UserAttemptAction } from '../../common/enums/user-attempt-action.enum';
import { AccessResponseDto } from '../../access/dto/access-response.dto';
import { AttemptSummaryDto } from '../../mock-tests/dto/attempt-summary.dto';
import { ExamSummaryDto } from '../../mock-tests/dto/mock-test-list-item.dto';
import { DraftSubjectBlockDto } from './draft-response.dto';

export class FullMockSubjectConfigDto {
  @ApiProperty({
    description: 'Subject ID',
    example: '64f123456789abcdef123456',
  })
  subject: string;

  @ApiProperty({ example: 'Quantitative Aptitude' })
  name: string;

  @ApiProperty({
    description: 'Number of questions in this subject block',
    example: 25,
  })
  numberOfQuestions: number;

  @ApiProperty({ example: 2 })
  marksPerQuestion: number;

  @ApiProperty({ example: true })
  hasNegativeMarking: boolean;

  @ApiProperty({ example: 0.5 })
  negativeMarksPerQuestion: number;

  @ApiPropertyOptional({
    description: 'Session timer in minutes when isSessionWise is true',
    example: 60,
  })
  sessionTime?: number;

  @ApiProperty({
    description: 'Inclusive start index into questionIds',
    example: 0,
  })
  questionStartIndex: number;

  @ApiProperty({
    description: 'Inclusive end index into questionIds',
    example: 24,
  })
  questionEndIndex: number;

  @ApiPropertyOptional({
    description:
      'Frozen question IDs in this subject block, in paper order. Present on newly published full mocks. Use with numberOfQuestions to splice the attempt questions array.',
    type: [String],
    example: ['64f123456789abcdef123456'],
  })
  questionIds?: string[];
}

export class FullMockTestListItemDto {
  @ApiProperty({ example: '64f123456789abcdef123456' })
  id: string;

  @ApiProperty({
    description:
      'Paper access mode. FREE = no entitlement required; ENTITLED = requires covering entitlement.',
    enum: AccessMode,
    example: AccessMode.FREE,
  })
  accessMode: AccessMode;

  @ApiProperty({
    description:
      'Backend-computed access for the current user. Do not authorize from the client alone.',
    type: AccessResponseDto,
  })
  access: AccessResponseDto;

  @ApiPropertyOptional({ example: 'SSC CGL Tier 1 Full Mock 12' })
  title?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty({
    description: 'Paper size from the exam blueprint (not limited to 10–30)',
    example: 100,
  })
  totalQuestions: number;

  @ApiProperty({
    description:
      'Mixed: exam.duration. Session-wise: sum of subject sessionTime values.',
    example: 60,
  })
  durationInMinutes: number;

  @ApiPropertyOptional({ example: 200 })
  totalMarks?: number;

  @ApiProperty({
    description:
      'When true, the student must finish one subject session before starting the next',
    example: false,
  })
  isSessionWise: boolean;

  @ApiProperty({ type: ExamSummaryDto, nullable: true })
  exam: ExamSummaryDto | null;

  @ApiProperty({
    description:
      'Frozen exam subject rows with contiguous index ranges and questionIds into the paper',
    type: [FullMockSubjectConfigDto],
  })
  subjectConfig: FullMockSubjectConfigDto[];

  @ApiProperty({
    description:
      'Display fallback (first subject). Scoring uses per-question marks.',
    example: 2,
  })
  marksPerQuestion: number;

  @ApiProperty({
    description:
      'Display fallback (first subject). Scoring uses per-question marks.',
    example: 0.5,
  })
  negativeMarking: number;

  @ApiPropertyOptional({ example: 120 })
  passingScore?: number;

  @ApiProperty({ example: true })
  allowRetake: boolean;

  @ApiProperty({
    description:
      'If true, options are shuffled within a subject block only (not across subjects)',
    example: false,
  })
  shuffleOptions: boolean;

  @ApiProperty({ example: true })
  showResultsImmediately: boolean;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({
    description:
      'START if never attempted, RESUME if in progress/paused, RETAKE if completed',
    enum: UserAttemptAction,
    example: UserAttemptAction.START,
  })
  userAttemptAction: UserAttemptAction;

  @ApiPropertyOptional({
    description: 'Present only when userAttemptAction is RESUME',
    example: '64f123456789abcdef123456',
  })
  resumeAttemptId?: string;

  @ApiPropertyOptional({
    description:
      'Authenticated-only card snapshot (progress, scores, Mistake Book teaser). Omitted for anonymous lists.',
    type: AttemptSummaryDto,
  })
  attemptSummary?: AttemptSummaryDto;

  @ApiPropertyOptional({
    description:
      'Admin-only: safe question payloads grouped by subject (same shape as draft review). Omitted for students.',
    type: [DraftSubjectBlockDto],
  })
  subjects?: DraftSubjectBlockDto[];
}
