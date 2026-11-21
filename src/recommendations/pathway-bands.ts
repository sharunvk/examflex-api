export type PathwayBand = 'below' | 'borderline' | 'comfortable';

/** How many of a student's most recent full mocks feed the pathway cards. */
export const PATHWAY_ATTEMPT_WINDOW = 10;

/** "Comfortable" starts this far above the cut-off (5% of the cut-off marks). */
export const COMFORT_MARGIN_RATIO = 0.05;

export type CutoffBandResult = {
  band: PathwayBand;
  /** 0–1: your marks ÷ cut-off, capped at 1 (full once the cut-off is cleared). */
  progress01: number;
  /** Cut-off marks plus the comfort margin. */
  comfortMarks: number;
  /** yourMarks − cutoffMarks (negative = short of the cut-off). */
  gapMarks: number;
  message: string;
};

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Recency weights for `count` attempts ordered OLDEST → NEWEST:
 * the oldest weighs 1 and the newest weighs `count`, so recent form counts most.
 */
export function recencyWeights(count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, index) => index + 1);
}

/**
 * Weighted mean of `values` (same length as `weights`). Non-finite pairs and
 * non-positive weights are skipped; returns null when nothing is left.
 */
export function weightedAverage(
  values: readonly number[],
  weights: readonly number[],
): number | null {
  let weightSum = 0;
  let total = 0;
  const length = Math.min(values.length, weights.length);
  for (let index = 0; index < length; index += 1) {
    const value = values[index];
    const weight = weights[index];
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    weightSum += weight;
    total += value * weight;
  }
  return weightSum > 0 ? total / weightSum : null;
}

/** Cut-off marks plus the comfort margin, rounded to 2 decimals. */
export function comfortMarksFor(cutoffMarks: number): number {
  return round2(cutoffMarks * (1 + COMFORT_MARGIN_RATIO));
}

function formatMarks(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function marksLabel(value: number): string {
  return `${formatMarks(value)} ${value === 1 ? 'mark' : 'marks'}`;
}

/**
 * Compare a student's weighted marks with a weighted cut-off (both in marks).
 * - below:       marks < cut-off
 * - borderline:  cut-off <= marks < cut-off × 1.05
 * - comfortable: marks >= cut-off × 1.05
 * Returns null when either input is missing or the cut-off is not positive.
 */
export function evaluateCutoffBand(
  yourMarks: number | null,
  cutoffMarks: number | null,
): CutoffBandResult | null {
  if (
    yourMarks === null ||
    cutoffMarks === null ||
    !Number.isFinite(yourMarks) ||
    !Number.isFinite(cutoffMarks) ||
    cutoffMarks <= 0
  ) {
    return null;
  }

  const comfortMarks = comfortMarksFor(cutoffMarks);
  const gapMarks = round2(yourMarks - cutoffMarks);
  const progress01 = Math.min(1, Math.max(0, yourMarks / cutoffMarks));

  if (yourMarks < cutoffMarks) {
    return {
      band: 'below',
      progress01,
      comfortMarks,
      gapMarks,
      message: `${marksLabel(-gapMarks)} below the cut-off — a strong stretch, keep climbing.`,
    };
  }

  if (yourMarks < comfortMarks) {
    return {
      band: 'borderline',
      progress01,
      comfortMarks,
      gapMarks,
      message: `Just above the cut-off — ${marksLabel(round2(comfortMarks - yourMarks))} more would make it steadier.`,
    };
  }

  return {
    band: 'comfortable',
    progress01: 1,
    comfortMarks,
    gapMarks,
    message: `${marksLabel(gapMarks)} above the cut-off — looking solid on recent full-mock form.`,
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
