import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NcertSearchService,
  parseVectorSimilarity,
  toNcertChunk,
} from './ncert-search.service';
import { Semaphore } from './semaphore';

const ENV = {
  WEAVIATE_HOST: 'https://cluster.example.weaviate.cloud',
  WEAVIATE_API_KEY: 'wv-key',
  GEMINI_API_KEY: 'gm-key',
};

function config(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function fakeClient() {
  const byProperty = jest.fn((name: string) => ({
    equal: (value: string) => ({ name, value }),
  }));
  const hybrid = jest.fn();
  const fetchObjectById = jest.fn();
  const collections = {
    get: jest.fn(() => ({
      filter: { byProperty },
      query: { hybrid, fetchObjectById },
    })),
  };
  return {
    client: { collections, close: jest.fn() },
    hybrid,
    fetchObjectById,
    collections,
  };
}

class TestableSearch extends NcertSearchService {
  constructor(
    cfg: ConfigService,
    private readonly fake: unknown,
  ) {
    super(cfg);
  }
  connectCalls = 0;
  protected connect(): Promise<any> {
    this.connectCalls += 1;
    return Promise.resolve(this.fake);
  }
}

describe('parseVectorSimilarity', () => {
  it('reads the vector original score from explainScore', () => {
    expect(
      parseVectorSimilarity(
        'Hybrid (Result Set keyword,bm25) ... original score 15.68\n' +
          'Hybrid (Result Set vector,hybridVector) Document x: original score 0.724676, normalized 1',
      ),
    ).toBeCloseTo(0.724676);
  });

  it('returns undefined when absent', () => {
    expect(parseVectorSimilarity(undefined)).toBeUndefined();
    expect(parseVectorSimilarity('nothing here')).toBeUndefined();
  });
});

describe('toNcertChunk', () => {
  it('maps properties and computes the printed page', () => {
    const chunk = toNcertChunk(
      'uuid-1',
      {
        title: 'Inertia',
        content: 'Full text',
        chunkIndex: 41,
        images: ['a.png', '', 3],
        sourceDoc: 'LAWS_OF_MOTION.pdf',
        documentType: 'study_material',
        grade: 'XI',
        pageStart: 3,
        ncertPageOffset: 48,
        subjectId: 'phy',
        modality: 'text',
      },
      { score: 0.9 },
    );
    expect(chunk).toMatchObject({
      chunkId: 'uuid-1',
      content: 'Full text',
      chunkIndex: 41,
      images: ['a.png'],
      grade: 'XI',
      pageStart: 3,
      ncertPageOffset: 48,
      pageNumber: 51,
      score: 0.9,
    });
  });

  it('uses pageStart when there is no offset, and drops empty image lists', () => {
    const chunk = toNcertChunk('u', { pageStart: 7, images: [] });
    expect(chunk.pageNumber).toBe(7);
    expect(chunk.images).toBeUndefined();
    expect(toNcertChunk('u', {}).pageNumber).toBeUndefined();
  });
});

describe('NcertSearchService', () => {
  it('is disabled without credentials and refuses to search', async () => {
    const service = new TestableSearch(config({}), fakeClient().client);
    expect(service.isEnabled()).toBe(false);
    await expect(
      service.search({
        collection: 'Ncert',
        vectorSubjectId: 'x',
        query: 'q',
        limit: 2,
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('runs a hybrid search filtered by subject and text modality', async () => {
    const fake = fakeClient();
    fake.hybrid.mockResolvedValue({
      objects: [
        {
          uuid: 'c1',
          properties: {
            title: 'T',
            pageStart: 2,
            ncertPageOffset: 10,
            modality: 'text',
          },
          metadata: {
            score: 1,
            explainScore: 'Result Set vector: original score 0.7',
          },
        },
      ],
    });
    const service = new TestableSearch(config(ENV), fake.client);

    const result = await service.search({
      collection: 'Ncert',
      vectorSubjectId: 'phy-id',
      query: '  inertia  ',
      limit: 2,
    });

    expect(fake.collections.get).toHaveBeenCalledWith('Ncert');
    const [query, opts] = fake.hybrid.mock.calls[0];
    expect(query).toBe('inertia');
    expect(opts).toMatchObject({
      alpha: 0.6,
      limit: 2,
      targetVector: 'text2vec_gemini',
      queryProperties: ['content', 'title'],
    });
    expect(opts.filters).toEqual({
      operator: 'And',
      filters: [
        { name: 'subjectId', value: 'phy-id' },
        { name: 'modality', value: 'text' },
      ],
    });
    expect(opts.returnProperties).toEqual(
      expect.arrayContaining([
        'content',
        'chunkIndex',
        'images',
        'grade',
        'ncertPageOffset',
      ]),
    );
    expect(result).toEqual([
      expect.objectContaining({
        chunkId: 'c1',
        pageNumber: 12,
        similarity: 0.7,
      }),
    ]);
  });

  it('skips the call for an empty query and connects only once', async () => {
    const fake = fakeClient();
    fake.hybrid.mockResolvedValue({ objects: [] });
    const service = new TestableSearch(config(ENV), fake.client);

    await expect(
      service.search({
        collection: 'Ncert',
        vectorSubjectId: 'x',
        query: '   ',
        limit: 2,
      }),
    ).resolves.toEqual([]);
    await service.search({
      collection: 'Ncert',
      vectorSubjectId: 'x',
      query: 'a',
      limit: 2,
    });
    await service.search({
      collection: 'Ncert',
      vectorSubjectId: 'x',
      query: 'b',
      limit: 2,
    });

    expect(fake.hybrid).toHaveBeenCalledTimes(2);
    expect(service.connectCalls).toBe(1);
  });

  it('fetches chunks by id in order, with null for missing ones', async () => {
    const fake = fakeClient();
    fake.fetchObjectById.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'missing' ? null : { uuid: id, properties: { title: id } },
      ),
    );
    const service = new TestableSearch(config(ENV), fake.client);

    const result = await service.fetchByIds('Ncert', ['b', 'missing', 'a']);

    expect(result.map(c => c?.chunkId ?? null)).toEqual(['b', null, 'a']);
    await expect(service.fetchByIds('Ncert', [])).resolves.toEqual([]);
  });

  it('closes the client on shutdown', async () => {
    const fake = fakeClient();
    fake.hybrid.mockResolvedValue({ objects: [] });
    const service = new TestableSearch(config(ENV), fake.client);
    await service.onModuleDestroy(); // no client yet
    await service.search({
      collection: 'Ncert',
      vectorSubjectId: 'x',
      query: 'a',
      limit: 1,
    });
    await service.onModuleDestroy();
    expect(fake.client.close).toHaveBeenCalledTimes(1);
  });
});

describe('Semaphore', () => {
  it('never runs more than the limit at once', async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const task = () =>
      semaphore.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise(r => setTimeout(r, 5));
        running -= 1;
      });
    await Promise.all(Array.from({ length: 7 }, task));
    expect(peak).toBe(2);
  });

  it('releases the slot when a task fails', async () => {
    const semaphore = new Semaphore(1);
    await expect(
      semaphore.run(() => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');
    await expect(semaphore.run(() => Promise.resolve(5))).resolves.toBe(5);
  });
});
