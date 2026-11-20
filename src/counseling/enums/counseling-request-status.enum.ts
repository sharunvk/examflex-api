export enum CounselingRequestStatus {
  BOOKED = 'booked',
  ACKNOWLEDGED = 'acknowledged',
  RESPONDED = 'responded',
  COMPLETED = 'completed',
}

export const ACTIVE_COUNSELING_STATUSES: readonly CounselingRequestStatus[] = [
  CounselingRequestStatus.BOOKED,
  CounselingRequestStatus.ACKNOWLEDGED,
  CounselingRequestStatus.RESPONDED,
] as const;

export const COUNSELING_STATUS_TRANSITIONS: Readonly<
  Partial<Record<CounselingRequestStatus, CounselingRequestStatus>>
> = {
  [CounselingRequestStatus.BOOKED]: CounselingRequestStatus.ACKNOWLEDGED,
  [CounselingRequestStatus.ACKNOWLEDGED]: CounselingRequestStatus.RESPONDED,
  [CounselingRequestStatus.RESPONDED]: CounselingRequestStatus.COMPLETED,
};
