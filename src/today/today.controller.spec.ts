import { Test, TestingModule } from '@nestjs/testing';
import { TodayController } from './today.controller';
import { TodayService } from './today.service';

describe('TodayController', () => {
  let controller: TodayController;
  const todayService = {
    getToday: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TodayController],
      providers: [{ provide: TodayService, useValue: todayService }],
    }).compile();
    controller = module.get(TodayController);
    jest.clearAllMocks();
  });

  it('wraps today result', async () => {
    const data = { mode: 'empty', examId: 'e1' };
    todayService.getToday.mockResolvedValue(data);
    const result = await controller.getToday({ id: 'u1' } as never, 'e1');
    expect(result.message).toMatch(/retrieved/i);
    expect(result.data).toEqual(data);
    expect(todayService.getToday).toHaveBeenCalledWith('u1', 'e1');
  });
});
