export type PathwayBand = 'below' | 'borderline' | 'comfortable';

export type PathwayBandResult = {
  band: PathwayBand;
  /** 0–1 progress toward / past the minimum threshold. */
  progress01: number;
  message: string;
};

const DEFAULT_COMFORT_GAP_PP = 10;

/**
 * Resolve comfort percent: explicit value, else min + 10pp (capped at 100).
 */
export function resolveComfortPercent(
  minPercent: number,
  comfortPercent?: number | null,
): number {
  const min = clampPercent(minPercent);
  if (
    comfortPercent !== undefined &&
    comfortPercent !== null &&
    Number.isFinite(comfortPercent)
  ) {
    return Math.max(min, clampPercent(comfortPercent));
  }
  return Math.min(100, min + DEFAULT_COMFORT_GAP_PP);
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Map average attempt percent vs course thresholds into UI band + copy.
 * Progress is avg/min capped at 1 (full bar once the minimum is cleared).
 */
export function evaluatePathwayBand(
  userPercent: number | null,
  minPercent: number,
  comfortPercent?: number | null,
): PathwayBandResult {
  const min = clampPercent(minPercent);
  const comfort = resolveComfortPercent(min, comfortPercent);

  if (userPercent === null || !Number.isFinite(userPercent)) {
    return {
      band: 'below',
      progress01: 0,
      message: 'Attempt full mocks to see how this path looks for you.',
    };
  }

  const avg = clampPercent(userPercent);
  const progress01 =
    min <= 0 ? (avg > 0 ? 1 : 0) : Math.min(1, avg / Math.max(min, 1e-6));

  if (avg < min) {
    return {
      band: 'below',
      progress01,
      message: 'A strong stretch — keep climbing toward this path.',
    };
  }

  if (avg < comfort) {
    return {
      band: 'borderline',
      progress01,
      message: 'Within reach — one more push would make this steadier.',
    };
  }

  return {
    band: 'comfortable',
    progress01: 1,
    message: 'Looking solid for this path on recent full-mock form.',
  };
}

/** Average of percent scores; empty list → null. */
export function averagePercent(percents: number[]): number | null {
  if (percents.length === 0) return null;
  const sum = percents.reduce((acc, value) => acc + clampPercent(value), 0);
  return Math.round((sum / percents.length) * 10) / 10;
}

/** Score percent for one attempt using frozen snapshot fields. */
export function attemptScorePercent(
  score: number,
  totalQuestions: number,
  marksPerQuestion: number,
  totalMarks?: number | null,
): number {
  const maxFromMarks =
    typeof totalMarks === 'number' &&
    Number.isFinite(totalMarks) &&
    totalMarks > 0
      ? totalMarks
      : totalQuestions * marksPerQuestion;
  if (!Number.isFinite(maxFromMarks) || maxFromMarks <= 0) return 0;
  return clampPercent((score / maxFromMarks) * 100);
}
