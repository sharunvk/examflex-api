import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttemptSessionDto } from './attempt-session.dto';

/**
 * Basic info DTO for exam/subject/topic
 */
class BasicInfoDto {
  @ApiProperty({ description: 'ID' })
  id: string;

  @ApiProperty({ description: 'Name' })
  name: string;

  @ApiPropertyOptional({ description: 'Description' })
  description?: string;

  @ApiPropertyOptional({
    description:
      'Present on exam refs. When false, clients should hide the language toggle.',
  })
  hasMultiLingualSupport?: boolean;

  @ApiPropertyOptional({
    description:
      'Present on exam refs. Score-percent cutoffs for result messages.',
  })
  performanceBands?: { key: string; minPercent: number }[];
}

class QuestionOptionDto {
  @ApiProperty({ description: 'Option ID (UUID)' })
  id: string;

  @ApiProperty({ description: 'Option type (text/image)' })
  type: string;

  @ApiProperty({ description: 'Option text in English', nullable: true })
  en: string | null;

  @ApiProperty({ description: 'Option text in Malayalam', nullable: true })
  ml: string | null;

  @ApiProperty({ description: 'Option image URL', nullable: true })
  url: string | null;
}

class QuestionTextDto {
  @ApiProperty({ description: 'Question text', nullable: true })
  text: string | null;

  @ApiProperty({ description: 'Question image URL', nullable: true })
  image: string | null;
}

class AttemptQuestionDto {
  @ApiProperty({ description: 'Question ID' })
  _id: string;

  @ApiProperty({ description: 'Localized question text' })
  questionText: Record<string, QuestionTextDto>;

  @ApiProperty({ description: 'Answer options', type: [QuestionOptionDto] })
  options: QuestionOptionDto[];

  @ApiProperty({ description: 'Subject ID' })
  subject: string;

  @ApiPropertyOptional({
    description:
      'Display name of the question subject. Present when the subject could be resolved.',
    example: 'Physics',
  })
  subjectName?: string;

  @ApiPropertyOptional({
    description: 'Question difficulty',
    enum: ['easy', 'medium', 'hard'],
  })
  difficultyLevel?: 'easy' | 'medium' | 'hard';

  @ApiPropertyOptional({
    description:
      'Which subject block this question belongs to (sessions[].order when session-wise). Omitted for topic-wise papers.',
    example: 0,
  })
  sessionOrder?: number;

  @ApiPropertyOptional({
    description: 'Selected option ID (only for IN_PROGRESS attempts)',
  })
  selectedOption?: string | null;

  @ApiPropertyOptional({
    description: 'Correct answer (only shown after submission if allowed)',
  })
  correctAnswer?: string;

  @ApiPropertyOptional({
    description: 'Whether answer was correct (only after submission)',
  })
  isCorrect?: boolean;

  @ApiPropertyOptional({
    description: 'Marks awarded for this question (only after submission)',
  })
  marksAwarded?: number;

  @ApiPropertyOptional({
    description: 'Explanation (only shown after submission if allowed)',
  })
  explanation?: Record<string, string>;
}

class TestMetadataDto {
  @ApiPropertyOptional({
    description:
      'Id of the mock test (paper) this attempt belongs to. Used to deep-link to the Mistake Book session for the paper.',
    example: '64f123456789abcdef123456',
  })
  mockTestId?: string;

  @ApiProperty({ description: 'Mock test title' })
  title: string;

  @ApiProperty({ description: 'Test duration in minutes' })
  durationInMinutes: number;

  @ApiProperty({ description: 'Total number of questions' })
  totalQuestions: number;

  @ApiProperty({ description: 'When the attempt started' })
  startedAt: Date;

  @ApiProperty({ description: 'Marks per correct answer' })
  marksPerQuestion: number;

  @ApiProperty({ description: 'Negative marking per wrong answer' })
  negativeMarking: number;

  @ApiProperty({ description: 'Minimum score to pass', nullable: true })
  passingScore: number | null;

  @ApiPropertyOptional({
    description: 'Whether results are shown immediately after submission',
  })
  showResultsImmediately?: boolean;

  @ApiPropertyOptional({
    description:
      'TOPIC_WISE opens Daily Practice; FULL_EXAM opens Full Mocks; SPRINT opens Sprint Tests.',
    enum: ['TOPIC_WISE', 'FULL_EXAM', 'SPRINT'],
  })
  paperType?: 'TOPIC_WISE' | 'FULL_EXAM' | 'SPRINT';

  @ApiProperty({ description: 'Exam information', type: BasicInfoDto })
  exam: BasicInfoDto;

  @ApiPropertyOptional({
    description: 'Subject information (topic-wise papers)',
    type: BasicInfoDto,
  })
  subject?: BasicInfoDto;

  @ApiPropertyOptional({
    description: 'Topic information (optional)',
    type: BasicInfoDto,
  })
  topic?: BasicInfoDto;
}

export class AttemptDetailResponseDto {
  @ApiProperty({ description: 'Attempt ID' })
  attemptId: string;

  @ApiProperty({ description: 'Attempt status' })
  status: string;

  @ApiProperty({ description: 'Test metadata (frozen configuration)' })
  test: TestMetadataDto;

  @ApiProperty({
    description:
      'Questions with options and selected answers. Session-wise: grouped by session; each item has sessionOrder. Topic-wise: sessionOrder omitted.',
    type: [AttemptQuestionDto],
  })
  questions: AttemptQuestionDto[];

  @ApiPropertyOptional({ description: 'Time elapsed in seconds' })
  timeElapsed?: number;

  @ApiPropertyOptional({ description: 'Time remaining in seconds' })
  timeRemaining?: number;

  @ApiPropertyOptional({
    description:
      'Total time spent on the paper in seconds, summed across sections for session-wise papers (only for submitted or expired attempts)',
  })
  timeTaken?: number;

  @ApiPropertyOptional({
    description: 'Final score (only for submitted attempts)',
  })
  score?: number;

  @ApiPropertyOptional({
    description:
      'Maximum possible marks for the paper (sum of per-question marks). Present for submitted or expired attempts.',
  })
  totalScore?: number;

  @ApiPropertyOptional({
    description: 'When submitted (only for submitted attempts)',
  })
  submittedAt?: Date;

  @ApiPropertyOptional({
    description: 'Correct answers count (only for submitted attempts)',
  })
  correctAnswers?: number;

  @ApiPropertyOptional({
    description: 'Incorrect answers count (only for submitted attempts)',
  })
  incorrectAnswers?: number;

  @ApiPropertyOptional({
    description: 'Unanswered questions count (only for submitted attempts)',
  })
  unansweredQuestions?: number;

  @ApiPropertyOptional({
    description: 'Whether passed (only for submitted attempts)',
  })
  isPassed?: boolean;

  @ApiPropertyOptional({
    description:
      'Session-wise only. Prefer sessions[].questionIds and question.sessionOrder over startIndex/endIndex.',
    type: [AttemptSessionDto],
  })
  sessions?: AttemptSessionDto[];

  @ApiPropertyOptional({
    description: 'Index of the active session (session-wise only)',
    example: 0,
  })
  currentSessionIndex?: number;

  @ApiPropertyOptional({
    description: 'True when this attempt is a session-wise full exam',
    example: true,
  })
  isSessionWise?: boolean;
}
