import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { SubjectsService } from './subjects.service';
import { Subject } from './schemas/subject.schema';
import { Topic } from '../topics/schemas/topic.schema';
import { Exam } from '../exams/schemas/exam.schema';

const OID = '507f1f77bcf86cd799439011';
const OID2 = '507f1f77bcf86cd799439012';

function chain(result: unknown) {
  const q: any = {
    exec: jest.fn().mockResolvedValue(result),
    populate: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(),
    select: jest.fn(),
  };
  q.populate.mockReturnValue(q);
  q.sort.mockReturnValue(q);
  q.skip.mockReturnValue(q);
  q.limit.mockReturnValue(q);
  q.lean.mockReturnValue(q);
  q.select.mockReturnValue(q);
  q.then = (resolve: any, reject: any) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

const subjectDoc = (data: any) => {
  const obj = {
    ...data,
    _id: data._id || { toString: () => OID },
    id: data.id || OID,
    topics: data.topics || [],
  };
  return {
    ...obj,
    populate: jest.fn().mockResolvedValue({
      toObject: () => obj,
    }),
    toObject: () => obj,
  };
};

describe('SubjectsService', () => {
  let service: SubjectsService;
  const subjectModel: any = jest.fn();
  subjectModel.findOne = jest.fn();
  subjectModel.findById = jest.fn();
  subjectModel.findByIdAndUpdate = jest.fn();
  subjectModel.find = jest.fn();
  subjectModel.create = jest.fn();

  const topicModel: any = { find: jest.fn() };
  const examModel: any = { aggregate: jest.fn(), exists: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubjectsService,
        { provide: getModelToken(Subject.name), useValue: subjectModel },
        { provide: getModelToken(Topic.name), useValue: topicModel },
        { provide: getModelToken(Exam.name), useValue: examModel },
      ],
    }).compile();
    service = module.get(SubjectsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates a subject', async () => {
      subjectModel.findOne.mockReturnValue(chain(null));
      topicModel.find.mockReturnValue(chain([{ _id: OID }]));
      const created = subjectDoc({
        name: 'QA',
        topics: [
          { _id: { toString: () => OID }, name: 'Ratio' },
          OID2,
          'plain',
        ],
      });
      created.topics.push(new Types.ObjectId(OID));
      subjectModel.create.mockResolvedValue(created);

      await expect(
        service.create({ name: 'QA', topics: [OID] } as any),
      ).resolves.toBeDefined();
    });

    it('throws ConflictException', async () => {
      subjectModel.findOne.mockReturnValue(chain({ name: 'QA' }));
      await expect(service.create({ name: 'QA' } as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException for invalid topics', async () => {
      subjectModel.findOne.mockReturnValue(chain(null));
      topicModel.find.mockReturnValue(chain([]));
      await expect(
        service.create({ name: 'QA', topics: [OID] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('returns subjects', async () => {
      subjectModel.find.mockReturnValue(
        chain([subjectDoc({ name: 'QA', topics: [] })]),
      );
      const result = await service.findAll();
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('returns a subject', async () => {
      subjectModel.findById.mockReturnValue(chain(subjectDoc({ name: 'QA' })));
      await expect(service.findOne(OID)).resolves.toBeDefined();
    });

    it('throws NotFoundException', async () => {
      subjectModel.findById.mockReturnValue(chain(null));
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates a subject', async () => {
      subjectModel.findOne.mockReturnValue(chain(null));
      topicModel.find.mockReturnValue(chain([{ _id: OID }]));
      subjectModel.findByIdAndUpdate.mockReturnValue(
        chain(subjectDoc({ name: 'Updated' })),
      );
      await expect(
        service.update(OID, { name: 'Updated', topics: [OID] }),
      ).resolves.toBeDefined();
    });

    it('throws ConflictException', async () => {
      subjectModel.findOne.mockReturnValue(chain({ name: 'Taken' }));
      await expect(service.update(OID, { name: 'Taken' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException for invalid topics', async () => {
      topicModel.find.mockReturnValue(chain([]));
      await expect(service.update(OID, { topics: [OID] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException', async () => {
      subjectModel.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(service.update(OID, { description: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft deletes a subject', async () => {
      subjectModel.findByIdAndUpdate.mockReturnValue(
        chain(subjectDoc({ isDeleted: true })),
      );
      await expect(service.remove(OID)).resolves.toBeDefined();
    });

    it('throws NotFoundException', async () => {
      subjectModel.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByExam', () => {
    it('returns subjects for an exam with topics', async () => {
      examModel.aggregate.mockReturnValue(
        chain([
          {
            _id: { toString: () => OID },
            name: 'QA',
            description: 'd',
            topics: [{ _id: { toString: () => OID }, name: 'Ratio' }],
          },
        ]),
      );
      const result = await service.findByExam(OID);
      expect(result).toHaveLength(1);
      expect(result[0].topics).toEqual([{ id: OID, name: 'Ratio' }]);
    });

    it('returns empty list when exam exists but has no subjects', async () => {
      examModel.aggregate.mockReturnValue(chain([]));
      examModel.exists.mockReturnValue(chain({ _id: OID }));
      const result = await service.findByExam(OID);
      expect(result).toEqual([]);
    });

    it('throws NotFoundException when exam is missing', async () => {
      examModel.aggregate.mockReturnValue(chain([]));
      examModel.exists.mockReturnValue(chain(null));
      await expect(service.findByExam(OID)).rejects.toThrow(NotFoundException);
    });
  });
});
