import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class MistakeBookSessionItemsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter remaining cards by subject id',
    example: '64f123456789abcdef123456',
  })
  @IsOptional()
  @IsMongoId()
  subjectId?: string;

  @ApiPropertyOptional({
    description: 'Filter remaining cards by topic (chapter) id',
    example: '64f123456789abcdef123456',
  })
  @IsOptional()
  @IsMongoId()
  topicId?: string;
}
