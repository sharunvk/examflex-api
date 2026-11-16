import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { SubjectTopicDto } from './subject-response.dto';

export class SubjectForExamResponseDto {
  @ApiProperty({
    description: 'Subject ID',
    example: '64f123456789abcdef123456',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Subject name',
    example: 'Quantitative Aptitude',
  })
  @Expose()
  name: string;

  @ApiPropertyOptional({
    description: 'Subject description',
    example: 'Mathematics and problem solving',
  })
  @Expose()
  description?: string;

  @ApiProperty({
    description:
      'Active topics on this subject (for chapter-wise filters). Empty when none.',
    type: [SubjectTopicDto],
  })
  @Expose()
  @Type(() => SubjectTopicDto)
  topics: SubjectTopicDto[];

  constructor(partial: Partial<SubjectForExamResponseDto>) {
    Object.assign(this, partial);
    this.topics = partial.topics ?? [];
  }
}
