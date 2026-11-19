import {
  attemptScorePercent,
  averagePercent,
  clampPercent,
  evaluatePathwayBand,
  resolveComfortPercent,
} from './pathway-bands';

describe('pathway-bands', () => {
  describe('clampPercent', () => {
    it('clamps to 0–100', () => {
      expect(clampPercent(-5)).toBe(0);
      expect(clampPercent(50)).toBe(50);
      expect(clampPercent(150)).toBe(100);
      expect(clampPercent(Number.NaN)).toBe(0);
    });
  });

  describe('resolveComfortPercent', () => {
    it('defaults to min + 10', () => {
      expect(resolveComfortPercent(70)).toBe(80);
      expect(resolveComfortPercent(95)).toBe(100);
    });

    it('uses explicit comfort when provided', () => {
      expect(resolveComfortPercent(70, 90)).toBe(90);
      expect(resolveComfortPercent(70, 60)).toBe(70);
    });
  });

  describe('evaluatePathwayBand', () => {
    it('returns below when no score', () => {
      const result = evaluatePathwayBand(null, 75);
      expect(result.band).toBe('below');
      expect(result.progress01).toBe(0);
    });

    it('returns below when under min', () => {
      const result = evaluatePathwayBand(60, 75, 85);
      expect(result.band).toBe('below');
      expect(result.progress01).toBeCloseTo(60 / 75);
      expect(result.message).toMatch(/stretch/i);
    });

    it('returns borderline when between min and comfort', () => {
      const result = evaluatePathwayBand(78, 75, 85);
      expect(result.band).toBe('borderline');
      expect(result.progress01).toBe(1);
      expect(result.message).toMatch(/reach/i);
    });

    it('returns comfortable at or above comfort', () => {
      const result = evaluatePathwayBand(90, 75, 85);
      expect(result.band).toBe('comfortable');
      expect(result.progress01).toBe(1);
      expect(result.message).toMatch(/solid/i);
    });
  });

  describe('averagePercent', () => {
    it('returns null for empty list', () => {
      expect(averagePercent([])).toBeNull();
    });

    it('averages and rounds to 1 decimal', () => {
      expect(averagePercent([70, 80, 90])).toBe(80);
      expect(averagePercent([71, 72])).toBe(71.5);
    });
  });

  describe('attemptScorePercent', () => {
    it('uses totalMarks when provided', () => {
      expect(attemptScorePercent(360, 180, 4, 720)).toBe(50);
    });

    it('falls back to Q × marks', () => {
      expect(attemptScorePercent(100, 50, 4)).toBe(50);
    });
  });
});
