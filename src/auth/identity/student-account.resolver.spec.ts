import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { StudentAccountResolver } from './student-account.resolver';
import { StudentAuthProvider } from './verified-student-identity';
import { UserRole } from '../../common/enums/user-role.enum';

describe('StudentAccountResolver', () => {
  const users = {
    findByPhone: jest.fn(),
    create: jest.fn(),
    findAuthByGoogleSub: jest.fn(),
    findAuthByEmail: jest.fn(),
    createGoogleUser: jest.fn(),
    linkGoogleAccount: jest.fn(),
    updateEmailIfAvailable: jest.fn(),
  };

  const resolver = new StudentAccountResolver(users as never);

  const student = {
    id: 'user-1',
    name: 'Student',
    email: 'student@gmail.com',
    phoneNumber: '+911234567890',
    role: UserRole.USER,
    isActive: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('OTP', () => {
    it('logs in an existing active student', async () => {
      users.findByPhone.mockResolvedValue(student);

      const result = await resolver.resolve({
        provider: StudentAuthProvider.OTP,
        phoneNumber: student.phoneNumber,
      });

      expect(result).toEqual({ user: student, isNewUser: false });
      expect(users.create).not.toHaveBeenCalled();
    });

    it('creates a student when the phone number is new', async () => {
      users.findByPhone.mockResolvedValue(null);
      users.create.mockResolvedValue(student);

      const result = await resolver.resolve({
        provider: StudentAuthProvider.OTP,
        phoneNumber: '+911234567890',
      });

      expect(users.create).toHaveBeenCalledWith({
        name: 'User 7890',
        email: 'user911234567890@temp.examflex.com',
        phoneNumber: '+911234567890',
      });
      expect(result.isNewUser).toBe(true);
    });

    it('rejects inactive students and admins', async () => {
      users.findByPhone.mockResolvedValue({ ...student, isActive: false });
      await expect(
        resolver.resolve({
          provider: StudentAuthProvider.OTP,
          phoneNumber: student.phoneNumber,
        }),
      ).rejects.toThrow(/deactivated/);

      users.findByPhone.mockResolvedValue({ ...student, role: UserRole.ADMIN });
      await expect(
        resolver.resolve({
          provider: StudentAuthProvider.OTP,
          phoneNumber: student.phoneNumber,
        }),
      ).rejects.toThrow(/username and password/);
    });

    it('rejects a missing phone number and a failed create', async () => {
      await expect(
        resolver.resolve({ provider: StudentAuthProvider.OTP }),
      ).rejects.toThrow(UnauthorizedException);

      users.findByPhone.mockResolvedValue(null);
      users.create.mockRejectedValue(new Error('duplicate'));
      await expect(
        resolver.resolve({
          provider: StudentAuthProvider.OTP,
          phoneNumber: '+911111111111',
        }),
      ).rejects.toThrow('Failed to create user account');
    });
  });

  describe('Google', () => {
    const identity = {
      provider: StudentAuthProvider.GOOGLE,
      googleSub: 'sub-1',
      email: 'student@gmail.com',
      name: 'Student',
      avatarUrl: 'https://lh3.googleusercontent.com/a',
    };

    it('continues an account already linked to this Google subject', async () => {
      users.findAuthByGoogleSub.mockResolvedValue({
        user: student,
        googleSub: 'sub-1',
      });

      const result = await resolver.resolve(identity);

      expect(result.isNewUser).toBe(false);
      expect(result.user).toBe(student);
      expect(users.createGoogleUser).not.toHaveBeenCalled();
      expect(users.updateEmailIfAvailable).not.toHaveBeenCalled();
    });

    it('updates the stored email when Google reports a new unused address', async () => {
      const renamed = { ...student, email: 'next@gmail.com' };
      users.findAuthByGoogleSub.mockResolvedValue({
        user: student,
        googleSub: 'sub-1',
      });
      users.updateEmailIfAvailable.mockResolvedValue(renamed);

      const result = await resolver.resolve({
        ...identity,
        email: 'next@gmail.com',
      });

      expect(users.updateEmailIfAvailable).toHaveBeenCalledWith(
        student.id,
        'next@gmail.com',
      );
      expect(result.user).toBe(renamed);
    });

    it('keeps the old email when the new Google email belongs to someone else', async () => {
      users.findAuthByGoogleSub.mockResolvedValue({
        user: student,
        googleSub: 'sub-1',
      });
      users.updateEmailIfAvailable.mockResolvedValue(null);

      const result = await resolver.resolve({
        ...identity,
        email: 'taken@gmail.com',
      });

      expect(result.user).toBe(student);
    });

    it('links Google onto an OTP account that already uses that email', async () => {
      const otpUser = {
        ...student,
        email: 'student@gmail.com',
        avatarUrl: undefined,
      };
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail.mockResolvedValue({ user: otpUser });
      users.linkGoogleAccount.mockResolvedValue({
        ...otpUser,
        avatarUrl: identity.avatarUrl,
      });

      const result = await resolver.resolve(identity);

      expect(users.linkGoogleAccount).toHaveBeenCalledWith(
        otpUser.id,
        'sub-1',
        identity.avatarUrl,
      );
      expect(result.isNewUser).toBe(false);
      expect(users.createGoogleUser).not.toHaveBeenCalled();
    });

    it('does not replace an avatar the student already set', async () => {
      const otpUser = { ...student, avatarUrl: 'https://cdn.example/me.png' };
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail.mockResolvedValue({ user: otpUser });
      users.linkGoogleAccount.mockResolvedValue(otpUser);

      await resolver.resolve(identity);

      expect(users.linkGoogleAccount).toHaveBeenCalledWith(
        otpUser.id,
        'sub-1',
        undefined,
      );
    });

    it('rejects linking when that email belongs to a different Google account', async () => {
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail.mockResolvedValue({
        user: student,
        googleSub: 'other-sub',
      });

      await expect(resolver.resolve(identity)).rejects.toThrow(
        ConflictException,
      );
      expect(users.linkGoogleAccount).not.toHaveBeenCalled();
    });

    it('logs in when the email match is already this Google subject', async () => {
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail.mockResolvedValue({
        user: student,
        googleSub: 'sub-1',
      });

      const result = await resolver.resolve(identity);

      expect(result.user).toBe(student);
      expect(users.linkGoogleAccount).not.toHaveBeenCalled();
    });

    it('does not link an admin or inactive account', async () => {
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail.mockResolvedValue({
        user: { ...student, role: UserRole.ADMIN },
      });

      await expect(resolver.resolve(identity)).rejects.toThrow(
        /username and password/,
      );

      users.findAuthByEmail.mockResolvedValue({
        user: { ...student, isActive: false },
      });
      await expect(resolver.resolve(identity)).rejects.toThrow(/deactivated/);
    });

    it('uses a fallback name when Google does not provide one', async () => {
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail.mockResolvedValue(null);
      users.createGoogleUser.mockResolvedValue(student);

      await resolver.resolve({ ...identity, name: undefined });

      expect(users.createGoogleUser).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'ExamFlex User' }),
      );
    });

    it('creates a new student when neither the Google subject nor the email exists', async () => {
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail.mockResolvedValue(null);
      users.createGoogleUser.mockResolvedValue(student);

      const result = await resolver.resolve(identity);

      expect(users.createGoogleUser).toHaveBeenCalledWith({
        name: 'Student',
        email: 'student@gmail.com',
        googleSub: 'sub-1',
        avatarUrl: identity.avatarUrl,
      });
      expect(result.isNewUser).toBe(true);
    });

    it('joins the account that won a concurrent first sign-in', async () => {
      users.findAuthByGoogleSub
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ user: student, googleSub: 'sub-1' });
      users.findAuthByEmail.mockResolvedValue(null);
      users.createGoogleUser.mockRejectedValue(new ConflictException('exists'));

      const result = await resolver.resolve(identity);

      expect(result).toEqual({ user: student, isNewUser: false });
    });

    it('links after a race when the email account was created first', async () => {
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ user: student });
      users.createGoogleUser.mockRejectedValue(new ConflictException('exists'));
      users.linkGoogleAccount.mockResolvedValue(student);

      const result = await resolver.resolve(identity);

      expect(users.linkGoogleAccount).toHaveBeenCalled();
      expect(result.isNewUser).toBe(false);
    });

    it('asks for support when a conflicting row is not a live account', async () => {
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail.mockResolvedValue(null);
      users.createGoogleUser.mockRejectedValue(new ConflictException('exists'));

      await expect(resolver.resolve(identity)).rejects.toThrow(
        /contact support/,
      );
    });

    it('treats an unexpected create failure as an authentication error', async () => {
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail.mockResolvedValue(null);
      users.createGoogleUser.mockRejectedValue(new Error('db down'));

      await expect(resolver.resolve(identity)).rejects.toThrow(
        'Failed to create user account',
      );
    });

    it('refuses a Google identity with no subject or email', async () => {
      await expect(
        resolver.resolve({ provider: StudentAuthProvider.GOOGLE }),
      ).rejects.toThrow(/Invalid Google sign-in/);
    });

    it('rejects an inactive Google-linked account', async () => {
      users.findAuthByGoogleSub.mockResolvedValue({
        user: { ...student, isActive: false },
        googleSub: 'sub-1',
      });

      await expect(resolver.resolve(identity)).rejects.toThrow(/deactivated/);
    });

    it('recovers when linking loses a race to the same Google subject', async () => {
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail
        .mockResolvedValueOnce({ user: student })
        .mockResolvedValueOnce({ user: student, googleSub: 'sub-1' });
      users.linkGoogleAccount.mockResolvedValue(null);

      const result = await resolver.resolve(identity);

      expect(result.user).toBe(student);
    });

    it('rejects when linking loses a race to a different Google subject', async () => {
      users.findAuthByGoogleSub.mockResolvedValue(null);
      users.findAuthByEmail
        .mockResolvedValueOnce({ user: student })
        .mockResolvedValueOnce({ user: student, googleSub: 'other' });
      users.linkGoogleAccount.mockResolvedValue(null);

      await expect(resolver.resolve(identity)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
