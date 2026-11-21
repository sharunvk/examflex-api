import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EquationBookService } from './equation-book.service';
import { Equation } from './schemas/equation.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { Topic } from '../topics/schemas/topic.schema';
import { Exam } from '../exams/schemas/exam.schema';
import { AwsConfigService } from '../aws/config/aws.config';
import { ImageUrlResolver } from '../aws/s3/image-url.resolver';

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
    image: data.image,
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

  const awsConfig = {
    allowedImageBuckets: ['examflex-images'],
    region: 'ap-south-1',
  };
  // Signs like the real resolver: one URL per image, null for none.
  const imageUrlResolver = {
    resolveMany: jest.fn(
      async (images: Array<{ key?: string } | null | undefined>) =>
        images.map(image =>
          image?.key ? `https://signed.example/${image.key}?sig=1` : null,
        ),
    ),
  };

  const image = {
    key: 'admin-images/1710000000-abcd.png',
    bucket: 'examflex-images',
    region: 'ap-south-1',
    contentType: 'image/png',
    size: 1234,
  };

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
        { provide: AwsConfigService, useValue: awsConfig },
        { provide: ImageUrlResolver, useValue: imageUrlResolver },
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

  describe('equation image', () => {
    const arrangeValidRefs = () => {
      subjectModel.findById.mockReturnValue(
        chain({ _id: OID, topics: [{ toString: () => OID2 }] }),
      );
      topicModel.findById.mockReturnValue(chain({ _id: OID2 }));
      examModel.find.mockReturnValue(chain([{ _id: OID3 }]));
    };

    describe('create', () => {
      it('stores a sanitized image and returns its signed URL and metadata', async () => {
        arrangeValidRefs();
        equationModel.findById.mockReturnValue(chain(equationDoc({ image })));

        const result = await service.create({ ...createDto, image } as any);

        const saved = equationModel.mock.calls[0][0];
        expect(saved.image).toEqual({
          key: image.key,
          bucket: image.bucket,
          region: 'ap-south-1',
          contentType: 'image/png',
          size: 1234,
          lastModified: undefined,
        });
        expect(result.imageUrl).toBe(
          `https://signed.example/${image.key}?sig=1`,
        );
        // creating is an admin action, so metadata comes back for the form
        expect(result.image).toMatchObject({
          key: image.key,
          bucket: image.bucket,
        });
      });

      it('falls back to the configured region and drops client-supplied urls', async () => {
        arrangeValidRefs();
        equationModel.findById.mockReturnValue(chain(equationDoc()));
        await service.create({
          ...createDto,
          image: { key: image.key, bucket: image.bucket, url: 'https://evil' },
        } as any);
        const saved = equationModel.mock.calls[0][0];
        expect(saved.image.region).toBe('ap-south-1');
        expect(saved.image).not.toHaveProperty('url');
      });

      it('creates without an image exactly as before', async () => {
        arrangeValidRefs();
        equationModel.findById.mockReturnValue(chain(equationDoc()));

        const result = await service.create(createDto as any);

        expect(equationModel.mock.calls[0][0]).not.toHaveProperty('image');
        expect(result).not.toHaveProperty('imageUrl');
        expect(result).not.toHaveProperty('image');
      });

      it.each([
        ['null', null],
        ['an object without a key', { bucket: image.bucket }],
        ['an object without a bucket', { key: image.key }],
      ])('treats %s as no image', async (_label, value) => {
        arrangeValidRefs();
        equationModel.findById.mockReturnValue(chain(equationDoc()));
        await service.create({ ...createDto, image: value } as any);
        expect(equationModel.mock.calls[0][0]).not.toHaveProperty('image');
      });

      it('rejects keys outside the allowed prefixes and other buckets', async () => {
        arrangeValidRefs();
        await expect(
          service.create({
            ...createDto,
            image: { ...image, key: 'secrets/other.png' },
          } as any),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.create({
            ...createDto,
            image: { ...image, key: 'admin-images/../escape.png' },
          } as any),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.create({
            ...createDto,
            image: { ...image, bucket: 'someone-elses-bucket' },
          } as any),
        ).rejects.toThrow(BadRequestException);
        expect(equationModel).not.toHaveBeenCalled();
      });
    });

    describe('update', () => {
      const arrangeUpdate = () => {
        equationModel.findById.mockReturnValue(
          chain({
            subject: { toString: () => OID },
            topic: { toString: () => OID2 },
            exams: [{ toString: () => OID3 }],
          }),
        );
        equationModel.findByIdAndUpdate.mockReturnValue(
          chain(equationDoc({ image })),
        );
      };

      it('leaves the stored image alone when image is not sent', async () => {
        arrangeUpdate();
        await service.update(OID, { title: 'Updated' } as any);
        const [, update] = equationModel.findByIdAndUpdate.mock.calls[0];
        expect(update).not.toHaveProperty('image');
      });

      it('replaces the image when new metadata is sent', async () => {
        arrangeUpdate();
        await service.update(OID, {
          image: { ...image, key: 'admin-images/new.png' },
        } as any);
        const [, update] = equationModel.findByIdAndUpdate.mock.calls[0];
        expect(update.image).toMatchObject({
          key: 'admin-images/new.png',
          bucket: image.bucket,
        });
      });

      it('removes the image when null is sent', async () => {
        arrangeUpdate();
        equationModel.findByIdAndUpdate.mockReturnValue(chain(equationDoc()));
        const result = await service.update(OID, { image: null } as any);
        const [, update] = equationModel.findByIdAndUpdate.mock.calls[0];
        expect(update.image).toBeNull();
        expect(result).not.toHaveProperty('imageUrl');
      });

      it('rejects a disallowed image on update', async () => {
        arrangeUpdate();
        await expect(
          service.update(OID, {
            image: { ...image, bucket: 'nope' },
          } as any),
        ).rejects.toThrow(BadRequestException);
        expect(equationModel.findByIdAndUpdate).not.toHaveBeenCalled();
      });
    });

    describe('reading', () => {
      it('gives students the signed URL but never the key / bucket', async () => {
        equationModel.findById.mockReturnValue(chain(equationDoc({ image })));
        const result = await service.findOne(OID);
        expect(result.imageUrl).toBe(
          `https://signed.example/${image.key}?sig=1`,
        );
        expect(result).not.toHaveProperty('image');
        expect(JSON.stringify(result)).not.toContain(image.bucket);
      });

      it('gives admins the metadata as well so the form can keep it', async () => {
        equationModel.findById.mockReturnValue(chain(equationDoc({ image })));
        const result = await service.findOne(OID, true);
        expect(result.image).toMatchObject({
          key: image.key,
          bucket: image.bucket,
          region: 'ap-south-1',
        });
        expect(result.imageUrl).toContain(image.key);
      });

      it('omits both fields for an equation without an image', async () => {
        equationModel.findById.mockReturnValue(chain(equationDoc()));
        const result = await service.findOne(OID, true);
        expect(result).not.toHaveProperty('image');
        expect(result).not.toHaveProperty('imageUrl');
        expect(imageUrlResolver.resolveMany).toHaveBeenCalledWith([undefined]);
      });

      it('treats a stored null image as no image', async () => {
        equationModel.findById.mockReturnValue(
          chain(equationDoc({ image: null })),
        );
        const result = await service.findOne(OID, true);
        expect(result).not.toHaveProperty('image');
        expect(result).not.toHaveProperty('imageUrl');
      });

      it('sends imageUrl null (not an error) when signing is not possible', async () => {
        imageUrlResolver.resolveMany.mockResolvedValueOnce([null]);
        equationModel.findById.mockReturnValue(chain(equationDoc({ image })));
        const result = await service.findOne(OID);
        expect(result.imageUrl).toBeNull();
      });

      it('signs a whole page in one batch and keeps each URL on its own row', async () => {
        const second = { ...image, key: 'admin-images/second.png' };
        equationModel.find.mockReturnValue(
          chain([
            equationDoc({ image }),
            equationDoc(),
            equationDoc({ image: second }),
          ]),
        );
        equationModel.countDocuments.mockReturnValue(chain(3));

        const result = await service.findAll(1, 10);

        expect(imageUrlResolver.resolveMany).toHaveBeenCalledTimes(1);
        expect(result.data.map(row => row.imageUrl)).toEqual([
          `https://signed.example/${image.key}?sig=1`,
          undefined,
          'https://signed.example/admin-images/second.png?sig=1',
        ]);
        expect(result.data.every(row => !('image' in row))).toBe(true);

        equationModel.find.mockReturnValue(chain([equationDoc({ image })]));
        const asAdmin = await service.findAll(1, 10, {}, true);
        expect(asAdmin.data[0].image?.key).toBe(image.key);
      });
    });
  });
});
