import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  buildQueryText,
  QuestionCitationsService,
  toSearchText,
} from './question-citations.service';
import { NcertChunk, NcertSearchService } from './ncert-search.service';

const QID = new Types.ObjectId().toString();
const SUBJECT = new Types.ObjectId();
const PHY = '6afd6aa47d65768788984fed';

function chain(result: unknown) {
  const q: any = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  q.select.mockReturnValue(q);
  q.lean.mockReturnValue(q);
  return q;
}

const baseQuestion = (extra: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(QID),
  questionText: { en: { text: 'What is $\\mathbf{inertia}$?' } },
  options: [
    { id: 'a', en: 'Resistance to change in motion' },
    { id: 'b', en: 'Mass times speed' },
  ],
  correctAnswer: 'a',
  subject: SUBJECT,
  ...extra,
});

const chunk = (id: string, extra: Partial<NcertChunk> = {}): NcertChunk => ({
  chunkId: id,
  title: `T-${id}`,
  content: `Content ${id}`,
  chunkIndex: 1,
  images: ['img.png'],
  sourceDoc: 'LAWS_OF_MOTION.pdf',
  grade: 'XI',
  pageStart: 3,
  ncertPageOffset: 48,
  pageNumber: 51,
  subjectId: PHY,
  modality: 'text',
  score: 0.9,
  similarity: 0.7,
  ...extra,
});

describe('toSearchText / buildQueryText', () => {
  it('strips latex, markdown images and html', () => {
    expect(
      toSearchText(
        'Find $\\frac{a}{b}$ ![x](http://i/x.png) <b>now</b> \\begin{array}x\\end{array}',
      ),
    ).toBe('Find a b now x');
    expect(toSearchText(null)).toBe('');
  });

  it('joins the question text with the correct option and caps length', () => {
    expect(buildQueryText(baseQuestion() as any)).toBe(
      'What is inertia ? Resistance to change in motion',
    );
    const long = buildQueryText({
      questionText: { en: { text: 'w '.repeat(2000) } },
    } as any);
    expect(long.length).toBeLessThanOrEqual(1000);
  });
});

describe('QuestionCitationsService', () => {
  let questionModel: any;
  let subjectModel: any;
  let instanceConfigModel: any;
  let search: jest.Mocked<
    Pick<NcertSearchService, 'isEnabled' | 'search' | 'fetchByIds'>
  >;
  let service: QuestionCitationsService;

  const mapSubject = (key: string | undefined) =>
    subjectModel.findById.mockReturnValue(
      chain(key ? { vectorSubjectKey: key } : {}),
    );

  beforeEach(() => {
    questionModel = {
      findOne: jest.fn().mockReturnValue(chain(baseQuestion())),
      updateOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    subjectModel = { findById: jest.fn() };
    instanceConfigModel = { findById: jest.fn().mockReturnValue(chain(null)) };
    search = {
      isEnabled: jest.fn().mockReturnValue(true),
      search: jest.fn(),
      fetchByIds: jest.fn(),
    };
    service = new QuestionCitationsService(
      questionModel,
      subjectModel,
      instanceConfigModel,
      search as unknown as NcertSearchService,
    );
    mapSubject('physics');
  });

  const lastUpdate = () => questionModel.updateOne.mock.calls.at(-1);

  describe('resolveMapping', () => {
    it('uses the default config when instance_configs has none', async () => {
      await expect(service.resolveMapping(SUBJECT)).resolves.toEqual({
        key: 'physics',
        vectorSubjectId: PHY,
        collection: 'Ncert',
      });
    });

    it('uses stored collection and subjects', async () => {
      instanceConfigModel.findById.mockReturnValue(
        chain({
          vectorSearch: {
            collectionName: 'NcertV2',
            subjects: [
              { key: 'physics', label: 'P', vectorSubjectId: 'custom' },
            ],
          },
        }),
      );
      await expect(service.resolveMapping(SUBJECT)).resolves.toEqual({
        key: 'physics',
        vectorSubjectId: 'custom',
        collection: 'NcertV2',
      });
    });

    it('returns null for unmapped, unknown-key or missing subjects', async () => {
      mapSubject(undefined);
      await expect(service.resolveMapping(SUBJECT)).resolves.toBeNull();
      mapSubject('history');
      await expect(service.resolveMapping(SUBJECT)).resolves.toBeNull();
      await expect(service.resolveMapping(null)).resolves.toBeNull();
      await expect(service.resolveMapping('not-an-id')).resolves.toBeNull();
    });
  });

  describe('autoAttach', () => {
    it('saves the top 2 citations with full chunk data', async () => {
      search.search.mockResolvedValue([chunk('c1'), chunk('c2')]);

      await expect(service.autoAttach(QID)).resolves.toBe('done');

      expect(search.search).toHaveBeenCalledWith({
        collection: 'Ncert',
        vectorSubjectId: PHY,
        query: 'What is inertia ? Resistance to change in motion',
        limit: 2,
      });
      const [filter, update] = lastUpdate();
      expect(filter['citations.selectedBy']).toEqual({ $ne: 'admin' });
      expect(update.$set.citationStatus).toBe('done');
      expect(update.$set.citations).toEqual([
        expect.objectContaining({
          chunkId: 'c1',
          rank: 1,
          content: 'Content c1',
          chunkIndex: 1,
          images: ['img.png'],
          sourceDoc: 'LAWS_OF_MOTION.pdf',
          chapterName: 'LAWS OF MOTION',
          grade: 'XI',
          pageNumber: 51,
          selectedBy: 'auto',
        }),
        expect.objectContaining({ chunkId: 'c2', rank: 2 }),
      ]);
      expect(update.$set.citations[0]).not.toHaveProperty('subjectId');
    });

    it('skips and clears auto citations when the subject is not mapped', async () => {
      mapSubject(undefined);
      await expect(service.autoAttach(QID)).resolves.toBe('skipped');
      const [, update] = lastUpdate();
      expect(update).toEqual({
        $set: expect.objectContaining({ citationStatus: 'skipped' }),
        $unset: { citations: '' },
      });
      expect(search.search).not.toHaveBeenCalled();
    });

    it('skips when search is not configured', async () => {
      search.isEnabled.mockReturnValue(false);
      await expect(service.autoAttach(QID)).resolves.toBe('skipped');
    });

    it('marks failed and does not throw when the search errors', async () => {
      search.search.mockRejectedValue(new Error('timeout'));
      await expect(service.autoAttach(QID)).resolves.toBe('failed');
      expect(lastUpdate()[1].$set.citationStatus).toBe('failed');
    });

    it('stays quiet even when the status write fails', async () => {
      search.search.mockRejectedValue(new Error('timeout'));
      questionModel.updateOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('db down')),
      });
      await expect(service.autoAttach(QID)).resolves.toBe('failed');
    });

    it('does nothing for a missing question', async () => {
      questionModel.findOne.mockReturnValue(chain(null));
      await expect(service.autoAttach(QID)).resolves.toBeNull();
      expect(questionModel.updateOne).not.toHaveBeenCalled();
    });

    it('force replaces admin picks', async () => {
      search.search.mockResolvedValue([chunk('c1')]);
      await service.autoAttach(QID, { force: true });
      expect(lastUpdate()[0]).not.toHaveProperty('citations.selectedBy');
    });
  });

  describe('searchForQuestion', () => {
    it('returns 5 results by default, unsaved', async () => {
      search.search.mockResolvedValue([chunk('c1'), chunk('c2')]);
      const result = await service.searchForQuestion(QID);
      expect(search.search).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5 }),
      );
      expect(result.mapped).toBe(true);
      expect(result.vectorSubjectKey).toBe('physics');
      expect(result.results.map(r => r.rank)).toEqual([1, 2]);
      expect(result.results[0].selectedBy).toBeUndefined();
    });

    it('adds the chapter name to each suggestion', async () => {
      search.search.mockResolvedValue([chunk('c1')]);
      const result = await service.searchForQuestion(QID);
      expect(result.results[0].chapterName).toBe('LAWS OF MOTION');
    });

    it('uses a custom query when given', async () => {
      search.search.mockResolvedValue([]);
      const result = await service.searchForQuestion(QID, {
        q: 'newton',
        limit: 3,
      });
      expect(result.query).toBe('newton');
      expect(search.search).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'newton', limit: 3 }),
      );
    });

    it('reports unmapped subjects without searching', async () => {
      mapSubject(undefined);
      const result = await service.searchForQuestion(QID);
      expect(result).toMatchObject({ mapped: false, results: [] });
      expect(search.search).not.toHaveBeenCalled();
    });

    it('rejects a question with no text and no custom query', async () => {
      questionModel.findOne.mockReturnValue(
        chain(
          baseQuestion({ questionText: { en: { text: '' } }, options: [] }),
        ),
      );
      await expect(service.searchForQuestion(QID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws for a missing question', async () => {
      questionModel.findOne.mockReturnValue(chain(null));
      await expect(service.searchForQuestion(QID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('saveSelection', () => {
    it('saves chunks re-read from Weaviate in the given order', async () => {
      search.fetchByIds.mockResolvedValue([chunk('b'), chunk('a')]);

      await service.saveSelection(QID, ['b', 'a']);

      expect(search.fetchByIds).toHaveBeenCalledWith('Ncert', ['b', 'a']);
      const saveCall = questionModel.updateOne.mock.calls[0];
      expect(
        saveCall[1].$set.citations.map((c: any) => [
          c.chunkId,
          c.rank,
          c.selectedBy,
        ]),
      ).toEqual([
        ['b', 1, 'admin'],
        ['a', 2, 'admin'],
      ]);
    });

    it('stores the chapter name on admin-picked citations', async () => {
      search.fetchByIds.mockResolvedValue([chunk('a')]);
      await service.saveSelection(QID, ['a']);
      const saved = questionModel.updateOne.mock.calls[0][1].$set.citations[0];
      expect(saved).toMatchObject({
        sourceDoc: 'LAWS_OF_MOTION.pdf',
        chapterName: 'LAWS OF MOTION',
      });
    });

    it('keeps scores from an earlier save of the same chunk', async () => {
      questionModel.findOne.mockReturnValue(
        chain(
          baseQuestion({
            citations: [
              {
                chunkId: 'a',
                rank: 1,
                score: 0.42,
                similarity: 0.6,
                selectedBy: 'auto',
              },
            ],
          }),
        ),
      );
      search.fetchByIds.mockResolvedValue([
        chunk('a', { score: undefined, similarity: undefined }),
      ]);

      await service.saveSelection(QID, ['a']);

      const saved = questionModel.updateOne.mock.calls[0][1].$set.citations[0];
      expect(saved).toMatchObject({ score: 0.42, similarity: 0.6 });
    });

    it('rejects chunks that are missing, from another subject or not text', async () => {
      search.fetchByIds.mockResolvedValue([
        null,
        chunk('x', { subjectId: 'other' }),
        chunk('y', { modality: 'image' }),
      ]);
      await expect(service.saveSelection(QID, ['m', 'x', 'y'])).rejects.toThrow(
        /m, x, y/,
      );
      expect(questionModel.updateOne).not.toHaveBeenCalled();
    });

    it('rejects when the subject is not mapped', async () => {
      mapSubject(undefined);
      await expect(service.saveSelection(QID, ['a'])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('clears citations with an empty list', async () => {
      await service.saveSelection(QID, []);
      expect(questionModel.updateOne.mock.calls[0][1]).toEqual({
        $set: expect.objectContaining({ citationStatus: 'done' }),
        $unset: { citations: '' },
      });
      expect(search.fetchByIds).not.toHaveBeenCalled();
    });
  });

  describe('getCitations / refresh', () => {
    it('returns citations sorted by rank', async () => {
      questionModel.findOne.mockReturnValue(
        chain(
          baseQuestion({
            citationStatus: 'done',
            citations: [
              { chunkId: 'b', rank: 2, selectedBy: 'admin' },
              { chunkId: 'a', rank: 1, selectedBy: 'admin' },
            ],
          }),
        ),
      );
      const result = await service.getCitations(QID);
      expect(result.citationStatus).toBe('done');
      expect(result.citations.map(c => c.chunkId)).toEqual(['a', 'b']);
    });

    it('derives the chapter name for citations saved before it existed', async () => {
      questionModel.findOne.mockReturnValue(
        chain(
          baseQuestion({
            citations: [
              { chunkId: 'a', rank: 1, sourceDoc: 'Equilibrium.pdf' },
              {
                chunkId: 'b',
                rank: 2,
                sourceDoc: 'X.pdf',
                chapterName: 'Stored name',
              },
            ],
          }),
        ),
      );
      const result = await service.getCitations(QID);
      expect(result.citations.map(c => c.chapterName)).toEqual([
        'Equilibrium',
        'Stored name',
      ]);
    });

    it('returns empty values when nothing is stored', async () => {
      const result = await service.getCitations(QID);
      expect(result).toEqual({
        citationStatus: null,
        citations: [],
        citationsUpdatedAt: null,
      });
    });

    it('refresh forces a new auto lookup', async () => {
      search.search.mockResolvedValue([chunk('c1')]);
      await service.refresh(QID);
      expect(search.search).toHaveBeenCalled();
      const autoWrite = questionModel.updateOne.mock.calls.find(
        ([, u]: any) => u.$set?.citations,
      );
      expect(autoWrite[0]).not.toHaveProperty('citations.selectedBy');
    });
  });
});
