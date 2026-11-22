import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_INCOMPLETE_PROFILE_KEY } from '../decorators/allow-incomplete-profile.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

export const PROFILE_INCOMPLETE_ERROR = 'PROFILE_INCOMPLETE';

/**
 * Authenticates the access token and, for students, also requires a finished
 * profile (verified mobile + name + target exam). Routes that must work before
 * onboarding opt out with @AllowIncompleteProfile(). Admins are never gated.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(@Optional() private readonly reflector?: Reflector) {
    super();
  }

  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    const authenticated = super.handleRequest(
      err,
      user,
      info,
      context,
      status,
    ) as TUser;

    const student = authenticated as unknown as
      | { role?: string; profileComplete?: boolean }
      | undefined;

    if (student && student.role !== UserRole.ADMIN) {
      const allowed = this.reflector?.getAllAndOverride<boolean>(
        ALLOW_INCOMPLETE_PROFILE_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed && student.profileComplete !== true) {
        throw new ForbiddenException({
          statusCode: 403,
          error: PROFILE_INCOMPLETE_ERROR,
          message: 'Complete your profile to continue.',
        });
      }
    }

    return authenticated;
  }
}
