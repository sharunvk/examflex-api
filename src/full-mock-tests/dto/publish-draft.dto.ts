import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AccessMode } from '../../common/enums/access-mode.enum';
import { CourseCutoffEntryDto, MAX_COURSE_CUTOFFS } from './course-cutoff.dto';

export class PublishDraftDto {
  @ApiPropertyOptional({
    description:
      'Paper access mode. FREE = no entitlement required; ENTITLED = requires covering entitlement. Defaults to FREE.',
    enum: AccessMode,
    default: AccessMode.FREE,
  })
  @IsOptional()
  @IsEnum(AccessMode)
  accessMode?: AccessMode;

  @ApiPropertyOptional({
    description:
      'Title shown to students. Defaults to the exam name if omitted.',
    example: 'SSC CGL Tier 1 Full Mock 12',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => value?.trim())
  title?: string;

  @ApiPropertyOptional({
    description: 'Optional description shown on the student list',
    maxLength: 1000,
    example: 'Full-length paper matching the official CGL Tier 1 pattern',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => value?.trim())
  description?: string;

  @ApiPropertyOptional({
    description:
      'Whether students may start another attempt after completing one',
    default: true,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  allowRetake?: boolean;

  @ApiPropertyOptional({
    description:
      'Shuffle options within each subject block at attempt time. Does not reorder subjects or questions.',
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  shuffleOptions?: boolean;

  @ApiPropertyOptional({
    description:
      'Mixed papers only. When true, publish groups questions into contiguous blocks in exam subject order (all of the first subject, then the next). When false or omitted, the shuffled draft order is kept. Session-wise papers always stay in exam subject order; this flag does not change them.',
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  keepSubjectOrder?: boolean;

  @ApiPropertyOptional({
    description:
      'Show correct answers and explanations immediately after submit',
    default: true,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  showResultsImmediately?: boolean;

  @ApiPropertyOptional({
    description: 'Absolute passing score (not a percentage). Optional.',
    example: 120,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  passingScore?: number;

  @ApiPropertyOptional({
    description:
      "Optional per-course cut-off marks for this paper, in absolute marks on the paper's scale. Only courses the admin fills in need to be sent.",
    type: [CourseCutoffEntryDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COURSE_CUTOFFS)
  @ValidateNested({ each: true })
  @Type(() => CourseCutoffEntryDto)
  courseCutoffs?: CourseCutoffEntryDto[];
}
