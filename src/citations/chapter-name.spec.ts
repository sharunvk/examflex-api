import { toChapterName } from './chapter-name';

describe('toChapterName', () => {
  it('drops .pdf and turns every underscore into a space', () => {
    expect(toChapterName('SOME_BASIC_CONCEPTS_OF_CHEMISTRY.pdf')).toBe(
      'SOME BASIC CONCEPTS OF CHEMISTRY',
    );
    expect(toChapterName('LAWS_OF_MOTION.pdf')).toBe('LAWS OF MOTION');
  });

  it('keeps case and other characters', () => {
    expect(toChapterName('CELL-THE_UNIT_OF_LIFE.pdf')).toBe(
      'CELL-THE UNIT OF LIFE',
    );
    expect(toChapterName('The_d_-_and_f_-Block_Elements.pdf')).toBe(
      'The d - and f -Block Elements',
    );
    expect(toChapterName('structure_of_atom.pdf')).toBe('structure of atom');
  });

  it('only strips a trailing .pdf, in any case', () => {
    expect(toChapterName('Equilibrium.PDF')).toBe('Equilibrium');
    expect(toChapterName('Notes.pdf.backup')).toBe('Notes.pdf.backup');
    expect(toChapterName('Equilibrium')).toBe('Equilibrium');
  });

  it('collapses repeated separators and trims', () => {
    expect(toChapterName('  A__B___C.pdf ')).toBe('A B C');
  });

  it('returns undefined when there is nothing to show', () => {
    expect(toChapterName(undefined)).toBeUndefined();
    expect(toChapterName(null)).toBeUndefined();
    expect(toChapterName('')).toBeUndefined();
    expect(toChapterName('.pdf')).toBeUndefined();
    expect(toChapterName('___.pdf')).toBeUndefined();
  });
});
