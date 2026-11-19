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

export class AnalysisPathwayDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  subtitle?: string;

  @ApiProperty()
  minPercent: number;

  @ApiProperty()
  comfortPercent: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'User average of last N full mocks; null when none',
  })
  userPercent: number | null;

  @ApiProperty({ description: '0–1 progress toward min threshold' })
  progress01: number;

  @ApiProperty({ enum: ['below', 'borderline', 'comfortable'] })
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
