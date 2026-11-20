import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminCounselingController } from './admin-counseling.controller';
import { CounselingService } from './counseling.service';
import { CounselingRequestStatus } from './enums/counseling-request-status.enum';

describe('AdminCounselingController', () => {
  let controller: AdminCounselingController;
  const counselingService = {
    list: jest.fn(),
    updateStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminCounselingController],
      providers: [{ provide: CounselingService, useValue: counselingService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AdminCounselingController);
    jest.clearAllMocks();
  });

  it('lists counseling requests with pagination and status', async () => {
    const result = {
      data: [{ id: 'req-1' }],
      pagination: {
        total: 1,
        page: 1,
        limit: 12,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    };
    counselingService.list.mockResolvedValue(result);

    await expect(
      controller.list(1, 12, CounselingRequestStatus.BOOKED),
    ).resolves.toEqual({
      message: 'Counseling requests retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    });
    expect(counselingService.list).toHaveBeenCalledWith(
      1,
      12,
      CounselingRequestStatus.BOOKED,
    );
  });

  it('advances status for an admin', async () => {
    const data = { id: 'req-1', status: CounselingRequestStatus.ACKNOWLEDGED };
    counselingService.updateStatus.mockResolvedValue(data);

    await expect(
      controller.updateStatus(
        'req-1',
        { status: CounselingRequestStatus.ACKNOWLEDGED },
        { id: 'admin-1' } as never,
      ),
    ).resolves.toEqual({
      message: 'Counseling request status updated successfully',
      data,
    });
    expect(counselingService.updateStatus).toHaveBeenCalledWith(
      'req-1',
      CounselingRequestStatus.ACKNOWLEDGED,
      'admin-1',
    );
  });
});
