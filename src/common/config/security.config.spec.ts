import { getCorsConfig, parseCorsOrigins } from './security.config';

describe('parseCorsOrigins', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCors = process.env.CORS_ORIGINS;

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousCors === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = previousCors;
    }
  });

  it('parses comma-separated origins', () => {
    expect(
      parseCorsOrigins(
        'https://ezprep.in, https://www.ezprep.in,https://ezprep-app.vercel.app',
      ),
    ).toEqual([
      'https://ezprep.in',
      'https://www.ezprep.in',
      'https://ezprep-app.vercel.app',
    ]);
  });

  it('falls back to localhost outside production when unset', () => {
    process.env.NODE_ENV = 'development';
    expect(parseCorsOrigins(undefined)).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
    ]);
  });

  it('throws in production when unset', () => {
    process.env.NODE_ENV = 'production';
    expect(() => parseCorsOrigins('')).toThrow(/CORS_ORIGINS/);
  });
});

describe('getCorsConfig', () => {
  it('uses the provided CORS_ORIGINS string', () => {
    const cors = getCorsConfig('https://examflex.in,https://admin.examflex.in');
    expect(cors.origin).toEqual([
      'https://examflex.in',
      'https://admin.examflex.in',
    ]);
    expect(cors.credentials).toBe(true);
  });
});
