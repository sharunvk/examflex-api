#!/usr/bin/env node
/**
 * Bulk version of set-ncert-page-offset.js.
 * Sets (or increments) the int field `ncertPageOffset` for many sourceDocs in one run.
 *
 * Input is an array of { "sourceDoc": "<exact text>", "offset": <int> }, e.g. offsets.json:
 *   [
 *     { "sourceDoc": "TRIGONOMETRIC_FUNCTIONS.pdf", "offset": 12, "grade": "XI" },
 *     { "sourceDoc": "LAWS_OF_MOTION.pdf",          "offset": 40 }
 *   ]
 * "grade" is optional text written to the `grade` field; entries without it leave grade untouched.
 * (A plain object map { "TRIGONOMETRIC_FUNCTIONS.pdf": 12, ... } is also accepted.)
 *
 * Usage:
 *   WEAVIATE_HOST=<rest-host> WEAVIATE_API_KEY=<key> \
 *     node scripts/ncert/bulk-set-ncert-page-offset.js --file scripts/ncert/offsets.json [--dry-run]
 *   node scripts/ncert/bulk-set-ncert-page-offset.js --json '[{"sourceDoc":"A.pdf","offset":3}]'
 *
 * Options:
 *   --file <path>        JSON file with the array/map above
 *   --json <string>      same, inline
 *   --increment          add offset to the existing value (missing = 0) instead of overwriting
 *   --collection <name>  default: Ncert
 *   --dry-run            report per-sourceDoc match counts, write nothing
 *
 * Env: WEAVIATE_HOST (no https://), WEAVIATE_API_KEY. Requires Node 18+, no dependencies.
 *
 * The collection is scanned once (not once per sourceDoc), matching is exact, and objects
 * are rewritten with their existing vectors (no re-embedding, no embedding key needed).
 * Default is SET, so re-running is idempotent. sourceDocs that match nothing are reported
 * at the end (usually a typo) and make the script exit with code 3.
 */

const fs = require('fs');

const PAGE = 100;
const FIELD = 'ncertPageOffset';

function parseArgs(argv) {
  const out = { collection: 'Ncert', dryRun: false, increment: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--collection') out.collection = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--increment') out.increment = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

function loadEntries(args) {
  if (!args.file && !args.json) {
    console.error('Provide --file <path> or --json <string>.');
    process.exit(1);
  }
  let raw;
  try {
    raw = JSON.parse(args.file ? fs.readFileSync(args.file, 'utf8') : args.json);
  } catch (e) {
    console.error(`Could not parse input JSON: ${e.message}`);
    process.exit(1);
  }
  const list = Array.isArray(raw)
    ? raw
    : Object.entries(raw).map(([sourceDoc, offset]) => ({ sourceDoc, offset }));

  const map = new Map();
  list.forEach((e, i) => {
    if (!e || typeof e.sourceDoc !== 'string' || !e.sourceDoc) {
      console.error(`Entry ${i}: "sourceDoc" must be a non-empty string.`);
      process.exit(1);
    }
    if (!Number.isInteger(e.offset)) {
      console.error(`Entry ${i} (${e.sourceDoc}): "offset" must be an integer, got ${JSON.stringify(e.offset)}.`);
      process.exit(1);
    }
    if (e.grade !== undefined && (typeof e.grade !== 'string' || !e.grade.trim())) {
      console.error(`Entry ${i} (${e.sourceDoc}): "grade" must be a non-empty string if given.`);
      process.exit(1);
    }
    const prev = map.get(e.sourceDoc);
    if (prev && (prev.offset !== e.offset || prev.grade !== e.grade)) {
      console.error(`Duplicate sourceDoc with conflicting offset/grade: ${e.sourceDoc}`);
      process.exit(1);
    }
    map.set(e.sourceDoc, { offset: e.offset, grade: e.grade });
  });
  if (map.size === 0) {
    console.error('No entries in input.');
    process.exit(1);
  }
  return map;
}

const args = parseArgs(process.argv.slice(2));
const host = (process.env.WEAVIATE_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const apiKey = process.env.WEAVIATE_API_KEY;
if (!host || !apiKey) {
  console.error('Set WEAVIATE_HOST and WEAVIATE_API_KEY environment variables.');
  process.exit(1);
}
const offsets = loadEntries(args);
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

async function ensureProperty() {
  const schema = await api('GET', `/v1/schema/${args.collection}`);
  const existing = new Set((schema.properties || []).map((p) => p.name));
  const wanted = [{ name: FIELD, dataType: ['int'], indexFilterable: true }];
  if ([...offsets.values()].some((v) => v.grade !== undefined)) {
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
  console.log(
    `${args.dryRun ? '[dry-run] ' : ''}${args.collection}: ${FIELD} ${args.increment ? '+=' : '='} <offset> ` +
      `for ${offsets.size} sourceDoc(s)`
  );
  await ensureProperty();

  const perDoc = new Map([...offsets.keys()].map((k) => [k, { matched: 0, updated: 0, failed: 0 }]));
  let after = null;
  let scanned = 0;

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
      const doc = props.sourceDoc;
      if (!offsets.has(doc)) continue;
      perDoc.get(doc).matched++;
      const { offset, grade } = offsets.get(doc);
      const current = Number.isInteger(props[FIELD]) ? props[FIELD] : 0;
      batch.push({
        class: args.collection,
        id: o.id,
        properties: {
          ...props,
          [FIELD]: args.increment ? current + offset : offset,
          ...(grade !== undefined ? { grade } : {}),
        },
        vectors: o.vectors || {},
      });
    }

    if (batch.length && !args.dryRun) {
      const res = await api('POST', '/v1/batch/objects', { objects: batch });
      res.forEach((r, i) => {
        const stat = perDoc.get(batch[i].properties.sourceDoc);
        if (r.result && r.result.errors) {
          stat.failed++;
          console.error(`\n  FAILED ${r.id}: ${JSON.stringify(r.result.errors).slice(0, 300)}`);
        } else {
          stat.updated++;
        }
      });
    }
    process.stdout.write(`\rscanned ${scanned}`);
    if (objects.length < PAGE) break;
  }

  console.log(`\n\nResults (scanned ${scanned} objects):`);
  let totalMatched = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  const unmatched = [];
  for (const [doc, s] of perDoc) {
    totalMatched += s.matched;
    totalUpdated += s.updated;
    totalFailed += s.failed;
    if (s.matched === 0) unmatched.push(doc);
    console.log(
      `  ${doc}  offset=${offsets.get(doc).offset}${offsets.get(doc).grade !== undefined ? ` grade=${offsets.get(doc).grade}` : ''}  matched=${s.matched} updated=${s.updated} failed=${s.failed}`
    );
  }
  console.log(
    `\nTotal: matched=${totalMatched} updated=${totalUpdated} failed=${totalFailed}` +
      (args.dryRun ? ' (dry-run, nothing written)' : '')
  );
  if (unmatched.length) {
    console.error(`\nWARNING: ${unmatched.length} sourceDoc(s) matched no documents (check spelling):`);
    unmatched.forEach((d) => console.error(`  - ${d}`));
  }
  if (totalFailed) process.exit(2);
  if (unmatched.length) process.exit(3);
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
