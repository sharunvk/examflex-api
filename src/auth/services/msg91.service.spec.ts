import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Msg91Service } from './msg91.service';

describe('Msg91Service', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
  });

  async function createService(authKey: string | undefined = 'test-auth-key') {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Msg91Service,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'MSG91_AUTH_KEY' ? authKey : undefined,
            ),
          },
        },
      ],
    }).compile();
    return module.get(Msg91Service);
  }

  it('throws when MSG91_AUTH_KEY is missing', async () => {
    await expect(createService('')).rejects.toThrow(
      'MSG91_AUTH_KEY is required',
    );
  });

  describe('verifyAccessToken', () => {
    it('parses JSON success with data.mobile and prefixes plus', async () => {
      const service = await createService();
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ type: 'success', data: { mobile: '919876543210' } }),
      });
      await expect(service.verifyAccessToken('tok')).resolves.toBe(
        '+919876543210',
      );
    });

    it('uses message field and keeps existing plus', async () => {
      const service = await createService();
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ type: 'success', message: '+911234567890' }),
      });
      await expect(service.verifyAccessToken('tok')).resolves.toBe(
        '+911234567890',
      );
    });

    it('uses top-level mobile field', async () => {
      const service = await createService();
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ mobile: '911112223333' }),
      });
      await expect(service.verifyAccessToken('tok')).resolves.toBe(
        '+911112223333',
      );
    });

    it('treats non-JSON body as phone number', async () => {
      const service = await createService();
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '+919999888877',
      });
      await expect(service.verifyAccessToken('tok')).resolves.toBe(
        '+919999888877',
      );
    });

    it('throws UNAUTHORIZED for invalid JSON shape', async () => {
      const service = await createService();
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ type: 'error' }),
      });
      await expect(service.verifyAccessToken('tok')).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    });

    it('throws UNAUTHORIZED for short phone numbers', async () => {
      const service = await createService();
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ type: 'success', message: '123' }),
      });
      await expect(service.verifyAccessToken('tok')).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    });

    it('throws INTERNAL_SERVER_ERROR when HTTP status is not ok', async () => {
      const service = await createService();
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      await expect(service.verifyAccessToken('tok')).rejects.toBeInstanceOf(
        HttpException,
      );
    });

    it('wraps unexpected fetch errors', async () => {
      const service = await createService();
      mockFetch.mockRejectedValue(new Error('network'));
      await expect(service.verifyAccessToken('tok')).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    });

    it('rejects a token that verified an email address', async () => {
      const service = await createService();
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ type: 'success', message: 'learner@example.com' }),
      });
      await expect(service.verifyAccessToken('tok')).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    });

    it('ignores the message of an error reply', async () => {
      const service = await createService();
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ type: 'error', message: '9198765432100000' }),
      });
      await expect(service.verifyAccessToken('tok')).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    });
  });

  describe('verifyEmailAccessToken', () => {
    function reply(body: unknown) {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () =>
          typeof body === 'string' ? body : JSON.stringify(body),
      });
    }

    it.each([
      ['message', { type: 'success', message: ' Learner@Example.com ' }],
      [
        'data.email',
        { type: 'success', data: { email: 'learner@example.com' } },
      ],
      [
        'data.identifier',
        { type: 'success', data: { identifier: 'LEARNER@example.com' } },
      ],
      ['top-level email', { email: 'learner@example.com' }],
      ['plain text', 'learner@example.com'],
    ])('reads the email from %s and lowercases it', async (_label, body) => {
      const service = await createService();
      reply(body);
      await expect(service.verifyEmailAccessToken('tok')).resolves.toBe(
        'learner@example.com',
      );
    });

    it('rejects a token that verified a phone number', async () => {
      const service = await createService();
      reply({ type: 'success', message: '919876543210' });
      await expect(service.verifyEmailAccessToken('tok')).rejects.toMatchObject(
        { status: HttpStatus.UNAUTHORIZED },
      );
    });

    it('rejects an error reply', async () => {
      const service = await createService();
      reply({ type: 'error', message: 'learner@example.com' });
      await expect(service.verifyEmailAccessToken('tok')).rejects.toMatchObject(
        { status: HttpStatus.UNAUTHORIZED },
      );
    });

    it('rejects an empty body', async () => {
      const service = await createService();
      reply('   ');
      await expect(service.verifyEmailAccessToken('tok')).rejects.toMatchObject(
        { status: HttpStatus.UNAUTHORIZED },
      );
    });

    it('rejects a JSON null body', async () => {
      const service = await createService();
      reply('null');
      await expect(service.verifyEmailAccessToken('tok')).rejects.toMatchObject(
        { status: HttpStatus.UNAUTHORIZED },
      );
    });

    it('throws INTERNAL_SERVER_ERROR when HTTP status is not ok', async () => {
      const service = await createService();
      mockFetch.mockResolvedValue({ ok: false, status: 502 });
      await expect(service.verifyEmailAccessToken('tok')).rejects.toMatchObject(
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    });

    it('wraps unexpected fetch errors', async () => {
      const service = await createService();
      mockFetch.mockRejectedValue(new Error('network'));
      await expect(service.verifyEmailAccessToken('tok')).rejects.toMatchObject(
        { status: HttpStatus.INTERNAL_SERVER_ERROR },
      );
    });
  });
});
