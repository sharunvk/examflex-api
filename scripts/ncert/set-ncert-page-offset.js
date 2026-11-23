#!/usr/bin/env node
/**
 * Set (or increment) the int field `ncertPageOffset` on every document in a
 * Weaviate collection whose `sourceDoc` matches the given text.
 *
 * Usage:
 *   WEAVIATE_HOST=<rest-host> WEAVIATE_API_KEY=<key> \
 *     node scripts/ncert/set-ncert-page-offset.js --sourceDoc "TRIGONOMETRIC_FUNCTIONS.pdf" --offset 12 [--dry-run]
 *
 * Options:
 *   --sourceDoc <text>   sourceDoc value to match (exact match)           [required]
 *   --offset <int>       integer to write into ncertPageOffset            [required]
 *   --grade <text>       optional text written into the `grade` field (e.g. XI, XII)
 *   --increment          add --offset to the existing value (missing = 0) instead of overwriting
 *   --contains           match sourceDoc by substring instead of exact match
 *   --collection <name>  collection name (default: Ncert)
 *   --dry-run            only report what would change, write nothing
 *
 * Env:
 *   WEAVIATE_HOST        REST host, e.g. xyz.c0.eu-central-1.aws.weaviate.cloud (no https://)
 *   WEAVIATE_API_KEY     Weaviate API key
 *
 * Requires Node 18+ (built-in fetch). No dependencies.
 *
 * Notes:
 *  - By default the value is SET (idempotent: re-running does not stack offsets).
 *    Use --increment if you really want to add to the existing value.
 *  - Objects are rewritten with their existing vectors, so nothing is re-embedded
 *    and no embedding-provider key is needed.
 */

const PAGE = 100;
const FIELD = 'ncertPageOffset';

function parseArgs(argv) {
  const out = { collection: 'Ncert', dryRun: false, increment: false, contains: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sourceDoc') out.sourceDoc = argv[++i];
    else if (a === '--offset') out.offset = argv[++i];
    else if (a === '--grade') out.grade = argv[++i];
    else if (a === '--collection') out.collection = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--increment') out.increment = true;
    else if (a === '--contains') out.contains = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const host = (process.env.WEAVIATE_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const apiKey = process.env.WEAVIATE_API_KEY;

if (!host || !apiKey) {
  console.error('Set WEAVIATE_HOST and WEAVIATE_API_KEY environment variables.');
  process.exit(1);
}
if (!args.sourceDoc) {
  console.error('--sourceDoc <text> is required.');
  process.exit(1);
}
if (args.offset === undefined || !/^-?\d+$/.test(String(args.offset))) {
  console.error('--offset <int> is required and must be an integer.');
  process.exit(1);
}
const offset = parseInt(args.offset, 10);
const base = `https://${host}`;

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function matches(doc) {
  if (typeof doc !== 'string') return false;
  return args.contains ? doc.includes(args.sourceDoc) : doc === args.sourceDoc;
}

async function ensureProperty() {
  const schema = await api('GET', `/v1/schema/${args.collection}`);
  const existing = new Set((schema.properties || []).map((p) => p.name));
  const wanted = [
    { name: FIELD, dataType: ['int'], indexFilterable: true },
  ];
  if (args.grade !== undefined) {
    wanted.push({
      name: 'grade',
      dataType: ['text'],
      tokenization: 'field',
      indexFilterable: true,
      indexSearchable: true,
      // metadata only: keep it out of the embedding text
      moduleConfig: { 'text2vec-google': { skip: true, vectorizePropertyName: false } },
    });
  }
  for (const prop of wanted) {
    if (existing.has(prop.name)) continue;
    if (args.dryRun) {
      console.log(`[dry-run] would add ${prop.dataType[0]} property "${prop.name}" to ${args.collection}`);
      continue;
    }
    await api('POST', `/v1/schema/${args.collection}/properties`, prop);
    console.log(`Added ${prop.dataType[0]} property "${prop.name}" to ${args.collection}`);
  }
}

async function main() {
  if (args.grade !== undefined && !args.grade.trim()) {
    console.error('--grade must be non-empty text.');
    process.exit(1);
  }
  console.log(
    `${args.dryRun ? '[dry-run] ' : ''}${args.collection}: ${FIELD} ${args.increment ? '+=' : '='} ${offset} ` +
      (args.grade !== undefined ? `, grade = "${args.grade}" ` : '') +
      `where sourceDoc ${args.contains ? 'contains' : '=='} "${args.sourceDoc}"`
  );
  await ensureProperty();

  let after = null;
  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let failed = 0;

  for (;;) {
    let path = `/v1/objects?class=${encodeURIComponent(args.collection)}&limit=${PAGE}&include=${args.dryRun ? '' : 'vector'}`;
    if (after) path += `&after=${after}`;
    const { objects = [] } = await api('GET', path);
    if (objects.length === 0) break;
    scanned += objects.length;
    after = objects[objects.length - 1].id;

    const batch = [];
    for (const o of objects) {
      const props = o.properties || {};
      if (!matches(props.sourceDoc)) continue;
      matched++;
      const current = Number.isInteger(props[FIELD]) ? props[FIELD] : 0;
      batch.push({
        class: args.collection,
        id: o.id,
        properties: {
          ...props,
          [FIELD]: args.increment ? current + offset : offset,
          ...(args.grade !== undefined ? { grade: args.grade } : {}),
        },
        vectors: o.vectors || {},
      });
    }

    if (batch.length && !args.dryRun) {
      const res = await api('POST', '/v1/batch/objects', { objects: batch });
      for (const r of res) {
        const errs = r.result && r.result.errors;
        if (errs) {
          failed++;
          console.error(`  FAILED ${r.id}: ${JSON.stringify(errs).slice(0, 300)}`);
        } else {
          updated++;
        }
      }
    }
    process.stdout.write(`\rscanned ${scanned}, matched ${matched}, updated ${updated}, failed ${failed}`);
    if (objects.length < PAGE) break;
  }

  console.log(`\nDone. scanned=${scanned} matched=${matched} updated=${updated} failed=${failed}${args.dryRun ? ' (dry-run, nothing written)' : ''}`);
  if (failed) process.exit(2);
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
