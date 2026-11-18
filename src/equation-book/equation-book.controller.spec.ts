import { Test, TestingModule } from '@nestjs/testing';
import { EquationBookController } from './equation-book.controller';
import { EquationBookService } from './equation-book.service';

const OID = '507f1f77bcf86cd799439011';

describe('EquationBookController', () => {
  let controller: EquationBookController;
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EquationBookController],
      providers: [{ provide: EquationBookService, useValue: service }],
    }).compile();
    controller = module.get(EquationBookController);
    jest.clearAllMocks();
  });

  it('creates an equation', async () => {
    service.create.mockResolvedValue({ id: OID, title: 'Force' });
    const result = await controller.create(
      {
        title: 'Force',
        shortDescription: 'cue',
        equation: '$$F=ma$$',
        subject: OID,
        topic: OID,
        exams: [OID],
      } as any,
      { id: OID } as any,
    );
    expect(result.message).toContain('created');
    expect(service.create).toHaveBeenCalled();
  });

  it('lists equations', async () => {
    service.findAll.mockResolvedValue({
      data: [{ id: OID }],
      pagination: {
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    });
    const result = await controller.findAll(1, 10, OID, OID, OID, 'force');
    expect(result.data).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith(1, 10, {
      examId: OID,
      subjectId: OID,
      topicId: OID,
      search: 'force',
    });
  });

  it('gets one equation', async () => {
    service.findOne.mockResolvedValue({ id: OID });
    const result = await controller.findOne(OID);
    expect(result.data.id).toBe(OID);
  });

  it('updates an equation', async () => {
    service.update.mockResolvedValue({ id: OID, title: 'Updated' });
    const result = await controller.update(
      OID,
      { title: 'Updated' } as any,
      { id: OID } as any,
    );
    expect(result.message).toContain('updated');
  });

  it('soft deletes an equation', async () => {
    service.remove.mockResolvedValue({
      message: 'Equation deleted successfully',
    });
    await expect(controller.remove(OID, { id: OID } as any)).resolves.toEqual({
      message: 'Equation deleted successfully',
    });
  });
});
