import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteOnboardingDto } from './complete-onboarding.dto';
import { UpdateMeDto } from '../../users/dto/update-me.dto';

const EXAM = '64f123456789abcdef123456';

async function check<T extends object>(cls: new () => T, plain: object) {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance);
  return { instance, errors };
}

describe('names through the real request pipeline', () => {
  describe('CompleteOnboardingDto', () => {
    it.each([
      ['Rahul Sharma', 'Rahul Sharma'],
      ['Rahul K.', 'Rahul K.'],
      ['  José   García ', 'José García'],
      ['McDonald', 'McDonald'],
      ['de Souza', 'de Souza'],
      ['李雷', '李雷'],
      ['rahul sharma', 'rahul sharma'],
    ])('accepts %j and keeps it as %j', async (input, expected) => {
      const { instance, errors } = await check(CompleteOnboardingDto, {
        name: input,
        targetExamId: EXAM,
      });
      expect(errors).toHaveLength(0);
      expect(instance.name).toBe(expected);
    });

    it.each([['<b>Rahul</b>'], ['Rahul 🚀'], ['A'], ['x'.repeat(101)], ['']])(
      'rejects %j',
      async input => {
        const { errors } = await check(CompleteOnboardingDto, {
          name: input,
          targetExamId: EXAM,
        });
        expect(errors.some(e => e.property === 'name')).toBe(true);
      },
    );

    describe('hostile and malformed names', () => {
      const cp = (...points: number[]) => String.fromCodePoint(...points);
      const ZWSP = cp(0x200b);
      const RLO = cp(0x202e);
      const PDF = cp(0x202c);
      const NBSP = cp(0x00a0);
      const NUL = String.fromCharCode(0);
      const ACUTE = cp(0x0301);

      it.each([
        ['zero-width characters', `Ra${ZWSP}hul${ZWSP}`, 'Rahul'],
        ['a bidi override', `${RLO}Rahul${PDF}`, 'Rahul'],
        ['a NUL byte', `Ra${NUL}hul`, 'Rahul'],
        ['non-breaking spaces', `Rahul${NBSP}${NBSP}Sharma`, 'Rahul Sharma'],
        ['newlines', 'Rahul\nSharma', 'Rahul Sharma'],
      ])(
        'cleans %s instead of storing them',
        async (_label, input, expected) => {
          const { instance, errors } = await check(CompleteOnboardingDto, {
            name: input,
            targetExamId: EXAM,
          });
          expect(errors).toHaveLength(0);
          expect(instance.name).toBe(expected);
        },
      );

      it('trims "Zalgo" mark stacks rather than storing them', async () => {
        const { instance, errors } = await check(CompleteOnboardingDto, {
          name: `Rahul${ACUTE.repeat(60)}`,
          targetExamId: EXAM,
        });
        expect(errors).toHaveLength(0);
        expect(instance.name.length).toBeLessThan(20);
      });

      it.each([
        ['a script tag', '<script>alert(1)</script>'],
        ['an event handler', 'Rahul" onmouseover="alert(1)'],
        ['a backtick', 'Rahul`id`'],
        ['a template expression', '{{constructor.constructor("x")()}}'],
        ['a NoSQL operator', '$where'],
        ['a spreadsheet formula', '=HYPERLINK("http://evil","x")'],
        ['a leading plus', '+1+1'],
        ['a web address', 'www.evil.com'],
        ['a domain', 'click evil.com now'],
        ['only invisible characters', `${ZWSP}${ZWSP}`],
        ['only digits', '123456'],
      ])('rejects %s', async (_label, input) => {
        const { errors } = await check(CompleteOnboardingDto, {
          name: input,
          targetExamId: EXAM,
        });
        expect(errors.some(e => e.property === 'name')).toBe(true);
      });

      it('rejects a name that is not a string at all (object / array injection)', async () => {
        for (const bad of [{ $ne: '' }, ['Rahul'], 42, true]) {
          const { errors } = await check(CompleteOnboardingDto, {
            name: bad,
            targetExamId: EXAM,
          });
          expect(errors.some(e => e.property === 'name')).toBe(true);
        }
      });
    });

    it('rejects a malformed exam id', async () => {
      const { errors } = await check(CompleteOnboardingDto, {
        name: 'Rahul',
        targetExamId: 'nope',
      });
      expect(errors.some(e => e.property === 'targetExamId')).toBe(true);
    });
  });

  describe('UpdateMeDto (profile edit)', () => {
    it('accepts the same Google-style names and no longer forces title case', async () => {
      const { instance, errors } = await check(UpdateMeDto, {
        name: 'Rahul K.',
      });
      expect(errors).toHaveLength(0);
      expect(instance.name).toBe('Rahul K.');
    });

    it('rejects a phoneNumber, exactly as the app pipeline is configured', async () => {
      // Same options as main.ts.
      const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      await expect(
        pipe.transform(
          { phoneNumber: '+911234567890' },
          { type: 'body', metatype: UpdateMeDto },
        ),
      ).rejects.toThrow(BadRequestException);

      // …while a normal edit still passes.
      await expect(
        pipe.transform(
          { name: 'Rahul K.' },
          { type: 'body', metatype: UpdateMeDto },
        ),
      ).resolves.toMatchObject({ name: 'Rahul K.' });
    });
  });
});
