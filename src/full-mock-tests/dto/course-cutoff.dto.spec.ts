import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CourseCutoffEntryDto,
  MAX_COURSE_CUTOFFS,
  UpdateCourseCutoffEntryDto,
  UpdateCourseCutoffsDto,
} from './course-cutoff.dto';
import { PublishDraftDto } from './publish-draft.dto';

const ID = '64f123456789abcdef123456';

// Mirror the global ValidationPipe in main.ts
const OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

async function errorsFor<T extends object>(
  cls: new () => T,
  plain: unknown,
): Promise<string[]> {
  const instance = plainToInstance(cls, plain, {
    enableImplicitConversion: true,
  });
  const errors = await validate(instance as object, OPTIONS);
  const flatten = (list: typeof errors, prefix = ''): string[] =>
    list.flatMap(e => [
      ...(e.constraints
        ? Object.keys(e.constraints).map(k => `${prefix}${e.property}:${k}`)
        : []),
      ...flatten(e.children ?? [], `${prefix}${e.property}.`),
    ]);
  return flatten(errors);
}

describe('CourseCutoffEntryDto (publish)', () => {
  it('accepts a valid id and positive marks, including 2 decimals', async () => {
    expect(
      await errorsFor(CourseCutoffEntryDto, {
        offeringId: ID,
        cutoffMarks: 620,
      }),
    ).toEqual([]);
    expect(
      await errorsFor(CourseCutoffEntryDto, {
        offeringId: ID,
        cutoffMarks: 0.25,
      }),
    ).toEqual([]);
    expect(
      await errorsFor(CourseCutoffEntryDto, {
        offeringId: ID,
        cutoffMarks: 619.75,
      }),
    ).toEqual([]);
  });

  it.each([
    [
      'a malformed id',
      { offeringId: 'nope', cutoffMarks: 5 },
      'offeringId:isMongoId',
    ],
    [
      'zero marks',
      { offeringId: ID, cutoffMarks: 0 },
      'cutoffMarks:isPositive',
    ],
    [
      'negative marks',
      { offeringId: ID, cutoffMarks: -3 },
      'cutoffMarks:isPositive',
    ],
    [
      'more than two decimals',
      { offeringId: ID, cutoffMarks: 1.234 },
      'cutoffMarks:isNumber',
    ],
    [
      'non-numeric marks',
      { offeringId: ID, cutoffMarks: 'abc' },
      'cutoffMarks:isNumber',
    ],
    ['missing marks', { offeringId: ID }, 'cutoffMarks:isNumber'],
  ])('rejects %s', async (_label, plain, expected) => {
    expect(await errorsFor(CourseCutoffEntryDto, plain)).toContain(expected);
  });

  it('rejects unknown properties', async () => {
    const errors = await errorsFor(CourseCutoffEntryDto, {
      offeringId: ID,
      cutoffMarks: 5,
      extra: true,
    });
    expect(errors).toContain('extra:whitelistValidation');
  });
});

describe('UpdateCourseCutoffEntryDto (edit)', () => {
  it('accepts a number or an explicit null (clear)', async () => {
    expect(
      await errorsFor(UpdateCourseCutoffEntryDto, {
        offeringId: ID,
        cutoffMarks: 600,
      }),
    ).toEqual([]);
    expect(
      await errorsFor(UpdateCourseCutoffEntryDto, {
        offeringId: ID,
        cutoffMarks: null,
      }),
    ).toEqual([]);
  });

  it('requires the field to be present (undefined is not null)', async () => {
    expect(
      (await errorsFor(UpdateCourseCutoffEntryDto, { offeringId: ID })).length,
    ).toBeGreaterThan(0);
  });

  it('rejects zero, negative and bad ids', async () => {
    expect(
      await errorsFor(UpdateCourseCutoffEntryDto, {
        offeringId: ID,
        cutoffMarks: 0,
      }),
    ).toContain('cutoffMarks:isPositive');
    expect(
      await errorsFor(UpdateCourseCutoffEntryDto, {
        offeringId: ID,
        cutoffMarks: -1,
      }),
    ).toContain('cutoffMarks:isPositive');
    expect(
      await errorsFor(UpdateCourseCutoffEntryDto, {
        offeringId: 'x',
        cutoffMarks: 5,
      }),
    ).toContain('offeringId:isMongoId');
  });
});

describe('UpdateCourseCutoffsDto', () => {
  it('accepts a mix of numbers and nulls', async () => {
    expect(
      await errorsFor(UpdateCourseCutoffsDto, {
        courseCutoffs: [
          { offeringId: ID, cutoffMarks: 600 },
          { offeringId: '64f123456789abcdef123457', cutoffMarks: null },
        ],
      }),
    ).toEqual([]);
  });

  it('accepts an empty list', async () => {
    expect(
      await errorsFor(UpdateCourseCutoffsDto, { courseCutoffs: [] }),
    ).toEqual([]);
  });

  it('requires an array', async () => {
    expect(await errorsFor(UpdateCourseCutoffsDto, {})).toContain(
      'courseCutoffs:isArray',
    );
    expect(
      await errorsFor(UpdateCourseCutoffsDto, { courseCutoffs: 'x' }),
    ).toContain('courseCutoffs:isArray');
  });

  it('caps the list size', async () => {
    const entries = Array.from({ length: MAX_COURSE_CUTOFFS + 1 }, () => ({
      offeringId: ID,
      cutoffMarks: 1,
    }));
    expect(
      await errorsFor(UpdateCourseCutoffsDto, { courseCutoffs: entries }),
    ).toContain('courseCutoffs:arrayMaxSize');
  });

  it('validates nested entries', async () => {
    const errors = await errorsFor(UpdateCourseCutoffsDto, {
      courseCutoffs: [{ offeringId: 'bad', cutoffMarks: 1 }],
    });
    expect(errors).toContain('courseCutoffs.0.offeringId:isMongoId');
  });
});

describe('PublishDraftDto.courseCutoffs', () => {
  it('stays optional so existing publish calls are unchanged', async () => {
    expect(await errorsFor(PublishDraftDto, {})).toEqual([]);
    expect(
      await errorsFor(PublishDraftDto, { title: 'Paper', allowRetake: true }),
    ).toEqual([]);
  });

  it('accepts valid cut-offs next to the existing settings', async () => {
    expect(
      await errorsFor(PublishDraftDto, {
        title: 'Paper',
        courseCutoffs: [{ offeringId: ID, cutoffMarks: 620 }],
      }),
    ).toEqual([]);
  });

  it('validates the nested entries and the size cap', async () => {
    expect(
      await errorsFor(PublishDraftDto, {
        courseCutoffs: [{ offeringId: ID, cutoffMarks: 0 }],
      }),
    ).toContain('courseCutoffs.0.cutoffMarks:isPositive');

    const many = Array.from({ length: MAX_COURSE_CUTOFFS + 1 }, () => ({
      offeringId: ID,
      cutoffMarks: 1,
    }));
    expect(await errorsFor(PublishDraftDto, { courseCutoffs: many })).toContain(
      'courseCutoffs:arrayMaxSize',
    );
    expect(await errorsFor(PublishDraftDto, { courseCutoffs: 'x' })).toContain(
      'courseCutoffs:isArray',
    );
  });
});
