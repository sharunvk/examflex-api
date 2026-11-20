export const COUNSELING_DEFAULT_LIMIT = 12;
export const COUNSELING_MAX_LIMIT = 100;

export const COUNSELING_STUDENT_NAME_MAX = 120;
export const COUNSELING_COURSE_MAX = 120;
export const COUNSELING_EXPECTED_MARK_MAX = 80;
export const COUNSELING_TWELFTH_MARKS_MAX = 80;
export const COUNSELING_STATE_MAX = 80;
export const COUNSELING_CATEGORY_MAX = 80;
export const COUNSELING_PREFERRED_DAY_TIME_MAX = 160;
export const COUNSELING_TALK_ABOUT_MAX = 2000;
export const COUNSELING_EMAIL_MAX = 254;
export const COUNSELING_PHONE_MAX = 32;

export function clampPage(page: number): number {
  if (!Number.isFinite(page)) {
    return 1;
  }
  return Math.max(1, Math.trunc(page));
}

export function clampLimit(
  limit: number,
  max = COUNSELING_MAX_LIMIT,
  fallback = COUNSELING_DEFAULT_LIMIT,
): number {
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.trunc(limit)), max);
}
