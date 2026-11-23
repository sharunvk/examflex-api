import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccessMode } from '../../common/enums/access-mode.enum';
import { SafeQuestionDto } from '../../mock-test-attempts/dto/start-attempt-response.dto';

export class TopicWiseDifficultyDistributionDto {
  @ApiProperty()
  easy: number;

  @ApiProperty()
  medium: number;

  @ApiProperty()
  hard: number;
}

export class TopicWiseDraftQuestionItemDto extends SafeQuestionDto {
  @ApiProperty()
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

export class TopicWiseDraftSubjectBlockDto {
  @ApiProperty()
  subjectId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: [TopicWiseDraftQuestionItemDto] })
  questions: TopicWiseDraftQuestionItemDto[];
}

export class TopicWiseDraftSettingsDto {
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

  @ApiProperty({ enum: ['STATIC', 'DYNAMIC'] })
  generationMode: string;

  @ApiProperty({ type: TopicWiseDifficultyDistributionDto })
  difficultyDistribution: TopicWiseDifficultyDistributionDto;
}

export class TopicWiseDraftResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  examId: string;

  @ApiProperty()
  examName: string;

  @ApiProperty()
  subjectId: string;

  @ApiProperty()
  subjectName: string;

  @ApiPropertyOptional()
  topicId?: string;

  @ApiPropertyOptional()
  topicName?: string;

  @ApiProperty({
    enum: ['GENERATING', 'REVIEW', 'PUBLISHING', 'PUBLISHED', 'DISCARDED'],
  })
  status: string;

  @ApiProperty({ type: TopicWiseDraftSettingsDto })
  settings: TopicWiseDraftSettingsDto;

  @ApiProperty({ type: [TopicWiseDraftSubjectBlockDto] })
  subjects: TopicWiseDraftSubjectBlockDto[];

  @ApiPropertyOptional()
  publishedMockTestId?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class TopicWiseDraftListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  examId: string;

  @ApiProperty()
  examName: string;

  @ApiProperty()
  subjectId: string;

  @ApiProperty()
  subjectName: string;

  @ApiPropertyOptional()
  topicId?: string;

  @ApiPropertyOptional()
  topicName?: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  totalQuestions: number;

  @ApiProperty()
  durationInMinutes: number;

  @ApiPropertyOptional()
  title?: string;

  @ApiProperty({ type: TopicWiseDifficultyDistributionDto })
  difficultyDistribution: TopicWiseDifficultyDistributionDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class TopicWiseSearchQuestionItemDto extends SafeQuestionDto {
  @ApiPropertyOptional()
  snippet?: string;
}

export class PublishTopicWiseDraftResultDto {
  @ApiProperty()
  mockTestId: string;

  @ApiProperty({ type: TopicWiseDraftResponseDto })
  draft: TopicWiseDraftResponseDto;
}
