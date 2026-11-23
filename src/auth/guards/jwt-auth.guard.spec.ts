import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AllowIncompleteProfile } from '../decorators/allow-incomplete-profile.decorator';

class Routes {
  gated() {
    return 'gated';
  }

  @AllowIncompleteProfile()
  open() {
    return 'open';
  }
}

@AllowIncompleteProfile()
class OpenController {
  anything() {
    return 'anything';
  }
}

function contextFor(cls: new () => object, method: string): ExecutionContext {
  const proto = cls.prototype as Record<string, () => unknown>;
  return {
    getHandler: () => proto[method],
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard profile gate', () => {
  const guard = new JwtAuthGuard(new Reflector());
  const run = (user: unknown, cls: new () => object, method: string) =>
    guard.handleRequest(null, user, undefined, contextFor(cls, method));

  const student = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    role: 'user',
    profileComplete: false,
    ...over,
  });

  it('lets a finished student through', () => {
    expect(() =>
      run(student({ profileComplete: true }), Routes, 'gated'),
    ).not.toThrow();
  });

  it('blocks an unfinished student with a machine-readable code', () => {
    try {
      run(student(), Routes, 'gated');
      fail('expected a 403');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const body = (error as ForbiddenException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body.error).toBe('PROFILE_INCOMPLETE');
      expect((error as ForbiddenException).getStatus()).toBe(403);
    }
  });

  it('blocks when the flag is missing entirely (fail closed)', () => {
    expect(() => run({ id: 'u1', role: 'user' }, Routes, 'gated')).toThrow(
      ForbiddenException,
    );
  });

  it('allows opted-out routes for unfinished students', () => {
    expect(() => run(student(), Routes, 'open')).not.toThrow();
  });

  it('allows everything on an opted-out controller', () => {
    expect(() => run(student(), OpenController, 'anything')).not.toThrow();
  });

  it('never gates admins', () => {
    expect(() =>
      run(student({ role: 'admin' }), Routes, 'gated'),
    ).not.toThrow();
  });

  it('still rejects unauthenticated requests as 401, not 403', () => {
    expect(() =>
      guard.handleRequest(null, false, undefined, contextFor(Routes, 'gated')),
    ).toThrow(UnauthorizedException);
  });
});
