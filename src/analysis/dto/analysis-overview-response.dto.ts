import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnalysisExamRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  totalMarks?: number;
}

export class AnalysisFullMockAttemptDto {
  @ApiProperty()
  attemptId: string;

  @ApiProperty()
  label: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  score: number;

  @ApiProperty()
  maxScore: number;

  @ApiProperty()
  percent: number;

  @ApiProperty()
  submittedAt: string;
}

export class AnalysisLatestFullMockDto {
  @ApiProperty()
  attemptId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  score: number;

  @ApiProperty()
  maxScore: number;

  @ApiProperty()
  percent: number;

  @ApiProperty()
  submittedAt: string;

  @ApiPropertyOptional()
  deltaFromPrevious: number | null;

  @ApiPropertyOptional()
  correctCount?: number;

  @ApiPropertyOptional()
  incorrectCount?: number;

  @ApiPropertyOptional()
  skippedCount?: number;
}

export class AnalysisFullMocksSectionDto {
  @ApiProperty({ description: 'Completed FULL_EXAM attempts for this exam' })
  completedCount: number;

  @ApiProperty({ description: 'Target sample size for the bar chart' })
  targetCount: number;

  @ApiProperty({
    description: 'True when fewer than targetCount full mocks are finished',
  })
  needsMoreAttempts: boolean;

  @ApiPropertyOptional({ type: AnalysisLatestFullMockDto, nullable: true })
  latest: AnalysisLatestFullMockDto | null;

  @ApiProperty({
    type: [AnalysisFullMockAttemptDto],
    description: 'Up to 5 most recent full mocks, oldest → newest for charts',
  })
  recent: AnalysisFullMockAttemptDto[];
}

export type AnalysisPathwayStatus = 'NO_ATTEMPTS' | 'NO_CUTOFF' | 'EVALUATED';

export class AnalysisPathwayDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  subtitle?: string;

  @ApiProperty({
    enum: ['NO_ATTEMPTS', 'NO_CUTOFF', 'EVALUATED'],
    description:
      'NO_ATTEMPTS: no completed full mock yet. NO_CUTOFF: attempts exist but none of the recent mocks has a cut-off for this course. EVALUATED: band/bar are meaningful.',
  })
  status: AnalysisPathwayStatus;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Recency-weighted marks over the last <=10 full mocks. When EVALUATED it only counts mocks that have a cut-off for this course; when NO_CUTOFF it covers every mock in the window. Null when NO_ATTEMPTS.',
  })
  yourMarks: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Same-weighted average of the cut-off marks set on those mocks. Null unless EVALUATED.',
  })
  cutoffMarks: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'cutoffMarks plus the 5% comfort margin. Null unless EVALUATED.',
  })
  comfortMarks: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'yourMarks - cutoffMarks (negative = short of the cut-off). Null unless EVALUATED.',
  })
  gapMarks: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Scale for the bar: max score of the latest full mock, else the exam total marks.',
  })
  maxMarks: number | null;

  @ApiProperty({
    description: 'How many mocks are behind yourMarks / cutoffMarks',
  })
  attemptsConsidered: number;

  @ApiProperty({
    description: 'How many of the latest full mocks were looked at (<= 10)',
  })
  attemptsInWindow: number;

  @ApiProperty({
    deprecated: true,
    description:
      'DEPRECATED, derived: cutoffMarks / maxMarks * 100 (legacy minPercent when not EVALUATED).',
  })
  minPercent: number;

  @ApiProperty({
    deprecated: true,
    description: 'DEPRECATED, derived: comfortMarks / maxMarks * 100.',
  })
  comfortPercent: number;

  @ApiPropertyOptional({
    nullable: true,
    deprecated: true,
    description: 'DEPRECATED, derived: yourMarks / maxMarks * 100.',
  })
  userPercent: number | null;

  @ApiProperty({ description: '0–1: yourMarks / cutoffMarks, capped at 1' })
  progress01: number;

  @ApiProperty({
    enum: ['below', 'borderline', 'comfortable'],
    description:
      'Only meaningful when status is EVALUATED (otherwise "below").',
  })
  band: 'below' | 'borderline' | 'comfortable';

  @ApiProperty()
  message: string;
}

export class AnalysisPathwaysSectionDto {
  @ApiPropertyOptional({ nullable: true })
  averagePercent: number | null;

  @ApiProperty()
  attemptCountUsed: number;

  @ApiProperty({ type: [AnalysisPathwayDto] })
  offerings: AnalysisPathwayDto[];
}

export class AnalysisTopicInsightDto {
  @ApiProperty()
  topicId: string;

  @ApiProperty()
  topicName: string;

  @ApiProperty()
  attemptCount: number;

  @ApiProperty()
  averagePercent: number;

  @ApiProperty()
  isWeak: boolean;

  @ApiProperty()
  isStrong: boolean;
}

export class AnalysisSubjectInsightDto {
  @ApiProperty()
  subjectId: string;

  @ApiProperty()
  subjectName: string;

  @ApiProperty()
  attemptCount: number;

  @ApiProperty()
  averagePercent: number;

  @ApiProperty({ enum: ['Strong', 'Good', 'Weak'] })
  strengthLabel: 'Strong' | 'Good' | 'Weak';

  @ApiProperty({ type: [AnalysisTopicInsightDto] })
  topics: AnalysisTopicInsightDto[];

  @ApiPropertyOptional()
  tip?: string;
}

export class AnalysisSubjectsSectionDto {
  @ApiProperty({
    description: 'Evidence source for this section',
    example: 'TOPIC_WISE',
  })
  source: 'TOPIC_WISE';

  @ApiProperty()
  attemptCount: number;

  @ApiProperty()
  needsMoreAttempts: boolean;

  @ApiProperty({ type: [AnalysisSubjectInsightDto] })
  items: AnalysisSubjectInsightDto[];
}

export class AnalysisEngagementDto {
  @ApiProperty()
  hasFullMocks: boolean;

  @ApiProperty()
  hasChapterWise: boolean;

  @ApiProperty()
  fullMockTarget: number;

  @ApiProperty()
  fullMocksRemaining: number;
}

export class AnalysisOverviewResponseDto {
  @ApiProperty({ type: AnalysisExamRefDto })
  exam: AnalysisExamRefDto;

  @ApiProperty({ type: AnalysisFullMocksSectionDto })
  fullMocks: AnalysisFullMocksSectionDto;

  @ApiProperty({ type: AnalysisPathwaysSectionDto })
  pathways: AnalysisPathwaysSectionDto;

  @ApiProperty({ type: AnalysisSubjectsSectionDto })
  subjects: AnalysisSubjectsSectionDto;

  @ApiProperty({ type: AnalysisEngagementDto })
  engagement: AnalysisEngagementDto;
}

export class AnalysisOverviewApiResponseDto {
  @ApiProperty()
  message: string;

  @ApiProperty({ type: AnalysisOverviewResponseDto })
  data: AnalysisOverviewResponseDto;
}
