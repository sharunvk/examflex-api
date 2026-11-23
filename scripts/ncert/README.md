# NCERT / Weaviate maintenance scripts

One-off tools for the `Ncert` Weaviate collection. All read `WEAVIATE_HOST` and
`WEAVIATE_API_KEY` from the environment (the same values as in `.env`) and need Node 18+.
Each script documents its options in the comment at the top of the file.

| Script | What it does |
|---|---|
| `set-ncert-page-offset.js` | Set `ncertPageOffset` (and optionally `grade`) on every chunk of one `sourceDoc`. |
| `bulk-set-ncert-page-offset.js` | Same, for a list of `{ sourceDoc, offset, grade }` entries (see `offsets.json`). |
| `migrate-ncert-image-urls.js` | Rewrite the `images` URLs to the CDN host, keeping `<CHAPTER>/<file>`. Safe to re-run. |
| `search-ncert.mjs` | Hybrid search against the collection from the command line. |

Always run with `--dry-run` first. Writes reuse each object's existing vector, so nothing is re-embedded.

`offsets.json` holds the list the bulk script reads, in the form
`{ "sourceDoc": "LAWS_OF_MOTION.pdf", "offset": 40, "grade": "XI" }`.
