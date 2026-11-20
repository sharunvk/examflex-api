import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CounselingController } from './counseling.controller';
import { CounselingService } from './counseling.service';
import { CounselingRequestStatus } from './enums/counseling-request-status.enum';
import { CounselingWhoWillJoin } from './enums/counseling-who-will-join.enum';

describe('CounselingController', () => {
  let controller: CounselingController;
  const counselingService = {
    getMe: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CounselingController],
      providers: [{ provide: CounselingService, useValue: counselingService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CounselingController);
    jest.clearAllMocks();
  });

  it('returns counseling me status for the signed-in user', async () => {
    const data = { canRequest: true, activeRequest: null };
    counselingService.getMe.mockResolvedValue(data);

    await expect(controller.getMe({ id: 'user-1' } as never)).resolves.toEqual({
      message: 'Counseling status retrieved successfully',
      data,
    });
    expect(counselingService.getMe).toHaveBeenCalledWith('user-1');
  });

  it('creates a counseling request for the signed-in user', async () => {
    const dto = {
      whoWillJoin: CounselingWhoWillJoin.STUDENT,
      contact: {
        emailEnabled: true,
        email: 'riya@example.com',
        phoneEnabled: false,
      },
    };
    const data = {
      id: 'req-1',
      status: CounselingRequestStatus.BOOKED,
    };
    counselingService.create.mockResolvedValue(data);

    await expect(
      controller.create({ id: 'user-1' } as never, dto),
    ).resolves.toEqual({
      message: 'Counseling session requested successfully',
      data,
    });
    expect(counselingService.create).toHaveBeenCalledWith(
      { id: 'user-1' },
      dto,
    );
  });
});
