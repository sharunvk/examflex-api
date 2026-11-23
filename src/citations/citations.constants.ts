/** Named vector on the NCERT collection (text2vec-google / Gemini embeddings). */
export const NCERT_NAMED_VECTOR = 'text2vec_gemini';

/** Citations saved automatically when a question is created. */
export const AUTO_CITATION_COUNT = 2;

/** Results returned when an admin searches for one question. */
export const DEFAULT_SEARCH_LIMIT = 5;

/** Most citations an admin may keep on one question. */
export const MAX_SAVED_CITATIONS = 5;

/** Hybrid weight: 0 = keyword only, 1 = vector only. */
export const HYBRID_ALPHA = 0.6;

/** Concurrent lookups per process, so bulk imports do not flood Gemini. */
export const SEARCH_CONCURRENCY = 3;

/** Weaviate client timeouts, in seconds. */
export const WEAVIATE_TIMEOUT_SECONDS = { init: 15, query: 20, insert: 20 };

/** Only text chunks are cited; image chunks are skipped. */
export const CITABLE_MODALITY = 'text';

/** Longest query text sent to the embedder. */
export const MAX_QUERY_CHARS = 1000;
