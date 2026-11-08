import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttemptSessionDto } from './attempt-session.dto';

// Simplified - only expose URL to frontend, not S3 internal details
export class QuestionTextLanguageDto {
  @ApiPropertyOptional({
    description: 'Question text',
    example: 'What is the powerhouse of the cell?',
  })
  text?: string | null;

  @ApiPropertyOptional({
    description: 'Question image URL (pre-signed S3 URL)',
    example:
      'https://examflex-images.s3.ap-south-1.amazonaws.com/questions/abc123.jpg?X-Amz-...',
  })
  imageUrl?: string | null;
}

export class QuestionTextDto {
  @ApiProperty({
    description: 'English question text',
    type: QuestionTextLanguageDto,
  })
  en: QuestionTextLanguageDto;

  @ApiProperty({
    description: 'Malayalam question text',
    type: QuestionTextLanguageDto,
  })
  ml: QuestionTextLanguageDto;
}

export class QuestionOptionDto {
  @ApiProperty({
    description: 'Option unique ID (UUID)',
    example: '3b23efba-3626-4606-bee3-9130247d1949',
  })
  id: string;

  @ApiProperty({
    description: 'Option type',
    enum: ['text', 'image'],
    example: 'text',
  })
  type: string;

  @ApiPropertyOptional({
    description: 'Option text in English',
    example: 'Mitochondria',
  })
  en?: string | null;

  @ApiPropertyOptional({
    description: 'Option text in Malayalam',
    example: null,
  })
  ml?: string | null;

  @ApiPropertyOptional({
    description: 'Option image URL (pre-signed S3 URL)',
    example:
      'https://examflex-images.s3.ap-south-1.amazonaws.com/options/xyz789.jpg?X-Amz-...',
  })
  imageUrl?: string | null;
}

export class SafeQuestionDto {
  @ApiProperty({
    description: 'Question ID',
    example: '64f123456789abcdef123456',
  })
  _id: string;

  @ApiProperty({
    description: 'Question text with language support',
    type: QuestionTextDto,
  })
  questionText: QuestionTextDto;

  @ApiPropertyOptional({
    description: 'Option type for this question',
    enum: ['text', 'image'],
    example: 'text',
  })
  optionType?: string;

  @ApiProperty({
    description: 'Array of options',
    type: [QuestionOptionDto],
  })
  options: QuestionOptionDto[];

  @ApiPropertyOptional({
    description: 'Subject reference',
    example: '64f123456789abcdef123456',
  })
  subject?: string;

  @ApiPropertyOptional({
    description: 'Topic reference',
    example: '64f123456789abcdef123456',
  })
  topic?: string;

  @ApiPropertyOptional({
    description: 'Difficulty level',
    enum: ['easy', 'medium', 'hard'],
    example: 'medium',
  })
  difficultyLevel?: string;

  @ApiPropertyOptional({
    description:
      'Tag names on this question. Empty when the question has no tag.',
    type: [String],
  })
  tags?: string[];

  @ApiPropertyOptional({
    description:
      'Present on full-exam papers that have subject blocks. Same number as sessions[].order on session-wise papers. Omitted for topic-wise papers. Do not group by live question.subject.',
    example: 0,
  })
  sessionOrder?: number;
}

export class ExamSummaryDto {
  @ApiProperty({
    description: 'Exam ID',
    example: '64f123456789abcdef123456',
  })
  id: string;

  @ApiProperty({
    description: 'Exam name',
    example: 'SSC CGL',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Exam description',
    example: 'Staff Selection Commission Combined Graduate Level',
  })
  description?: string;

  @ApiProperty({
    description:
      'Whether the exam supports bilingual questions. When false, clients should hide the language toggle.',
    example: false,
  })
  hasMultiLingualSupport: boolean;

  @ApiPropertyOptional({
    description:
      'Score-percent cutoffs for result messages. Omitted when the exam uses app defaults.',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        key: { type: 'string', example: 'good' },
        minPercent: { type: 'number', example: 40 },
      },
    },
  })
  performanceBands?: { key: string; minPercent: number }[];
}

export class SubjectSummaryDto {
  @ApiProperty({
    description: 'Subject ID',
    example: '64f123456789abcdef123456',
  })
  id: string;

  @ApiProperty({
    description: 'Subject name',
    example: 'Quantitative Aptitude',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Subject description',
    example: 'Mathematics and problem solving',
  })
  description?: string;
}

export class TopicSummaryDto {
  @ApiProperty({
    description: 'Topic ID',
    example: '64f123456789abcdef123456',
  })
  id: string;

  @ApiProperty({
    description: 'Topic name',
    example: 'Ratio & Proportion',
  })
  name: string;
}

export class AttemptTestMetadataDto {
  @ApiProperty({
    description: 'Mock test title',
    example: 'Daily Practice Test 1',
  })
  title: string;

  @ApiProperty({
    description:
      'Paper duration in minutes. Topic-wise / mixed: this is the live timer. Session-wise: this is the SUM of subject session times — the live timer is sessions[currentSessionIndex].durationInMinutes.',
    example: 30,
  })
  durationInMinutes: number;

  @ApiProperty({
    description: 'Total number of questions',
    example: 30,
  })
  totalQuestions: number;

  @ApiProperty({
    description: 'When the attempt was started',
    example: '2026-02-15T10:00:00.000Z',
  })
  startedAt: Date;

  @ApiPropertyOptional({
    description: 'Marks per question',
    example: 4,
  })
  marksPerQuestion?: number;

  @ApiPropertyOptional({
    description: 'Negative marking per wrong answer',
    example: 1,
  })
  negativeMarking?: number;

  @ApiPropertyOptional({
    description: 'Passing score',
    example: 50,
  })
  passingScore?: number;

  @ApiPropertyOptional({
    description:
      'TOPIC_WISE opens Daily Practice; FULL_EXAM opens Full Mocks; SPRINT opens Sprint Tests.',
    enum: ['TOPIC_WISE', 'FULL_EXAM', 'SPRINT'],
    example: 'TOPIC_WISE',
  })
  paperType?: 'TOPIC_WISE' | 'FULL_EXAM' | 'SPRINT';

  @ApiProperty({
    description: 'Exam details',
    type: ExamSummaryDto,
  })
  exam: ExamSummaryDto;

  @ApiPropertyOptional({
    description: 'Subject details (topic-wise papers only)',
    type: SubjectSummaryDto,
  })
  subject?: SubjectSummaryDto;

  @ApiPropertyOptional({
    description: 'Topic details (optional)',
    type: TopicSummaryDto,
  })
  topic?: TopicSummaryDto;

  @ApiPropertyOptional({
    description:
      'True when the student must finish one subject before the next (per-subject timers). False/omitted: one paper timer, show all questions. Branch the take-test UI on this flag.',
  })
  isSessionWise?: boolean;

  @ApiPropertyOptional({
    description:
      'Session-wise only (omitted otherwise). Current subject is the item with status IN_PROGRESS (or index currentSessionIndex). Prefer questionIds over startIndex/endIndex.',
    type: [AttemptSessionDto],
  })
  sessions?: AttemptSessionDto[];

  @ApiPropertyOptional({
    description:
      'Session-wise only. Index of the active session. Timer fields on resume apply to this session.',
  })
  currentSessionIndex?: number;
}

export class StartAttemptResponseDto {
  @ApiProperty({
    description: 'Attempt ID',
    example: '64f123456789abcdef123456',
  })
  attemptId: string;

  @ApiProperty({
    description: 'Mock test metadata',
    type: AttemptTestMetadataDto,
  })
  mockTestData: AttemptTestMetadataDto;

  @ApiProperty({
    description:
      'Questions without keys/explanations, in locked paper order. Session-wise: full paper, contiguous subject blocks, each item has sessionOrder — show only the current session. Topic-wise: omit sessionOrder, show all.',
    type: [SafeQuestionDto],
  })
  questions: SafeQuestionDto[];
}
