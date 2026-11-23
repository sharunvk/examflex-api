import { Exclude, Expose, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubjectTopicDto {
  @ApiProperty({
    description: 'Topic ID',
    example: '64f123456789abcdef123456',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Topic name',
    example: 'Ratio & Proportion',
  })
  @Expose()
  name: string;
}

export class SubjectResponseDto {
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
    description: 'Topics associated with this subject',
    type: [SubjectTopicDto],
  })
  @Expose()
  @Type(() => SubjectTopicDto)
  topics: SubjectTopicDto[];

  @ApiPropertyOptional({
    description: 'NCERT vector subject key, if this subject is mapped',
    example: 'physics',
    nullable: true,
  })
  @Expose()
  vectorSubjectKey?: string | null;

  @ApiProperty({
    description: 'Whether the subject is active',
    example: true,
  })
  @Expose()
  isActive: boolean;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2026-05-10T10:00:00.000Z',
  })
  @Expose()
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2026-05-10T10:00:00.000Z',
  })
  @Expose()
  updatedAt: Date;

  @Exclude()
  isDeleted: boolean;

  constructor(partial: Partial<SubjectResponseDto>) {
    Object.assign(this, partial);
  }
}
