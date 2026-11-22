import {
  MAX_PERSON_NAME_LENGTH,
  coerceProvidedName,
  isValidPersonName,
  looksLikeLink,
  sanitizePersonName,
} from './person-name';

// Invisible and hostile characters are built from code points on purpose, so no
// test depends on how an editor or tool renders (or silently drops) them.
const cp = (...points: number[]) => String.fromCodePoint(...points);
const ZWSP = cp(0x200b); // zero-width space
const ZWNJ = cp(0x200c);
const ZWJ = cp(0x200d);
const LRM = cp(0x200e);
const RLM = cp(0x200f);
const RLO = cp(0x202e); // right-to-left override
const PDF = cp(0x202c);
const LRI = cp(0x2066);
const PDI = cp(0x2069);
const BOM = cp(0xfeff);
const SOFT_HYPHEN = cp(0x00ad);
const NBSP = cp(0x00a0);
const IDEOGRAPHIC_SPACE = cp(0x3000);
const LINE_SEPARATOR = cp(0x2028);
const HANGUL_FILLER = cp(0x3164);
const BRAILLE_BLANK = cp(0x2800);
const PRIVATE_USE = cp(0xe000);
const LONE_SURROGATE = String.fromCharCode(0xd800);
const NUL = String.fromCharCode(0);
const ACUTE = cp(0x0301);
const ROCKET = cp(0x1f680);
const HAN_ASTRAL = cp(0x20bb7); // 𠮷, outside the BMP

describe('sanitizePersonName (layer 1: remove what is invisible or hostile)', () => {
  it.each([
    ['composes to NFC', `e${ACUTE}`, 'é'],
    ['zero-width space', `Ra${ZWSP}hul`, 'Rahul'],
    ['byte order mark', `${BOM}Rahul`, 'Rahul'],
    ['soft hyphen', `Ra${SOFT_HYPHEN}hul`, 'Rahul'],
    ['bidi override / pop', `${RLO}evil${PDF}`, 'evil'],
    ['bidi marks and isolates', `${LRM}Ra${RLM}hul${LRI}${PDI}`, 'Rahul'],
    ['NUL and other controls', `Rahul${NUL}Sharma`, 'RahulSharma'],
    ['newlines and tabs become a space', 'Rahul\n\tSharma', 'Rahul Sharma'],
    [
      'NBSP / ideographic space / LS become a space',
      `Rahul${NBSP}${IDEOGRAPHIC_SPACE}${LINE_SEPARATOR}Sharma`,
      'Rahul Sharma',
    ],
    ['Hangul filler (an invisible letter)', `${HANGUL_FILLER}`, ''],
    ['Braille blank', `${BRAILLE_BLANK}Rahul`, 'Rahul'],
    ['private use', `Ra${PRIVATE_USE}hul`, 'Rahul'],
    ['lone surrogate', `Ra${LONE_SURROGATE}hul`, 'Rahul'],
    ['whitespace runs and edges', '   Rahul     Sharma  ', 'Rahul Sharma'],
  ])('%s', (_label, input, expected) => {
    expect(sanitizePersonName(input)).toBe(expected);
  });

  it('keeps legitimate joiners between letters (Persian / Indic spelling)', () => {
    const persian = `می${ZWNJ}خواهم`;
    expect(sanitizePersonName(persian)).toBe(persian);
    const indic = `क${ZWJ}ष`;
    expect(sanitizePersonName(indic)).toBe(indic);
  });

  it('drops joiners that are leading, trailing, next to a space or repeated', () => {
    expect(sanitizePersonName(`${ZWNJ}Rahul`)).toBe('Rahul');
    expect(sanitizePersonName(`Rahul${ZWJ}`)).toBe('Rahul');
    expect(sanitizePersonName(`Rahul${ZWNJ} Sharma`)).toBe('Rahul Sharma');
    expect(sanitizePersonName(`Ra${ZWNJ}${ZWJ}${ZWNJ}hul`)).toBe(
      `Ra${ZWNJ}hul`,
    );
  });

  it('caps stacked combining marks ("Zalgo" text)', () => {
    const zalgo = `a${ACUTE.repeat(40)}`;
    const cleaned = sanitizePersonName(zalgo);
    // NFC folds the first mark into the base letter, so at most 6 stay stacked after it.
    const marks = cleaned.normalize('NFD').replace(/[^\p{M}]/gu, '');
    expect(marks.length).toBeLessThanOrEqual(7);
    expect(cleaned.normalize('NFD').startsWith('a')).toBe(true);
  });

  it('is idempotent and never throws on odd input', () => {
    const odd = `${RLO}${ZWSP}A${ACUTE.repeat(9)}${LONE_SURROGATE}\n${ROCKET}`;
    const once = sanitizePersonName(odd);
    expect(sanitizePersonName(once)).toBe(once);
    expect(sanitizePersonName('')).toBe('');
  });
});

describe('isValidPersonName (layer 2: the allowed alphabet)', () => {
  it.each([
    'Rahul',
    'Rahul Sharma',
    'Rahul K.',
    'J.K. Rowling',
    'Dr. Rahul Sharma, Jr.',
    "O'Brien",
    '’Brien'.slice(1) && 'O’Brien',
    'Mary-Jane Watson',
    'José García',
    'Müller',
    'Nguyễn Văn An',
    '李雷',
    'राहुल शर्मा',
    'محمد علي',
    'McDonald',
    'de Souza',
    'Rahul (Rocky) Sharma',
    'John 2',
    'A',
  ])('accepts %s', name => {
    expect(isValidPersonName(name)).toBe(true);
  });

  it('accepts a joiner between letters', () => {
    expect(isValidPersonName(`می${ZWNJ}خواهم`)).toBe(true);
  });

  it.each([
    ['script tag', '<script>alert(1)</script>'],
    ['an HTML entity', 'Rahul &amp; Co'],
    ['quotes', 'Rahul "The Great"'],
    ['a backtick (template / shell injection)', 'Rahul`id`'],
    ['a slash', 'Rahul/Sharma'],
    ['a backslash', 'Rahul\\Sharma'],
    ['an @', 'John@Doe'],
    ['a colon (javascript: / data: / scheme)', 'javascript:alert'],
    ['a semicolon', 'Rahul; DROP TABLE users'],
    ['an equals sign', 'Rahul=1'],
    ['curly braces / template syntax', '{{7*7}}'],
    ['square brackets', 'Rahul[0]'],
    ['a pipe', 'Rahul|id'],
    ['a dollar sign (NoSQL operator style)', '$ne'],
    ['an emoji', `Rahul ${ROCKET}`],
    ['a spreadsheet formula', '=1+1'],
    ['a leading plus', '+919876543210'],
    ['a leading minus', '-2+3'],
    ['a leading @ (formula)', '@SUM(A1)'],
    ['a leading dot', '.Rahul'],
    ['a trailing hyphen', 'Rahul-'],
    ['a trailing apostrophe', "Rahul'"],
    ['only digits', '12345'],
    ['only punctuation', '...'],
    ['consecutive spaces', 'Rahul  Sharma'],
    ['a leading space', ' Rahul'],
    ['a trailing space', 'Rahul '],
    ['a newline', 'Rahul\nSharma'],
    ['a zero-width space', `Ra${ZWSP}hul`],
    ['a bidi override', `${RLO}Rahul`],
    ['a NUL byte', `Rahul${NUL}`],
    ['a NBSP', `Rahul${NBSP}Sharma`],
    ['a Hangul filler', `Rahul${HANGUL_FILLER}`],
    ['a lone joiner at the end', `Rahul${ZWNJ}`],
    ['a repeated joiner', `Ra${ZWNJ}${ZWNJ}hul`],
    ['stacked combining marks', `a${ACUTE.repeat(7)}`],
    ['a web address', 'www.evil.com'],
    ['a domain', 'evil.com'],
    ['a domain inside text', 'Visit evil.com now'],
    ['a non-string', 42],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isValidPersonName(value)).toBe(false);
  });

  it('does not mistake ordinary names for links', () => {
    expect(looksLikeLink('Rahul K.')).toBe(false);
    expect(looksLikeLink('Kumar Net')).toBe(false);
    expect(looksLikeLink('Anne Co')).toBe(false);
    expect(looksLikeLink('www.example.org')).toBe(true);
    expect(looksLikeLink('rahul.io')).toBe(true);
  });

  it.each([
    'Priya S.In',
    'Anil K.Me',
    'Rahul M.Co',
    'Anita S.Io',
    'R.K.Narayan',
    'J.K. Rowling',
  ])('does not mistake the initials in %s for a domain', name => {
    expect(looksLikeLink(name)).toBe(false);
    expect(isValidPersonName(name)).toBe(true);
    expect(coerceProvidedName(name)).toBe(name);
  });

  it.each(['evil.com', 'Visit evil.com now', 'WWW.EVIL.COM', 'click rahul.io'])(
    'still catches the real address %s',
    name => {
      expect(looksLikeLink(name)).toBe(true);
      expect(isValidPersonName(name)).toBe(false);
    },
  );
});

describe('coerceProvidedName (layer 3: names Google hands us)', () => {
  it.each([
    ['a normal name', 'Rahul Sharma', 'Rahul Sharma'],
    ['an accented name', 'José García', 'José García'],
    ['CJK', '李雷', '李雷'],
    ['a name with a dot', 'Rahul K.', 'Rahul K.'],
    ['an apostrophe', 'O’Brien', 'O’Brien'],
    [
      'markup becomes harmless text',
      '<script>alert(1)</script>',
      'script alert(1) script',
    ],
    ['an emoji is dropped', `Rahul ${ROCKET} Sharma`, 'Rahul Sharma'],
    ['a formula starter is dropped', "=cmd|' /C calc'!A0", "cmd ' C calc' A0"],
    ['a leading symbol is dropped', '@@Rahul', 'Rahul'],
    [
      'invisible and bidi characters are removed',
      `${RLO}Ra${ZWSP}hul${PDF}`,
      'Rahul',
    ],
    ['control characters are removed', `Ra${NUL}hul\n`, 'Rahul'],
    ['trailing punctuation is trimmed', 'Rahul -', 'Rahul'],
    ['a web address is unusable', 'www.evil.com', ''],
    ['digits only is unusable', '12345', ''],
    [
      'only invisible characters is unusable',
      `${ZWSP}${HANGUL_FILLER}${BRAILLE_BLANK}`,
      '',
    ],
    ['whitespace is unusable', '   ', ''],
    ['null is unusable', null, ''],
    ['undefined is unusable', undefined, ''],
  ])('%s', (_label, input, expected) => {
    expect(coerceProvidedName(input as string | null | undefined)).toBe(
      expected,
    );
  });

  it('truncates to the schema limit', () => {
    const result = coerceProvidedName('A'.repeat(300));
    expect(result).toHaveLength(MAX_PERSON_NAME_LENGTH);
  });

  it('never splits a character that takes two UTF-16 units', () => {
    const result = coerceProvidedName(HAN_ASTRAL.repeat(80));
    expect(result.length).toBeLessThanOrEqual(MAX_PERSON_NAME_LENGTH);
    expect(() => encodeURIComponent(result)).not.toThrow(); // throws on a lone surrogate
    expect(Array.from(result).every(ch => ch === HAN_ASTRAL)).toBe(true);
  });

  it('does not end on a dangling joiner after truncating', () => {
    const result = coerceProvidedName(`${'A'.repeat(99)}${ZWNJ}B`);
    expect(result.endsWith(ZWNJ)).toBe(false);
    expect(isValidPersonName(result)).toBe(true);
  });
});

describe('hostile input, many shapes at once', () => {
  const pool = [
    '<',
    '>',
    '&',
    '"',
    "'",
    '`',
    '/',
    '\\',
    '=',
    '+',
    '@',
    '|',
    ';',
    ':',
    '{',
    '}',
    '[',
    ']',
    '$',
    '%',
    '^',
    '*',
    '!',
    '?',
    '~',
    '#',
    ' ',
    '\n',
    '\t',
    '.',
    ',',
    '-',
    '(',
    ')',
    '_',
    'a',
    'b',
    'Z',
    '5',
    'é',
    '李',
    'ä',
    '’',
    ZWSP,
    ZWNJ,
    ZWJ,
    RLO,
    PDF,
    BOM,
    HANGUL_FILLER,
    NBSP,
    ACUTE,
    ROCKET,
    HAN_ASTRAL,
    LONE_SURROGATE,
    NUL,
    PRIVATE_USE,
    'www.',
    '.com',
    'javascript:',
  ];

  // Small seeded generator so a failure is reproducible.
  let seed = 20260101;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const randomString = () => {
    const length = Math.floor(next() * 60);
    let out = '';
    for (let i = 0; i < length; i += 1)
      out += pool[Math.floor(next() * pool.length)];
    return out;
  };

  it('sanitize is idempotent, and coerce only ever returns a valid, bounded, well-formed name', () => {
    for (let i = 0; i < 3000; i += 1) {
      const input = randomString();

      const cleaned = sanitizePersonName(input);
      expect(sanitizePersonName(cleaned)).toBe(cleaned);

      const coerced = coerceProvidedName(input);
      if (coerced !== '') {
        expect(isValidPersonName(coerced)).toBe(true);
        expect(coerced.length).toBeLessThanOrEqual(MAX_PERSON_NAME_LENGTH);
        expect(() => encodeURIComponent(coerced)).not.toThrow();
        expect(coerceProvidedName(coerced)).toBe(coerced);
        // nothing a browser or parser could treat as markup or code survives
        expect(coerced).not.toMatch(/[<>&"`/\\=@|;:{}$%^*!?~#[\]+]/);
      }
    }
  });
});
