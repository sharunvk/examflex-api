export const MISTAKE_KINDS = ['incorrect', 'unattended'] as const;
export type MistakeKind = (typeof MISTAKE_KINDS)[number];

export const MISTAKE_TRIP_REASONS = [
  'concept-gap',
  'calculation',
  'time',
] as const;
export type MistakeTripReason = (typeof MISTAKE_TRIP_REASONS)[number];

export const DEFAULT_TRIP_REASON: MistakeTripReason = 'concept-gap';

export const INSIGHT_TITLE = 'Solution';

export const SOURCE_HINT = 'Page link matched to your NCERT edition.';

export const MISTAKE_BOOK_SESSION_PAGE_DEFAULT = 1;
export const MISTAKE_BOOK_SESSION_PAGE_LIMIT_DEFAULT = 20;
export const MISTAKE_BOOK_SESSION_PAGE_LIMIT_MAX = 50;

export function clampMistakeBookPage(page?: number): number {
  if (!page || !Number.isFinite(page) || page < 1) {
    return MISTAKE_BOOK_SESSION_PAGE_DEFAULT;
  }
  return Math.floor(page);
}

export function clampMistakeBookLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) {
    return MISTAKE_BOOK_SESSION_PAGE_LIMIT_DEFAULT;
  }
  return Math.min(Math.floor(limit), MISTAKE_BOOK_SESSION_PAGE_LIMIT_MAX);
}

export function optionLetter(index: number): string {
  if (index < 0) {
    return '?';
  }
  return String.fromCharCode(65 + index);
}
