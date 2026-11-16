import { buildExamStatsLabel } from './exam-stats-label';

describe('buildExamStatsLabel', () => {
  it('builds a full label when fields are complete and marking is uniform', () => {
    expect(
      buildExamStatsLabel({
        totalQuestions: 180,
        duration: 180,
        totalMarks: 720,
        subjects: [
          {
            marksPerQuestion: 4,
            hasNegativeMarking: true,
            negativeMarksPerQuestion: 1,
          },
          {
            marksPerQuestion: 4,
            hasNegativeMarking: true,
            negativeMarksPerQuestion: 1,
          },
        ],
      }),
    ).toBe('180 QUESTIONS · 180 MINUTES · 720 MARKS · +4 / -1');
  });

  it('omits marking when subjects disagree', () => {
    expect(
      buildExamStatsLabel({
        totalQuestions: 90,
        duration: 90,
        totalMarks: 300,
        subjects: [
          {
            marksPerQuestion: 4,
            hasNegativeMarking: true,
            negativeMarksPerQuestion: 1,
          },
          {
            marksPerQuestion: 2,
            hasNegativeMarking: false,
            negativeMarksPerQuestion: 0,
          },
        ],
      }),
    ).toBe('90 QUESTIONS · 90 MINUTES · 300 MARKS');
  });

  it('uses +M when there is no negative marking', () => {
    expect(
      buildExamStatsLabel({
        totalQuestions: 10,
        subjects: [
          {
            marksPerQuestion: 1,
            hasNegativeMarking: false,
            negativeMarksPerQuestion: 0,
          },
        ],
      }),
    ).toBe('10 QUESTIONS · +1');
  });

  it('falls back when nothing useful is set', () => {
    expect(buildExamStatsLabel({})).toBe('Practice papers available');
    expect(buildExamStatsLabel({ totalQuestions: 0, duration: 0 })).toBe(
      'Practice papers available',
    );
  });
});
