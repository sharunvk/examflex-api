import {
  clampLimit,
  clampPage,
  COUNSELING_DEFAULT_LIMIT,
} from './counseling.constants';

describe('counseling.constants', () => {
  it('clamps page to at least 1', () => {
    expect(clampPage(0)).toBe(1);
    expect(clampPage(-2)).toBe(1);
    expect(clampPage(3.9)).toBe(3);
    expect(clampPage(Number.NaN)).toBe(1);
  });

  it('clamps limit within bounds', () => {
    expect(clampLimit(Number.NaN)).toBe(COUNSELING_DEFAULT_LIMIT);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(500)).toBe(100);
    expect(clampLimit(24)).toBe(24);
  });
});
