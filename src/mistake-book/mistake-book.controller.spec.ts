import { Test, TestingModule } from '@nestjs/testing';
import { MistakeBookController } from './mistake-book.controller';
import { MistakeBookService } from './mistake-book.service';
import { PaperType } from '../common/enums/paper-type.enum';

describe('MistakeBookController', () => {
  let controller: MistakeBookController;
  const service = {
    listSessions: jest.fn(),
    getSession: jest.fn(),
    updateTripReason: jest.fn(),
    deleteEntry: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MistakeBookController],
      providers: [{ provide: MistakeBookService, useValue: service }],
    }).compile();

    controller = module.get(MistakeBookController);
    jest.clearAllMocks();
  });

  it('lists sessions', async () => {
    service.listSessions.mockResolvedValue({
      data: [],
      pagination: {
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
    });

    const result = await controller.listSessions({ id: 'u1' } as never, {
      page: 1,
      limit: 20,
    });
    expect(result.data).toEqual([]);
    expect(service.listSessions).toHaveBeenCalledWith('u1', 1, 20);
  });

  it('gets a session and mutates entries', async () => {
    service.getSession.mockResolvedValue({
      mockTestId: 'm1',
      attemptId: 'a1',
      title: 'Mock',
      paperType: PaperType.FULL_EXAM,
      remainingCount: 1,
      attemptSubmittedAt: new Date(),
      subjects: [],
      chapters: [],
      entries: [],
    });
    service.updateTripReason.mockResolvedValue(undefined);
    service.deleteEntry.mockResolvedValue(undefined);

    await controller.getSession({ id: 'u1' } as never, 'm1', {});
    await controller.updateTripReason({ id: 'u1' } as never, 'e1', {
      tripReason: 'time',
    });
    await controller.deleteEntry({ id: 'u1' } as never, 'e1');

    expect(service.getSession).toHaveBeenCalledWith(
      'u1',
      'm1',
      undefined,
      undefined,
    );
    expect(service.updateTripReason).toHaveBeenCalledWith('u1', 'e1', 'time');
    expect(service.deleteEntry).toHaveBeenCalledWith('u1', 'e1');
  });
});
