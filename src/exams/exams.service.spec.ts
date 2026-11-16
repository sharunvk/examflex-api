import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ExamsService } from './exams.service';
import { Exam } from './schemas/exam.schema';
import { Category } from '../categories/schemas/category.schema';
import { ExamGroup } from '../exam-groups/schemas/exam-group.schema';

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

const examDoc = (data: any) => ({
  ...data,
  _id: data._id || OID,
  toObject: () => ({
    ...data,
    id: data.id || OID,
    category: data.category || OID,
    examGroup: data.examGroup || OID2,
    subjects: data.subjects || [],
  }),
});

describe('ExamsService', () => {
  let service: ExamsService;
  const examModel: any = jest.fn();
  examModel.findOne = jest.fn();
  examModel.findById = jest.fn();
  examModel.findByIdAndUpdate = jest.fn();
  examModel.find = jest.fn();
  examModel.create = jest.fn();
  examModel.countDocuments = jest.fn();
  examModel.aggregate = jest.fn();

  const categoryModel: any = { findById: jest.fn(), find: jest.fn() };
  const examGroupModel: any = { findById: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamsService,
        { provide: getModelToken(Exam.name), useValue: examModel },
        { provide: getModelToken(Category.name), useValue: categoryModel },
        { provide: getModelToken(ExamGroup.name), useValue: examGroupModel },
      ],
    }).compile();
    service = module.get(ExamsService);
    jest.clearAllMocks();
  });

  const dto = {
    name: 'SBI PO',
    category: OID,
    examGroup: OID2,
    subjects: [{ numberOfQuestions: 10, marksPerQuestion: 2 }],
  };

  describe('create', () => {
    it('creates an exam with computed totals', async () => {
      categoryModel.findById.mockReturnValue(chain({ _id: OID }));
      examGroupModel.findById.mockReturnValue(
        chain({ _id: OID2, category: OID }),
      );
      examModel.findOne.mockReturnValue(chain(null));
      examModel.create.mockResolvedValue(examDoc({ name: 'SBI PO' }));

      const result = await service.create(dto as any);
      expect(result).toBeDefined();
      expect(examModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalQuestions: 10, totalMarks: 20 }),
      );
    });

    it('throws when category is missing', async () => {
      categoryModel.findById.mockReturnValue(chain(null));
      await expect(service.create(dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws when exam group is missing', async () => {
      categoryModel.findById.mockReturnValue(chain({ _id: OID }));
      examGroupModel.findById.mockReturnValue(chain(null));
      await expect(service.create(dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws when exam category does not match exam group category', async () => {
      const otherCategory = '507f1f77bcf86cd799439099';
      categoryModel.findById.mockReturnValue(chain({ _id: OID }));
      examGroupModel.findById.mockReturnValue(
        chain({ _id: OID2, category: otherCategory }),
      );
      await expect(service.create(dto as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(examModel.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException on duplicate name', async () => {
      categoryModel.findById.mockReturnValue(chain({ _id: OID }));
      examGroupModel.findById.mockReturnValue(
        chain({ _id: OID2, category: OID }),
      );
      examModel.findOne.mockReturnValue(chain({ name: 'SBI PO' }));
      await expect(service.create(dto as any)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('returns paginated exams', async () => {
      examModel.find.mockReturnValue(chain([examDoc({ name: 'SBI PO' })]));
      examModel.countDocuments.mockReturnValue(chain(1));
      const result = await service.findAll(1, 10, 'sbi', OID, true);
      expect(result.data).toHaveLength(1);
      expect(examModel.find).toHaveBeenCalledWith(
        expect.not.objectContaining({ showInApp: true }),
      );
    });
  });

  describe('getExamsByCategory', () => {
    it('groups exams, formats duration, and returns paper counts', async () => {
      categoryModel.find.mockReturnValue(
        chain([
          {
            _id: { toString: () => OID },
            name: 'Banking',
            shortName: 'BANK',
            imageUrl: 'img',
            description: 'desc',
          },
        ]),
      );
      examModel.find.mockReturnValue(
        chain([
          {
            _id: { toString: () => OID2 },
            name: 'SBI PO',
            description: 'full',
            duration: 90,
            totalQuestions: 10,
            totalMarks: 20,
            trending: true,
            category: { toString: () => OID },
            subjects: [
              {
                marksPerQuestion: 2,
                hasNegativeMarking: true,
                negativeMarksPerQuestion: 0.5,
              },
            ],
          },
          {
            _id: { toString: () => '507f1f77bcf86cd799439013' },
            name: 'Short',
            duration: 45,
            category: { toString: () => OID },
            subjects: [],
          },
          {
            _id: { toString: () => '507f1f77bcf86cd799439014' },
            name: 'Hour',
            duration: 60,
            category: { toString: () => OID },
            subjects: [],
          },
        ]),
      );
      examModel.aggregate.mockReturnValue(
        chain([
          {
            _id: { toString: () => OID2 },
            paperCounts: [
              { _id: 'TOPIC_WISE', count: 3 },
              { _id: 'FULL_EXAM', count: 1 },
            ],
          },
        ]),
      );

      const result = await service.getExamsByCategory();
      expect(examModel.find).toHaveBeenCalledWith({
        isActive: true,
        isDeleted: { $ne: true },
        showInApp: true,
      });
      expect(result.data).toHaveLength(1);
      expect(result.pagination).toMatchObject({
        total: 1,
        page: 1,
        limit: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
      expect(result.data[0].exams[0].duration).toBe('1h 30min');
      expect(result.data[0].exams[0].description).toBe('full');
      expect(result.data[0].exams[0].imageUrl).toBe('img');
      expect(result.data[0].exams[0].testsCount).toBe(3);
      expect(result.data[0].exams[0].paperCounts).toEqual({
        chapterWise: 3,
        fullMocks: 1,
        sprint: 0,
      });
      expect(result.data[0].exams[0].statsLabel).toContain('10 QUESTIONS');
      expect(result.data[0].exams[0].trending).toBe(true);
      expect(result.data[0].exams[1].trending).toBe(false);
      expect(result.data[0].exams[1].duration).toBe('45min');
      expect(result.data[0].exams[2].duration).toBe('1h');
    });

    it('orders categories by priority, skips empty, and paginates', async () => {
      categoryModel.find.mockReturnValue(
        chain([
          {
            _id: { toString: () => 'a' },
            name: 'Zebra',
            shortName: 'Z',
            priority: 1,
          },
          {
            _id: { toString: () => 'b' },
            name: 'Alpha',
            shortName: 'A',
            priority: 5,
          },
          {
            _id: { toString: () => 'c' },
            name: 'Middle',
            shortName: 'M',
          },
        ]),
      );
      examModel.find.mockReturnValue(
        chain([
          {
            _id: { toString: () => OID2 },
            name: 'Exam A',
            category: { toString: () => 'b' },
            subjects: [],
          },
          {
            _id: { toString: () => '507f1f77bcf86cd799439013' },
            name: 'Exam Z',
            category: { toString: () => 'a' },
            subjects: [],
          },
        ]),
      );
      examModel.aggregate.mockReturnValue(chain([]));

      const page1 = await service.getExamsByCategory(1, 1);
      expect(page1.data.map(category => category.name)).toEqual(['Alpha']);
      expect(page1.pagination).toMatchObject({
        total: 2,
        page: 1,
        totalPages: 2,
        hasNextPage: true,
        hasPrevPage: false,
      });

      const page2 = await service.getExamsByCategory(2, 1);
      expect(page2.data.map(category => category.name)).toEqual(['Zebra']);
      expect(page2.pagination.hasPrevPage).toBe(true);
      expect(page2.pagination.hasNextPage).toBe(false);
    });
  });

  describe('findOne', () => {
    it('returns an exam', async () => {
      examModel.findById.mockReturnValue(chain(examDoc({ name: 'SBI PO' })));
      await expect(service.findOne(OID)).resolves.toBeDefined();
    });

    it('throws NotFoundException', async () => {
      examModel.findById.mockReturnValue(chain(null));
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByCategory', () => {
    it('delegates to findAll', async () => {
      examModel.find.mockReturnValue(chain([]));
      examModel.countDocuments.mockReturnValue(chain(0));
      await service.findByCategory(OID, 1, 10);
      expect(examModel.find).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates an exam', async () => {
      categoryModel.findById.mockReturnValue(chain({ _id: OID }));
      examGroupModel.findById.mockReturnValue(
        chain({ _id: OID2, category: OID }),
      );
      examModel.findById.mockReturnValue(
        chain({ name: 'Old', category: OID, examGroup: OID2 }),
      );
      examModel.findOne.mockReturnValue(chain(null));
      examModel.findByIdAndUpdate.mockReturnValue(
        chain(examDoc({ name: 'New' })),
      );

      await expect(
        service.update(OID, {
          name: 'New',
          category: OID,
          examGroup: OID2,
          subjects: [{ numberOfQuestions: 5, marksPerQuestion: 1 }],
        } as any),
      ).resolves.toBeDefined();
    });

    it('throws when new category is missing', async () => {
      categoryModel.findById.mockReturnValue(chain(null));
      await expect(
        service.update(OID, { category: OID } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when new exam group is missing', async () => {
      examGroupModel.findById.mockReturnValue(chain(null));
      await expect(
        service.update(OID, { examGroup: OID2 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when updated category does not match exam group category', async () => {
      const otherCategory = '507f1f77bcf86cd799439099';
      categoryModel.findById.mockReturnValue(chain({ _id: otherCategory }));
      examGroupModel.findById.mockReturnValue(
        chain({ _id: OID2, category: OID }),
      );
      examModel.findById.mockReturnValue(
        chain({ name: 'Old', category: OID, examGroup: OID2 }),
      );
      await expect(
        service.update(OID, { category: otherCategory } as any),
      ).rejects.toThrow(BadRequestException);
      expect(examModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('throws when updated exam group category does not match exam category', async () => {
      const otherCategory = '507f1f77bcf86cd799439099';
      examGroupModel.findById.mockReturnValue(
        chain({ _id: OID2, category: otherCategory }),
      );
      examModel.findById.mockReturnValue(
        chain({ name: 'Old', category: OID, examGroup: OID2 }),
      );
      await expect(
        service.update(OID, { examGroup: OID2 } as any),
      ).rejects.toThrow(BadRequestException);
      expect(examModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('throws BadRequest when updating category on exam missing examGroup', async () => {
      categoryModel.findById.mockReturnValue(chain({ _id: OID }));
      examModel.findById.mockReturnValue(
        chain({ name: 'Legacy', category: OID, examGroup: null }),
      );
      await expect(
        service.update(OID, { category: OID } as any),
      ).rejects.toThrow(BadRequestException);
      expect(examModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when exam missing during duplicate check', async () => {
      examModel.findById.mockReturnValue(chain(null));
      await expect(service.update(OID, { name: 'New' } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException on duplicate', async () => {
      examModel.findById.mockReturnValue(chain({ name: 'Old', category: OID }));
      examModel.findOne.mockReturnValue(chain({ name: 'New' }));
      await expect(service.update(OID, { name: 'New' } as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when update returns null', async () => {
      examModel.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(
        service.update(OID, { description: 'x' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('soft deletes an exam', async () => {
      examModel.findByIdAndUpdate.mockReturnValue(
        chain(examDoc({ isDeleted: true })),
      );
      await expect(service.remove(OID)).resolves.toBeDefined();
    });

    it('throws NotFoundException', async () => {
      examModel.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('maps populated category, examGroup, and subject refs', async () => {
    examModel.findById.mockReturnValue(
      chain(
        examDoc({
          name: 'Mapped',
          category: { id: OID },
          examGroup: { _id: { toString: () => OID2 } },
          subjects: [
            {
              subject: { id: OID, name: 'Quantitative Aptitude' },
              numberOfQuestions: 1,
            },
          ],
        }),
      ),
    );
    const result = await service.findOne(OID);
    expect(result.category).toBe(OID);
    expect(result.examGroup).toBe(OID2);
    expect(result.subjects[0].subject).toBe(OID);
    expect(result.subjects[0].name).toBe('Quantitative Aptitude');
  });

  it('stringifies leftover subject refs', async () => {
    examModel.findById.mockReturnValue(
      chain(
        examDoc({
          name: 'Nums',
          category: 12 as never,
          examGroup: 34 as never,
          subjects: [{ subject: 56, numberOfQuestions: 1 }],
        }),
      ),
    );
    const result = await service.findOne(OID);
    expect(result.category).toBe('12');
    expect(result.subjects[0].subject).toBe('56');
  });
});
