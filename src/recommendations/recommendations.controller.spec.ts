import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationKind } from './enums/recommendation-kind.enum';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

describe('RecommendationsController', () => {
  let controller: RecommendationsController;
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationsController],
      providers: [{ provide: RecommendationsService, useValue: service }],
    }).compile();
    controller = module.get(RecommendationsController);
    jest.clearAllMocks();
  });

  it('create wraps service result', async () => {
    const data = {
      id: '1',
      title: 'MBBS',
      kind: RecommendationKind.COURSE,
    };
    service.create.mockResolvedValue(data);
    const result = await controller.create(
      {
        exam: 'e1',
        title: 'MBBS',
        minPercent: 75,
      } as never,
      { id: 'admin' } as never,
    );
    expect(result.message).toMatch(/created/i);
    expect(result.data).toEqual(data);
  });

  it('findAll wraps paginated result', async () => {
    service.findAll.mockResolvedValue({
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
    const result = await controller.findAll(1, 20);
    expect(result.data).toEqual([]);
    expect(result.pagination.page).toBe(1);
  });

  it('findOne / update / remove wrap service', async () => {
    const data = { id: '1', title: 'MBBS' };
    service.findOne.mockResolvedValue(data);
    service.update.mockResolvedValue(data);
    service.remove.mockResolvedValue(data);

    await expect(controller.findOne('1')).resolves.toMatchObject({ data });
    await expect(
      controller.update(
        '1',
        { title: 'BDS' } as never,
        {
          id: 'admin',
        } as never,
      ),
    ).resolves.toMatchObject({ data });
    await expect(
      controller.remove('1', { id: 'admin' } as never),
    ).resolves.toMatchObject({ data });
  });
});
