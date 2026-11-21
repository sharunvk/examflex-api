import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEquationDto } from './create-equation.dto';
import { UpdateEquationDto } from './update-equation.dto';

const OID = '507f1f77bcf86cd799439011';
// Mirror the global ValidationPipe in main.ts
const OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

const base = {
  title: 'Force',
  shortDescription: 'cue',
  equation: '$$F=ma$$',
  subject: OID,
  topic: OID,
  exams: [OID],
};
const image = {
  key: 'admin-images/a.png',
  bucket: 'examflex-images',
  region: 'ap-south-1',
};

async function errors<T extends object>(cls: new () => T, plain: unknown) {
  const list = await validate(
    plainToInstance(cls, plain, { enableImplicitConversion: true }) as object,
    OPTIONS,
  );
  const flatten = (items: typeof list, prefix = ''): string[] =>
    items.flatMap(e => [
      ...(e.constraints
        ? Object.keys(e.constraints).map(k => `${prefix}${e.property}:${k}`)
        : []),
      ...flatten(e.children ?? [], `${prefix}${e.property}.`),
    ]);
  return flatten(list);
}

describe('equation image on the DTOs', () => {
  it('stays optional so existing create calls are unchanged', async () => {
    expect(await errors(CreateEquationDto, base)).toEqual([]);
  });

  it('accepts uploaded image metadata', async () => {
    expect(await errors(CreateEquationDto, { ...base, image })).toEqual([]);
    expect(
      await errors(CreateEquationDto, {
        ...base,
        image: { ...image, contentType: 'image/png', size: 10 },
      }),
    ).toEqual([]);
  });

  it('accepts null (used to remove an image)', async () => {
    expect(await errors(CreateEquationDto, { ...base, image: null })).toEqual(
      [],
    );
    expect(await errors(UpdateEquationDto, { image: null })).toEqual([]);
  });

  it('validates the nested metadata', async () => {
    expect(
      await errors(CreateEquationDto, { ...base, image: { bucket: 'b' } }),
    ).toEqual(
      expect.arrayContaining(['image.key:isString', 'image.region:isString']),
    );
    expect(
      await errors(CreateEquationDto, { ...base, image: 'not-an-object' }),
    ).not.toEqual([]);
  });

  it('is part of the update payload and an empty patch is still valid', async () => {
    expect(await errors(UpdateEquationDto, { image })).toEqual([]);
    expect(await errors(UpdateEquationDto, {})).toEqual([]);
  });
});
