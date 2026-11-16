import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Error as MongooseError } from 'mongoose';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let json: jest.Mock;
  let status: jest.Mock;
  let host: ArgumentsHost;
  const originalEnv = process.env.NODE_ENV;

  const createHost = (): ArgumentsHost => {
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    return {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/test', method: 'GET' }),
      }),
    } as unknown as ArgumentsHost;
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    filter = new HttpExceptionFilter();
    host = createHost();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('should format HttpException object responses with errors array of strings', () => {
    const exception = new HttpException(
      {
        message: 'bad',
        error: 'BadRequest',
        errors: ['field a', 'field b'],
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: 'BadRequest',
        message: 'bad',
        path: '/test',
        method: 'GET',
        details: [{ message: 'field a' }, { message: 'field b' }],
      }),
    );
  });

  it('should map object errors and details arrays', () => {
    const exception = new HttpException(
      {
        message: ['one', 'two'],
        details: [{ field: 'email', message: 'invalid' }],
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: [{ field: 'email', message: 'invalid' }],
        message: ['one', 'two'],
      }),
    );
  });

  it('should map string details entries', () => {
    const exception = new HttpException(
      { message: 'fail', details: ['oops'] },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: [{ message: 'oops' }],
      }),
    );
  });

  it('should use non-array errors/details as-is', () => {
    const exception = new HttpException(
      { message: 'fail', errors: { field: 'x' } as any },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(json.mock.calls[0][0].details).toEqual({ field: 'x' });
  });

  it('should handle HttpException string responses', () => {
    const exception = new HttpException('plain', HttpStatus.NOT_FOUND);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'plain',
        error: 'HttpException',
      }),
    );
  });

  it('should handle ThrottlerException as HttpException', () => {
    filter.catch(new ThrottlerException(), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('should handle duplicate key mongo errors with field', () => {
    const err = new Error('E11000 duplicate key error index: email_1 dup key');
    err.name = 'MongoServerError';
    (err as any).code = 11000;

    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'DuplicateEntry',
        message: 'A record with this email already exists',
      }),
    );
  });

  it('hides the payments compound index name', () => {
    const err = new Error(
      'E11000 duplicate key error collection: live.payments index: provider_1_providerPaymentId_1 dup key',
    );
    err.name = 'MongoServerError';
    (err as any).code = 11000;
    (err as any).keyPattern = { provider: 1, providerPaymentId: 1 };

    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'DuplicateEntry',
        message: 'Payment could not be started. Please try again.',
      }),
    );
  });

  it('should handle duplicate key without extractable field (code 11001)', () => {
    const err = new Error('dup');
    err.name = 'MongoError';
    (err as any).code = 11001;

    filter.catch(err, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Duplicate entry. A record with this value already exists.',
      }),
    );
  });

  it('should handle mongo document validation code 121', () => {
    const err = new Error('doc validation');
    err.name = 'MongoError';
    (err as any).code = 121;

    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'ValidationError' }),
    );
  });

  it('should handle unknown mongo error codes', () => {
    const err = new Error('mongo boom');
    (err as any).code = 999;

    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'DatabaseError',
        message: 'mongo boom',
      }),
    );
  });

  it('should hide mongo error message in production', () => {
    process.env.NODE_ENV = 'production';
    filter = new HttpExceptionFilter();
    host = createHost();

    const err = new Error('secret mongo');
    (err as any).code = 50;

    filter.catch(err, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'A database error occurred' }),
    );
  });

  it('should handle mongoose ValidationError', () => {
    const validationError = new MongooseError.ValidationError();
    validationError.errors = {
      name: { path: 'name', message: 'required', value: '' } as any,
    };

    filter.catch(validationError, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'ValidationError',
        details: [{ field: 'name', message: 'required', value: '' }],
      }),
    );
  });

  it('should handle mongoose CastError', () => {
    const castError = new MongooseError.CastError('ObjectId', 'bad-id', '_id');

    filter.catch(castError, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'InvalidId',
        message: 'Invalid ID format',
      }),
    );
  });

  it('should sanitize BSON ObjectId constructor errors', () => {
    const bson = new Error(
      'input must be a 24 character hex string, 12 byte Uint8Array, or an integer',
    );
    bson.name = 'BSONError';

    filter.catch(bson, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'InvalidId',
        message: 'Invalid ID format',
      }),
    );
  });

  it('should handle JWT error names', () => {
    const jwt = new Error('bad jwt');
    jwt.name = 'JsonWebTokenError';
    filter.catch(jwt, host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'InvalidToken' }),
    );

    host = createHost();
    const expired = new Error('expired');
    expired.name = 'TokenExpiredError';
    filter.catch(expired, host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'TokenExpired' }),
    );

    host = createHost();
    const nbf = new Error('nbf');
    nbf.name = 'NotBeforeError';
    filter.catch(nbf, host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'TokenNotActive' }),
    );
  });

  it('should handle generic Error and unknown types', () => {
    filter.catch(new Error('explode'), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'InternalServerError',
        message: 'explode',
      }),
    );

    host = createHost();
    filter.catch({ weird: true }, host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'UnknownError',
        message: 'Internal server error',
      }),
    );
  });

  it('should hide generic and unknown messages in production', () => {
    process.env.NODE_ENV = 'production';
    filter = new HttpExceptionFilter();
    host = createHost();

    filter.catch(new Error('secret'), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'An unexpected error occurred. Please try again later.',
      }),
    );

    host = createHost();
    filter.catch(123, host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'UnknownError',
        message: 'An unexpected error occurred. Please try again later.',
      }),
    );
  });

  it('should omit details for 5xx in production', () => {
    process.env.NODE_ENV = 'production';
    filter = new HttpExceptionFilter();
    host = createHost();

    const exception = new HttpException(
      { message: 'fail', errors: ['hidden'] },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );

    filter.catch(exception, host);

    expect(json.mock.calls[0][0].details).toBeUndefined();
  });
});
