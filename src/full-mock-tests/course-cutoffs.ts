/**
 * Pure helpers for per-course cut-off marks stored on a FULL_EXAM paper.
 * No Nest / Mongoose imports so they stay trivially unit-testable.
 */

export type CourseCutoffInput = {
  offeringId: string;
  /** `null` removes an existing cut-off (PATCH only). */
  cutoffMarks: number | null;
};

export type StoredCourseCutoff = {
  offering: { toString(): string } | string;
  cutoffMarks: number;
};

export type NormalizedCourseCutoff = {
  offeringId: string;
  cutoffMarks: number | null;
};

/** Total marks for a paper: explicit `totalMarks`, else Σ questions × marks. */
export function paperTotalMarks(snapshot: {
  totalMarks?: number | null;
  subjects?: Array<{
    numberOfQuestions?: number | null;
    marksPerQuestion?: number | null;
  }>;
}): number {
  if (
    typeof snapshot.totalMarks === 'number' &&
    Number.isFinite(snapshot.totalMarks) &&
    snapshot.totalMarks > 0
  ) {
    return snapshot.totalMarks;
  }
  return (snapshot.subjects ?? []).reduce(
    (sum, row) =>
      sum + (row.numberOfQuestions ?? 0) * (row.marksPerQuestion ?? 0),
    0,
  );
}

/** Offering ids that appear more than once in `entries`. */
export function duplicateOfferingIds(
  entries: ReadonlyArray<{ offeringId: string }>,
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.offeringId)) {
      duplicates.add(entry.offeringId);
    }
    seen.add(entry.offeringId);
  }
  return [...duplicates];
}

/** Keep only well-formed entries; `undefined` marks become `null` (= clear). */
export function normalizeCutoffInput(
  entries: ReadonlyArray<{
    offeringId: string;
    cutoffMarks?: number | null;
  }> = [],
): NormalizedCourseCutoff[] {
  return entries.map(entry => ({
    offeringId: entry.offeringId,
    cutoffMarks:
      typeof entry.cutoffMarks === 'number' ? entry.cutoffMarks : null,
  }));
}

/**
 * Merge incoming edits into what is already stored.
 * - provided number  -> upsert
 * - provided null    -> remove
 * - not mentioned    -> kept (a deactivated course does not lose its cut-off)
 */
export function mergeCutoffs(
  existing: ReadonlyArray<StoredCourseCutoff> = [],
  incoming: ReadonlyArray<NormalizedCourseCutoff> = [],
): Array<{ offeringId: string; cutoffMarks: number }> {
  const merged = new Map<string, number>();
  for (const row of existing) {
    merged.set(String(row.offering), row.cutoffMarks);
  }
  for (const row of incoming) {
    if (row.cutoffMarks === null) {
      merged.delete(row.offeringId);
    } else {
      merged.set(row.offeringId, row.cutoffMarks);
    }
  }
  return [...merged.entries()].map(([offeringId, cutoffMarks]) => ({
    offeringId,
    cutoffMarks,
  }));
}
