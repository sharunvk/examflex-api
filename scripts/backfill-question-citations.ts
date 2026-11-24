/**
 * Save the top-2 NCERT citations on every question of one subject that has none.
 *
 *   npm run citations:backfill -- --subject <subjectId>             (dry run)
 *   npm run citations:backfill -- --subject <subjectId> --apply     (writes)
 *
 * Options:
 *   --subject <id>       subject whose questions to fill                       [required]
 *   --topic <id[,id…]>   only questions of these topic id(s) within the subject  [optional]
 *   --apply              write citations. Without it nothing is searched or written.
 *   --limit <n>          stop after n questions (try 20 first)
 *   --concurrency <n>    questions processed at once (default 2; the service allows 3)
 *   --delay-ms <n>       pause after each question per worker (default 250)
 *   --max-retries <n>    retries per search on a rate-limit / transient error (default 5)
 *
 * What it does:
 *  - Picks questions of that subject that are not deleted and have no citations
 *    (never saved, empty, or a previous run marked them `failed`). So the script is
 *    safe to re-run: it resumes where it stopped. Questions that already have
 *    citations, including ones an admin picked, are never touched.
 *  - The subject must be mapped to an NCERT vector subject (Subject.vectorSubjectKey);
 *    if it is not, the script stops without changing anything.
 *  - Uses the same code as question creation (QuestionCitationsService.autoAttach),
 *    so the saved citations are identical to what a new question gets.
 *
 * Rate limits:
 *  - Gemini embeddings are called by Weaviate on every search, using GEMINI_API_KEY
 *    from .env (use the paid-tier key). Weaviate itself may still be on a free plan.
 *  - A rate-limit (429 / RESOURCE_EXHAUSTED / "too many requests") or a transient
 *    error (503, timeout, connection reset) is retried with exponential backoff
 *    (5s, 10s, 20s, 40s, 60s, plus jitter).
 *  - A daily-quota error, or 5 questions in a row failing on rate limits after all
 *    retries, stops the run early. Re-run later and it resumes.
 *  - The summary lists every distinct error message, so you can see whether Gemini
 *    or Weaviate is the one limiting you.
 */
import 'reflect-metadata';
import { setServers as setDnsServers } from 'dns';
import { config } from 'dotenv';
import { resolve } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Question,
  QuestionDocument,
  QuestionSchema,
} from '../src/mock-test-attempts/schemas/question.schema';
import {
  Subject,
  SubjectDocument,
  SubjectSchema,
} from '../src/subjects/schemas/subject.schema';
import {
  InstanceConfig,
  InstanceConfigSchema,
} from '../src/instance-config/schemas/instance-config.schema';
import {
  Topic,
  TopicDocument,
  TopicSchema,
} from '../src/topics/schemas/topic.schema';
import { NcertSearchService } from '../src/citations/ncert-search.service';
import { QuestionCitationsService } from '../src/citations/question-citations.service';

config({ path: resolve(__dirname, '../.env') });

// mongodb+srv needs a DNS SRV lookup, which Node does with its own resolver. On
// some machines that resolver points at a local stub (127.0.0.1: VPN, DNS filter)
// that refuses it -> "querySrv ECONNREFUSED". Use public DNS for it instead.
// Override with DNS_SERVERS=1.2.3.4,5.6.7.8, or DNS_SERVERS=system to leave it alone.
if (process.env.MONGODB_URI?.startsWith('mongodb+srv://')) {
  const configured = process.env.DNS_SERVERS?.trim();
  if (configured !== 'system') {
    setDnsServers(
      configured
        ? configured.split(',').map(s => s.trim())
        : ['8.8.8.8', '1.1.1.1'],
    );
  }
}

const RATE_LIMIT =
  /\b429\b|too many requests|rate.?limit|resource.?exhausted|quota/i;
const DAILY_QUOTA = /per.?day|daily|requests per day/i;
const TRANSIENT =
  /\b50[234]\b|unavailable|timed? ?out|deadline|econnreset|etimedout|socket hang up|enotfound/i;
const BACKOFF_SECONDS = [5, 10, 20, 40, 60];
const STOP_AFTER_CONSECUTIVE_RATE_LIMITED = 5;

interface Options {
  subject: string;
  topics: string[];
  apply: boolean;
  limit?: number;
  concurrency: number;
  delayMs: number;
  maxRetries: number;
}

function parseArgs(argv: string[]): Options {
  const out: Options = {
    subject: '',
    topics: [],
    apply: false,
    concurrency: 2,
    delayMs: 250,
    maxRetries: 5,
  };
  const num = (flag: string, value: string | undefined, min: number) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) {
      throw new Error(`${flag} must be an integer >= ${min}`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--subject') out.subject = argv[++i] ?? '';
    else if (a === '--topic')
      out.topics = (argv[++i] ?? '')
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
    else if (a === '--apply') out.apply = true;
    else if (a === '--limit') out.limit = num(a, argv[++i], 1);
    else if (a === '--concurrency') out.concurrency = num(a, argv[++i], 1);
    else if (a === '--delay-ms') out.delayMs = num(a, argv[++i], 0);
    else if (a === '--max-retries') out.maxRetries = num(a, argv[++i], 0);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Types.ObjectId.isValid(out.subject)) {
    throw new Error(
      '--subject <subjectId> is required and must be an ObjectId',
    );
  }
  const badTopic = out.topics.find(t => !Types.ObjectId.isValid(t));
  const emptyTopic = argv.includes('--topic') && out.topics.length === 0;
  if (badTopic !== undefined || emptyTopic) {
    throw new Error(
      `--topic needs one or more topic ObjectIds, comma separated (got "${badTopic ?? ''}")`,
    );
  }
  return out;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Only what the script needs: Mongo, the three models, and the two services. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '../.env'),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        uri: c.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    MongooseModule.forFeature([
      { name: Question.name, schema: QuestionSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: Topic.name, schema: TopicSchema },
      { name: InstanceConfig.name, schema: InstanceConfigSchema },
    ]),
  ],
  providers: [NcertSearchService, QuestionCitationsService],
})
class BackfillModule {}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['error', 'warn'],
  });

  try {
    const questions = app.get<Model<QuestionDocument>>(
      getModelToken(Question.name),
    );
    const subjects = app.get<Model<SubjectDocument>>(
      getModelToken(Subject.name),
    );
    const citations = app.get(QuestionCitationsService);
    const search = app.get(NcertSearchService);

    const subjectId = new Types.ObjectId(opts.subject);
    const subject = await subjects
      .findById(subjectId)
      .select('name vectorSubjectKey')
      .lean<{ name?: string; vectorSubjectKey?: string }>()
      .exec();
    if (!subject) {
      throw new Error(`Subject ${opts.subject} not found`);
    }
    const mapping = await citations.resolveMapping(subjectId);
    if (!mapping) {
      console.error(
        `Subject "${subject.name}" is not mapped to an NCERT vector subject ` +
          `(vectorSubjectKey: ${subject.vectorSubjectKey ?? 'none'}). Nothing changed.`,
      );
      process.exitCode = 1;
      return;
    }
    if (!search.isEnabled()) {
      throw new Error(
        'WEAVIATE_HOST, WEAVIATE_API_KEY and GEMINI_API_KEY must be set in .env',
      );
    }

    let topicLabel = '';
    const topicIds = opts.topics.map(t => new Types.ObjectId(t));
    if (topicIds.length) {
      const topics = app.get<Model<TopicDocument>>(getModelToken(Topic.name));
      const found = await topics
        .find({ _id: { $in: topicIds } })
        .select('name')
        .lean<Array<{ _id: Types.ObjectId; name?: string }>>()
        .exec();
      const foundIds = new Set(found.map(t => String(t._id)));
      const unknown = opts.topics.filter(t => !foundIds.has(t));
      if (unknown.length) {
        throw new Error(`Topic not found: ${unknown.join(', ')}`);
      }
      topicLabel = found.map(t => `"${t.name}"`).join(', ');
    }

    const base = {
      subject: subjectId,
      ...(topicIds.length ? { topic: { $in: topicIds } } : {}),
      isDeleted: { $ne: true },
    };
    const missing = {
      ...base,
      $or: [{ citations: null }, { citations: { $size: 0 } }],
    };
    const [total, pendingCount] = await Promise.all([
      questions.countDocuments(base).exec(),
      questions.countDocuments(missing).exec(),
    ]);
    const ids = (
      await questions
        .find(missing)
        .select('_id')
        .sort({ _id: 1 })
        .limit(opts.limit ?? 0)
        .lean<Array<{ _id: Types.ObjectId }>>()
        .exec()
    ).map(q => String(q._id));

    console.log(
      `${opts.apply ? 'APPLY' : 'DRY RUN'}  subject "${subject.name}" -> ${mapping.key} ` +
        `(collection ${mapping.collection})` +
        (topicLabel ? `  topic ${topicLabel}` : ''),
    );
    console.log(
      `questions: ${total} total, ${total - pendingCount} already have citations, ` +
        `${pendingCount} without; this run: ${ids.length}`,
    );
    if (!opts.apply) {
      const perQuestion = (1.5 + opts.delayMs / 1000) / opts.concurrency;
      console.log(
        `estimated time: ~${Math.ceil((ids.length * perQuestion) / 60)} min. ` +
          'Nothing was searched or written. Add --apply to run.',
      );
      return;
    }
    if (ids.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    // --- Rate-limit handling around the search call ----------------------------
    const stats = {
      rateLimited: 0,
      transient: 0,
      retriesUsed: 0,
      exhaustedRateLimited: 0,
    };
    const errorCounts = new Map<string, number>();
    let consecutiveRateLimited = 0;
    let abortReason: string | null = null;
    const noteError = (error: unknown) => {
      const text = (error instanceof Error ? error.message : String(error))
        .replace(/\s+/g, ' ')
        .slice(0, 200);
      errorCounts.set(text, (errorCounts.get(text) ?? 0) + 1);
    };

    const originalSearch = search.search.bind(search);
    search.search = async params => {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await originalSearch(params);
          consecutiveRateLimited = 0;
          return result;
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          noteError(error);
          const rateLimited = RATE_LIMIT.test(text);
          const transient = !rateLimited && TRANSIENT.test(text);
          if (rateLimited) stats.rateLimited++;
          if (transient) stats.transient++;

          if (rateLimited && DAILY_QUOTA.test(text)) {
            abortReason = 'daily quota reached';
            throw error;
          }
          if ((!rateLimited && !transient) || attempt >= opts.maxRetries) {
            if (rateLimited) {
              stats.exhaustedRateLimited++;
              if (
                ++consecutiveRateLimited >= STOP_AFTER_CONSECUTIVE_RATE_LIMITED
              ) {
                abortReason = `${consecutiveRateLimited} questions in a row hit rate limits after all retries`;
              }
            }
            throw error;
          }
          stats.retriesUsed++;
          const wait =
            BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)] *
              1000 +
            Math.floor(Math.random() * 1000);
          console.warn(
            `\n  ${rateLimited ? 'rate limited' : 'transient error'}; retry ${attempt + 1}/${opts.maxRetries} in ${Math.round(wait / 1000)}s`,
          );
          await sleep(wait);
        }
      }
    };

    // --- Process ---------------------------------------------------------------
    const outcome = { done: 0, failed: 0, skipped: 0, other: 0 };
    let next = 0;
    let finished = 0;
    const startedAt = Date.now();

    const worker = async () => {
      while (!abortReason) {
        const i = next++;
        if (i >= ids.length) return;
        const status = await citations.autoAttach(ids[i]);
        if (status === 'done') outcome.done++;
        else if (status === 'failed') outcome.failed++;
        else if (status === 'skipped') outcome.skipped++;
        else outcome.other++;
        finished++;
        if (finished % 25 === 0 || finished === ids.length) {
          const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
          process.stdout.write(
            `\r${finished}/${ids.length}  done ${outcome.done}  failed ${outcome.failed}  skipped ${outcome.skipped}  (${mins} min)   `,
          );
        }
        if (opts.delayMs) await sleep(opts.delayMs);
      }
    };
    await Promise.all(Array.from({ length: opts.concurrency }, worker));

    // --- Summary ---------------------------------------------------------------
    const stillMissing = await questions.countDocuments(missing).exec();
    console.log('\n');
    console.log(
      `processed ${finished} of ${ids.length}: done ${outcome.done}, failed ${outcome.failed}, skipped ${outcome.skipped}`,
    );
    console.log(
      `rate-limit errors: ${stats.rateLimited} (questions that still failed on them: ${stats.exhaustedRateLimited}), ` +
        `transient errors: ${stats.transient}, retries used: ${stats.retriesUsed}`,
    );
    if (errorCounts.size) {
      console.log('distinct errors:');
      for (const [message, count] of [...errorCounts].sort(
        (a, b) => b[1] - a[1],
      )) {
        console.log(`  ${count}x  ${message}`);
      }
    }
    if (abortReason) {
      console.log(
        `STOPPED EARLY: ${abortReason}. Wait, then run the same command again; it resumes.`,
      );
      process.exitCode = 2;
    }
    console.log(
      `questions in this subject still without citations: ${stillMissing}` +
        (stillMissing
          ? ' (failed ones are retried on the next run; "skipped" means no English text)'
          : ''),
    );
  } finally {
    await app.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
