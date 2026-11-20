import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { CounselingRequestStatus } from '../enums/counseling-request-status.enum';

export class UpdateCounselingStatusDto {
  @ApiProperty({
    enum: CounselingRequestStatus,
    description:
      'Next status only. Transitions are sequential: booked → acknowledged → responded → completed.',
  })
  @IsEnum(CounselingRequestStatus)
  status: CounselingRequestStatus;
}
