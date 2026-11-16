import { Test, TestingModule } from '@nestjs/testing';
import { MockTestsController } from './mock-tests.controller';
import { MockTestsService } from './mock-tests.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

describe('MockTestsController', () => {
  let controller: MockTestsController;
  const mockTestsService = {
    findAll: jest.fn(),
    getStats: jest.fn(),
    findActive: jest.fn(),
    findByExam: jest.fn(),
    findBySubject: jest.fn(),
    findByExamAndSubject: jest.fn(),
    findOne: jest.fn(),
    createTopicWise: jest.fn(),
    updateTopicWise: jest.fn(),
    removeTopicWise: jest.fn(),
  };

  const user = { id: 'u1', role: UserRole.USER };
  const admin = { id: 'a1', role: UserRole.ADMIN };
  const page = { data: [{ id: 't1' }], pagination: { total: 1, page: 1 } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MockTestsController],
      providers: [{ provide: MockTestsService, useValue: mockTestsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(MockTestsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll should wrap results and change message with search', async () => {
    mockTestsService.findAll.mockResolvedValue(page);

    const withoutSearch = await controller.findAll(
      1,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      user as any,
    );
    expect(withoutSearch.message).toBe('Mock tests retrieved successfully');

    const withSearch = await controller.findAll(
      1,
      10,
      'NEET',
      'exam-1',
      undefined,
      undefined,
      admin as any,
    );
    expect(withSearch.message).toContain('NEET');
    expect(mockTestsService.findAll).toHaveBeenLastCalledWith(
      1,
      10,
      'NEET',
      'a1',
      true,
      { examId: 'exam-1', subjectId: undefined, topicId: undefined },
    );
  });

  it('should delegate remaining endpoints', async () => {
    mockTestsService.getStats.mockResolvedValue({ totalTests: 1 });
    mockTestsService.findActive.mockResolvedValue(page);
    mockTestsService.findByExam.mockResolvedValue(page);
    mockTestsService.findBySubject.mockResolvedValue(page);
    mockTestsService.findByExamAndSubject.mockResolvedValue(page);
    mockTestsService.findOne.mockResolvedValue({ id: 't1' });
    mockTestsService.createTopicWise.mockResolvedValue({ id: 't1' });
    mockTestsService.updateTopicWise.mockResolvedValue({ id: 't1' });
    mockTestsService.removeTopicWise.mockResolvedValue({
      message: 'Mock test deleted successfully',
    });

    await expect(controller.getStats()).resolves.toMatchObject({
      data: { totalTests: 1 },
    });
    await expect(
      controller.findActive(1, 10, user as any),
    ).resolves.toMatchObject({
      data: page.data,
    });
    await expect(
      controller.findByExam('e1', 1, 10, 's', 'sub', 'topic', user as any),
    ).resolves.toMatchObject({ data: page.data });
    expect(mockTestsService.findByExam).toHaveBeenCalledWith(
      'e1',
      1,
      10,
      user.id,
      's',
      'sub',
      'topic',
    );
    await expect(
      controller.findBySubject('s1', 1, 10, user as any),
    ).resolves.toMatchObject({ data: page.data });
    await expect(
      controller.findByExamAndSubject('e1', 's1', 1, 10, user as any),
    ).resolves.toMatchObject({ data: page.data });
    await expect(controller.findOne('t1', user as any)).resolves.toMatchObject({
      data: { id: 't1' },
    });
    await expect(
      controller.create({} as any, admin as any),
    ).resolves.toMatchObject({ data: { id: 't1' } });
    await expect(
      controller.update('t1', {} as any, admin as any),
    ).resolves.toMatchObject({ data: { id: 't1' } });
    await expect(controller.remove('t1', admin as any)).resolves.toEqual({
      message: 'Mock test deleted successfully',
    });
  });
});
