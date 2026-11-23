#!/usr/bin/env node
/**
 * Rewrite the hosts of every URL in the `images` array of a Weaviate collection,
 * keeping the "<CHAPTER>/<figure-name>" tail exactly as it is.
 *
 *   https://buddizcentralindia.blob.core.windows.net/academy-.../studymaterial-.../study-materials/images/KINETIC_THEORY/figure-1.jpg
 *   -> https://cdn.clustream.tech/KINETIC_THEORY/figure-1.jpg
 *
 * Usage:
 *   WEAVIATE_HOST=<rest-host> WEAVIATE_API_KEY=<key> \
 *     node scripts/ncert/migrate-ncert-image-urls.js [--dry-run] [--cdn https://cdn.clustream.tech]
 *
 * Options:
 *   --cdn <base-url>     new base URL, no trailing slash (default: https://cdn.clustream.tech)
 *   --collection <name>  collection name (default: Ncert)
 *   --dry-run            report what would change, write nothing
 *
 * Notes:
 *  - Only URLs ending in ".../images/<chapter>/<file>" on the old host are rewritten.
 *    URLs already on the CDN, or in any other shape, are left untouched, so the
 *    script is safe to re-run.
 *  - Objects are rewritten with their existing vectors: nothing is re-embedded.
 *  - Upload the files to the CDN and check they load BEFORE running this for real.
 *
 * Requires Node 18+ (built-in fetch). No dependencies.
 */

const PAGE = 100;
const OLD_URL = /^https:\/\/buddizcentralindia\.blob\.core\.windows\.net\/.+\/images\/([^/]+)\/([^/]+)$/;

function parseArgs(argv) {
  const out = { collection: 'Ncert', cdn: 'https://cdn.clustream.tech', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cdn') out.cdn = argv[++i];
    else if (a === '--collection') out.collection = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  out.cdn = String(out.cdn || '').replace(/\/+$/, '');
  return out;
}

const args = parseArgs(process.argv.slice(2));
const host = (process.env.WEAVIATE_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const apiKey = process.env.WEAVIATE_API_KEY;

if (!host || !apiKey) {
  console.error('Set WEAVIATE_HOST and WEAVIATE_API_KEY environment variables.');
  process.exit(1);
}
if (!/^https:\/\/[^/]+$/.test(args.cdn)) {
  console.error('--cdn must look like https://cdn.example.com');
  process.exit(1);
}
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

/** New URL for an old one, or the input unchanged when it is not an old-host URL. */
function rewrite(url) {
  const m = typeof url === 'string' ? OLD_URL.exec(url) : null;
  return m ? `${args.cdn}/${m[1]}/${m[2]}` : url;
}

async function main() {
  console.log(
    `${args.dryRun ? '[dry-run] ' : ''}${args.collection}: images -> ${args.cdn}/<CHAPTER>/<file>`,
  );

  let after = null;
  let scanned = 0;
  let withImages = 0;
  let urlsChanged = 0;
  let urlsKept = 0;
  let updated = 0;
  let failed = 0;
  const examples = [];

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
      const images = props.images;
      if (!Array.isArray(images) || images.length === 0) continue;
      withImages++;

      const next = images.map(rewrite);
      const changed = next.filter((u, i) => u !== images[i]).length;
      urlsChanged += changed;
      urlsKept += images.length - changed;
      if (changed === 0) continue;
      if (examples.length < 3) examples.push([images[0], next[0]]);

      batch.push({
        class: args.collection,
        id: o.id,
        properties: { ...props, images: next },
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
    } else {
      updated += 0;
    }
    process.stdout.write(
      `\rscanned ${scanned}, with images ${withImages}, urls changed ${urlsChanged}, objects updated ${updated}, failed ${failed}`,
    );
    if (objects.length < PAGE) break;
  }

  console.log(
    `\nDone. scanned=${scanned} withImages=${withImages} urlsChanged=${urlsChanged} urlsUntouched=${urlsKept} objectsUpdated=${updated} failed=${failed}${args.dryRun ? ' (dry-run, nothing written)' : ''}`,
  );
  for (const [from, to] of examples) console.log(`  e.g. ${from}\n    -> ${to}`);
  if (failed) process.exit(2);
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
