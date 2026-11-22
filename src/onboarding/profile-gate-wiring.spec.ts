import { Reflector } from '@nestjs/core';
import { ALLOW_INCOMPLETE_PROFILE_KEY } from '../auth/decorators/allow-incomplete-profile.decorator';
import { AuthController } from '../auth/auth.controller';
import { UsersController } from '../users/users.controller';
import { OnboardingController } from './onboarding.controller';

/**
 * Pins which student routes are reachable before onboarding. Everything else
 * behind JwtAuthGuard returns 403 PROFILE_INCOMPLETE, so widening this list
 * must be a deliberate, reviewed change.
 */
describe('profile gate wiring', () => {
  const reflector = new Reflector();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  const isOpen = (cls: Function, method: string) =>
    Boolean(
      reflector.getAllAndOverride(ALLOW_INCOMPLETE_PROFILE_KEY, [
        (cls.prototype as Record<string, () => unknown>)[method],
        cls,
      ]),
    );

  it('keeps exactly the routes the onboarding screen needs open', () => {
    expect(isOpen(UsersController, 'getMyProfile')).toBe(true); // GET /users/me
    expect(isOpen(UsersController, 'softDeleteMe')).toBe(true); // always allow account deletion
    expect(isOpen(AuthController, 'getProfile')).toBe(true); // GET /auth/profile
    expect(isOpen(OnboardingController, 'verifyPhone')).toBe(true);
    expect(isOpen(OnboardingController, 'complete')).toBe(true);
  });

  it('keeps email verification gated (profile page only)', () => {
    expect(isOpen(OnboardingController, 'verifyEmail')).toBe(false);
  });

  it.each([
    'updateMe',
    'updateMyPreferences',
    'setMyTargetExams',
    'addMyTargetExam',
    'removeMyTargetExam',
    'shouldPromptForTargetExam',
    'dismissTargetExamPrompt',
  ])('keeps UsersController.%s gated', method => {
    expect(isOpen(UsersController, method)).toBe(false);
  });
});
