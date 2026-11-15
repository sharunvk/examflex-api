import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AccessMode } from '../../common/enums/access-mode.enum';
import { DifficultyDistributionInputDto } from './create-topic-wise-mock-test.dto';

export const TOPIC_WISE_SIZE_OPTIONS = [10, 15, 20, 25, 30] as const;

export class CreateTopicWiseDraftDto {
  @ApiProperty({
    description:
      'Exam the questions must be tagged to. Inactive exams are rejected.',
  })
  @IsMongoId()
  exam: string;

  @ApiProperty({ enum: TOPIC_WISE_SIZE_OPTIONS })
  @IsIn(TOPIC_WISE_SIZE_OPTIONS)
  totalQuestions: number;

  @ApiProperty({ enum: TOPIC_WISE_SIZE_OPTIONS })
  @IsIn(TOPIC_WISE_SIZE_OPTIONS)
  durationInMinutes: number;

  @ApiPropertyOptional({
    description:
      'Required when questionIds is omitted. The paper is sampled from this subject.',
  })
  @ValidateIf((dto: CreateTopicWiseDraftDto) => !dto.questionIds?.length)
  @IsMongoId()
  subject?: string;

  @ApiPropertyOptional({
    description:
      'Required when questionIds is omitted. Every sampled question must have this topic, and the topic must belong to the subject. On the hand-picked path, topic is inferred from the selected questions.',
  })
  @ValidateIf((dto: CreateTopicWiseDraftDto) => !dto.questionIds?.length)
  @IsMongoId()
  topic?: string;

  @ApiPropertyOptional({ type: DifficultyDistributionInputDto })
  @ValidateIf((dto: CreateTopicWiseDraftDto) => !dto.questionIds?.length)
  @ValidateNested()
  @Type(() => DifficultyDistributionInputDto)
  difficultyDistribution?: DifficultyDistributionInputDto;

  @ApiPropertyOptional({
    description:
      'When set, these questions are frozen in this order instead of sampling. Length must equal totalQuestions. Every question must share one subject and one topic, be active, have a difficulty, and be tagged to exam.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(10)
  @ArrayMaxSize(30)
  @IsMongoId({ each: true })
  questionIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: ['STATIC', 'DYNAMIC'] })
  @IsOptional()
  @IsEnum(['STATIC', 'DYNAMIC'])
  generationMode?: 'STATIC' | 'DYNAMIC';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  marksPerQuestion?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  negativeMarking?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  passingScore?: number;

  @ApiPropertyOptional({ enum: AccessMode, default: AccessMode.FREE })
  @IsOptional()
  @IsEnum(AccessMode)
  accessMode?: AccessMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowRetake?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  shuffleOptions?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showResultsImmediately?: boolean;
}
