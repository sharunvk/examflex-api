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
});
