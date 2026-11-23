import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SafeQuestionDto } from '../../mock-test-attempts/dto/start-attempt-response.dto';

export class DraftQuestionItemDto extends SafeQuestionDto {
  @ApiProperty({
    description: '0-based position across the whole paper',
    example: 0,
  })
  position: number;

  @ApiProperty({
    description:
      'Marks for a correct answer (copied from the exam subject row)',
    example: 2,
  })
  marksPerQuestion: number;

  @ApiProperty({
    description:
      'Negative marks for a wrong answer (0 if the subject has no negative marking)',
    example: 0.5,
  })
  negativeMarking: number;

  @ApiPropertyOptional({
    description: 'Previous question ID if an admin replaced this slot',
    example: '64f123456789abcdef123456',
  })
  replacedFrom?: string;

  @ApiPropertyOptional({
    description: 'Correct option id (admin-only review)',
    example: 'a',
  })
  correctAnswer?: string;
}
