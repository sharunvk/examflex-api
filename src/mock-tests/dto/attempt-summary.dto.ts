import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export type AttemptSummaryStatus =
  | 'NONE'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED';

/** Lightweight per-paper attempt snapshot for catalog cards (no question bank). */
export class AttemptSummaryDto {
  @ApiProperty({
    description: 'Card lifecycle status derived from the user attempt history',
    enum: ['NONE', 'IN_PROGRESS', 'PAUSED', 'COMPLETED'],
    example: 'COMPLETED',
  })
  @Expose()
  status: AttemptSummaryStatus;

  @ApiPropertyOptional({
    description:
      'Active IN_PROGRESS/PAUSED attempt id (same as resumeAttemptId when present)',
    example: '64f123456789abcdef123456',
  })
  @Expose()
  activeAttemptId?: string;

  @ApiPropertyOptional({
    description: 'Questions with a selected option on the active attempt',
    example: 4,
  })
  @Expose()
  answeredCount?: number;

  @ApiPropertyOptional({
    description: 'Seconds left on the active attempt timer',
    example: 370,
  })
  @Expose()
  timeRemainingSeconds?: number;

  @ApiPropertyOptional({
    description: 'Seconds elapsed on the active attempt timer',
    example: 230,
  })
  @Expose()
  timeElapsedSeconds?: number;

  @ApiProperty({
    description: 'Count of SUBMITTED + EXPIRED attempts for this paper',
    example: 2,
  })
  @Expose()
  attemptCount: number;

  @ApiPropertyOptional({
    description: 'Best score among completed attempts',
    example: 32,
  })
  @Expose()
  bestScore?: number;

  @ApiPropertyOptional({
    description: 'Best correct-answer count among completed attempts',
    example: 8,
  })
  @Expose()
  bestCorrectAnswers?: number;

  @ApiPropertyOptional({
    description: 'Latest completed attempt id (for Review)',
    example: '64f123456789abcdef123456',
  })
  @Expose()
  lastAttemptId?: string;

  @ApiPropertyOptional({
    description: 'Score on the latest completed attempt',
    example: 28,
  })
  @Expose()
  lastScore?: number;

  @ApiPropertyOptional({
    description: 'Correct answers on the latest completed attempt',
    example: 7,
  })
  @Expose()
  lastCorrectAnswers?: number;

  @ApiPropertyOptional({
    description: 'Seconds consumed on the latest completed attempt',
    example: 460,
  })
  @Expose()
  lastTimeTakenSeconds?: number;

  @ApiPropertyOptional({
    description:
      'Incorrect answers on the latest completed attempt (Mistake Book teaser)',
    example: 2,
  })
  @Expose()
  lastIncorrectAnswers?: number;

  constructor(partial: Partial<AttemptSummaryDto>) {
    Object.assign(this, partial);
  }
}
