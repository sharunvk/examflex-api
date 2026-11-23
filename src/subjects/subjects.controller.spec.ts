import { Test, TestingModule } from '@nestjs/testing';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('SubjectsController', () => {
  let controller: SubjectsController;
  const subject = { id: 's1', name: 'QA' };
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    findByExam: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    listVectorSubjects: jest.fn(),
  };

  const admin = { id: 'admin-1' } as never;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubjectsController],
      providers: [{ provide: SubjectsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(SubjectsController);
    jest.clearAllMocks();
  });

  it('listVectorSubjects wraps data', async () => {
    const rows = [{ key: 'physics', label: 'Physics', vectorSubjectId: 'p' }];
    service.listVectorSubjects.mockResolvedValue(rows);
    await expect(controller.listVectorSubjects()).resolves.toMatchObject({
      data: rows,
    });
  });

  it('create wraps data', async () => {
    service.create.mockResolvedValue(subject);
    await expect(controller.create({} as any, admin)).resolves.toMatchObject({
      data: subject,
    });
  });

  it('findAll includes count', async () => {
    service.findAll.mockResolvedValue([subject]);
    expect((await controller.findAll()).count).toBe(1);
  });

  it('findByExam wraps data', async () => {
    service.findByExam.mockResolvedValue([subject]);
    await expect(controller.findByExam('e1')).resolves.toMatchObject({
      data: [subject],
    });
  });

  it('findOne wraps data', async () => {
    service.findOne.mockResolvedValue(subject);
    await expect(controller.findOne('s1')).resolves.toMatchObject({
      data: subject,
    });
  });

  it('update wraps data', async () => {
    service.update.mockResolvedValue(subject);
    await expect(
      controller.update('s1', {} as any, admin),
    ).resolves.toMatchObject({
      data: subject,
    });
  });

  it('remove wraps data', async () => {
    service.remove.mockResolvedValue(subject);
    await expect(controller.remove('s1', admin)).resolves.toMatchObject({
      data: subject,
    });
  });
});
