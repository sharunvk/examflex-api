import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { QuestionsService } from './questions.service';
import { Question } from '../mock-test-attempts/schemas/question.schema';
import { AwsConfigService } from '../aws/config/aws.config';
import { QuestionCitationsService } from '../citations/question-citations.service';

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

const questionDoc = (data: any = {}) => ({
  id: data.id || OID,
  _id: { toString: () => OID },
  toObject: () => ({
    id: OID,
    questionText: data.questionText || { en: { text: 'Q?' } },
    optionType: 'text',
    options: data.options || [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' },
    ],
    explanation: data.explanation,
    correctAnswer: 'a',
    subject: data.subject || { id: OID, name: 'QA' },
    topic: data.topic || OID,
    exams: data.exams || [
      { _id: { toString: () => OID2 }, name: 'SBI PO' },
      null,
    ],
    difficultyLevel: 'easy',
    source: 'MANUAL_INPUT',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
});

describe('QuestionsService', () => {
  let service: QuestionsService;
  const questionModel: any = jest.fn();
  questionModel.create = jest.fn();
  questionModel.find = jest.fn();
  questionModel.findOne = jest.fn();
  questionModel.findOneAndUpdate = jest.fn();
  questionModel.countDocuments = jest.fn();

  const citations = { autoAttach: jest.fn().mockResolvedValue('done') };

  const awsConfig = {
    region: 'ap-south-1',
    allowedImageBuckets: ['img-bucket'],
  };

  const baseDto = {
    questionText: { en: { text: 'Q?' }, ml: { text: 'Q ml' } },
    optionType: 'text' as const,
    options: [
      { id: 'a', type: 'text' as const, en: 'A' },
      { id: 'b', type: 'text' as const, en: 'B' },
      { id: 'c', type: 'text' as const, en: 'C' },
      { id: 'd', type: 'text' as const, en: 'D' },
    ],
    correctAnswer: 'a',
    explanation: { en: 'because', images: [] },
    subject: OID,
    topic: OID2,
    exams: [OID],
    difficultyLevel: 'easy' as const,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionsService,
        { provide: getModelToken(Question.name), useValue: questionModel },
        { provide: AwsConfigService, useValue: awsConfig },
        { provide: QuestionCitationsService, useValue: citations },
      ],
    }).compile();
    service = module.get(QuestionsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('starts the citation lookup without waiting for it', async () => {
      let finish: (v: string) => void = () => undefined;
      citations.autoAttach.mockReturnValueOnce(
        new Promise<string>(resolve => (finish = resolve)),
      );
      questionModel.create.mockResolvedValue({ id: OID });
      questionModel.findOne.mockReturnValue(chain(questionDoc()));

      await expect(service.create(baseDto as any)).resolves.toMatchObject({
        id: OID,
      });
      expect(citations.autoAttach).toHaveBeenCalledWith(OID);
      finish('done');
    });

    it('creates a question then reloads it', async () => {
      questionModel.create.mockResolvedValue({ id: OID });
      questionModel.findOne.mockReturnValue(chain(questionDoc()));
      await expect(service.create(baseDto as any)).resolves.toMatchObject({
        id: OID,
        correctAnswer: 'a',
      });
    });

    it('stores every selected tag in selection order', async () => {
      questionModel.create.mockResolvedValue({ id: OID });
      questionModel.findOne.mockReturnValue(chain(questionDoc()));

      await service.create({
        ...baseDto,
        tagIds: [OID2, OID, OID2],
      } as any);

      const created = questionModel.create.mock.calls.at(-1)[0];
      expect(created).not.toHaveProperty('tag');
      expect(
        created.tags.map((id: { toString(): string }) => id.toString()),
      ).toEqual([OID2, OID]);
    });

    it('omits tags when none are selected', async () => {
      questionModel.create.mockResolvedValue({ id: OID });
      questionModel.findOne.mockReturnValue(chain(questionDoc()));

      await service.create({ ...baseDto, tagIds: [] } as any);

      const created = questionModel.create.mock.calls.at(-1)[0];
      expect(created).not.toHaveProperty('tag');
      expect(created).not.toHaveProperty('tags');
    });

    it('stamps createdBy and still creates when the actor id is missing', async () => {
      questionModel.create.mockResolvedValue({ id: OID });
      questionModel.findOne.mockReturnValue(chain(questionDoc()));

      await service.create(baseDto as any, OID);
      expect(questionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: new Types.ObjectId(OID),
        }),
      );
      expect(questionModel.create.mock.calls[0][0]).not.toHaveProperty(
        'updatedBy',
      );

      await service.create(baseDto as any);
      expect(questionModel.create.mock.calls[1][0]).not.toHaveProperty(
        'createdBy',
      );
      await service.create(baseDto as any, 'not-an-id');
      expect(questionModel.create.mock.calls[2][0]).not.toHaveProperty(
        'createdBy',
      );
    });

    it('throws when correctAnswer does not match an option', async () => {
      await expect(
        service.create({ ...baseDto, correctAnswer: 'z' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('sanitizes allowed images', async () => {
      questionModel.create.mockResolvedValue({ id: OID });
      questionModel.findOne.mockReturnValue(chain(questionDoc()));
      await service.create({
        ...baseDto,
        questionText: {
          en: {
            text: 'Q?',
            image: { key: 'admin-images/a.png', bucket: 'img-bucket' },
          },
        },
        options: baseDto.options.map(o => ({
          ...o,
          image: { key: 'question-imports/o.png', bucket: 'img-bucket' },
        })),
        explanation: {
          en: 'e',
          image: { key: 'admin-images/e.png', bucket: 'img-bucket' },
          images: [{ key: 'admin-images/e2.png', bucket: 'img-bucket' }],
        },
      } as any);
      expect(questionModel.create).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns paginated questions', async () => {
      questionModel.find.mockReturnValue(chain([questionDoc()]));
      questionModel.countDocuments.mockReturnValue(chain(1));
      const result = await service.findAll(1, 10, OID, OID2, OID);
      expect(result.data).toHaveLength(1);
    });

    it('applies escaped case-insensitive regex on English question text', async () => {
      questionModel.find.mockReturnValue(chain([questionDoc()]));
      questionModel.countDocuments.mockReturnValue(chain(1));
      await service.findAll(1, 10, OID, undefined, undefined, '  a+b  ');
      expect(questionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.any(Types.ObjectId),
          'questionText.en.text': {
            $regex: 'a\\+b',
            $options: 'i',
          },
        }),
      );
    });

    it('ignores blank search terms', async () => {
      questionModel.find.mockReturnValue(chain([]));
      questionModel.countDocuments.mockReturnValue(chain(0));
      await service.findAll(1, 10, undefined, undefined, undefined, '   ');
      expect(questionModel.find).toHaveBeenCalledWith(
        expect.not.objectContaining({
          'questionText.en.text': expect.anything(),
        }),
      );
    });

    it('throws on invalid subject ID', async () => {
      await expect(service.findAll(1, 10, 'bad')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws on invalid topic ID', async () => {
      await expect(service.findAll(1, 10, undefined, 'bad')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws on invalid exam ID', async () => {
      await expect(
        service.findAll(1, 10, undefined, undefined, 'bad'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('returns a question', async () => {
      questionModel.findOne.mockReturnValue(chain(questionDoc()));
      await expect(service.findOne(OID)).resolves.toBeDefined();
    });

    it('throws NotFoundException', async () => {
      questionModel.findOne.mockReturnValue(chain(null));
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    beforeEach(() => {
      questionModel.findOne.mockReturnValue(
        chain({ subject: new Types.ObjectId(OID) }),
      );
    });

    it('clears every stored tag when the editor sends an empty list', async () => {
      questionModel.findOneAndUpdate.mockReturnValue(chain(questionDoc()));
      await service.update(OID, {
        ...baseDto,
        topic: null,
        tagIds: [],
      } as any);

      const updateOp = questionModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateOp.$set).not.toHaveProperty('tag');
      expect(updateOp.$set).not.toHaveProperty('tags');
      expect(updateOp.$unset).toEqual({ tags: '' });
    });

    it('replaces the stored tags with the editor list', async () => {
      questionModel.findOneAndUpdate.mockReturnValue(chain(questionDoc()));

      await service.update(OID, { ...baseDto, tagIds: [OID2, OID] } as any);

      const update = questionModel.findOneAndUpdate.mock.calls[0][1].$set;
      expect(update).not.toHaveProperty('tag');
      expect(
        update.tags.map((tagId: { toString(): string }) => tagId.toString()),
      ).toEqual([OID2, OID]);
      // Only the light subject lookup used to detect a subject change.
      expect(questionModel.findOne).toHaveBeenCalledTimes(1);
    });

    it('re-runs automatic citations when the subject changes', async () => {
      questionModel.findOne.mockReturnValue(
        chain({ subject: new Types.ObjectId(OID2) }),
      );
      questionModel.findOneAndUpdate.mockReturnValue(
        chain({ ...questionDoc(), subject: { _id: new Types.ObjectId(OID) } }),
      );

      await service.update(OID, { ...baseDto, subject: OID } as any);

      expect(citations.autoAttach).toHaveBeenCalledWith(OID);
    });

    it('returns citations with a chapter name, deriving it for old ones', async () => {
      const doc = questionDoc();
      const base = doc.toObject();
      questionModel.findOneAndUpdate.mockReturnValue(
        chain({
          ...doc,
          toObject: () => ({
            ...base,
            citations: [
              { chunkId: 'b', rank: 2, sourceDoc: 'LAWS_OF_MOTION.pdf' },
              {
                chunkId: 'a',
                rank: 1,
                sourceDoc: 'X.pdf',
                chapterName: 'Stored name',
              },
            ],
          }),
        }),
      );

      const result = await service.update(OID, { explanation: { en: 'x' } });

      expect(result.citations).toEqual([
        expect.objectContaining({ chunkId: 'a', chapterName: 'Stored name' }),
        expect.objectContaining({
          chunkId: 'b',
          chapterName: 'LAWS OF MOTION',
        }),
      ]);
    });

    it('does not re-run citations when the subject is unchanged', async () => {
      questionModel.findOne.mockReturnValue(
        chain({ subject: new Types.ObjectId(OID) }),
      );
      questionModel.findOneAndUpdate.mockReturnValue(
        chain({ ...questionDoc(), subject: { _id: new Types.ObjectId(OID) } }),
      );

      await service.update(OID, { ...baseDto, subject: OID } as any);

      expect(citations.autoAttach).not.toHaveBeenCalled();
    });

    it('skips the subject lookup when the subject is not sent', async () => {
      questionModel.findOneAndUpdate.mockReturnValue(chain(questionDoc()));

      await service.update(OID, { explanation: { en: 'x' } });

      expect(questionModel.findOne).not.toHaveBeenCalled();
      expect(citations.autoAttach).not.toHaveBeenCalled();
    });

    it('stamps updatedBy without replacing createdBy', async () => {
      questionModel.findOneAndUpdate.mockReturnValue(chain(questionDoc()));

      await service.update(OID, { explanation: { en: 'x' } }, OID2);

      const update = questionModel.findOneAndUpdate.mock.calls[0][1].$set;
      expect(update.updatedBy).toEqual(new Types.ObjectId(OID2));
      expect(update).not.toHaveProperty('createdBy');

      await service.update(OID, { explanation: { en: 'x' } });
      expect(
        questionModel.findOneAndUpdate.mock.calls[1][1].$set,
      ).not.toHaveProperty('updatedBy');
    });

    it('throws when options length is not 4', async () => {
      await expect(
        service.update(OID, { options: [{ id: 'a' }] } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException', async () => {
      questionModel.findOneAndUpdate.mockReturnValue(chain(null));
      await expect(
        service.update(OID, { explanation: { en: 'x' } }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('soft deletes a question', async () => {
      questionModel.findOneAndUpdate.mockReturnValue(chain(questionDoc()));
      await expect(service.remove(OID)).resolves.toEqual({
        message: 'Question deleted successfully',
      });
    });

    it('throws NotFoundException', async () => {
      questionModel.findOneAndUpdate.mockReturnValue(chain(null));
      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
