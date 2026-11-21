import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsMongoId,
  IsNumber,
  IsPositive,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const MAX_COURSE_CUTOFFS = 50;

/** One course cut-off supplied when publishing a full mock. */
export class CourseCutoffEntryDto {
  @ApiProperty({
    description:
      'Recommendation course (offering) id. Must be an active COURSE of the same exam.',
    example: '64f123456789abcdef123456',
  })
  @IsMongoId()
  offeringId: string;

  @ApiProperty({
    description:
      "Cut-off in absolute marks on this paper's scale (e.g. 620 of 720). Must be > 0 and <= the paper's total marks. Omit the course to leave it without a cut-off.",
    example: 620,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  cutoffMarks: number;
}

/** One edit on `PATCH /full-mock-tests/:id/course-cutoffs`. */
export class UpdateCourseCutoffEntryDto {
  @ApiProperty({ example: '64f123456789abcdef123456' })
  @IsMongoId()
  offeringId: string;

  @ApiProperty({
    description: "New cut-off marks, or null to remove this course's cut-off.",
    example: 620,
    nullable: true,
    type: Number,
  })
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  cutoffMarks: number | null;
}

export class UpdateCourseCutoffsDto {
  @ApiProperty({
    description:
      'Courses to upsert (number) or clear (null). Courses not listed keep their stored cut-off.',
    type: [UpdateCourseCutoffEntryDto],
  })
  @IsArray()
  @ArrayMaxSize(MAX_COURSE_CUTOFFS)
  @ValidateNested({ each: true })
  @Type(() => UpdateCourseCutoffEntryDto)
  courseCutoffs: UpdateCourseCutoffEntryDto[];
}

/** Admin-only view of a stored cut-off. */
export class CourseCutoffResponseDto {
  @ApiProperty({ example: '64f123456789abcdef123456' })
  offeringId: string;

  @ApiProperty({ example: 620 })
  cutoffMarks: number;
}
