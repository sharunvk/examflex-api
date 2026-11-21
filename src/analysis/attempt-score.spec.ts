import { attemptMaxScore } from './attempt-score';

describe('attemptMaxScore', () => {
  it('sums the frozen per-question marks', () => {
    expect(
      attemptMaxScore({
        totalQuestions: 5,
        marksPerQuestion: 4,
        questions: [
          { marksPerQuestion: 4 },
          { marksPerQuestion: 4 },
          { marksPerQuestion: 1 },
          { marksPerQuestion: 1 },
          { marksPerQuestion: 1 },
        ],
      }),
    ).toBe(11);
  });

  it('uses the attempt marks for questions without their own', () => {
    expect(
      attemptMaxScore({
        marksPerQuestion: 4,
        questions: [{}, { marksPerQuestion: null }, { marksPerQuestion: 2 }],
      }),
    ).toBe(10);
  });

  it('falls back to totalQuestions x marks when there are no questions', () => {
    expect(
      attemptMaxScore({
        totalQuestions: 25,
        marksPerQuestion: 4,
        questions: [],
      }),
    ).toBe(100);
    expect(attemptMaxScore({ totalQuestions: 25, marksPerQuestion: 4 })).toBe(
      100,
    );
    expect(
      attemptMaxScore({
        totalQuestions: 25,
        marksPerQuestion: 4,
        questions: null,
      }),
    ).toBe(100);
  });

  it('is 0 when nothing can be derived', () => {
    expect(attemptMaxScore({})).toBe(0);
    expect(attemptMaxScore({ totalQuestions: 10 })).toBe(0);
    expect(
      attemptMaxScore({ totalQuestions: Number.NaN, marksPerQuestion: 4 }),
    ).toBe(0);
  });
});
