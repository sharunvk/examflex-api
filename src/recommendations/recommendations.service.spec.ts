import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Exam } from '../exams/schemas/exam.schema';
import { RecommendationKind } from './enums/recommendation-kind.enum';
import { RecommendationsService } from './recommendations.service';
import { RecommendationOffering } from './schemas/recommendation-offering.schema';

const EXAM_ID = '64f123456789abcdef123456';
const OFFERING_ID = '64f123456789abcdef123457';

function chain(result: unknown) {
  const q: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(result),
    populate: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    select: jest.fn(),
  };
  q.populate.mockReturnValue(q);
  q.sort.mockReturnValue(q);
  q.skip.mockReturnValue(q);
  q.limit.mockReturnValue(q);
  q.select.mockReturnValue(q);
  return q;
}

function offeringDoc(overrides: Record<string, unknown> = {}) {
  const examOid = new Types.ObjectId(EXAM_ID);
  const payload = {
    id: OFFERING_ID,
    exam: { _id: examOid, name: 'NEET UG' },
    kind: RecommendationKind.COURSE,
    title: 'MBBS',
    subtitle: 'Medicine',
    minPercent: 75,
    comfortPercent: 85,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
  return payload;
}

describe('RecommendationsService', () => {
  let service: RecommendationsService;
  const offeringModel: Record<string, jest.Mock> = {
    create: jest.fn(),
    findById: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    countDocuments: jest.fn(),
  };
  const examModel: Record<string, jest.Mock> = {
    findById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationsService,
        {
          provide: getModelToken(RecommendationOffering.name),
          useValue: offeringModel,
        },
        { provide: getModelToken(Exam.name), useValue: examModel },
      ],
    }).compile();
    service = module.get(RecommendationsService);
    jest.clearAllMocks();
  });

  it('creates a COURSE offering', async () => {
    examModel.findById.mockReturnValue(chain({ _id: EXAM_ID }));
    offeringModel.findOne.mockReturnValue(chain(null));
    offeringModel.create.mockResolvedValue({ _id: OFFERING_ID });
    offeringModel.findById.mockReturnValue(chain(offeringDoc()));

    const result = await service.create({
      exam: EXAM_ID,
      title: 'MBBS',
      subtitle: 'Medicine',
      minPercent: 75,
      comfortPercent: 85,
    });

    expect(result.title).toBe('MBBS');
    expect(result.exam.name).toBe('NEET UG');
    expect(offeringModel.create).toHaveBeenCalled();
  });

  it('rejects comfort below min', async () => {
    examModel.findById.mockReturnValue(chain({ _id: EXAM_ID }));
    await expect(
      service.create({
        exam: EXAM_ID,
        title: 'MBBS',
        minPercent: 80,
        comfortPercent: 70,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects COURSE with parentOffering', async () => {
    examModel.findById.mockReturnValue(chain({ _id: EXAM_ID }));
    await expect(
      service.create({
        exam: EXAM_ID,
        title: 'MBBS',
        minPercent: 75,
        parentOffering: OFFERING_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists with filters', async () => {
    offeringModel.find.mockReturnValue(chain([offeringDoc()]));
    offeringModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });

    const result = await service.findAll(1, 20, {
      examId: EXAM_ID,
      activeOnly: true,
    });
    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it('findOne throws when missing', async () => {
    offeringModel.findById.mockReturnValue(chain(null));
    await expect(service.findOne(OFFERING_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('soft-deletes an offering', async () => {
    offeringModel.findByIdAndUpdate.mockReturnValue(
      chain(offeringDoc({ isActive: false, isDeleted: true })),
    );
    const result = await service.remove(OFFERING_ID, 'admin1');
    expect(result.isActive).toBe(false);
  });

  it('listActiveCoursesForExam returns courses', async () => {
    offeringModel.find.mockReturnValue(chain([offeringDoc()]));
    const rows = await service.listActiveCoursesForExam(EXAM_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe(RecommendationKind.COURSE);
  });

  describe('legacy percent thresholds are optional', () => {
    it('creates a COURSE without any percent thresholds', async () => {
      examModel.findById.mockReturnValue(chain({ _id: EXAM_ID }));
      offeringModel.findOne.mockReturnValue(chain(null));
      offeringModel.create.mockResolvedValue({ _id: OFFERING_ID });
      offeringModel.findById.mockReturnValue(
        chain(
          offeringDoc({ minPercent: undefined, comfortPercent: undefined }),
        ),
      );

      const result = await service.create({ exam: EXAM_ID, title: 'MBBS' });

      const payload = offeringModel.create.mock.calls[0][0];
      expect(payload).not.toHaveProperty('minPercent');
      expect(payload).not.toHaveProperty('comfortPercent');
      expect(result).not.toHaveProperty('minPercent');
      expect(result).not.toHaveProperty('comfortPercent');
      expect(result.title).toBe('MBBS');
    });

    it('still stores legacy thresholds when an older client sends them', async () => {
      examModel.findById.mockReturnValue(chain({ _id: EXAM_ID }));
      offeringModel.findOne.mockReturnValue(chain(null));
      offeringModel.create.mockResolvedValue({ _id: OFFERING_ID });
      offeringModel.findById.mockReturnValue(chain(offeringDoc()));

      const result = await service.create({
        exam: EXAM_ID,
        title: 'MBBS',
        minPercent: 75,
        comfortPercent: 85,
      });

      const payload = offeringModel.create.mock.calls[0][0];
      expect(payload).toMatchObject({ minPercent: 75, comfortPercent: 85 });
      expect(result.minPercent).toBe(75);
      expect(result.comfortPercent).toBe(85);
    });

    it('does not compare comfort against a missing minimum', async () => {
      examModel.findById.mockReturnValue(chain({ _id: EXAM_ID }));
      offeringModel.findOne.mockReturnValue(chain(null));
      offeringModel.create.mockResolvedValue({ _id: OFFERING_ID });
      offeringModel.findById.mockReturnValue(chain(offeringDoc()));

      await expect(
        service.create({ exam: EXAM_ID, title: 'MBBS', comfortPercent: 40 }),
      ).resolves.toBeDefined();
    });

    it('updates a course that has no legacy thresholds', async () => {
      const existing = {
        exam: new Types.ObjectId(EXAM_ID),
        kind: RecommendationKind.COURSE,
        sortOrder: 0,
      };
      offeringModel.findById.mockReturnValue(chain(existing));
      offeringModel.findByIdAndUpdate.mockReturnValue(
        chain(
          offeringDoc({
            title: 'MBBS (renamed)',
            minPercent: undefined,
            comfortPercent: undefined,
          }),
        ),
      );

      const result = await service.update(
        OFFERING_ID,
        { title: 'MBBS (renamed)' },
        'admin1',
      );

      const [, updateQuery] = offeringModel.findByIdAndUpdate.mock.calls[0];
      expect(updateQuery.$set).toMatchObject({ title: 'MBBS (renamed)' });
      expect(updateQuery.$set).not.toHaveProperty('minPercent');
      expect(result.title).toBe('MBBS (renamed)');
      expect(result).not.toHaveProperty('minPercent');
    });
  });

  describe('validation and edge paths', () => {
    const PARENT_ID = '64f123456789abcdef123458';
    const OTHER_EXAM = '64f123456789abcdef1234ff';

    const arrangeCreate = (parent?: Record<string, unknown> | null) => {
      examModel.findById.mockReturnValue(chain({ _id: EXAM_ID }));
      offeringModel.findOne.mockReturnValue(chain(null));
      offeringModel.create.mockResolvedValue({ _id: OFFERING_ID });
      offeringModel.findById.mockImplementation((id: string) =>
        chain(id === PARENT_ID ? parent : offeringDoc()),
      );
    };

    it('rejects an invalid or unknown exam on create', async () => {
      await expect(
        service.create({ exam: 'bad', title: 'MBBS' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      examModel.findById.mockReturnValue(chain(null));
      await expect(
        service.create({ exam: EXAM_ID, title: 'MBBS' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('appends after the last sort order, or starts at 0', async () => {
      arrangeCreate();
      offeringModel.findOne.mockReturnValue(chain({ sortOrder: 4 }));
      await service.create({ exam: EXAM_ID, title: 'MBBS' });
      expect(offeringModel.create.mock.calls[0][0].sortOrder).toBe(5);

      offeringModel.create.mockClear();
      offeringModel.findOne.mockReturnValue(chain(null));
      await service.create({ exam: EXAM_ID, title: 'BDS' });
      expect(offeringModel.create.mock.calls[0][0].sortOrder).toBe(0);

      offeringModel.create.mockClear();
      await service.create({ exam: EXAM_ID, title: 'Vet', sortOrder: 9 });
      expect(offeringModel.create.mock.calls[0][0].sortOrder).toBe(9);
    });

    it('fails when the created row cannot be reloaded', async () => {
      arrangeCreate();
      offeringModel.findById.mockReturnValue(chain(null));
      await expect(
        service.create({ exam: EXAM_ID, title: 'MBBS' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('INSTITUTION offerings need an existing COURSE parent of the same exam', async () => {
      arrangeCreate(null);
      const base = {
        exam: EXAM_ID,
        title: 'AIIMS',
        kind: RecommendationKind.INSTITUTION,
      };
      await expect(service.create(base)).rejects.toThrow(
        /require a parentOffering/,
      );
      await expect(
        service.create({ ...base, parentOffering: PARENT_ID }),
      ).rejects.toThrow(/not found/);

      arrangeCreate({
        kind: RecommendationKind.INSTITUTION,
        exam: new Types.ObjectId(EXAM_ID),
      });
      await expect(
        service.create({ ...base, parentOffering: PARENT_ID }),
      ).rejects.toThrow(/must be a COURSE/);

      arrangeCreate({
        kind: RecommendationKind.COURSE,
        exam: new Types.ObjectId(OTHER_EXAM),
      });
      await expect(
        service.create({ ...base, parentOffering: PARENT_ID }),
      ).rejects.toThrow(/same exam/);

      arrangeCreate({
        kind: RecommendationKind.COURSE,
        exam: new Types.ObjectId(EXAM_ID),
      });
      await expect(
        service.create({ ...base, parentOffering: PARENT_ID }),
      ).resolves.toBeDefined();
      expect(
        offeringModel.create.mock.calls[
          offeringModel.create.mock.calls.length - 1
        ][0].parentOffering,
      ).toEqual(new Types.ObjectId(PARENT_ID));
    });

    it('findAll validates examId and applies kind / search filters', async () => {
      await expect(
        service.findAll(1, 20, { examId: 'bad' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      offeringModel.find.mockReturnValue(chain([]));
      offeringModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });
      const result = await service.findAll(0, 500, {
        kind: RecommendationKind.COURSE,
        search: ' mbb ',
      });
      const query = offeringModel.find.mock.calls[0][0];
      expect(query.kind).toBe(RecommendationKind.COURSE);
      expect(query.title).toEqual({ $regex: 'mbb', $options: 'i' });
      expect(result.pagination).toMatchObject({
        page: 1,
        limit: 100,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      });
    });

    it('listActiveCoursesForExam rejects a malformed exam id', async () => {
      await expect(
        service.listActiveCoursesForExam('bad'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('findOne returns a mapped row, with an unpopulated exam reference too', async () => {
      offeringModel.findById.mockReturnValue(
        chain(
          offeringDoc({ exam: new Types.ObjectId(EXAM_ID), description: 'd' }),
        ),
      );
      const result = await service.findOne(OFFERING_ID);
      expect(result.exam).toEqual({ id: EXAM_ID, name: '' });
      expect(result.description).toBe('d');
    });

    describe('update', () => {
      const existing = () => ({
        exam: new Types.ObjectId(EXAM_ID),
        kind: RecommendationKind.COURSE,
        minPercent: 60,
        comfortPercent: 70,
        sortOrder: 1,
      });

      it('404s for a missing row, and when the write finds nothing', async () => {
        offeringModel.findById.mockReturnValue(chain(null));
        await expect(
          service.update(OFFERING_ID, { title: 'x' }),
        ).rejects.toBeInstanceOf(NotFoundException);

        offeringModel.findById.mockReturnValue(chain(existing()));
        offeringModel.findByIdAndUpdate.mockReturnValue(chain(null));
        await expect(
          service.update(OFFERING_ID, { title: 'x' }),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('sets every provided field and unsets cleared ones', async () => {
        offeringModel.findById.mockReturnValue(chain(existing()));
        examModel.findById.mockReturnValue(chain({ _id: OTHER_EXAM }));
        offeringModel.findByIdAndUpdate.mockReturnValue(chain(offeringDoc()));

        await service.update(
          OFFERING_ID,
          {
            exam: OTHER_EXAM,
            kind: RecommendationKind.COURSE,
            title: 't',
            subtitle: 's',
            description: 'd',
            minPercent: 50,
            comfortPercent: null,
            sortOrder: 3,
            isActive: false,
            parentOffering: null,
          },
          'admin1',
        );

        const [, query] = offeringModel.findByIdAndUpdate.mock.calls[0];
        expect(query.$set).toMatchObject({
          exam: new Types.ObjectId(OTHER_EXAM),
          kind: RecommendationKind.COURSE,
          title: 't',
          subtitle: 's',
          description: 'd',
          minPercent: 50,
          sortOrder: 3,
          isActive: false,
        });
        expect(query.$unset).toEqual({ comfortPercent: 1, parentOffering: 1 });
      });

      it('sets a new comfort percent and parent', async () => {
        offeringModel.findById.mockImplementation((id: string) =>
          chain(
            id === PARENT_ID
              ? {
                  kind: RecommendationKind.COURSE,
                  exam: new Types.ObjectId(EXAM_ID),
                }
              : { ...existing(), kind: RecommendationKind.INSTITUTION },
          ),
        );
        offeringModel.findByIdAndUpdate.mockReturnValue(chain(offeringDoc()));
        await service.update(OFFERING_ID, {
          comfortPercent: 90,
          parentOffering: PARENT_ID,
        });
        const [, query] = offeringModel.findByIdAndUpdate.mock.calls[0];
        expect(query.$set.comfortPercent).toBe(90);
        expect(query.$set.parentOffering).toEqual(
          new Types.ObjectId(PARENT_ID),
        );
        expect(query.$unset).toBeUndefined();
      });

      it('rejects comfort below min and an invalid new exam', async () => {
        offeringModel.findById.mockReturnValue(chain(existing()));
        await expect(
          service.update(OFFERING_ID, { minPercent: 90 }),
        ).rejects.toThrow(/comfortPercent/);

        await expect(
          service.update(OFFERING_ID, { exam: 'bad' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('rejects an INSTITUTION that names itself as parent', async () => {
        offeringModel.findById.mockReturnValue(
          chain({ ...existing(), kind: RecommendationKind.INSTITUTION }),
        );
        await expect(
          service.update(OFFERING_ID, { parentOffering: OFFERING_ID }),
        ).rejects.toThrow(/cannot reference itself/);
      });
    });

    it('remove 404s when the row does not exist', async () => {
      offeringModel.findByIdAndUpdate.mockReturnValue(chain(null));
      await expect(service.remove(OFFERING_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
