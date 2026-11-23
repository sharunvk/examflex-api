import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { QuestionPersistenceService } from './question-persistence.service';
import { Question } from '../../mock-test-attempts/schemas/question.schema';
import {
  ImportQuestion,
  PDF_IMPORT_QUESTION_SOURCE,
} from '../types/import-question';
import { QuestionCitationsService } from '../../citations/question-citations.service';

const subjectId = '507f1f77bcf86cd799439011';
const topicId = '507f1f77bcf86cd799439012';
const examId = '507f1f77bcf86cd799439013';
const uploadId = '507f1f77bcf86cd799439014';

function makeQuestion(overrides: Partial<ImportQuestion> = {}): ImportQuestion {
  return {
    questionText: {
      en: { text: 'Stem', image: null },
      ml: { text: null, image: null },
    },
    optionType: 'text',
    options: [
      { id: 'opt-a', type: 'text', en: 'A', ml: null },
      { id: 'opt-b', type: 'text', en: 'B', ml: null },
    ],
    explanation: { en: 'Because', ml: null, image: null, images: [] },
    correctAnswer: 'opt-a',
    subject: subjectId,
    topic: topicId,
    exams: [examId],
    difficultyLevel: 'easy',
    isActive: true,
    isDeleted: false,
    source: PDF_IMPORT_QUESTION_SOURCE,
    ...overrides,
  };
}

describe('QuestionPersistenceService', () => {
  let service: QuestionPersistenceService;
  const create = jest.fn();
  const autoAttach = jest.fn().mockResolvedValue('done');

  beforeEach(async () => {
    create.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionPersistenceService,
        { provide: getModelToken(Question.name), useValue: { create } },
        { provide: QuestionCitationsService, useValue: { autoAttach } },
      ],
    }).compile();
    service = module.get(QuestionPersistenceService);
  });

  it('saves a question payload with ObjectIds', async () => {
    const created = { _id: new Types.ObjectId() };
    create.mockResolvedValue(created);

    const result = await service.saveOne(
      makeQuestion({
        uploadId,
        explanation: {
          en: 'Because',
          ml: null,
          image: null,
          images: [{ key: 'k', bucket: 'b', region: 'r' }],
        },
      }),
    );

    expect(result).toBe(created);
    expect(autoAttach).toHaveBeenCalledWith(created._id.toString());
    const payload = create.mock.calls[0][0];
    expect(payload.subject.toString()).toBe(subjectId);
    expect(payload.topic.toString()).toBe(topicId);
    expect(payload.exams[0].toString()).toBe(examId);
    expect(payload.uploadId.toString()).toBe(uploadId);
    expect(payload.explanation.images).toHaveLength(1);
    expect(payload.source).toBe(PDF_IMPORT_QUESTION_SOURCE);
    expect(payload).not.toHaveProperty('tag');
    expect(payload).not.toHaveProperty('tags');
    expect(payload).not.toHaveProperty('createdBy');

    await service.saveOne(makeQuestion({ uploadId }), subjectId);
    expect(create.mock.calls[1][0].createdBy.toString()).toBe(subjectId);
    expect(create.mock.calls[1][0]).not.toHaveProperty('updatedBy');
  });

  it('stores selected tags and omits them when none are provided', async () => {
    create.mockResolvedValue({ _id: new Types.ObjectId() });
    const tagId = '507f1f77bcf86cd799439016';

    await service.saveOne(makeQuestion({ tags: [tagId] }));
    const tagged = create.mock.calls[0][0];
    expect(tagged).not.toHaveProperty('tag');
    expect(
      tagged.tags.map((id: { toString(): string }) => id.toString()),
    ).toEqual([tagId]);

    await service.saveOne(makeQuestion({ tags: [] }));
    expect(create.mock.calls[1][0]).not.toHaveProperty('tag');
    expect(create.mock.calls[1][0]).not.toHaveProperty('tags');
  });

  it('omits uploadId when not present and wraps DB errors', async () => {
    create.mockRejectedValue(new Error('dup key'));

    await expect(service.saveOne(makeQuestion())).rejects.toThrow(
      /Failed to save question to database: dup key/,
    );

    create.mockRejectedValue('boom');
    await expect(service.saveOne(makeQuestion())).rejects.toThrow(
      /Unknown database error/,
    );
  });
});
