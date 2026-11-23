import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  CitationStatus,
  Question,
  QuestionCitation,
  QuestionDocument,
} from '../mock-test-attempts/schemas/question.schema';
import { Subject, SubjectDocument } from '../subjects/schemas/subject.schema';
import {
  InstanceConfig,
  InstanceConfigDocument,
  InstanceVectorSearchConfig,
} from '../instance-config/schemas/instance-config.schema';
import { INSTANCE_CONFIG_ID } from '../instance-config/instance-config.constants';
import { resolveVectorSearch } from '../instance-config/vector-search.settings';
import {
  AUTO_CITATION_COUNT,
  CITABLE_MODALITY,
  DEFAULT_SEARCH_LIMIT,
  MAX_QUERY_CHARS,
} from './citations.constants';
import { NcertChunk, NcertSearchService } from './ncert-search.service';
import { toChapterName } from './chapter-name';
import {
  CitationDto,
  CitationSearchResponseDto,
  QuestionCitationsResponseDto,
} from './dto/citation.dto';

export interface VectorMapping {
  key: string;
  vectorSubjectId: string;
  collection: string;
}

type QuestionForCitation = Pick<
  Question,
  'questionText' | 'options' | 'correctAnswer' | 'subject'
> & { _id: Types.ObjectId };

/** Auto results never overwrite citations an admin picked. */
const NOT_ADMIN_PICKED: FilterQuery<Question> = {
  'citations.selectedBy': { $ne: 'admin' },
};

/**
 * Turns question text (Mathpix markdown / LaTeX) into plain search text:
 * drops images, HTML, LaTeX commands and markdown symbols, keeps the words.
 */
export function toSearchText(raw: string | null | undefined): string {
  if (!raw) {
    return '';
  }
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // markdown images
    .replace(/<[^>]+>/g, ' ') // html tags
    .replace(/\\(?:begin|end)\{[^}]*\}/g, ' ') // environments
    .replace(/\\[a-zA-Z]+\*?/g, ' ') // latex commands
    .replace(/[$^_{}\\#*`|~]/g, ' ') // math / markdown symbols
    .replace(/\s+/g, ' ')
    .trim();
}

/** English question text plus the correct option text, capped for the embedder. */
export function buildQueryText(question: Partial<QuestionForCitation>): string {
  const parts = [toSearchText(question.questionText?.en?.text)];
  const correct = question.options?.find(o => o.id === question.correctAnswer);
  const answer = toSearchText(correct?.en);
  if (answer) {
    parts.push(answer);
  }
  return parts.filter(Boolean).join(' ').slice(0, MAX_QUERY_CHARS).trim();
}

function toCitation(
  chunk: NcertChunk,
  rank: number,
  selectedBy: 'auto' | 'admin',
): QuestionCitation {
  return {
    chunkId: chunk.chunkId,
    rank,
    title: chunk.title,
    content: chunk.content,
    chunkIndex: chunk.chunkIndex,
    images: chunk.images,
    sourceDoc: chunk.sourceDoc,
    chapterName: toChapterName(chunk.sourceDoc),
    documentType: chunk.documentType,
    grade: chunk.grade,
    pageStart: chunk.pageStart,
    ncertPageOffset: chunk.ncertPageOffset,
    pageNumber: chunk.pageNumber,
    score: chunk.score,
    similarity: chunk.similarity,
    selectedBy,
  };
}

function toCitationDto(
  c: Partial<QuestionCitation>,
  rank?: number,
): CitationDto {
  return {
    chunkId: c.chunkId,
    rank: rank ?? c.rank,
    title: c.title,
    content: c.content,
    chunkIndex: c.chunkIndex,
    images: c.images,
    sourceDoc: c.sourceDoc,
    // Citations saved before chapterName existed get it derived on read.
    chapterName: c.chapterName ?? toChapterName(c.sourceDoc),
    documentType: c.documentType,
    grade: c.grade,
    pageStart: c.pageStart,
    ncertPageOffset: c.ncertPageOffset,
    pageNumber: c.pageNumber,
    score: c.score,
    similarity: c.similarity,
    selectedBy: c.selectedBy,
  };
}

@Injectable()
export class QuestionCitationsService {
  private readonly logger = new Logger(QuestionCitationsService.name);

  constructor(
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(InstanceConfig.name)
    private readonly instanceConfigModel: Model<InstanceConfigDocument>,
    private readonly search: NcertSearchService,
  ) {}

  /** Subject → vectorSubjectKey → configured NCERT subject id, or null when unmapped. */
  async resolveMapping(
    subjectId: Types.ObjectId | string | null | undefined,
  ): Promise<VectorMapping | null> {
    if (!subjectId || !Types.ObjectId.isValid(String(subjectId))) {
      return null;
    }
    const subject = await this.subjectModel
      .findById(subjectId)
      .select('vectorSubjectKey')
      .lean<{ vectorSubjectKey?: string }>()
      .exec();
    const key = subject?.vectorSubjectKey;
    if (!key) {
      return null;
    }
    const config = await this.instanceConfigModel
      .findById(INSTANCE_CONFIG_ID)
      .select('vectorSearch')
      .lean<{ vectorSearch?: InstanceVectorSearchConfig }>()
      .exec();
    const settings = resolveVectorSearch(config?.vectorSearch);
    const entry = settings.subjects.find(s => s.key === key);
    return entry
      ? {
          key,
          vectorSubjectId: entry.vectorSubjectId,
          collection: settings.collectionName,
        }
      : null;
  }

  /**
   * Saves the top auto citations for a question. Fire-and-forget safe: it never
   * throws. With `force`, it also replaces citations an admin picked.
   */
  async autoAttach(
    questionId: string,
    options: { force?: boolean } = {},
  ): Promise<CitationStatus | null> {
    const guard = options.force ? {} : NOT_ADMIN_PICKED;
    try {
      const question = await this.loadQuestion(questionId);
      if (!question) {
        return null;
      }
      const mapping = await this.resolveMapping(question.subject);
      const query = buildQueryText(question);
      if (!mapping || !query || !this.search.isEnabled()) {
        // Drop auto citations left over from a previously mapped subject.
        await this.questionModel
          .updateOne(
            { _id: question._id, ...guard },
            {
              $set: {
                citationStatus: 'skipped',
                citationsUpdatedAt: new Date(),
              },
              $unset: { citations: '' },
            },
          )
          .exec();
        return 'skipped';
      }

      await this.questionModel
        .updateOne(
          { _id: question._id, ...guard },
          { $set: { citationStatus: 'pending' } },
        )
        .exec();

      const chunks = await this.search.search({
        collection: mapping.collection,
        vectorSubjectId: mapping.vectorSubjectId,
        query,
        limit: AUTO_CITATION_COUNT,
      });
      const citations = chunks.map((chunk, i) =>
        toCitation(chunk, i + 1, 'auto'),
      );

      await this.questionModel
        .updateOne(
          { _id: question._id, ...guard },
          citations.length
            ? {
                $set: {
                  citations,
                  citationStatus: 'done',
                  citationsUpdatedAt: new Date(),
                },
              }
            : {
                $set: {
                  citationStatus: 'done',
                  citationsUpdatedAt: new Date(),
                },
                $unset: { citations: '' },
              },
        )
        .exec();
      return 'done';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[citations] Lookup failed for question ${questionId}: ${message}`,
      );
      try {
        await this.questionModel
          .updateOne(
            { _id: questionId, ...guard },
            {
              $set: {
                citationStatus: 'failed',
                citationsUpdatedAt: new Date(),
              },
            },
          )
          .exec();
      } catch {
        // status write is best effort
      }
      return 'failed';
    }
  }

  /** Fresh search for one question, for the admin to pick and rank from. */
  async searchForQuestion(
    questionId: string,
    options: { limit?: number; q?: string } = {},
  ): Promise<CitationSearchResponseDto> {
    const question = await this.requireQuestion(questionId);
    const mapping = await this.resolveMapping(question.subject);
    const query = options.q?.trim() || buildQueryText(question);
    if (!mapping) {
      return { mapped: false, vectorSubjectKey: null, query, results: [] };
    }
    if (!query) {
      throw new BadRequestException(
        'Question has no English text to search with. Pass a custom query in "q".',
      );
    }
    const chunks = await this.search.search({
      collection: mapping.collection,
      vectorSubjectId: mapping.vectorSubjectId,
      query,
      limit: options.limit ?? DEFAULT_SEARCH_LIMIT,
    });
    return {
      mapped: true,
      vectorSubjectKey: mapping.key,
      query,
      // Search results are suggestions, not saved citations, so no selectedBy.
      results: chunks.map((chunk, i) => ({
        ...toCitationDto(toCitation(chunk, i + 1, 'admin')),
        selectedBy: undefined,
      })),
    };
  }

  /**
   * Saves an admin's ranked selection. Chunks are re-read from Weaviate by id;
   * citation data from the client is never trusted.
   */
  async saveSelection(
    questionId: string,
    chunkIds: string[],
  ): Promise<QuestionCitationsResponseDto> {
    const question = await this.requireQuestion(questionId);

    if (chunkIds.length === 0) {
      await this.questionModel
        .updateOne(
          { _id: question._id },
          {
            $set: { citationStatus: 'done', citationsUpdatedAt: new Date() },
            $unset: { citations: '' },
          },
        )
        .exec();
      return this.getCitations(questionId);
    }

    const mapping = await this.resolveMapping(question.subject);
    if (!mapping) {
      throw new BadRequestException('Question subject has no NCERT mapping');
    }

    const chunks = await this.search.fetchByIds(mapping.collection, chunkIds);
    const invalid = chunkIds.filter((id, i) => {
      const chunk = chunks[i];
      return (
        !chunk ||
        chunk.subjectId !== mapping.vectorSubjectId ||
        chunk.modality !== CITABLE_MODALITY
      );
    });
    if (invalid.length) {
      throw new BadRequestException(
        `These chunks were not found or are not ${mapping.key} text chunks: ${invalid.join(', ')}`,
      );
    }

    // Keep the scores from an earlier save of the same chunk, if any.
    const previous = new Map<string, QuestionCitation>(
      (question.citations ?? []).map(c => [c.chunkId, c]),
    );
    const citations = chunks.map((chunk, i) => {
      const prior = previous.get(chunk.chunkId);
      return toCitation(
        { ...chunk, score: prior?.score, similarity: prior?.similarity },
        i + 1,
        'admin',
      );
    });

    await this.questionModel
      .updateOne(
        { _id: question._id },
        {
          $set: {
            citations,
            citationStatus: 'done',
            citationsUpdatedAt: new Date(),
          },
        },
      )
      .exec();
    return this.getCitations(questionId);
  }

  /** Re-runs the automatic top citations, replacing any admin selection. */
  async refresh(questionId: string): Promise<QuestionCitationsResponseDto> {
    await this.requireQuestion(questionId);
    await this.autoAttach(questionId, { force: true });
    return this.getCitations(questionId);
  }

  async getCitations(
    questionId: string,
  ): Promise<QuestionCitationsResponseDto> {
    const question = await this.requireQuestion(questionId);
    return {
      citationStatus: question.citationStatus ?? null,
      citations: (question.citations ?? [])
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map(c => toCitationDto(c)),
      citationsUpdatedAt: question.citationsUpdatedAt ?? null,
    };
  }

  private loadQuestion(questionId: string) {
    if (!Types.ObjectId.isValid(questionId)) {
      return Promise.resolve(null);
    }
    return this.questionModel
      .findOne({ _id: questionId, isDeleted: { $ne: true } })
      .select(
        'questionText options correctAnswer subject citations citationStatus citationsUpdatedAt',
      )
      .lean<
        QuestionForCitation &
          Pick<Question, 'citations' | 'citationStatus' | 'citationsUpdatedAt'>
      >()
      .exec();
  }

  private async requireQuestion(questionId: string) {
    const question = await this.loadQuestion(questionId);
    if (!question) {
      throw new NotFoundException(`Question with ID "${questionId}" not found`);
    }
    return question;
  }
}
