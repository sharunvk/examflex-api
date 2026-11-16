type ExamSubjectMarks = {
  marksPerQuestion?: number;
  hasNegativeMarking?: boolean;
  negativeMarksPerQuestion?: number;
};

export type ExamStatsLabelInput = {
  totalQuestions?: number;
  /** Duration in minutes. */
  duration?: number;
  totalMarks?: number;
  subjects?: ExamSubjectMarks[];
};

/**
 * Builds the lime stats row for the mocks hub card, e.g.
 * `180 QUESTIONS · 180 MINUTES · 720 MARKS · +4 / -1`.
 * Falls back to a generic line when schema fields are sparse.
 */
export function buildExamStatsLabel(input: ExamStatsLabelInput): string {
  const parts: string[] = [];

  if (
    typeof input.totalQuestions === 'number' &&
    Number.isFinite(input.totalQuestions) &&
    input.totalQuestions > 0
  ) {
    parts.push(`${Math.round(input.totalQuestions)} QUESTIONS`);
  }

  if (
    typeof input.duration === 'number' &&
    Number.isFinite(input.duration) &&
    input.duration > 0
  ) {
    parts.push(`${Math.round(input.duration)} MINUTES`);
  }

  if (
    typeof input.totalMarks === 'number' &&
    Number.isFinite(input.totalMarks) &&
    input.totalMarks > 0
  ) {
    parts.push(`${Math.round(input.totalMarks)} MARKS`);
  }

  const marking = uniformMarkingLabel(input.subjects);
  if (marking) {
    parts.push(marking);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Practice papers available';
}

function uniformMarkingLabel(
  subjects: ExamSubjectMarks[] | undefined,
): string | undefined {
  if (!subjects?.length) {
    return undefined;
  }

  const first = subjects[0];
  if (
    typeof first.marksPerQuestion !== 'number' ||
    !Number.isFinite(first.marksPerQuestion)
  ) {
    return undefined;
  }

  const marks = first.marksPerQuestion;
  const hasNeg = first.hasNegativeMarking === true;
  const neg = hasNeg ? (first.negativeMarksPerQuestion ?? 0) : 0;

  for (const subject of subjects) {
    if (subject.marksPerQuestion !== marks) {
      return undefined;
    }
    const subjectHasNeg = subject.hasNegativeMarking === true;
    const subjectNeg = subjectHasNeg
      ? (subject.negativeMarksPerQuestion ?? 0)
      : 0;
    if (subjectHasNeg !== hasNeg || subjectNeg !== neg) {
      return undefined;
    }
  }

  if (hasNeg && neg > 0) {
    return `+${formatMark(marks)} / -${formatMark(neg)}`;
  }
  return `+${formatMark(marks)}`;
}

function formatMark(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}
