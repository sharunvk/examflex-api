import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CounselingWhoWillJoin } from '../enums/counseling-who-will-join.enum';
import { CreateCounselingRequestDto } from './create-counseling-request.dto';

describe('CreateCounselingRequestDto', () => {
  it('accepts a request with email contact enabled', async () => {
    const dto = plainToInstance(CreateCounselingRequestDto, {
      whoWillJoin: CounselingWhoWillJoin.STUDENT,
      contact: {
        emailEnabled: true,
        email: 'riya@example.com',
        phoneEnabled: false,
      },
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects when neither contact channel is usable', async () => {
    const dto = plainToInstance(CreateCounselingRequestDto, {
      whoWillJoin: CounselingWhoWillJoin.STUDENT,
      contact: {
        emailEnabled: false,
        phoneEnabled: false,
      },
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('trims blank optional strings to undefined', async () => {
    const dto = plainToInstance(CreateCounselingRequestDto, {
      studentName: '   ',
      whoWillJoin: CounselingWhoWillJoin.STUDENT_AND_PARENT,
      contact: {
        emailEnabled: false,
        phoneEnabled: true,
        phone: '+91 98765 43210',
      },
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.studentName).toBeUndefined();
  });
});
