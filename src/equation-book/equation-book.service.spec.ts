import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EquationBookService } from './equation-book.service';
import { Equation } from './schemas/equation.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { Topic } from '../topics/schemas/topic.schema';
import { Exam } from '../exams/schemas/exam.schema';

const OID = '507f1f77bcf86cd799439011';
const OID2 = '507f1f77bcf86cd799439012';
const OID3 = '507f1f77bcf86cd799439013';

function chain(result: unknown) {
  const q: any = {
    exec: jest.fn().mockResolvedValue(result),
    populate: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
  };
  q.populate.mockReturnValue(q);
  q.sort.mockReturnValue(q);
  q.skip.mockReturnValue(q);
  q.limit.mockReturnValue(q);
  q.then = (resolve: any, reject: any) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

const equationDoc = (data: any = {}) => ({
  ...data,
  _id: data._id || { toString: () => OID },
  save: jest.fn().mockResolvedValue(undefined),
  toObject: () => ({
    id: OID,
    title: data.title || 'Net force?',
    shortDescription: data.shortDescription || 'Think ΣF',
    equation: data.equation || '$$\\Sigma F = ma$$',
    longDescription: data.longDescription,
    mnemonic: data.mnemonic,
    bulletPoints: data.bulletPoints || [],
    subject: data.subject || { id: OID, name: 'Physics' },
    topic: data.topic || { id: OID2, name: 'Laws of motion' },
    exams: data.exams || [{ id: OID3, name: 'NEET' }],
    isActive: data.isActive ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
});

describe('EquationBookService', () => {
  let service: EquationBookService;
  const equationModel: any = jest.fn().mockImplementation(() => equationDoc());
  equationModel.findById = jest.fn();
  equationModel.findByIdAndUpdate = jest.fn();
  equationModel.find = jest.fn();
  equationModel.countDocuments = jest.fn();

  const subjectModel: any = { findById: jest.fn() };
  const topicModel: any = { findById: jest.fn() };
  const examModel: any = { find: jest.fn() };

  const createDto = {
    title: 'Net force?',
    shortDescription: 'Think ΣF',
    equation: '$$\\Sigma F = ma$$',
    subject: OID,
    topic: OID2,
    exams: [OID3],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EquationBookService,
        { provide: getModelToken(Equation.name), useValue: equationModel },
        { provide: getModelToken(Subject.name), useValue: subjectModel },
        { provide: getModelToken(Topic.name), useValue: topicModel },
        { provide: getModelToken(Exam.name), useValue: examModel },
      ],
    }).compile();
    service = module.get(EquationBookService);
    jest.clearAllMocks();
    equationModel.mockImplementation(() => equationDoc());
  });

  describe('create', () => {
    it('creates an equation when refs are valid', async () => {
      subjectModel.findById.mockReturnValue(
        chain({ _id: OID, topics: [{ toString: () => OID2 }] }),
      );
      topicModel.findById.mockReturnValue(chain({ _id: OID2 }));
      examModel.find.mockReturnValue(chain([{ _id: OID3 }]));
      equationModel.findById.mockReturnValue(chain(equationDoc()));

      const result = await service.create(createDto as any);
      expect(result.title).toBe('Net force?');
      expect(result.exams).toHaveLength(1);
    });

    it('rejects missing subject', async () => {
      subjectModel.findById.mockReturnValue(chain(null));
      await expect(service.create(createDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects topic not on subject', async () => {
      subjectModel.findById.mockReturnValue(chain({ _id: OID, topics: [] }));
      topicModel.findById.mockReturnValue(chain({ _id: OID2 }));
      await expect(service.create(createDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects invalid exams', async () => {
      subjectModel.findById.mockReturnValue(
        chain({ _id: OID, topics: [{ toString: () => OID2 }] }),
      );
      topicModel.findById.mockReturnValue(chain({ _id: OID2 }));
      examModel.find.mockReturnValue(chain([]));
      await expect(service.create(createDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    it('returns paginated equations', async () => {
      equationModel.find.mockReturnValue(chain([equationDoc()]));
      equationModel.countDocuments.mockReturnValue(chain(1));
      const result = await service.findAll(1, 10, {
        examId: OID3,
        subjectId: OID,
        topicId: OID2,
        search: 'force',
      });
      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('returns an equation', async () => {
      equationModel.findById.mockReturnValue(chain(equationDoc()));
      await expect(service.findOne(OID)).resolves.toMatchObject({
        title: 'Net force?',
      });
    });

    it('throws when missing', async () => {
      equationModel.findById.mockReturnValue(chain(null));
      await expect(service.findOne(OID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates an equation', async () => {
      equationModel.findById.mockReturnValue(
        chain({
          subject: { toString: () => OID },
          topic: { toString: () => OID2 },
          exams: [{ toString: () => OID3 }],
        }),
      );
      subjectModel.findById.mockReturnValue(
        chain({ _id: OID, topics: [{ toString: () => OID2 }] }),
      );
      topicModel.findById.mockReturnValue(chain({ _id: OID2 }));
      examModel.find.mockReturnValue(chain([{ _id: OID3 }]));
      equationModel.findByIdAndUpdate.mockReturnValue(chain(equationDoc()));

      await expect(
        service.update(OID, { title: 'Updated' } as any),
      ).resolves.toBeDefined();
    });

    it('throws when missing', async () => {
      equationModel.findById.mockReturnValue(chain(null));
      await expect(
        service.update(OID, { title: 'Updated' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('soft deletes an equation', async () => {
      equationModel.findByIdAndUpdate.mockReturnValue(chain(equationDoc()));
      await expect(service.remove(OID)).resolves.toEqual({
        message: 'Equation deleted successfully',
      });
    });

    it('throws when missing', async () => {
      equationModel.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(service.remove(OID)).rejects.toThrow(NotFoundException);
    });
  });
});
