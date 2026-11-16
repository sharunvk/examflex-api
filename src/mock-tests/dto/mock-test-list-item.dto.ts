import { Exclude, Expose, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccessMode } from '../../common/enums/access-mode.enum';
import { UserAttemptAction } from '../../common/enums/user-attempt-action.enum';
import { AccessResponseDto } from '../../access/dto/access-response.dto';
import { AttemptSummaryDto } from './attempt-summary.dto';

export class ExamSummaryDto {
  @ApiProperty({
    description: 'Exam ID',
    example: '64f123456789abcdef123456',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Exam name',
    example: 'SSC CGL',
  })
  @Expose()
  name: string;

  @ApiPropertyOptional({
    description: 'Exam description',
    example: 'Staff Selection Commission Combined Graduate Level',
  })
  @Expose()
  description?: string;
}

export class SubjectSummaryDto {
  @ApiProperty({
    description: 'Subject ID',
    example: '64f123456789abcdef123456',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Subject name',
    example: 'Quantitative Aptitude',
  })
  @Expose()
  name: string;

  @ApiPropertyOptional({
    description: 'Subject description',
    example: 'Mathematics and problem solving',
  })
  @Expose()
  description?: string;
}

export class TopicSummaryDto {
  @ApiProperty({
    description: 'Topic ID',
    example: '64f123456789abcdef123456',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Topic name',
    example: 'Ratio & Proportion',
  })
  @Expose()
  name: string;
}

export class MockTestListItemDto {
  @ApiProperty({
    description: 'Unique identifier for the mock test',
    example: '64f123456789abcdef123456',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description:
      'Paper access mode. FREE = no entitlement required; ENTITLED = requires covering entitlement.',
    enum: AccessMode,
    example: AccessMode.FREE,
  })
  @Expose()
  accessMode: AccessMode;

  @ApiProperty({
    description:
      'Backend-computed access for the current user. Do not authorize from the client alone.',
    type: AccessResponseDto,
  })
  @Expose()
  access: AccessResponseDto;

  @ApiPropertyOptional({
    description: 'Title of the mock test',
    example: 'NEET 2025 Full Length Mock Test 1',
  })
  @Expose()
  title?: string;

  @ApiPropertyOptional({
    description: 'Description of the mock test',
    example: 'Comprehensive NEET mock test covering all subjects',
  })
  @Expose()
  description?: string;

  @ApiProperty({
    description: 'Total number of questions in the mock test',
    enum: [10, 15, 20, 25, 30],
    example: 30,
  })
  @Expose()
  totalQuestions: number;

  @ApiProperty({
    description: 'Duration of the test in minutes',
    enum: [10, 15, 20, 25, 30],
    example: 30,
  })
  @Expose()
  durationInMinutes: number;

  @ApiProperty({
    description: 'Total marks (totalQuestions × marksPerQuestion)',
    example: 120,
  })
  @Expose()
  totalMarks: number;

  @ApiProperty({
    description: 'Exam details',
    type: ExamSummaryDto,
  })
  @Expose()
  @Type(() => ExamSummaryDto)
  exam: ExamSummaryDto;

  @ApiProperty({
    description: 'Subject details',
    type: SubjectSummaryDto,
  })
  @Expose()
  @Type(() => SubjectSummaryDto)
  subject: SubjectSummaryDto;

  @ApiPropertyOptional({
    description: 'Topic details (optional)',
    type: TopicSummaryDto,
  })
  @Expose()
  @Type(() => TopicSummaryDto)
  topic?: TopicSummaryDto;

  @ApiProperty({
    description: 'Test generation mode',
    enum: ['STATIC', 'DYNAMIC'],
    example: 'STATIC',
  })
  @Expose()
  generationMode: string;

  @ApiProperty({
    description: 'Marks awarded per correct answer',
    example: 4,
  })
  @Expose()
  marksPerQuestion: number;

  @ApiProperty({
    description: 'Negative marks for incorrect answer',
    example: 1,
  })
  @Expose()
  negativeMarking: number;

  @ApiPropertyOptional({
    description: 'Minimum score required to pass',
    example: 360,
  })
  @Expose()
  passingScore?: number;

  @ApiProperty({
    description: 'Whether users can retake the test',
    example: true,
  })
  @Expose()
  allowRetake: boolean;

  @ApiProperty({
    description: 'Whether options should be shuffled',
    example: false,
  })
  @Expose()
  shuffleOptions: boolean;

  @ApiProperty({
    description: 'Whether results are shown immediately after completion',
    example: true,
  })
  @Expose()
  showResultsImmediately: boolean;

  @ApiProperty({
    description: 'Whether the mock test is currently active',
    example: true,
  })
  @Expose()
  isActive: boolean;

  @ApiProperty({
    description: 'Date when the mock test was created',
    example: '2026-02-15T10:30:00.000Z',
  })
  @Expose()
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the mock test was last updated',
    example: '2026-02-15T10:35:00.000Z',
  })
  @Expose()
  updatedAt: Date;

  @ApiProperty({
    description: 'Recommended action for the user based on attempt history',
    enum: UserAttemptAction,
    example: UserAttemptAction.START,
  })
  @Expose()
  userAttemptAction: UserAttemptAction;

  @ApiPropertyOptional({
    description:
      'ID of the active attempt to resume. Only present when userAttemptAction is RESUME.',
    example: '64f123456789abcdef123456',
  })
  @Expose()
  resumeAttemptId?: string;

  @ApiPropertyOptional({
    description:
      'Authenticated-only card snapshot (progress, scores, Mistake Book teaser). Omitted for anonymous lists.',
    type: AttemptSummaryDto,
  })
  @Expose()
  @Type(() => AttemptSummaryDto)
  attemptSummary?: AttemptSummaryDto;

  // Exclude sensitive fields from response
  @Exclude()
  questionIds: string[];

  @Exclude()
  difficultyDistribution: {
    easy: number;
    medium: number;
    hard: number;
  };

  @Exclude()
  isDeleted: boolean;

  constructor(partial: Partial<MockTestListItemDto>) {
    Object.assign(this, partial);
  }
}
