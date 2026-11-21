import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRecommendationOfferingDto } from './create-recommendation-offering.dto';
import { UpdateRecommendationOfferingDto } from './update-recommendation-offering.dto';

const EXAM = '64f123456789abcdef123456';
const OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

async function errors<T extends object>(cls: new () => T, plain: unknown) {
  const list = await validate(
    plainToInstance(cls, plain, { enableImplicitConversion: true }) as object,
    OPTIONS,
  );
  return list.map(e => e.property);
}

describe('recommendation offering DTOs', () => {
  describe('create', () => {
    it('no longer requires minPercent (cut-offs now live on each full mock)', async () => {
      expect(
        await errors(CreateRecommendationOfferingDto, {
          exam: EXAM,
          title: 'MBBS',
        }),
      ).toEqual([]);
    });

    it('still accepts the legacy thresholds so older clients do not get a 400', async () => {
      expect(
        await errors(CreateRecommendationOfferingDto, {
          exam: EXAM,
          title: 'MBBS',
          minPercent: 75,
          comfortPercent: 85,
        }),
      ).toEqual([]);
    });

    it('still range-checks legacy values when they are sent', async () => {
      expect(
        await errors(CreateRecommendationOfferingDto, {
          exam: EXAM,
          title: 'MBBS',
          minPercent: 120,
        }),
      ).toContain('minPercent');
      expect(
        await errors(CreateRecommendationOfferingDto, {
          exam: EXAM,
          title: 'MBBS',
          comfortPercent: -1,
        }),
      ).toContain('comfortPercent');
    });

    it('still requires an exam and a title', async () => {
      const props = await errors(CreateRecommendationOfferingDto, {});
      expect(props).toEqual(expect.arrayContaining(['exam', 'title']));
    });
  });

  describe('update', () => {
    it('accepts an empty patch and legacy values', async () => {
      expect(await errors(UpdateRecommendationOfferingDto, {})).toEqual([]);
      expect(
        await errors(UpdateRecommendationOfferingDto, {
          minPercent: 10,
          comfortPercent: null,
        }),
      ).toEqual([]);
    });

    it('rejects out-of-range legacy values', async () => {
      expect(
        await errors(UpdateRecommendationOfferingDto, { minPercent: 101 }),
      ).toContain('minPercent');
    });
  });
});
