import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { Order } from '../orders/schemas/order.schema';
import { TaxInvoice } from '../invoices/schemas/tax-invoice.schema';
import { Exam } from '../exams/schemas/exam.schema';
import { UserRole } from '../common/enums/user-role.enum';

const OID = '507f1f77bcf86cd799439011';
const PHONE = '+919876543210';

function chain(result: unknown) {
  const q: any = {
    exec: jest.fn().mockResolvedValue(result),
    populate: jest.fn(),
    select: jest.fn(),
    lean: jest.fn(),
  };
  q.populate.mockReturnValue(q);
  q.select.mockReturnValue(q);
  q.lean.mockReturnValue(q);
  // The service sometimes awaits a query directly instead of calling exec().
  q.then = (resolve: any, reject: any) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

function userDoc(data: Record<string, unknown>) {
  const base = {
    name: 'Rahul',
    email: 'rahul@example.com',
    role: UserRole.USER,
    isActive: true,
    isDeleted: false,
    ...data,
    _id: OID,
  };
  return { ...base, toObject: () => ({ ...base, id: OID }) };
}

describe('UsersService: verified phone + onboarding', () => {
  let service: UsersService;

  const model: any = jest.fn();
  model.findById = jest.fn();
  model.findOne = jest.fn();
  model.updateOne = jest.fn();
  model.findByIdAndUpdate = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    model.updateOne.mockReturnValue(chain({ modifiedCount: 1 }));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: model },
        { provide: getModelToken(Order.name), useValue: {} },
        { provide: getModelToken(TaxInvoice.name), useValue: {} },
        { provide: getModelToken(Exam.name), useValue: {} },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  /** findById serves both the guard read and the final findOne() re-read. */
  const stubUser = (data: Record<string, unknown>) =>
    model.findById.mockImplementation(() => chain(userDoc(data)));

  describe('profile state in responses', () => {
    it.each([
      ['no phone, not onboarded', {}, false, false, false],
      [
        'phone typed but never verified',
        { phoneNumber: PHONE },
        false,
        false,
        false,
      ],
      [
        'verified, not onboarded',
        { phoneNumber: PHONE, phoneVerifiedAt: new Date() },
        true,
        false,
        false,
      ],
      [
        'verified and onboarded',
        {
          phoneNumber: PHONE,
          phoneVerifiedAt: new Date(),
          onboardingCompletedAt: new Date(),
        },
        true,
        true,
        true,
      ],
      [
        'onboarded flag without a verified phone',
        { onboardingCompletedAt: new Date() },
        false,
        true,
        false,
      ],
    ])('%s', async (_label, data, verified, onboarded, complete) => {
      stubUser(data as Record<string, unknown>);
      const result = await service.findOne(OID);
      expect(result.phoneVerified).toBe(verified);
      expect(result.onboardingCompleted).toBe(onboarded);
      expect(result.profileComplete).toBe(complete);
      expect(result).not.toHaveProperty('phoneVerifiedAt');
      expect(result).not.toHaveProperty('onboardingCompletedAt');
    });

    it('treats admins as always complete', async () => {
      stubUser({ role: UserRole.ADMIN });
      expect((await service.findOne(OID)).profileComplete).toBe(true);
    });
  });

  describe('markPhoneVerified', () => {
    it('stamps only accounts that have an unstamped number', async () => {
      await service.markPhoneVerified(OID);
      const [filter, update] = model.updateOne.mock.calls[0];
      expect(filter.phoneNumber).toEqual({ $type: 'string' });
      expect(filter.phoneVerifiedAt).toEqual({ $exists: false });
      expect(update.$set.phoneVerifiedAt).toBeInstanceOf(Date);
    });
  });

  describe('setVerifiedPhone', () => {
    beforeEach(() => {
      model.findOne.mockImplementation(() => chain(null));
    });

    it('attaches a new number and stamps it verified', async () => {
      stubUser({});
      await service.setVerifiedPhone(OID, PHONE);
      const [, update] = model.updateOne.mock.calls[0];
      expect(update.$set.phoneNumber).toBe(PHONE);
      expect(update.$set.phoneVerifiedAt).toBeInstanceOf(Date);
    });

    it('is idempotent for the same already-verified number', async () => {
      stubUser({ phoneNumber: PHONE, phoneVerifiedAt: new Date() });
      await service.setVerifiedPhone(OID, PHONE);
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('replaces an old, unverified number', async () => {
      stubUser({ phoneNumber: '+911111111111' });
      await service.setVerifiedPhone(OID, PHONE);
      expect(model.updateOne.mock.calls[0][1].$set.phoneNumber).toBe(PHONE);
    });

    it('refuses to swap a different verified number', async () => {
      stubUser({ phoneNumber: '+911111111111', phoneVerifiedAt: new Date() });
      await expect(service.setVerifiedPhone(OID, PHONE)).rejects.toMatchObject({
        response: { error: 'PHONE_ALREADY_SET' },
      });
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('rejects a number that belongs to another account', async () => {
      stubUser({});
      model.findOne.mockImplementation(() => chain({ _id: 'someone-else' }));
      await expect(service.setVerifiedPhone(OID, PHONE)).rejects.toMatchObject({
        response: { error: 'PHONE_IN_USE' },
      });
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('maps a duplicate-key race to the same "already linked" error', async () => {
      stubUser({});
      model.updateOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue({ code: 11000 }),
      });
      await expect(service.setVerifiedPhone(OID, PHONE)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('does not mask other database errors', async () => {
      stubUser({});
      model.updateOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('mongo down')),
      });
      await expect(service.setVerifiedPhone(OID, PHONE)).rejects.toThrow(
        'mongo down',
      );
    });

    it.each([
      ['missing', null],
      ['deactivated', userDoc({ isActive: false })],
      ['deleted', userDoc({ isDeleted: true })],
    ])('rejects a %s account', async (_label, doc) => {
      model.findById.mockImplementation(() => chain(doc));
      await expect(service.setVerifiedPhone(OID, PHONE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('completeOnboarding', () => {
    const input = { name: 'Rahul Sharma', targetExamId: 'exam-1' };
    let setTargetExams: jest.SpyInstance;

    beforeEach(() => {
      setTargetExams = jest
        .spyOn(service, 'setTargetExams')
        .mockResolvedValue({} as never);
    });

    it('requires a verified number first', async () => {
      stubUser({ phoneNumber: PHONE }); // typed, never verified
      await expect(
        service.completeOnboarding(OID, input),
      ).rejects.toMatchObject({ response: { error: 'PHONE_NOT_VERIFIED' } });
      expect(setTargetExams).not.toHaveBeenCalled();
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('requires a number at all', async () => {
      stubUser({});
      await expect(
        service.completeOnboarding(OID, input),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('saves the single exam, the name and the completion stamp', async () => {
      stubUser({ phoneNumber: PHONE, phoneVerifiedAt: new Date() });
      await service.completeOnboarding(OID, input);
      expect(setTargetExams).toHaveBeenCalledWith(OID, ['exam-1']);
      const [, update] = model.updateOne.mock.calls[0];
      expect(update.$set.name).toBe('Rahul Sharma');
      expect(update.$set.onboardingCompletedAt).toBeInstanceOf(Date);
    });

    it('is a no-op for a learner who already finished (retry, or a direct API call)', async () => {
      stubUser({
        phoneNumber: PHONE,
        phoneVerifiedAt: new Date(),
        onboardingCompletedAt: new Date('2026-01-01'),
      });
      const result = await service.completeOnboarding(OID, input);
      // their exam list and name are left exactly as they were
      expect(setTargetExams).not.toHaveBeenCalled();
      expect(model.updateOne).not.toHaveBeenCalled();
      expect(result.onboardingCompleted).toBe(true);
    });

    it('writes nothing when the exam is rejected', async () => {
      stubUser({ phoneNumber: PHONE, phoneVerifiedAt: new Date() });
      setTargetExams.mockRejectedValue(new Error('unknown exam'));
      await expect(service.completeOnboarding(OID, input)).rejects.toThrow(
        'unknown exam',
      );
      expect(model.updateOne).not.toHaveBeenCalled();
    });
  });
  describe('a number changed outside the OTP flow is not a verified number', () => {
    const dto = { phoneNumber: PHONE };
    const updated = userDoc({ phoneNumber: PHONE });

    beforeEach(() => {
      model.findOne.mockImplementation(() => chain(null)); // no conflicting account
      model.findByIdAndUpdate.mockReset();
      model.findByIdAndUpdate.mockImplementation(() => chain(updated));
    });

    it('drops the verified stamp when an admin changes the number', async () => {
      model.findById.mockImplementation(() =>
        chain({ phoneNumber: '+911111111111' }),
      );
      await service.update(OID, dto as never);
      const [, update] = model.findByIdAndUpdate.mock.calls[0];
      expect(update.$set).toMatchObject({ phoneNumber: PHONE });
      expect(update.$unset).toEqual({ phoneVerifiedAt: 1 });
    });

    it('also drops it when the account had no number before', async () => {
      model.findById.mockImplementation(() => chain({}));
      await service.update(OID, dto as never);
      expect(model.findByIdAndUpdate.mock.calls[0][1].$unset).toEqual({
        phoneVerifiedAt: 1,
      });
    });

    it('keeps the stamp when an admin form re-saves the same number', async () => {
      model.findById.mockImplementation(() => chain({ phoneNumber: PHONE }));
      await service.update(OID, {
        phoneNumber: PHONE,
        name: 'Renamed',
      } as never);
      const [, update] = model.findByIdAndUpdate.mock.calls[0];
      expect(update).not.toHaveProperty('$unset');
      expect(update.$set).toMatchObject({ name: 'Renamed' });
    });

    it('does not even look at the number when it is not being edited', async () => {
      await service.update(OID, { name: 'Renamed' } as never);
      expect(model.findById).not.toHaveBeenCalled();
      expect(model.findByIdAndUpdate.mock.calls[0][1]).not.toHaveProperty(
        '$unset',
      );
    });

    it('reports a number that another account owns as 409 instead of a raw database error', async () => {
      model.findById.mockImplementation(() =>
        chain({ phoneNumber: '+911111111111' }),
      );
      model.findByIdAndUpdate.mockImplementation(() => ({
        exec: jest.fn().mockRejectedValue({ code: 11000 }),
      }));
      await expect(service.update(OID, dto as never)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('does not hide other database failures', async () => {
      model.findById.mockImplementation(() =>
        chain({ phoneNumber: '+911111111111' }),
      );
      model.findByIdAndUpdate.mockImplementation(() => ({
        exec: jest.fn().mockRejectedValue(new Error('mongo down')),
      }));
      await expect(service.update(OID, dto as never)).rejects.toThrow(
        'mongo down',
      );
    });

    it('404s for an unknown account', async () => {
      model.findById.mockImplementation(() => chain(null));
      await expect(service.update(OID, dto as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('deleting an account', () => {
    it('forgets the verification and onboarding stamps along with the number', async () => {
      model.findByIdAndUpdate.mockReset();
      model.findByIdAndUpdate.mockImplementation(() =>
        chain(userDoc({ isDeleted: true })),
      );
      await service.softDelete(OID);
      const [, update] = model.findByIdAndUpdate.mock.calls[0];
      expect(update.$unset).toMatchObject({
        phoneNumber: 1,
        googleSub: 1,
        phoneVerifiedAt: 1,
        onboardingCompletedAt: 1,
      });
    });
  });
  describe('an email is only added by proving it with an OTP', () => {
    beforeEach(() => {
      model.findOne.mockImplementation(() => chain(null)); // nobody else owns it
      model.findByIdAndUpdate.mockReset();
      model.findByIdAndUpdate.mockImplementation(() => chain(userDoc({})));
    });

    const currentEmail = (email: string | undefined) =>
      model.findById.mockImplementation(() => chain({ email }));

    it.each([
      [
        'a new address on a placeholder account',
        'user9198@temp.examflex.com',
        'riya@example.com',
      ],
      [
        'a new address on an account without one',
        undefined,
        'riya@example.com',
      ],
      [
        'a different address on a real-email account',
        'asha@gmail.com',
        'riya@example.com',
      ],
      [
        'the placeholder itself',
        'user9198@temp.examflex.com',
        'user9198@temp.examflex.com',
      ],
      ['an empty string', 'asha@gmail.com', ''],
      ['a non-string', 'asha@gmail.com', 42],
    ])(
      'PATCH /users/me refuses %s, and writes nothing',
      async (_l, current, email) => {
        currentEmail(current);
        await expect(
          service.updateMe(OID, { email, name: 'Asha K' } as never),
        ).rejects.toMatchObject({
          status: 400,
          response: { error: 'EMAIL_VERIFICATION_REQUIRED' },
        });
        expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
      },
    );

    it('ignores the current email re-sent with the form (any case), and saves the rest', async () => {
      currentEmail('Asha@Gmail.com');
      await service.updateMe(OID, {
        email: ' asha@gmail.com ',
        name: 'Asha K',
      } as never);
      const [, update] = model.findByIdAndUpdate.mock.calls[0];
      expect(update.$set).toEqual({ name: 'Asha K' });
    });

    it('404s for an unknown account', async () => {
      model.findById.mockImplementation(() => chain(null));
      await expect(
        service.updateMe(OID, { email: 'x@example.com' } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not even look up the email when it is not being edited', async () => {
      await service.updateMe(OID, { name: 'Renamed' } as never);
      expect(model.findById).not.toHaveBeenCalled();
      expect(model.findByIdAndUpdate).toHaveBeenCalled();
    });
  });

  describe('setVerifiedEmail', () => {
    beforeEach(() => {
      model.findOne.mockImplementation(() => chain(null));
    });

    it.each([
      ['an OTP placeholder', 'user919876543210@temp.examflex.com'],
      ['an uppercase placeholder', 'USER9198@TEMP.EXAMFLEX.COM'],
      ['no email on record', undefined],
      ['an empty email on record', ''],
    ])('attaches and stamps the address for %s', async (_label, email) => {
      stubUser({ email });
      await service.setVerifiedEmail(OID, ' Riya@Example.com ');
      const [, update] = model.updateOne.mock.calls[0];
      expect(update.$set.email).toBe('riya@example.com');
      expect(update.$set.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('stamps the same real address again, ignoring case', async () => {
      stubUser({ email: 'Asha@Gmail.com' });
      await service.setVerifiedEmail(OID, 'asha@gmail.com');
      expect(model.updateOne).toHaveBeenCalled();
    });

    it('refuses to swap an existing real email', async () => {
      stubUser({ email: 'asha@gmail.com' });
      await expect(
        service.setVerifiedEmail(OID, 'someone.else@example.com'),
      ).rejects.toMatchObject({ response: { error: 'EMAIL_ALREADY_SET' } });
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('refuses an address another account owns', async () => {
      stubUser({ email: 'user9198@temp.examflex.com' });
      model.findOne.mockImplementation(() => chain({ _id: 'someone-else' }));
      await expect(
        service.setVerifiedEmail(OID, 'taken@example.com'),
      ).rejects.toMatchObject({ response: { error: 'EMAIL_IN_USE' } });
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('maps a duplicate-key race to EMAIL_IN_USE', async () => {
      stubUser({ email: 'user9198@temp.examflex.com' });
      model.updateOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue({ code: 11000 }),
      });
      await expect(
        service.setVerifiedEmail(OID, 'taken@example.com'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows other write errors', async () => {
      stubUser({ email: 'user9198@temp.examflex.com' });
      model.updateOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('db down')),
      });
      await expect(
        service.setVerifiedEmail(OID, 'riya@example.com'),
      ).rejects.toThrow('db down');
    });

    it.each([
      ['unknown', null],
      ['deleted', { isDeleted: true }],
      ['deactivated', { isActive: false }],
    ])('404s for a %s account', async (_label, data) => {
      model.findById.mockImplementation(() =>
        chain(data === null ? null : userDoc(data)),
      );
      await expect(
        service.setVerifiedEmail(OID, 'riya@example.com'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('emailVerified in responses', () => {
    it.each([
      ['a real email with no proof', {}, false],
      ['an OTP-verified email', { emailVerifiedAt: new Date() }, true],
      ['a Google-linked email', { googleSub: 'g-123' }, true],
      [
        'a stamped placeholder',
        {
          email: 'user9198@temp.examflex.com',
          emailVerifiedAt: new Date(),
        },
        false,
      ],
      ['no email at all', { email: undefined, googleSub: 'g-1' }, false],
    ])('%s', async (_label, data, expected) => {
      stubUser(data as Record<string, unknown>);
      const result = await service.findOne(OID);
      expect(result.emailVerified).toBe(expected);
      expect(result).not.toHaveProperty('emailVerifiedAt');
    });
  });
});
