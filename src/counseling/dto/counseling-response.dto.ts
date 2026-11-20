import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';
import { CounselingRequestStatus } from '../enums/counseling-request-status.enum';
import { CounselingWhoWillJoin } from '../enums/counseling-who-will-join.enum';

export class CounselingAccountSnapshotDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  name: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  email: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  phone: string | null;
}

export class CounselingContactDto {
  @ApiProperty()
  emailEnabled: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  email: string | null;

  @ApiProperty()
  phoneEnabled: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  phone: string | null;
}

export class CounselingRequestDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ type: CounselingAccountSnapshotDto })
  accountSnapshot: CounselingAccountSnapshotDto;

  @ApiPropertyOptional({ nullable: true, type: String })
  studentName: string | null;

  @ApiProperty({ enum: CounselingWhoWillJoin })
  whoWillJoin: CounselingWhoWillJoin;

  @ApiPropertyOptional({ nullable: true, type: String })
  courseInterestedIn: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  expectedMark: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  twelfthMarks: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  state: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  category: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  preferredDayTime: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  talkAbout: string | null;

  @ApiProperty({ type: CounselingContactDto })
  contact: CounselingContactDto;

  @ApiProperty({ enum: CounselingRequestStatus })
  status: CounselingRequestStatus;

  @ApiProperty()
  statusUpdatedAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CounselingActiveRequestDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    enum: [
      CounselingRequestStatus.BOOKED,
      CounselingRequestStatus.ACKNOWLEDGED,
      CounselingRequestStatus.RESPONDED,
    ],
  })
  status:
    | CounselingRequestStatus.BOOKED
    | CounselingRequestStatus.ACKNOWLEDGED
    | CounselingRequestStatus.RESPONDED;

  @ApiProperty()
  createdAt: Date;
}

export class CounselingMeDto {
  @ApiProperty({
    description: 'True when the learner may submit a new counseling request',
  })
  canRequest: boolean;

  @ApiProperty({ type: CounselingActiveRequestDto, nullable: true })
  activeRequest: CounselingActiveRequestDto | null;
}

export class CounselingMeApiResponseDto {
  @ApiProperty({ example: 'Counseling status retrieved successfully' })
  message: string;

  @ApiProperty({ type: CounselingMeDto })
  data: CounselingMeDto;
}

export class CounselingCreatedApiResponseDto {
  @ApiProperty({ example: 'Counseling session requested successfully' })
  message: string;

  @ApiProperty({ type: CounselingRequestDto })
  data: CounselingRequestDto;
}

export class CounselingListApiResponseDto {
  @ApiProperty({ example: 'Counseling requests retrieved successfully' })
  message: string;

  @ApiProperty({ type: [CounselingRequestDto] })
  data: CounselingRequestDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class CounselingStatusUpdatedApiResponseDto {
  @ApiProperty({ example: 'Counseling request status updated successfully' })
  message: string;

  @ApiProperty({ type: CounselingRequestDto })
  data: CounselingRequestDto;
}
