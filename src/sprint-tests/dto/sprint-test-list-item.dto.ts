import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccessMode } from '../../common/enums/access-mode.enum';
import { UserAttemptAction } from '../../common/enums/user-attempt-action.enum';
import { AccessResponseDto } from '../../access/dto/access-response.dto';
import { AttemptSummaryDto } from '../../mock-tests/dto/attempt-summary.dto';
import { SprintQuestionItemDto } from './sprint-draft-response.dto';

export class SprintExamRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string;
}

export class SprintTestListItemDto {
  @ApiProperty()
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

  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  totalQuestions: number;

  @ApiProperty()
  durationInMinutes: number;

  @ApiProperty({
    description: 'Total marks (totalQuestions × marksPerQuestion)',
    example: 40,
  })
  totalMarks: number;

  @ApiProperty({ type: SprintExamRefDto, nullable: true })
  exam: SprintExamRefDto | null;

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

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ enum: UserAttemptAction })
  userAttemptAction: UserAttemptAction;

  @ApiPropertyOptional()
  resumeAttemptId?: string;

  @ApiPropertyOptional({
    description:
      'Authenticated-only card snapshot (progress, scores, Mistake Book teaser). Omitted for anonymous lists.',
    type: AttemptSummaryDto,
  })
  attemptSummary?: AttemptSummaryDto;

  @ApiPropertyOptional({
    description:
      'Admin only. Safe stems in paper order. Students start an attempt to receive questions.',
    type: [SprintQuestionItemDto],
  })
  questions?: SprintQuestionItemDto[];
}
