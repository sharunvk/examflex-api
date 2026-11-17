import {
  clampMistakeBookLimit,
  clampMistakeBookPage,
  optionLetter,
} from './mistake-book.constants';

describe('mistake-book.constants', () => {
  it('clamps page and limit', () => {
    expect(clampMistakeBookPage(undefined)).toBe(1);
    expect(clampMistakeBookPage(0)).toBe(1);
    expect(clampMistakeBookPage(3)).toBe(3);
    expect(clampMistakeBookLimit(undefined)).toBe(20);
    expect(clampMistakeBookLimit(100)).toBe(50);
  });

  it('maps option indexes to letters', () => {
    expect(optionLetter(0)).toBe('A');
    expect(optionLetter(2)).toBe('C');
    expect(optionLetter(-1)).toBe('?');
  });
});
