import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

export class SubjectDifficultyDto {
  @ApiProperty({
    description: 'Subject id; must be one of the exam’s subjects.',
    example: '64f123456789abcdef123457',
  })
  @IsMongoId()
  subjectId: string;

  @ApiProperty({ example: 10, description: 'Easy questions for this subject' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  easy: number;

  @ApiProperty({
    example: 10,
    description: 'Medium questions for this subject',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  medium: number;

  @ApiProperty({ example: 5, description: 'Hard questions for this subject' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  hard: number;
}

export class CreateDraftDto {
  @ApiProperty({
    description:
      'Exam ID from GET /full-mock-tests/exams. The paper is sampled to match this exam’s subject quotas, marks, duration, and session rules. Fails with BLUEPRINT_INVALID or BANK_SHORTAGE if the exam or question bank cannot support a full paper.',
    example: '64f123456789abcdef123456',
  })
  @IsMongoId()
  examId: string;

  @ApiPropertyOptional({
    type: [SubjectDifficultyDto],
    description:
      'Optional explicit easy/medium/hard split per exam subject. When sent it must list every exam subject exactly once and easy+medium+hard must equal that subject’s numberOfQuestions. Fails with DIFFICULTY_DISTRIBUTION_INVALID, or BANK_SHORTAGE listing every subject/difficulty that lacks questions. When omitted, difficulty is not controlled (legacy behaviour).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubjectDifficultyDto)
  difficultyDistribution?: SubjectDifficultyDto[];
}
