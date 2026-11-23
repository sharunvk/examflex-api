#!/usr/bin/env node
/**
 * Hybrid search over the Ncert collection, returning top documents with
 * ncertPageOffset and grade.
 *
 * Usage:
 *   WEAVIATE_API_KEY=<key> GEMINI_API_KEY=<key> \
 *     node scripts/ncert/search-ncert.mjs "inertia and Newton's first law" [options]
 *
 * Options:
 *   --grade <XI|XII>        only documents with this grade
 *   --sourceDoc <text>      only documents from this sourceDoc (exact)
 *   --limit <n>             number of results (default 5)
 *   --min-similarity <x>    drop hits whose vector similarity is below x (e.g. 0.58)
 *   --alpha <0..1>          hybrid weight: 0 = keyword only, 1 = vector only (default 0.6)
 *
 * Env:
 *   WEAVIATE_API_KEY   (required)
 *   GEMINI_API_KEY     (required; used to embed the query)
 *   WEAVIATE_HOST      optional, default: the examflex-admin cluster
 *   NCERT_COLLECTION   optional, default: Ncert
 *
 * Requires: npm i weaviate-client   (Node 18+). Keys are read from the environment only.
 */
import weaviate, { ApiKey } from 'weaviate-client';

const CLUSTER_HOST =
  process.env.WEAVIATE_HOST ||
  'cwwhfxys2hzah7cqibhc2qghoey.c0.eu-central-1.aws.weaviate.cloud';
const COLLECTION = process.env.NCERT_COLLECTION || 'Ncert';
const NAMED_VECTOR = 'text2vec_gemini';
const DEFAULT_QUERY = "inertia and Newton's first law";

function parseArgs(argv) {
  const out = { limit: 5, alpha: 0.6, minSimilarity: null, grade: null, sourceDoc: null };
  const queryParts = [];
  const num = (flag, v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) {
      console.error(`${flag} needs a number`);
      process.exit(1);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--grade') out.grade = argv[++i];
    else if (a === '--sourceDoc') out.sourceDoc = argv[++i];
    else if (a === '--limit') out.limit = num(a, argv[++i]);
    else if (a === '--min-similarity') out.minSimilarity = num(a, argv[++i]);
    else if (a === '--alpha') out.alpha = num(a, argv[++i]);
    else queryParts.push(a);
  }
  out.query = queryParts.join(' ').trim() || DEFAULT_QUERY;
  return out;
}

function originalScores(explainScore) {
  const text = explainScore ?? '';
  const num = '([+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)';
  const vector = text.match(new RegExp(`Result Set vector[^:]*: original score ${num}`));
  const keyword = text.match(new RegExp(`Result Set keyword[^:]*: original score ${num}`));
  return {
    similarity: vector ? Number(vector[1]) : null,
    keyword: keyword ? Number(keyword[1]) : null,
  };
}

function snippet(value, max = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

const args = parseArgs(process.argv.slice(2));
const weaviateApiKey = process.env.WEAVIATE_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!weaviateApiKey || !geminiApiKey) {
  console.error('Set WEAVIATE_API_KEY and GEMINI_API_KEY environment variables.');
  process.exit(1);
}

const client = await weaviate.connectToWeaviateCloud(CLUSTER_HOST, {
  authCredentials: new ApiKey(weaviateApiKey),
  headers: { 'X-Goog-Studio-Api-Key': geminiApiKey },
});

try {
  const collection = client.collections.get(COLLECTION);

  const filters = [];
  if (args.grade) filters.push(collection.filter.byProperty('grade').equal(args.grade));
  if (args.sourceDoc) filters.push(collection.filter.byProperty('sourceDoc').equal(args.sourceDoc));
  const filter =
    filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : weaviate.Filters.and(...filters);

  const result = await collection.query.hybrid(args.query, {
    alpha: args.alpha,
    limit: args.limit,
    queryProperties: ['content', 'title'],
    targetVector: NAMED_VECTOR,
    filters: filter,
    returnProperties: [
      'title',
      'content',
      'documentType',
      'sourceDoc',
      'grade',
      'pageStart',
      'ncertPageOffset',
      'chunkIndex',
    ],
    returnMetadata: ['score', 'explainScore'],
  });

  const hits = (result.objects ?? [])
    .map((object) => ({ object, ...originalScores(object.metadata?.explainScore) }))
    .filter(
      (h) => args.minSimilarity == null || (h.similarity != null && h.similarity >= args.minSimilarity),
    );

  console.log(`Query: ${args.query}`);
  if (args.grade) console.log(`Grade: ${args.grade}`);
  if (args.sourceDoc) console.log(`SourceDoc: ${args.sourceDoc}`);
  if (args.minSimilarity != null) console.log(`Min similarity: ${args.minSimilarity}`);
  console.log(`Results: ${hits.length}`);

  hits.forEach((hit, i) => {
    const p = hit.object.properties ?? {};
    const relative = hit.object.metadata?.score;
    console.log(`\n#${i + 1}`);
    if (relative != null) console.log(`relative: ${relative}`);
    if (hit.similarity != null) console.log(`similarity: ${hit.similarity}`);
    if (hit.keyword != null) console.log(`keyword: ${hit.keyword}`);
    console.log(`title: ${p.title ?? ''}`);
    console.log(`sourceDoc: ${p.sourceDoc ?? ''}`);
    console.log(`grade: ${p.grade ?? ''}`);
    console.log(`pageStart: ${p.pageStart ?? ''}`);
    console.log(`ncertPageOffset: ${p.ncertPageOffset ?? ''}`);
    console.log(`snippet: ${snippet(p.content)}`);
  });
} finally {
  await client.close();
}
