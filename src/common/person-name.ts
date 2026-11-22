/**
 * Everything the API does to a person's name, in one place.
 *
 * Three layers, strictest last:
 *  1. sanitizePersonName: removes what is invisible, controlling or hostile to
 *     rendering, without judging the name.
 *  2. isValidPersonName: the allowed alphabet. Used to REJECT typed names.
 *  3. coerceProvidedName: turns a name handed to us by Google (which we cannot
 *     reject without blocking sign-in) into something that passes layer 2.
 *
 * The web app mirrors layers 1-2 (examflex-app/lib/onboarding/validate.ts) so
 * the browser never blocks what the server accepts, or the reverse.
 */

/** Matches the User schema's `name` maxlength. Measured in UTF-16 units. */
export const MAX_PERSON_NAME_LENGTH = 100;

/** Real scripts stack a few marks (Vietnamese, Thai, Tibetan); "Zalgo" text stacks dozens. */
const MAX_COMBINING_MARKS_IN_A_ROW = 6;

/**
 * Invisible characters that are letters or marks, so no Unicode category check
 * removes them: Hangul/Khmer fillers, Braille blank, Mongolian vowel separator.
 * They are used to make "blank" or lookalike names.
 */
const INVISIBLE_FILLERS =
  /[\u17B4\u17B5\u115F\u1160\u180E\u2800\u3164\uFFA0]/gu;

/** Zero-width non-joiner / joiner: needed inside Persian and Indic words. */
const ZERO_WIDTH_JOINERS = /[\u200C\u200D]+/g;

/**
 * The allowed alphabet: letters of any script, combining marks, digits, space,
 * and the punctuation real names use. Deliberately excludes markup and code
 * metacharacters (< > & " ` / \ : ; = @ # $ % ^ * + | { } [ ] ! ? ~), emoji and
 * everything invisible.
 */
const ALLOWED = "\\p{L}\\p{M}\\p{N} .,'’‘\\-()_\\u200C\\u200D";

/** Starts with a letter or digit (so never = + - @, which start spreadsheet formulas). */
const PERSON_NAME = new RegExp(
  `^[\\p{L}\\p{N}](?:[${ALLOWED}]*[\\p{L}\\p{M}\\p{N}.)])?$`,
  'u',
);
const DISALLOWED_CHARACTERS = new RegExp(`[^${ALLOWED}]`, 'gu');
const COMBINING_MARK_STACK = new RegExp(
  `(\\p{M}{${MAX_COMBINING_MARKS_IN_A_ROW}})\\p{M}+`,
  'gu',
);

/**
 * A name that is really a link (spam / phishing in a greeting). A domain needs
 * at least two characters before its dot, so initials such as "Priya S.In" or
 * "Anil K.Me" are never mistaken for one.
 */
const LOOKS_LIKE_LINK =
  /(?:^|\s)www\.|[\p{L}\p{N}]{2,}\.(?:com|net|org|in|io|co|me|xyz|info|app|dev|ly|tk|ml|ga|cf|gq|ru|cn|top|site|online|link|click)(?=$|[\s,)])/iu;

export function looksLikeLink(name: string): boolean {
  return LOOKS_LIKE_LINK.test(name);
}

/**
 * Layer 1. Never throws, never judges: normalises Unicode (NFC), turns every
 * kind of whitespace into one space, and removes control characters,
 * zero-width / bidi-override / format characters, private-use and unassigned
 * code points, lone surrogates, invisible fillers and stacked combining marks.
 * ZWNJ/ZWJ survive only between two letters.
 */
export function sanitizePersonName(input: string): string {
  let name = input;

  name = name.replace(/[\t\n\r\f\v\u0085\u2028\u2029]/g, ' ');
  name = name.replace(/\p{Zs}/gu, ' ');
  name = name.replace(INVISIBLE_FILLERS, '');
  name = name.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}]/gu, character =>
    character === '\u200C' || character === '\u200D' ? character : '',
  );

  name = name.replace(
    ZERO_WIDTH_JOINERS,
    (run, offset: number, whole: string) => {
      const before = whole.slice(0, offset);
      const after = whole.slice(offset + run.length);
      return /[\p{L}\p{M}]$/u.test(before) && /^[\p{L}\p{M}]/u.test(after)
        ? run[0]
        : '';
    },
  );

  // Normalise only AFTER everything invisible is gone: removing a character
  // can put a base letter next to a mark that should compose with it, and the
  // result must not change on a second pass.
  name = name.normalize('NFC');
  name = name.replace(COMBINING_MARK_STACK, '$1');
  return name.replace(/ +/g, ' ').trim();
}

/** Layer 2. True only for a name that is already clean and uses the allowed alphabet. */
export function isValidPersonName(name: unknown): boolean {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    sanitizePersonName(name) === name &&
    /\p{L}/u.test(name) &&
    PERSON_NAME.test(name) &&
    !looksLikeLink(name)
  );
}

/** Cut to `max` UTF-16 units without splitting a surrogate pair. */
function truncateUtf16(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const character of text) {
    if (out.length + character.length > max) break;
    out += character;
  }
  return out;
}

/**
 * Layer 3. For names supplied by an identity provider. Returns '' when nothing
 * usable is left, so the caller can fall back. Whatever it returns passes
 * isValidPersonName.
 */
export function coerceProvidedName(raw: string | null | undefined): string {
  if (!raw) return '';

  let name = sanitizePersonName(raw);
  if (looksLikeLink(name)) return '';

  name = name.replace(DISALLOWED_CHARACTERS, ' ');
  name = name.replace(/ +/g, ' ').trim();
  name = name.replace(/^[^\p{L}\p{N}]+/u, '');
  name = truncateUtf16(name, MAX_PERSON_NAME_LENGTH);
  name = sanitizePersonName(name).replace(/[^\p{L}\p{M}\p{N}.)]+$/u, '');
  name = sanitizePersonName(name);

  return isValidPersonName(name) ? name : '';
}
