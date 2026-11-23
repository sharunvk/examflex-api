import { Types } from 'mongoose';
import {
  duplicateOfferingIds,
  mergeCutoffs,
  normalizeCutoffInput,
  paperTotalMarks,
} from './course-cutoffs';

const A = '64f123456789abcdef1234aa';
const B = '64f123456789abcdef1234bb';
const C = '64f123456789abcdef1234cc';

describe('course-cutoffs helpers', () => {
  describe('paperTotalMarks', () => {
    it('prefers an explicit totalMarks', () => {
      expect(
        paperTotalMarks({
          totalMarks: 720,
          subjects: [{ numberOfQuestions: 1, marksPerQuestion: 1 }],
        }),
      ).toBe(720);
    });

    it('sums questions x marks per subject otherwise', () => {
      expect(
        paperTotalMarks({
          subjects: [
            { numberOfQuestions: 45, marksPerQuestion: 4 },
            { numberOfQuestions: 45, marksPerQuestion: 4 },
            { numberOfQuestions: 90, marksPerQuestion: 4 },
          ],
        }),
      ).toBe(720);
      expect(
        paperTotalMarks({
          totalMarks: 0,
          subjects: [
            { numberOfQuestions: 20, marksPerQuestion: 4 },
            { numberOfQuestions: 5, marksPerQuestion: 2 },
          ],
        }),
      ).toBe(90);
    });

    it('treats missing numbers as zero and tolerates no subjects', () => {
      expect(
        paperTotalMarks({
          totalMarks: null,
          subjects: [{ numberOfQuestions: 10 }, { marksPerQuestion: 4 }],
        }),
      ).toBe(0);
      expect(paperTotalMarks({})).toBe(0);
    });

    it('ignores a non-finite totalMarks', () => {
      expect(
        paperTotalMarks({
          totalMarks: Number.NaN,
          subjects: [{ numberOfQuestions: 2, marksPerQuestion: 3 }],
        }),
      ).toBe(6);
    });
  });

  describe('duplicateOfferingIds', () => {
    it('finds repeated ids once', () => {
      expect(
        duplicateOfferingIds([
          { offeringId: A },
          { offeringId: B },
          { offeringId: A },
          { offeringId: A },
        ]),
      ).toEqual([A]);
    });

    it('is empty without duplicates', () => {
      expect(
        duplicateOfferingIds([{ offeringId: A }, { offeringId: B }]),
      ).toEqual([]);
      expect(duplicateOfferingIds([])).toEqual([]);
    });
  });

  describe('normalizeCutoffInput', () => {
    it('maps undefined/null marks to null and keeps numbers', () => {
      expect(
        normalizeCutoffInput([
          { offeringId: A, cutoffMarks: 620 },
          { offeringId: B, cutoffMarks: null },
          { offeringId: C },
        ]),
      ).toEqual([
        { offeringId: A, cutoffMarks: 620 },
        { offeringId: B, cutoffMarks: null },
        { offeringId: C, cutoffMarks: null },
      ]);
    });

    it('defaults to an empty list', () => {
      expect(normalizeCutoffInput()).toEqual([]);
    });
  });

  describe('mergeCutoffs', () => {
    const stored = [
      { offering: new Types.ObjectId(A), cutoffMarks: 600 },
      { offering: new Types.ObjectId(B), cutoffMarks: 500 },
    ];

    it('upserts provided numbers', () => {
      const merged = mergeCutoffs(stored, [
        { offeringId: A, cutoffMarks: 610 },
        { offeringId: C, cutoffMarks: 400 },
      ]);
      expect(merged).toEqual([
        { offeringId: A, cutoffMarks: 610 },
        { offeringId: B, cutoffMarks: 500 },
        { offeringId: C, cutoffMarks: 400 },
      ]);
    });

    it('removes entries whose incoming mark is null', () => {
      expect(
        mergeCutoffs(stored, [{ offeringId: B, cutoffMarks: null }]),
      ).toEqual([{ offeringId: A, cutoffMarks: 600 }]);
    });

    it('keeps courses that are not mentioned', () => {
      expect(mergeCutoffs(stored, [])).toEqual([
        { offeringId: A, cutoffMarks: 600 },
        { offeringId: B, cutoffMarks: 500 },
      ]);
    });

    it('works with string offering ids, from nothing, and clearing a missing one', () => {
      expect(
        mergeCutoffs(
          [{ offering: A, cutoffMarks: 1 }],
          [{ offeringId: C, cutoffMarks: null }],
        ),
      ).toEqual([{ offeringId: A, cutoffMarks: 1 }]);
      expect(
        mergeCutoffs(undefined, [{ offeringId: A, cutoffMarks: 5 }]),
      ).toEqual([{ offeringId: A, cutoffMarks: 5 }]);
      expect(mergeCutoffs()).toEqual([]);
    });
  });
});
