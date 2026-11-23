import { SetMetadata } from '@nestjs/common';

export const ALLOW_INCOMPLETE_PROFILE_KEY = 'allowIncompleteProfile';

/**
 * Marks a route as reachable before the student has finished onboarding
 * (verified mobile number, name, target exam). Every other route behind
 * JwtAuthGuard rejects such students with 403 PROFILE_INCOMPLETE.
 */
export const AllowIncompleteProfile = () =>
  SetMetadata(ALLOW_INCOMPLETE_PROFILE_KEY, true);
