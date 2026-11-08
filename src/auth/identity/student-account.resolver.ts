import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService, UserWithGoogleLink } from '../../users/users.service';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { CreateUserDto } from '../../users/dto/create-user.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  StudentAuthProvider,
  VerifiedStudentIdentity,
} from './verified-student-identity';

export interface ResolvedStudentAccount {
  user: UserResponseDto;
  isNewUser: boolean;
}

@Injectable()
export class StudentAccountResolver {
  private readonly logger = new Logger(StudentAccountResolver.name);

  constructor(private readonly usersService: UsersService) {}

  async resolve(
    identity: VerifiedStudentIdentity,
  ): Promise<ResolvedStudentAccount> {
    if (identity.provider === StudentAuthProvider.OTP) {
      return this.resolveOtp(identity);
    }

    return this.resolveGoogle(identity);
  }

  private async resolveOtp(
    identity: VerifiedStudentIdentity,
  ): Promise<ResolvedStudentAccount> {
    const phoneNumber = identity.phoneNumber;
    if (!phoneNumber) {
      throw new UnauthorizedException('Authentication failed');
    }

    const existingUser = await this.usersService.findByPhone(phoneNumber);
    if (existingUser) {
      this.assertStudentCanSignIn(existingUser);
      return { user: existingUser, isNewUser: false };
    }

    const tempName = `User ${phoneNumber.slice(-4)}`;
    const tempEmail = `user${phoneNumber.replace(/\D/g, '')}@temp.examflex.com`;
    const createUserDto: CreateUserDto = {
      name: tempName,
      email: tempEmail,
      phoneNumber,
    };

    try {
      const user = await this.usersService.create(createUserDto);
      return { user, isNewUser: true };
    } catch (error) {
      this.logger.error('Failed to create new user:', error.message);
      throw new UnauthorizedException('Failed to create user account');
    }
  }

  private async resolveGoogle(
    identity: VerifiedStudentIdentity,
  ): Promise<ResolvedStudentAccount> {
    const googleSub = identity.googleSub;
    const email = identity.email;
    if (!googleSub || !email) {
      throw new UnauthorizedException('Invalid Google sign-in');
    }

    const linked = await this.usersService.findAuthByGoogleSub(googleSub);
    if (linked) {
      this.assertStudentCanSignIn(linked.user);
      const user = await this.syncGoogleEmail(linked.user, email);
      return { user, isNewUser: false };
    }

    const byEmail = await this.usersService.findAuthByEmail(email);
    if (byEmail) {
      const user = await this.attachGoogleToExisting(byEmail, identity);
      return { user, isNewUser: false };
    }

    try {
      const user = await this.usersService.createGoogleUser({
        name: identity.name || 'ExamFlex User',
        email,
        googleSub,
        avatarUrl: identity.avatarUrl,
      });
      return { user, isNewUser: true };
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        this.logger.error('Failed to create Google user:', error.message);
        throw new UnauthorizedException('Failed to create user account');
      }
    }

    return this.reconcileGoogleRace(identity);
  }

  /**
   * Two droplets can verify the same first-time Google sign-in together.
   * The unique indexes decide the winner; this path logs the loser into that account.
   */
  private async reconcileGoogleRace(
    identity: VerifiedStudentIdentity,
  ): Promise<ResolvedStudentAccount> {
    const googleSub = identity.googleSub!;
    const email = identity.email!;

    const linked = await this.usersService.findAuthByGoogleSub(googleSub);
    if (linked) {
      this.assertStudentCanSignIn(linked.user);
      return { user: linked.user, isNewUser: false };
    }

    const byEmail = await this.usersService.findAuthByEmail(email);
    if (byEmail) {
      const user = await this.attachGoogleToExisting(byEmail, identity);
      return { user, isNewUser: false };
    }

    throw new UnauthorizedException(
      'This account is not available. Please contact support.',
    );
  }

  private async attachGoogleToExisting(
    record: UserWithGoogleLink,
    identity: VerifiedStudentIdentity,
  ): Promise<UserResponseDto> {
    const user = record.user;
    this.assertStudentCanSignIn(user);

    if (record.googleSub && record.googleSub !== identity.googleSub) {
      throw new ConflictException(
        'This email is already linked to a different Google account',
      );
    }

    if (record.googleSub === identity.googleSub) {
      return user;
    }

    const linked = await this.usersService.linkGoogleAccount(
      user.id,
      identity.googleSub!,
      user.avatarUrl ? undefined : identity.avatarUrl,
    );

    if (!linked) {
      const current = await this.usersService.findAuthByEmail(identity.email!);
      if (current?.googleSub === identity.googleSub) {
        this.assertStudentCanSignIn(current.user);
        return current.user;
      }
      throw new ConflictException(
        'This email is already linked to a different Google account',
      );
    }

    this.logger.log(`Linked Google sign-in to existing user ${linked.id}`);
    return linked;
  }

  private async syncGoogleEmail(
    user: UserResponseDto,
    email: string,
  ): Promise<UserResponseDto> {
    if (user.email?.toLowerCase() === email) {
      return user;
    }

    const updated = await this.usersService.updateEmailIfAvailable(
      user.id,
      email,
    );
    return updated ?? user;
  }

  private assertStudentCanSignIn(user: UserResponseDto): void {
    if (!user.isActive) {
      throw new UnauthorizedException(
        'Your account has been deactivated. Please contact support.',
      );
    }

    if (user.role === UserRole.ADMIN) {
      throw new UnauthorizedException(
        'Admin accounts must sign in with username and password',
      );
    }
  }
}
