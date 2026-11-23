/**
 * Readable chapter name from an NCERT source file name:
 * drops the ".pdf" extension and turns underscores into spaces.
 *
 *   SOME_BASIC_CONCEPTS_OF_CHEMISTRY.pdf -> SOME BASIC CONCEPTS OF CHEMISTRY
 *
 * Case and other characters are kept as they are. Returns undefined when there
 * is nothing left to show.
 */
export function toChapterName(
  sourceDoc: string | null | undefined,
): string | undefined {
  if (typeof sourceDoc !== 'string') {
    return undefined;
  }
  const name = sourceDoc
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name.length > 0 ? name : undefined;
}
