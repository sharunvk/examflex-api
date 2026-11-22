import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';
import { sanitizePersonName } from '../../common/person-name';
import { IsPersonName } from '../../common/validators/is-person-name.validator';

export class CompleteOnboardingDto {
  @ApiProperty({ description: 'Full name', example: 'Rahul Sharma' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @IsPersonName()
  @Transform(({ value }) =>
    typeof value === 'string' ? sanitizePersonName(value) : value,
  )
  name: string;

  @ApiProperty({
    description: 'The one exam the learner is preparing for',
    example: '64f123456789abcdef123456',
  })
  @IsMongoId()
  targetExamId: string;
}
