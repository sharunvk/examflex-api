import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FullMockSelectionService } from './full-mock-selection.service';
import { Subject } from '../subjects/schemas/subject.schema';
import { Topic } from '../topics/schemas/topic.schema';
import { Question } from '../mock-test-attempts/schemas/question.schema';

const EXAM_ID = '507f1f77bcf86cd799439015';
const SUB_ID = '507f1f77bcf86cd799439011';
const TOP_ID = '507f1f77bcf86cd799439012';
const Q1 = '507f1f77bcf86cd799439013';
const Q2 = '507f1f77bcf86cd799439014';

function chainable(resolved: unknown) {
  const query: any = {};
  ['populate', 'sort', 'skip', 'limit', 'lean', 'select', 'session'].forEach(
    m => {
      query[m] = jest.fn().mockReturnValue(query);
    },
  );
  query.exec = jest.fn().mockResolvedValue(resolved);
  return query;
}

function exam(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(EXAM_ID),
    totalQuestions: 2,
    totalMarks: 4,
    duration: 60,
    isSessionWise: false,
    subjects: [
      {
        subject: new Types.ObjectId(SUB_ID),
        numberOfQuestions: 2,
        marksPerQuestion: 2,
        hasNegativeMarking: true,
        negativeMarksPerQuestion: 0.5,
        sessionTime: 30,
      },
    ],
    ...overrides,
  } as any;
}

describe('FullMockSelectionService', () => {
  let service: FullMockSelectionService;
  const subjectModel: any = { findById: jest.fn() };
  const topicModel: any = { find: jest.fn() };
  const questionModel: any = {
    countDocuments: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FullMockSelectionService,
        { provide: getModelToken(Subject.name), useValue: subjectModel },
        { provide: getModelToken(Topic.name), useValue: topicModel },
        { provide: getModelToken(Question.name), useValue: questionModel },
      ],
    }).compile();

    service = module.get(FullMockSelectionService);
    jest.clearAllMocks();
  });

  describe('assertBlueprint', () => {
    it('should reject empty subjects and mismatches', () => {
      expect(() =>
        service.assertBlueprint({
          subjects: [],
          totalQuestions: 10,
        } as any),
      ).toThrow(BadRequestException);

      expect(() =>
        service.assertBlueprint({
          subjects: [
            { subject: SUB_ID, numberOfQuestions: 1, marksPerQuestion: 1 },
          ],
          totalQuestions: 2,
          totalMarks: 99,
          duration: 0,
          isSessionWise: false,
        } as any),
      ).toThrow(BadRequestException);
    });

    it('should require session times when session-wise', () => {
      expect(() =>
        service.assertBlueprint({
          subjects: [
            {
              subject: SUB_ID,
              numberOfQuestions: 1,
              marksPerQuestion: 1,
              sessionTime: 0,
            },
          ],
          totalQuestions: 1,
          isSessionWise: true,
        } as any),
      ).toThrow(BadRequestException);
    });

    it('should accept a valid mixed blueprint', () => {
      expect(() => service.assertBlueprint(exam())).not.toThrow();
    });

    it('requires duration for mixed papers', () => {
      expect(() =>
        service.assertBlueprint({
          subjects: [
            { subject: SUB_ID, numberOfQuestions: 2, marksPerQuestion: 2 },
          ],
          totalQuestions: 2,
          totalMarks: 4,
          isSessionWise: false,
        } as any),
      ).toThrow(BadRequestException);
    });
  });

  describe('generatePaper', () => {
    it('should throw when a subject id is missing on a row that passed blueprint', async () => {
      const bad = exam({
        subjects: [
          {
            subject: null,
            numberOfQuestions: 2,
            marksPerQuestion: 2,
          },
        ],
      });
      jest
        .spyOn(service, 'assertBlueprint')
        .mockImplementation(() => undefined);

      await expect(service.generatePaper(bad)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw when subject document is missing', async () => {
      subjectModel.findById.mockReturnValue(chainable(null));
      await expect(service.generatePaper(exam())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BANK_SHORTAGE when inventory is low', async () => {
      subjectModel.findById.mockReturnValue(
        chainable({
          _id: new Types.ObjectId(SUB_ID),
          name: 'Physics',
          topics: [],
        }),
      );
      questionModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      });

      await expect(service.generatePaper(exam())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should sample questions for a subject with topics', async () => {
      subjectModel.findById.mockReturnValue(
        chainable({
          _id: new Types.ObjectId(SUB_ID),
          name: 'Physics',
          topics: [new Types.ObjectId(TOP_ID)],
        }),
      );
      topicModel.find.mockReturnValue(
        chainable([{ _id: new Types.ObjectId(TOP_ID) }]),
      );
      questionModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(5),
      });
      questionModel.find.mockReturnValue(
        chainable([
          {
            _id: new Types.ObjectId(Q1),
            topic: new Types.ObjectId(TOP_ID),
            difficultyLevel: 'easy',
            fullMockUsageCount: 3,
            lastUsedInFullMockAt: new Date(),
          },
          {
            _id: new Types.ObjectId(Q2),
            topic: new Types.ObjectId(TOP_ID),
            difficultyLevel: 'medium',
            fullMockUsageCount: 0,
          },
        ]),
      );

      const paper = await service.generatePaper(exam());
      expect(paper.questions).toHaveLength(2);
      expect(paper.subjectNames.get(SUB_ID)).toBe('Physics');
      expect(questionModel.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          exams: new Types.ObjectId(EXAM_ID),
          subject: new Types.ObjectId(SUB_ID),
        }),
      );
      expect(questionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          exams: new Types.ObjectId(EXAM_ID),
        }),
      );
    });

    it('should throw when generated length mismatches expected', async () => {
      subjectModel.findById.mockReturnValue(
        chainable({
          _id: new Types.ObjectId(SUB_ID),
          name: 'Physics',
          topics: [],
        }),
      );
      questionModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(10),
      });
      questionModel.find.mockReturnValue(
        chainable([{ _id: new Types.ObjectId(Q1), difficultyLevel: 'easy' }]),
      );

      await expect(service.generatePaper(exam())).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('generatePaper with explicit difficulty split', () => {
    const physics = () =>
      chainable({
        _id: new Types.ObjectId(SUB_ID),
        name: 'Physics',
        topics: [],
      });

    const captureError = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        return e as BadRequestException;
      }
      throw new Error('expected rejection');
    };

    it('rejects a split that does not sum to the subject quota, naming the subject', async () => {
      subjectModel.findById.mockReturnValue(physics());
      const err = await captureError(() =>
        service.generatePaper(exam(), [
          { subjectId: SUB_ID, easy: 1, medium: 0, hard: 0 },
        ]),
      );
      const body = err.getResponse() as any;
      expect(body.error).toBe('DIFFICULTY_DISTRIBUTION_INVALID');
      expect(body.message).toContain('Physics');
      expect(body.details[0]).toMatchObject({
        rule: 'SUBJECT_TOTAL_MISMATCH',
        expected: 2,
        actual: 1,
      });
      expect(questionModel.find).not.toHaveBeenCalled();
    });

    it('rejects missing, unknown and duplicate subjects', async () => {
      subjectModel.findById.mockReturnValue(physics());
      const other = '507f1f77bcf86cd799439099';
      const err = await captureError(() =>
        service.generatePaper(exam(), [
          { subjectId: other, easy: 1, medium: 1, hard: 0 },
        ]),
      );
      const rules = (err.getResponse() as any).details.map((d: any) => d.rule);
      expect(rules).toEqual(['UNKNOWN_SUBJECT', 'SUBJECT_MISSING']);

      const dup = await captureError(() =>
        service.generatePaper(exam(), [
          { subjectId: SUB_ID, easy: 1, medium: 1, hard: 0 },
          { subjectId: SUB_ID, easy: 2, medium: 0, hard: 0 },
        ]),
      );
      expect((dup.getResponse() as any).details[0].rule).toBe(
        'DUPLICATE_SUBJECT',
      );
    });

    it('reports every subject/difficulty shortage with names and counts', async () => {
      subjectModel.findById.mockReturnValue(physics());
      questionModel.countDocuments.mockImplementation((match: any) => ({
        exec: jest
          .fn()
          .mockResolvedValue(match.difficultyLevel === 'hard' ? 0 : 5),
      }));
      const err = await captureError(() =>
        service.generatePaper(exam(), [
          { subjectId: SUB_ID, easy: 0, medium: 1, hard: 1 },
        ]),
      );
      const body = err.getResponse() as any;
      expect(body.error).toBe('BANK_SHORTAGE');
      expect(body.details).toEqual([
        expect.objectContaining({
          subjectName: 'Physics',
          difficulty: 'hard',
          needed: 1,
          available: 0,
        }),
      ]);
      expect(body.message).toContain('Physics – hard: need 1, only 0');
      expect(questionModel.find).not.toHaveBeenCalled();
    });

    it('samples each difficulty separately and filters the query by it', async () => {
      subjectModel.findById.mockReturnValue(physics());
      questionModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(5),
      });
      questionModel.find.mockImplementation((match: any) =>
        chainable([
          {
            _id: new Types.ObjectId(match.difficultyLevel === 'easy' ? Q1 : Q2),
            difficultyLevel: match.difficultyLevel,
          },
        ]),
      );

      const paper = await service.generatePaper(exam(), [
        { subjectId: SUB_ID, easy: 1, medium: 1, hard: 0 },
      ]);

      expect(paper.questions.map(q => q.difficultyLevel)).toEqual([
        'easy',
        'medium',
      ]);
      const levels = questionModel.find.mock.calls.map(
        (c: any[]) => c[0].difficultyLevel,
      );
      expect(levels).toEqual(['easy', 'medium']);
    });

    it('counts with real ObjectIds even when the exam row hydrates the subject as a string', async () => {
      // Regression: string subject filters match nothing in the questions
      // collection, which made every cell report "only 0 available".
      subjectModel.findById.mockReturnValue(physics());
      questionModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });
      const stringSubjectExam = exam({
        subjects: [{ ...exam().subjects[0], subject: SUB_ID }],
      });

      await captureError(() =>
        service.generatePaper(stringSubjectExam, [
          { subjectId: SUB_ID, easy: 2, medium: 0, hard: 0 },
        ]),
      );

      const filter = questionModel.countDocuments.mock.calls[0][0];
      expect(filter.subject).toBeInstanceOf(Types.ObjectId);
      expect(filter.subject.toString()).toBe(SUB_ID);
    });

    it('keeps legacy behaviour when no split is sent', async () => {
      subjectModel.findById.mockReturnValue(physics());
      questionModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(5),
      });
      questionModel.find.mockReturnValue(
        chainable([
          { _id: new Types.ObjectId(Q1), difficultyLevel: 'easy' },
          { _id: new Types.ObjectId(Q2), difficultyLevel: 'hard' },
        ]),
      );
      const paper = await service.generatePaper(exam());
      expect(paper.questions).toHaveLength(2);
      expect(questionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          difficultyLevel: { $in: ['easy', 'medium', 'hard'] },
        }),
      );
    });
  });

  describe('allocateLargestRemainder', () => {
    it('should no-op on empty inventory', () => {
      const buckets = [{ topicId: null, inventory: 0, quota: 0, frac: 0 }];
      service.allocateLargestRemainder(buckets, 5);
      expect(buckets[0].quota).toBe(0);
    });

    it('should allocate seats and spill remainder', () => {
      const buckets = [
        { topicId: null, inventory: 3, quota: 0, frac: 0 },
        { topicId: null, inventory: 1, quota: 0, frac: 0 },
      ];
      service.allocateLargestRemainder(buckets, 4);
      expect(buckets.reduce((s, b) => s + b.quota, 0)).toBe(4);
    });
  });

  describe('weightedSample', () => {
    it('should pick without exceeding pool size', () => {
      const pool = [
        { _id: new Types.ObjectId(Q1), fullMockUsageCount: 0 },
        { _id: new Types.ObjectId(Q2), fullMockUsageCount: 8 },
      ];
      jest.spyOn(Math, 'random').mockReturnValue(0.01);
      const picked = service.weightedSample(pool, 2);
      expect(picked).toHaveLength(2);
      jest.restoreAllMocks();
    });
  });

  describe('shuffleAvoidingAdjacentTopics', () => {
    const topicA = new Types.ObjectId('507f1f77bcf86cd7994390b1');
    const topicB = new Types.ObjectId('507f1f77bcf86cd7994390b2');
    const topicC = new Types.ObjectId('507f1f77bcf86cd7994390b3');

    function q(
      id: string,
      topic: Types.ObjectId,
      subject = new Types.ObjectId(SUB_ID),
    ) {
      return {
        question: new Types.ObjectId(id),
        subject,
        topic,
        difficultyLevel: 'easy',
        position: 0,
        marksPerQuestion: 1,
        negativeMarking: 0,
      };
    }

    it('should avoid adjacent same-topic questions when possible', () => {
      const clustered = [
        q('507f1f77bcf86cd7994390c1', topicA),
        q('507f1f77bcf86cd7994390c2', topicA),
        q('507f1f77bcf86cd7994390c3', topicB),
        q('507f1f77bcf86cd7994390c4', topicB),
        q('507f1f77bcf86cd7994390c5', topicC),
        q('507f1f77bcf86cd7994390c6', topicC),
      ];

      const shuffled = service.shuffleAvoidingAdjacentTopics(clustered);
      expect(shuffled).toHaveLength(6);
      for (let i = 1; i < shuffled.length; i++) {
        expect(shuffled[i].topic?.toString()).not.toBe(
          shuffled[i - 1].topic?.toString(),
        );
      }
      expect(new Set(shuffled.map(row => row.question.toString())).size).toBe(
        6,
      );
    });

    it('should keep all questions when one topic dominates', () => {
      const mostlyA = [
        q('507f1f77bcf86cd7994390c1', topicA),
        q('507f1f77bcf86cd7994390c2', topicA),
        q('507f1f77bcf86cd7994390c3', topicA),
        q('507f1f77bcf86cd7994390c4', topicB),
      ];
      const shuffled = service.shuffleAvoidingAdjacentTopics(mostlyA);
      expect(shuffled).toHaveLength(4);
      expect(new Set(shuffled.map(row => row.question.toString())).size).toBe(
        4,
      );
    });
  });

  describe('arrangePaperQuestions', () => {
    const sub2 = '507f1f77bcf86cd799439019';
    const topicA = new Types.ObjectId('507f1f77bcf86cd7994390b1');
    const topicB = new Types.ObjectId('507f1f77bcf86cd7994390b2');

    function q(
      id: string,
      subjectId: string,
      topic: Types.ObjectId,
      position: number,
    ) {
      return {
        question: new Types.ObjectId(id),
        subject: new Types.ObjectId(subjectId),
        topic,
        difficultyLevel: 'easy',
        position,
        marksPerQuestion: 1,
        negativeMarking: 0,
      };
    }

    it('should preserve session/subject order and separate topics within each session', () => {
      const subjects = [
        { subject: new Types.ObjectId(SUB_ID) },
        { subject: new Types.ObjectId(sub2) },
      ];
      const questions = [
        q('507f1f77bcf86cd7994390d1', SUB_ID, topicA, 0),
        q('507f1f77bcf86cd7994390d2', SUB_ID, topicA, 1),
        q('507f1f77bcf86cd7994390d3', SUB_ID, topicB, 2),
        q('507f1f77bcf86cd7994390d4', SUB_ID, topicB, 3),
        q('507f1f77bcf86cd7994390d5', sub2, topicA, 4),
        q('507f1f77bcf86cd7994390d6', sub2, topicB, 5),
      ];

      const arranged = service.arrangePaperQuestions(questions, subjects, true);

      expect(arranged.map(row => row.subject.toString())).toEqual([
        SUB_ID,
        SUB_ID,
        SUB_ID,
        SUB_ID,
        sub2,
        sub2,
      ]);
      expect(arranged.map(row => row.position)).toEqual([0, 1, 2, 3, 4, 5]);

      const firstSession = arranged.slice(0, 4);
      for (let i = 1; i < firstSession.length; i++) {
        expect(firstSession[i].topic?.toString()).not.toBe(
          firstSession[i - 1].topic?.toString(),
        );
      }
    });

    it('should shuffle the whole pack for mixed exams', () => {
      const subjects = [
        { subject: new Types.ObjectId(SUB_ID) },
        { subject: new Types.ObjectId(sub2) },
      ];
      const questions = [
        q('507f1f77bcf86cd7994390d1', SUB_ID, topicA, 0),
        q('507f1f77bcf86cd7994390d2', SUB_ID, topicA, 1),
        q('507f1f77bcf86cd7994390d3', sub2, topicB, 2),
        q('507f1f77bcf86cd7994390d4', sub2, topicB, 3),
      ];

      const arranged = service.arrangePaperQuestions(
        questions,
        subjects,
        false,
      );
      expect(arranged).toHaveLength(4);
      expect(arranged.map(row => row.position)).toEqual([0, 1, 2, 3]);
      for (let i = 1; i < arranged.length; i++) {
        expect(arranged[i].topic?.toString()).not.toBe(
          arranged[i - 1].topic?.toString(),
        );
      }
    });
  });
});
