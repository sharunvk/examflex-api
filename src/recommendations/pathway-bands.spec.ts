import {
  COMFORT_MARGIN_RATIO,
  PATHWAY_ATTEMPT_WINDOW,
  attemptScorePercent,
  averagePercent,
  clampPercent,
  comfortMarksFor,
  evaluateCutoffBand,
  recencyWeights,
  round2,
  weightedAverage,
} from './pathway-bands';

describe('pathway-bands', () => {
  describe('constants', () => {
    it('uses a 10-attempt window and a 5% comfort margin', () => {
      expect(PATHWAY_ATTEMPT_WINDOW).toBe(10);
      expect(COMFORT_MARGIN_RATIO).toBe(0.05);
    });
  });

  describe('clampPercent / round2', () => {
    it('clamps to 0..100 and tolerates non-finite input', () => {
      expect(clampPercent(-5)).toBe(0);
      expect(clampPercent(50)).toBe(50);
      expect(clampPercent(140)).toBe(100);
      expect(clampPercent(Number.NaN)).toBe(0);
      expect(clampPercent(Infinity)).toBe(0);
    });

    it('rounds to two decimals', () => {
      expect(round2(1.005)).toBe(1);
      expect(round2(626.6666)).toBe(626.67);
      expect(round2(-46.666)).toBe(-46.67);
    });
  });

  describe('recencyWeights', () => {
    it('is empty for 0 or negative counts', () => {
      expect(recencyWeights(0)).toEqual([]);
      expect(recencyWeights(-3)).toEqual([]);
    });

    it('gives the oldest weight 1 and the newest weight n', () => {
      expect(recencyWeights(1)).toEqual([1]);
      expect(recencyWeights(2)).toEqual([1, 2]);
      expect(recencyWeights(10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('floors fractional counts', () => {
      expect(recencyWeights(3.9)).toEqual([1, 2, 3]);
    });

    it('makes the newest of ten about 18% and the oldest about 1.8%', () => {
      const weights = recencyWeights(10);
      const total = weights.reduce((a, b) => a + b, 0);
      expect(weights[9] / total).toBeCloseTo(0.1818, 3);
      expect(weights[0] / total).toBeCloseTo(0.0182, 3);
    });
  });

  describe('weightedAverage', () => {
    it('returns the plain value for a single item', () => {
      expect(weightedAverage([540], [1])).toBe(540);
    });

    it('weights later values more', () => {
      // (500*1 + 560*2 + 620*3) / 6 = 580
      expect(weightedAverage([500, 560, 620], [1, 2, 3])).toBe(580);
    });

    it('equals the plain mean for equal weights', () => {
      expect(weightedAverage([10, 20, 30], [1, 1, 1])).toBe(20);
    });

    it('returns null for empty input or nothing usable', () => {
      expect(weightedAverage([], [])).toBeNull();
      expect(weightedAverage([5], [0])).toBeNull();
      expect(weightedAverage([Number.NaN], [1])).toBeNull();
    });

    it('skips non-finite values and non-positive weights', () => {
      expect(
        weightedAverage([100, Number.NaN, 200, 300], [1, 5, Infinity, -2]),
      ).toBe(100);
    });

    it('ignores extra values or weights beyond the shorter list', () => {
      expect(weightedAverage([10, 20, 30], [1, 1])).toBe(15);
      expect(weightedAverage([10], [1, 100])).toBe(10);
    });

    it('keeps negative scores (negative marking can push marks below zero)', () => {
      expect(weightedAverage([-20, 40], [1, 2])).toBeCloseTo(20, 6);
    });
  });

  describe('comfortMarksFor', () => {
    it('adds 5% of the cut-off', () => {
      expect(comfortMarksFor(620)).toBe(651);
      expect(comfortMarksFor(600)).toBe(630);
      expect(comfortMarksFor(250)).toBe(262.5);
    });
  });

  describe('evaluateCutoffBand', () => {
    it.each([
      [null, 600],
      [500, null],
      [Number.NaN, 600],
      [500, Number.NaN],
      [500, 0],
      [500, -10],
      [500, Infinity],
    ])('returns null for unusable input (%p, %p)', (marks, cutoff) => {
      expect(
        evaluateCutoffBand(marks as number | null, cutoff as number | null),
      ).toBeNull();
    });

    it('is below when marks are under the cut-off', () => {
      const result = evaluateCutoffBand(584, 598)!;
      expect(result.band).toBe('below');
      expect(result.gapMarks).toBe(-14);
      expect(result.comfortMarks).toBe(627.9);
      expect(result.progress01).toBeCloseTo(584 / 598, 6);
      expect(result.message).toBe(
        '14 marks below the cut-off — a strong stretch, keep climbing.',
      );
    });

    it('uses the singular for exactly one mark', () => {
      expect(evaluateCutoffBand(599, 600)!.message).toMatch(/^1 mark below/);
      expect(evaluateCutoffBand(661, 660)!.band).toBe('borderline');
    });

    it('is borderline at exactly the cut-off', () => {
      const result = evaluateCutoffBand(620, 620)!;
      expect(result.band).toBe('borderline');
      expect(result.gapMarks).toBe(0);
      expect(result.progress01).toBe(1);
      expect(result.message).toBe(
        'Just above the cut-off — 31 marks more would make it steadier.',
      );
    });

    it('is borderline just under cut-off x1.05 and comfortable at it', () => {
      expect(evaluateCutoffBand(629.99, 600)!.band).toBe('borderline');
      expect(evaluateCutoffBand(630, 600)!.band).toBe('comfortable');
    });

    it('is comfortable well above, with a full bar', () => {
      const result = evaluateCutoffBand(700, 620)!;
      expect(result.band).toBe('comfortable');
      expect(result.progress01).toBe(1);
      expect(result.gapMarks).toBe(80);
      expect(result.message).toBe(
        '80 marks above the cut-off — looking solid on recent full-mock form.',
      );
    });

    it('handles negative marks (bar clamps to 0, still below)', () => {
      const result = evaluateCutoffBand(-12, 400)!;
      expect(result.band).toBe('below');
      expect(result.progress01).toBe(0);
      expect(result.gapMarks).toBe(-412);
    });

    it('works for any scale, e.g. a 300-mark exam', () => {
      const result = evaluateCutoffBand(240, 250)!;
      expect(result.band).toBe('below');
      expect(result.comfortMarks).toBe(262.5);
      expect(result.progress01).toBeCloseTo(0.96, 6);
    });

    it('prints decimals to one place', () => {
      expect(evaluateCutoffBand(584.25, 600)!.message).toMatch(/^15.8 marks/);
    });
  });

  describe('averagePercent', () => {
    it('is null for an empty list', () => {
      expect(averagePercent([])).toBeNull();
    });

    it('averages and rounds to one decimal, clamping each value', () => {
      expect(averagePercent([50, 75])).toBe(62.5);
      expect(averagePercent([200, 0])).toBe(50);
      expect(averagePercent([33.333, 33.333, 33.334])).toBe(33.3);
    });
  });

  describe('attemptScorePercent', () => {
    it('uses total marks when given', () => {
      expect(attemptScorePercent(360, 0, 0, 720)).toBe(50);
    });

    it('falls back to questions x marks', () => {
      expect(attemptScorePercent(30, 10, 4)).toBe(75);
      expect(attemptScorePercent(30, 10, 4, 0)).toBe(75);
      expect(attemptScorePercent(30, 10, 4, null)).toBe(75);
    });

    it('is 0 when no maximum can be derived, and clamps negatives/overflow', () => {
      expect(attemptScorePercent(10, 0, 0)).toBe(0);
      expect(attemptScorePercent(-5, 10, 4)).toBe(0);
      expect(attemptScorePercent(500, 10, 4)).toBe(100);
      expect(attemptScorePercent(10, Number.NaN, 4)).toBe(0);
    });
  });
});
