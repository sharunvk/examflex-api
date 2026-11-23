import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsArray,
  IsMongoId,
  IsOptional,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateSubjectDto {
  @ApiProperty({
    description: 'Subject name',
    example: 'Quantitative Aptitude',
    minLength: 2,
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    description: 'Subject description',
    example: 'Mathematics and problem solving',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Array of topic IDs',
    example: ['64f123456789abcdef123456', '64f123456789abcdef123457'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  topics?: string[];

  @ApiPropertyOptional({
    description:
      'Key of an NCERT vector subject from instance_configs.vectorSearch.subjects (e.g. "physics"). ' +
      'Questions in a mapped subject get citations. Send null on update to remove the mapping.',
    example: 'physics',
    nullable: true,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(60)
  vectorSubjectKey?: string | null;
}
