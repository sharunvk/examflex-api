import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type TodayMode = 'empty' | 'active';
export type TodaySessionStepState = 'active' | 'locked' | 'done';

export class TodayOverviewDto {
  @ApiProperty({ example: 'WELCOME TO YOUR STUDY SPACE' })
  eyebrow: string;

  @ApiProperty({ example: 'One good step at a time.' })
  headline: string;

  @ApiProperty()
  subhead: string;

  @ApiProperty({ example: 'examflex  /  Your pace, your plan' })
  paceBadge: string;
}

export class TodayNextStepDto {
  @ApiProperty()
  eyebrow: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty()
  ctaLabel: string;

  @ApiProperty()
  ctaHref: string;

  @ApiProperty()
  aside: string;

  @ApiProperty({
    description: 'Show the 4-step path illustration (empty / first-mock CTA)',
  })
  showPath: boolean;
}

export class TodaySessionStepDto {
  @ApiProperty({ example: '01' })
  index: string;

  @ApiProperty()
  label: string;

  @ApiProperty({ enum: ['active', 'locked', 'done'] })
  state: TodaySessionStepState;
}

export class TodaySessionPlanDto {
  @ApiProperty()
  eyebrow: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: [TodaySessionStepDto] })
  steps: TodaySessionStepDto[];
}

export class TodayMockAttemptDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  label: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null when the slot is a placeholder (empty state)',
  })
  score: number | null;
}

export class TodayLatestMockDto {
  @ApiProperty()
  title: string;

  @ApiProperty()
  meta: string;

  @ApiPropertyOptional({ nullable: true })
  score: number | null;

  @ApiProperty({ example: 720 })
  maxScore: number;

  @ApiPropertyOptional({ nullable: true })
  deltaLabel: string | null;

  @ApiPropertyOptional({ nullable: true })
  breakdown: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Empty-state callout over the score area',
  })
  placeholderMessage: string | null;

  @ApiProperty({ type: [TodayMockAttemptDto] })
  attempts: TodayMockAttemptDto[];
}

export class TodaySubjectInsightDto {
  @ApiProperty()
  subject: string;

  @ApiProperty({ example: '68%' })
  scoreLabel: string;

  @ApiProperty()
  tip: string;

  @ApiPropertyOptional({
    nullable: true,
    description: '0–100 for optional progress UI; null when empty',
  })
  averagePercent: number | null;
}

export class TodaySubjectInsightsSectionDto {
  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true })
  subhead: string | null;

  @ApiProperty({ type: [TodaySubjectInsightDto] })
  items: TodaySubjectInsightDto[];
}

export class TodayEquationBookDto {
  @ApiProperty()
  eyebrow: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty()
  ctaLabel: string;

  @ApiProperty()
  ctaHref: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Creative static promo pill (no due-count tracking)',
  })
  statusPill: string | null;
}

export class TodayMistakeBookDto {
  @ApiProperty()
  eyebrow: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty()
  ctaLabel: string;

  @ApiProperty()
  ctaHref: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Creative static promo pill',
  })
  statusPill: string | null;
}

export class TodayNextMockDto {
  @ApiProperty()
  eyebrow: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  meta: string;

  @ApiProperty()
  ctaLabel: string;

  @ApiProperty()
  ctaHref: string;
}

export class TodayPerspectiveDto {
  @ApiProperty()
  eyebrow: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty()
  ctaLabel: string;

  @ApiProperty()
  ctaHref: string;

  @ApiProperty({
    description: 'True until the student has a completed full-mock score',
  })
  locked: boolean;
}

export class TodayPageResponseDto {
  @ApiProperty({ enum: ['empty', 'active'] })
  mode: TodayMode;

  @ApiProperty()
  examId: string;

  @ApiProperty({ type: TodayOverviewDto })
  overview: TodayOverviewDto;

  @ApiProperty({ type: TodayNextStepDto })
  nextStep: TodayNextStepDto;

  @ApiProperty({ type: TodaySessionPlanDto })
  sessionPlan: TodaySessionPlanDto;

  @ApiProperty({ type: TodayLatestMockDto })
  latestMock: TodayLatestMockDto;

  @ApiProperty({ type: TodaySubjectInsightsSectionDto })
  subjectInsights: TodaySubjectInsightsSectionDto;

  @ApiProperty({ type: TodayEquationBookDto })
  equationBook: TodayEquationBookDto;

  @ApiProperty({ type: TodayMistakeBookDto })
  mistakeBook: TodayMistakeBookDto;

  @ApiProperty({ type: TodayNextMockDto })
  nextMock: TodayNextMockDto;

  @ApiProperty({ type: TodayPerspectiveDto })
  perspective: TodayPerspectiveDto;

  @ApiProperty()
  footerRight: string;
}

export class TodayApiResponseDto {
  @ApiProperty()
  message: string;

  @ApiProperty({ type: TodayPageResponseDto })
  data: TodayPageResponseDto;
}
