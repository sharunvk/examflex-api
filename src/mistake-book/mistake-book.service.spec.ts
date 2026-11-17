import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ImageUrlResolver } from '../aws/s3/image-url.resolver';
import { PaperType } from '../common/enums/paper-type.enum';
import { MockTestAttempt } from '../mock-test-attempts/schemas/mock-test-attempt.schema';
import { Question } from '../mock-test-attempts/schemas/question.schema';
import { MockTest } from '../mock-tests/schemas/mock-test.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { Topic } from '../topics/schemas/topic.schema';
import { MistakeBookService } from './mistake-book.service';
import { MistakeBookEntry } from './schemas/mistake-book-entry.schema';

const USER_ID = '507f1f77bcf86cd799439011';
const MOCK_ID = '507f1f77bcf86cd799439012';
const ATTEMPT_ID = '507f1f77bcf86cd799439013';
const Q1 = '507f1f77bcf86cd799439014';
const Q2 = '507f1f77bcf86cd799439015';
const Q3 = '507f1f77bcf86cd799439016';
const ENTRY_ID = '507f1f77bcf86cd799439017';
const SUBJECT_ID = '507f1f77bcf86cd799439018';

function chain(resolved: unknown) {
  const query: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'sort',
    'lean',
    'populate',
    'skip',
    'limit',
  ]) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.exec = jest.fn().mockResolvedValue(resolved);
  return query;
}

describe('MistakeBookService', () => {
  let service: MistakeBookService;
  const entryModel: any = {
    deleteMany: jest.fn(),
    insertMany: jest.fn(),
    aggregate: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    exists: jest.fn(),
  };
  const attemptModel: any = { findById: jest.fn() };
  const mockTestModel: any = { findById: jest.fn() };
  const questionModel: any = { find: jest.fn() };
  const subjectModel: any = { find: jest.fn() };
  const topicModel: any = { find: jest.fn() };
  const imageUrlResolver = {
    resolveMany: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MistakeBookService,
        { provide: getModelToken(MistakeBookEntry.name), useValue: entryModel },
        {
          provide: getModelToken(MockTestAttempt.name),
          useValue: attemptModel,
        },
        { provide: getModelToken(MockTest.name), useValue: mockTestModel },
        { provide: getModelToken(Question.name), useValue: questionModel },
        { provide: getModelToken(Subject.name), useValue: subjectModel },
        { provide: getModelToken(Topic.name), useValue: topicModel },
        { provide: ImageUrlResolver, useValue: imageUrlResolver },
      ],
    }).compile();

    service = module.get(MistakeBookService);
    jest.clearAllMocks();
    entryModel.deleteMany.mockReturnValue(chain({ deletedCount: 1 }));
    entryModel.insertMany.mockResolvedValue([]);
    entryModel.aggregate.mockReturnValue({ exec: jest.fn() });
    entryModel.find.mockReturnValue(chain([]));
    entryModel.findOne.mockReturnValue(chain(null));
    entryModel.exists.mockReturnValue(chain(null));
    attemptModel.findById.mockReturnValue(chain(null));
    mockTestModel.findById.mockReturnValue(chain(null));
    questionModel.find.mockReturnValue(chain([]));
    subjectModel.find.mockReturnValue(chain([]));
    topicModel.find.mockReturnValue(chain([]));
    imageUrlResolver.resolveMany.mockResolvedValue([]);
  });

  describe('replaceForAttempt', () => {
    it('replaces entries with incorrect and unattended only', async () => {
      const attempt = {
        _id: new Types.ObjectId(ATTEMPT_ID),
        id: ATTEMPT_ID,
        user: new Types.ObjectId(USER_ID),
        mockTest: new Types.ObjectId(MOCK_ID),
        status: 'SUBMITTED',
        submittedAt: new Date('2026-11-17T10:00:00.000Z'),
        testTitle: 'Mock 12',
        subject: new Types.ObjectId(SUBJECT_ID),
        questions: [
          {
            question: new Types.ObjectId(Q1),
            selectedOption: 'a',
            isCorrect: false,
          },
          {
            question: new Types.ObjectId(Q2),
            selectedOption: null,
            isCorrect: false,
          },
          {
            question: new Types.ObjectId(Q3),
            selectedOption: 'c',
            isCorrect: true,
          },
        ],
      };
      attemptModel.findById.mockReturnValue(chain(attempt));
      mockTestModel.findById.mockReturnValue(
        chain({ paperType: PaperType.FULL_EXAM, title: 'Mock 12' }),
      );
      questionModel.find.mockReturnValue(
        chain([
          {
            _id: new Types.ObjectId(Q1),
            subject: new Types.ObjectId(SUBJECT_ID),
          },
          {
            _id: new Types.ObjectId(Q2),
            subject: new Types.ObjectId(SUBJECT_ID),
          },
          {
            _id: new Types.ObjectId(Q3),
            subject: new Types.ObjectId(SUBJECT_ID),
          },
        ]),
      );

      await service.replaceForAttempt(ATTEMPT_ID);

      expect(entryModel.deleteMany).toHaveBeenCalledWith({
        user: attempt.user,
        mockTest: attempt.mockTest,
      });
      expect(entryModel.insertMany).toHaveBeenCalled();
      const docs = entryModel.insertMany.mock.calls[0][0];
      expect(docs).toHaveLength(2);
      expect(docs.map((doc: { kind: string }) => doc.kind).sort()).toEqual([
        'incorrect',
        'unattended',
      ]);
    });

    it('deletes prior rows and inserts nothing when the attempt is clean', async () => {
      const attempt = {
        _id: new Types.ObjectId(ATTEMPT_ID),
        id: ATTEMPT_ID,
        user: new Types.ObjectId(USER_ID),
        mockTest: new Types.ObjectId(MOCK_ID),
        status: 'SUBMITTED',
        submittedAt: new Date(),
        testTitle: 'Clean mock',
        questions: [
          {
            question: new Types.ObjectId(Q1),
            selectedOption: 'a',
            isCorrect: true,
          },
        ],
      };
      attemptModel.findById.mockReturnValue(chain(attempt));
      mockTestModel.findById.mockReturnValue(
        chain({ paperType: PaperType.TOPIC_WISE, title: 'Clean mock' }),
      );
      questionModel.find.mockReturnValue(
        chain([{ _id: new Types.ObjectId(Q1) }]),
      );

      await service.replaceForAttempt(ATTEMPT_ID);

      expect(entryModel.deleteMany).toHaveBeenCalled();
      expect(entryModel.insertMany).not.toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    it('returns paginated sessions newest first', async () => {
      entryModel.aggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            meta: [{ total: 1 }],
            data: [
              {
                _id: new Types.ObjectId(MOCK_ID),
                attemptId: new Types.ObjectId(ATTEMPT_ID),
                title: 'Mock 12',
                paperType: PaperType.FULL_EXAM,
                remainingCount: 2,
                attemptSubmittedAt: new Date('2026-11-17T10:00:00.000Z'),
              },
            ],
          },
        ]),
      });

      const result = await service.listSessions(USER_ID, 1, 20);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].mockTestId).toBe(MOCK_ID);
      expect(result.data[0].remainingCount).toBe(2);
      expect(result.pagination.total).toBe(1);
    });

    it('rejects invalid user ids', async () => {
      await expect(service.listSessions('bad')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('updateTripReason / deleteEntry', () => {
    it('updates trip reason for an owned entry', async () => {
      const entry = {
        id: ENTRY_ID,
        tripReason: 'concept-gap',
        save: jest.fn().mockResolvedValue(undefined),
      };
      entryModel.findOne.mockReturnValue(chain(entry));

      await service.updateTripReason(USER_ID, ENTRY_ID, 'calculation');
      expect(entry.tripReason).toBe('calculation');
      expect(entry.save).toHaveBeenCalled();
    });

    it('deletes an owned entry', async () => {
      const entry = {
        id: ENTRY_ID,
        deleteOne: jest.fn().mockResolvedValue(undefined),
      };
      entryModel.findOne.mockReturnValue(chain(entry));

      await service.deleteEntry(USER_ID, ENTRY_ID);
      expect(entry.deleteOne).toHaveBeenCalled();
    });

    it('throws when the entry is missing', async () => {
      entryModel.findOne.mockReturnValue(chain(null));
      await expect(
        service.deleteEntry(USER_ID, ENTRY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('countRemainingByMockTests', () => {
    it('maps remaining counts by mock test id', async () => {
      entryModel.aggregate.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue([{ _id: new Types.ObjectId(MOCK_ID), count: 4 }]),
      });

      const map = await service.countRemainingByMockTests(USER_ID, [MOCK_ID]);
      expect(map.get(MOCK_ID)).toBe(4);
    });
  });

  describe('getSession', () => {
    it('includes resolved stem image URLs on entries', async () => {
      const entry = {
        id: ENTRY_ID,
        kind: 'incorrect',
        question: new Types.ObjectId(Q1),
        questionOrder: 2,
        subject: new Types.ObjectId(SUBJECT_ID),
        topic: undefined,
        selectedOptionId: 'b',
        tripReason: 'concept-gap',
        attempt: new Types.ObjectId(ATTEMPT_ID),
        attemptSubmittedAt: new Date('2026-11-17T10:00:00.000Z'),
        mockTitle: 'Mock 12',
        paperType: PaperType.FULL_EXAM,
      };
      entryModel.find
        .mockReturnValueOnce(chain([entry]))
        .mockReturnValueOnce(chain([entry]));
      questionModel.find.mockReturnValue(
        chain([
          {
            _id: new Types.ObjectId(Q1),
            questionText: {
              en: {
                text: 'Fig. shows the position of a particle.',
                image: { key: 'fig.png', bucket: 'examflex' },
              },
              ml: { text: null, image: null },
            },
            options: [
              { id: 'a', type: 'text', en: 'A', ml: null },
              { id: 'b', type: 'text', en: 'B', ml: null },
            ],
            correctAnswer: 'a',
            explanation: { en: 'Because graph', ml: null },
          },
        ]),
      );
      subjectModel.find.mockReturnValue(
        chain([{ _id: new Types.ObjectId(SUBJECT_ID), name: 'Physics' }]),
      );
      imageUrlResolver.resolveMany.mockResolvedValue([
        'https://cdn.test/fig.png',
        null,
      ]);

      const result = await service.getSession(USER_ID, MOCK_ID);

      expect(imageUrlResolver.resolveMany).toHaveBeenCalled();
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].prompt).toContain('Fig. shows');
      expect(result.entries[0].imageUrl).toBe('https://cdn.test/fig.png');
    });
  });
});
