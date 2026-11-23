/**
 * Maximum marks a student could have scored on an attempt.
 *
 * Full mocks mix per-subject marks, so the attempt's root `marksPerQuestion`
 * (the first subject's value) is not enough: sum the frozen per-question
 * marks instead and only fall back to questions × marks for old documents.
 */
export function attemptMaxScore(row: {
  totalQuestions?: number | null;
  marksPerQuestion?: number | null;
  questions?: Array<{ marksPerQuestion?: number | null }> | null;
}): number {
  const fallbackMarks = row.marksPerQuestion ?? 0;
  const questions = row.questions ?? [];

  const fromQuestions = questions.reduce(
    (sum, question) => sum + (question.marksPerQuestion ?? fallbackMarks),
    0,
  );
  if (Number.isFinite(fromQuestions) && fromQuestions > 0) {
    return fromQuestions;
  }

  const fromTotals = (row.totalQuestions ?? 0) * fallbackMarks;
  return Number.isFinite(fromTotals) && fromTotals > 0 ? fromTotals : 0;
}
