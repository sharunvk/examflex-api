import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import weaviate, { ApiKey, Filters, WeaviateClient } from 'weaviate-client';
import {
  CITABLE_MODALITY,
  HYBRID_ALPHA,
  NCERT_NAMED_VECTOR,
  SEARCH_CONCURRENCY,
  WEAVIATE_TIMEOUT_SECONDS,
} from './citations.constants';
import { Semaphore } from './semaphore';

/** Properties read from each NCERT chunk. */
export const NCERT_RETURN_PROPERTIES = [
  'title',
  'content',
  'chunkIndex',
  'images',
  'sourceDoc',
  'documentType',
  'grade',
  'pageStart',
  'ncertPageOffset',
  'subjectId',
  'modality',
] as const;

export interface NcertChunk {
  chunkId: string;
  title?: string;
  content?: string;
  chunkIndex?: number;
  images?: string[];
  sourceDoc?: string;
  documentType?: string;
  grade?: string;
  pageStart?: number;
  ncertPageOffset?: number;
  pageNumber?: number;
  subjectId?: string;
  modality?: string;
  score?: number;
  similarity?: number;
}

export interface NcertSearchParams {
  collection: string;
  vectorSubjectId: string;
  query: string;
  limit: number;
}

type ChunkProperties = Partial<
  Record<(typeof NCERT_RETURN_PROPERTIES)[number], unknown>
>;

const NUM = '([+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)';
const VECTOR_SCORE = new RegExp(
  `Result Set vector[^:]*: original score ${NUM}`,
);

/** Vector similarity from a hybrid explainScore string. */
export function parseVectorSimilarity(
  explainScore?: string,
): number | undefined {
  const match = (explainScore ?? '').match(VECTOR_SCORE);
  return match ? Number(match[1]) : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Maps a Weaviate object to an NcertChunk, computing the printed page. */
export function toNcertChunk(
  uuid: string,
  props: ChunkProperties,
  metadata?: { score?: number; explainScore?: string },
): NcertChunk {
  const pageStart = asNumber(props.pageStart);
  const ncertPageOffset = asNumber(props.ncertPageOffset);
  const images = Array.isArray(props.images)
    ? props.images.filter(
        (i): i is string => typeof i === 'string' && i.length > 0,
      )
    : [];
  return {
    chunkId: uuid,
    title: asString(props.title),
    content: asString(props.content),
    chunkIndex: asNumber(props.chunkIndex),
    images: images.length ? images : undefined,
    sourceDoc: asString(props.sourceDoc),
    documentType: asString(props.documentType),
    grade: asString(props.grade),
    pageStart,
    ncertPageOffset,
    pageNumber:
      pageStart === undefined ? undefined : pageStart + (ncertPageOffset ?? 0),
    subjectId: asString(props.subjectId),
    modality: asString(props.modality),
    score: asNumber(metadata?.score),
    similarity: parseVectorSimilarity(metadata?.explainScore),
  };
}

/**
 * Read-only access to the NCERT Weaviate collection. Credentials come from the
 * environment; the collection name and subject ids come from instance_configs.
 */
@Injectable()
export class NcertSearchService implements OnModuleDestroy {
  private readonly logger = new Logger(NcertSearchService.name);
  private readonly semaphore = new Semaphore(SEARCH_CONCURRENCY);
  private clientPromise: Promise<WeaviateClient> | null = null;
  private warnedDisabled = false;

  constructor(private readonly configService: ConfigService) {}

  /** False when WEAVIATE_HOST, WEAVIATE_API_KEY or GEMINI_API_KEY is missing. */
  isEnabled(): boolean {
    const enabled = Boolean(
      this.configService.get<string>('WEAVIATE_HOST') &&
        this.configService.get<string>('WEAVIATE_API_KEY') &&
        this.configService.get<string>('GEMINI_API_KEY'),
    );
    if (!enabled && !this.warnedDisabled) {
      this.warnedDisabled = true;
      this.logger.warn(
        '[citations] Disabled: set WEAVIATE_HOST, WEAVIATE_API_KEY and GEMINI_API_KEY to enable NCERT citations',
      );
    }
    return enabled;
  }

  async search(params: NcertSearchParams): Promise<NcertChunk[]> {
    const query = params.query.trim();
    if (!query) {
      return [];
    }
    return this.semaphore.run(async () => {
      const collection = (await this.getClient()).collections.get(
        params.collection,
      );
      const result = await collection.query.hybrid(query, {
        alpha: HYBRID_ALPHA,
        limit: params.limit,
        queryProperties: ['content', 'title'],
        targetVector: NCERT_NAMED_VECTOR,
        filters: Filters.and(
          collection.filter
            .byProperty('subjectId')
            .equal(params.vectorSubjectId),
          collection.filter.byProperty('modality').equal(CITABLE_MODALITY),
        ),
        returnProperties: [...NCERT_RETURN_PROPERTIES],
        returnMetadata: ['score', 'explainScore'],
      });
      return (result.objects ?? []).map(o =>
        toNcertChunk(o.uuid, o.properties as ChunkProperties, o.metadata),
      );
    });
  }

  /** Fetches chunks by uuid, keeping the input order. Missing ids map to null. */
  async fetchByIds(
    collectionName: string,
    ids: string[],
  ): Promise<Array<NcertChunk | null>> {
    if (ids.length === 0) {
      return [];
    }
    return this.semaphore.run(async () => {
      const collection = (await this.getClient()).collections.get(
        collectionName,
      );
      return Promise.all(
        ids.map(async id => {
          const o = await collection.query.fetchObjectById(id, {
            returnProperties: [...NCERT_RETURN_PROPERTIES],
          });
          return o
            ? toNcertChunk(o.uuid, o.properties as ChunkProperties)
            : null;
        }),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.clientPromise) {
      return;
    }
    try {
      await (await this.clientPromise).close();
    } catch {
      // closing is best effort
    }
  }

  /** Separate so tests can replace the connection. */
  protected connect(): Promise<WeaviateClient> {
    const host = this.configService
      .get<string>('WEAVIATE_HOST')!
      .replace(/^https?:\/\//, '');
    return weaviate.connectToWeaviateCloud(host, {
      authCredentials: new ApiKey(
        this.configService.get<string>('WEAVIATE_API_KEY')!,
      ),
      headers: {
        'X-Goog-Studio-Api-Key':
          this.configService.get<string>('GEMINI_API_KEY')!,
      },
      timeout: WEAVIATE_TIMEOUT_SECONDS,
    });
  }

  private getClient(): Promise<WeaviateClient> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'NCERT citation search is not configured',
      );
    }
    if (!this.clientPromise) {
      this.clientPromise = this.connect().catch((error: unknown) => {
        // let the next call retry instead of caching a failed connection
        this.clientPromise = null;
        throw error;
      });
    }
    return this.clientPromise;
  }
}
