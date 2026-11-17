import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  MISTAKE_TRIP_REASONS,
  MistakeTripReason,
} from '../mistake-book.constants';

export class UpdateTripReasonDto {
  @ApiProperty({
    description: 'Why this question tripped the student up',
    enum: MISTAKE_TRIP_REASONS,
    example: 'concept-gap',
  })
  @IsIn(MISTAKE_TRIP_REASONS)
  tripReason: MistakeTripReason;
}
