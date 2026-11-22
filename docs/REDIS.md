# Redis and import queues

This document describes how this API uses Redis today: configuration, key isolation, BullMQ import queues, failure recovery, and the files that implement them. Sessions and cache are not stored in Redis yet. The key builder is ready for them. The only live Redis workload is PDF parse and question enrichment.

MongoDB remains the source of truth for uploads, users, and questions. Redis holds queue state. If Redis is empty, the product data is still in MongoDB and S3.

---

## Turn it on

Leave `REDIS_URL` empty and Redis is off: health reports `disabled`, and parse/enrich run in this process.

Set `REDIS_URL` and Redis is available for health and for any later feature that uses `RedisKeyBuilder`. The import queue is a separate choice:

```env
INSTANCE_ID=ezprep
REDIS_URL=rediss://default:TOKEN@ENDPOINT:6379

# memory = original in-process uploads. Redis stays available for other features.
# bullmq = durable import queue. Omit this line and a configured REDIS_URL uses bullmq.
IMPORT_QUEUE_DRIVER=memory
```

`rediss://` (two s) turns on TLS. Upstash rejects a plain `redis://` URL. Put the Redis URL in `REDIS_URL`, not the `redis-cli` command and not the REST URL.

`INSTANCE_ID` is the namespace. EZ Prep and ExamFlex can share one Redis database only if their `INSTANCE_ID` values differ. Separate Upstash databases with different `REDIS_URL` values are isolated even when the ids match. Both are supported. Nothing else is hardcoded.

The setting is read at process start. `IMPORT_QUEUE_DRIVER=memory` returns uploads to the in-process path without clearing `REDIS_URL`. A restart is required. Jobs already sitting in Redis are not picked up by the in-process path.

On a droplet, add `REDIS_URL` to the server `.env` and restart PM2. Nest reads that file itself. No Redis process is installed on the machine.

---

## Architecture

```text
POST /imports/parse-pdf/:id
POST /imports/enrich/:id
        |
        |  status saved on the upload
        v
BullImportJobPublisher
        |
        |  Queue.add  (returns immediately)
        v
Redis  {instance}:bull
        |
        |  non-blocking read every 60s
        |  and once, in the background, after enqueue
        v
ImportQueueWorker
        |
        v
ImportService.runParsePdfInBackground
ImportService.runEnrichUploadInBackground
        |
        v
MongoDB upload status + S3
```

The HTTP handler returns `202 Accepted` as soon as Redis has accepted the job. It does not wait for Mathpix or DeepSeek. That split is intentional: `BullImportJobPublisher.enqueue` stores the job and starts the poller without awaiting it.

Two logical queues exist:

| Logical name | Redis queue name | Work |
| --- | --- | --- |
| `import-parse` | `{INSTANCE_ID}-import-parse` | Mathpix PDF to markdown |
| `import-enrich` | `{INSTANCE_ID}-import-enrich` | Parse markdown, chunk, DeepSeek |

BullMQ forbids `:` inside a queue name, so the instance is joined with a hyphen. Isolation of the keys still uses a Redis hash tag in the BullMQ prefix: `{ezprep}:bull`. An ExamFlex process uses `{examflex}:bull` and cannot consume EZ Prep jobs.

A finished job is removed from the active set immediately. A completed record is kept for up to 1 day (at most 1,000 records). A failed record is kept for up to 7 days (at most 5,000). BullMQ applies those limits when a later job finishes. The PDF and the enriched questions are not in Redis. They stay in S3 and MongoDB.

---

## Why the worker does not block on Redis

A normal BullMQ `Worker` waits on Redis with a blocking command. Upstash answers that wait immediately, so the worker calls Redis again in a tight loop and spends the command allowance while the queue is empty.

This app does not call `worker.run()`. It creates a worker with `autorun: false` and, every 60 seconds, does two non-blocking commands per queue:

1. `moveStalledJobsToWait()` — move a job whose worker died back to the wait list.
2. `getNextJob(token, { block: false })` — take up to `IMPORT_PARSE_CONCURRENCY` or `IMPORT_ENRICH_CONCURRENCY` waiting jobs (default 2), one after another.

A job that was just queued is also fetched immediately, on a background task, so the admin does not wait for the next check. The HTTP response has already been sent.

There is no repeating Redis poll while the queues are idle. The chart of `EVALSHA`, `ZPOPMIN`, `RPOPLPUSH`, and `ZRANGE` was that idle poll: each "one script" is metered by Upstash as many commands, and two queues every 60 seconds was enough to spend tens of thousands of commands a day with zero uploads.

After a poll that actually moved a stalled job or finished an upload, one follow-up check is scheduled `IMPORT_QUEUE_POLL_INTERVAL_MS` later (default 60 seconds) so a delayed retry can run. If that follow-up finds nothing, it does not schedule another. Idle time after that costs zero Redis commands.

---

## BullMQ implementation

This section is the contract for the queue. Change it only with the command budget in mind. Parse and enrich are admin work. Waiting an extra minute is acceptable. A blocking worker loop is not.

### Strategy

We use BullMQ as a durable job store, not as a long-running consumer.

| Standard BullMQ | What this app does |
| --- | --- |
| `new Worker(name, processor)` starts `run()` and blocks on Redis until a job appears | `new Worker(name, null, { autorun: false })`. `run()` is never called |
| The processor is passed to the `Worker` constructor | `processImportJob` is called by `ImportQueueWorker.finishJob` after a manual fetch |
| `BZPOPMIN` / blocking `waitForJob` | `getNextJob(token, { block: false })`, which is one `moveToActive` script |
| Stalled-job timer inside the running worker | `moveStalledJobsToWait()` once per poll, from our own timer |
| Job finishes inside the worker loop, which then immediately fetches the next job | `moveToCompleted` / `moveToFailed` with `fetchNext: false`, so completion does not pull another job as a side effect |
| Queue events (`QueueEvents`) for progress | Not used. The upload document in MongoDB is the status the client polls |

`defaultManualWorkerFactory` in `src/queues/import-queue.worker.ts` is the only place that constructs a BullMQ `Worker`. Options passed in are merged with `autorun: false` again so a caller cannot turn the loop back on by accident. The processor argument is `null`.

`ImportQueueWorker` keeps one `ManualWorker` per logical queue for the life of the process. They are created on the first poll, not at import time. One producer Redis connection is shared by both, because neither of them blocks. Creating a new `Worker` on every poll would reload BullMQ's Lua scripts each time and spend a large burst of commands.

### When a poll runs

Redis is not read on a timer while the queues are empty. A poll runs only when there is a reason:

1. Process start (`onModuleInit`), once, after the Mongo stale-upload recovery pass. This picks up a job that was queued before a restart. If both queues are empty, nothing else is scheduled.
2. `ensureStarted()`, invoked in the background by `BullImportJobPublisher` immediately after `Queue.add`. The HTTP handler has already been given the job id.
3. One follow-up, `IMPORT_QUEUE_POLL_INTERVAL_MS` after a poll that recovered a stalled job or finished an upload. That follow-up exists so a delayed retry can run. If it finds nothing, the chain stops.

There is no `setInterval` for Redis. `scheduleFollowUp` stores a single `setTimeout` and will not stack another one. If `poll()` is already running when another enqueue arrives, it sets `pollAgain` and runs one extra pass when the current pass finishes. It does not start a second overlapping poll.

Each pass walks parse, then enrich. For each queue:

1. `moveStalledJobsToWait()`.
2. Up to `concurrency` calls to `getNextJob`. The first empty result stops that queue for this pass.
3. Each job is processed to completion before the next `getNextJob` for that queue. Concurrency here is "how many jobs one poll may start", not parallel Mathpix or DeepSeek calls inside the poller. The enrich path still has its own chunk concurrency inside `ImportService`.

A poll that fails to reach Redis is logged and skipped. The next interval tries again. The API process stays up.

### Job id and job name

`jobIdFor` builds a custom BullMQ id:

```text
import-parse-<uploadId>-<uuid>
import-enrich-<uploadId>-<uuid>
```

BullMQ custom ids must not contain `:`. The uuid allows the same upload to be queued again after an earlier job finished. Deduping "already running" is the Mongo status (`parsing` / `processing`), not the job id.

The BullMQ job name is the logical queue name (`import-parse` or `import-enrich`). `processImportJob` switches on that name. The queue that holds the job is `queueName(keyPrefix, logicalName)`, for example `ezprep-import-parse`.

### Payload limits

Zod schemas in `src/queues/import-job.payload.ts` are strict. Unknown fields are rejected. The PDF and the markdown never enter Redis.

Parse job:

| Field | Rule |
| --- | --- |
| `uploadId` | 24 hex characters (Mongo ObjectId) |
| `maxPollingAttempts` | optional integer, 1–120 |
| `pollingIntervalMs` | optional integer, 1000–30000 |

Enrich job:

| Field | Rule |
| --- | --- |
| `uploadId` | 24 hex characters |
| `forceReparse` | optional boolean |
| `adaptiveChunking` | optional boolean |
| `useParallel` | optional boolean |
| `maxRetries` | optional integer, 1–5 (per LLM chunk, not BullMQ attempts) |
| `maxConcurrentChunks` | optional integer, 1–5 |

`toParseJobPayload` / `toEnrichJobPayload` run before `Queue.add`. A bad payload throws `ZodError`, the publisher throws, and `ImportService` restores the previous upload status and returns `400`. The same schemas are checked again in `processImportJob` before any work runs. A job that somehow arrives invalid throws `UnrecoverableError` and is failed without a retry.

### Default job options

Set once on each `Queue` in `BullImportJobPublisher.queueFor`:

| Option | Value | Effect |
| --- | --- | --- |
| `attempts` | `IMPORT_QUEUE_ATTEMPTS`, default 3 | How many times BullMQ may run the job after failures recorded with `moveToFailed` |
| `backoff.type` | `exponential` | Wait grows after each failed attempt |
| `backoff.delay` | `IMPORT_QUEUE_BACKOFF_MS`, default 5000 | First retry waits about 5 seconds, then 10, then 20 |
| `removeOnComplete.count` | default 1000 | At most this many completed job records |
| `removeOnComplete.age` | default 86400 seconds (1 day) | Completed records older than this are eligible for removal |
| `removeOnFail.count` | default 5000 | At most this many failed job records |
| `removeOnFail.age` | default 604800 seconds (7 days) | Failed records older than this are eligible for removal |
| `prefix` | `{INSTANCE_ID}:bull` | Key namespace. Not the queue name |
| `skipWaitingForReady` | `true` | `Queue.add` fails fast if Redis is down, so the HTTP call returns 503 instead of hanging |

`Queue` instances are cached per queue name. The producer connection is created once and reused. `queue.on('error')` only logs the redacted message.

BullMQ applies `removeOnComplete` / `removeOnFail` when a job finishes, not on a timer. A single completed upload remains until a later completion happens after it is older than `age`, or until the `count` limit drops the oldest. The queue keys (wait list, meta, scripts) stay. That is required so the next upload can enqueue without recreating the queue.

`moveToCompleted('ok', token, false)` and `moveToFailed(error, token, false)` pass `fetchNext: false`. The third argument would otherwise ask BullMQ to pull the next job inside the completion script. The poller fetches the next job itself, so that side effect is turned off.

### Lock, stall, and retry

| Knob | Default | What it limits |
| --- | --- | --- |
| `lockDuration` | 180000 ms (3 minutes) | How long a taken job stays locked to this worker token |
| Lock renewal | every poll interval (60 seconds) | `job.extendLock(token, lockDuration)` while `finishJob` is running. A failed renewal is logged. The job is not aborted |
| `stalledInterval` | same as the poll interval, passed to the Worker options | Used by `moveStalledJobsToWait` as the definition of "this lock is old" |
| `maxStalledCount` | 2 | After this many stall recoveries the job is failed instead of returned to the wait list |
| `skipStalledCheck` | `true` on the Worker | We do not start BullMQ's internal stall loop. Our poll calls `moveStalledJobsToWait` once |
| `attempts` | 3 | Retries after `moveToFailed` for a thrown processing error |
| Backoff | exponential, 5 second base | A failed attempt becomes a delayed job. The next poll that finds it (immediately if `pollAgain`, otherwise within 60 seconds) will not take it until the delay has elapsed |
| `IMPORT_QUEUE_STALE_MS` | 30 minutes | Separate from BullMQ. Mongo recovery will not fail an upload younger than this |
| `IMPORT_QUEUE_RECOVERY_INTERVAL_MS` | 60 seconds | How often Mongo recovery runs. Not a Redis poll |

A crashed process leaves the job `active` until the lock is stale. The next poll's `moveStalledJobsToWait` puts it back to `waiting`, and `getNextJob` runs it again, until `maxStalledCount` is reached. The upload row stays `parsing` or `processing` for that whole time, so the admin still sees an in-progress upload. Mongo recovery only fails the row when the job is no longer live and the row is older than 30 minutes.

Business failures inside `ImportService` (Mathpix error, no questions, validation) usually mark the upload `failed` in MongoDB and resolve the background method. BullMQ then sees a successful `processImportJob` and calls `moveToCompleted`. The upload status in MongoDB is what the client reads. The BullMQ completed record is bookkeeping.

A thrown error (or `UnrecoverableError` from a bad payload) calls `moveToFailed`. If recording the failure also throws, that is logged and the next stall check can pick the job up again.

### Command budget

Per idle hour, after startup has finished and no upload is queued: **zero** Redis commands from BullMQ.

Startup runs one poll. Creating the workers the first time also loads BullMQ's Lua scripts once. That is a burst at process start, then silence.

A poll that finds work costs the stalled check and the fetch, plus one `extendLock` per minute while that upload is actually running. A follow-up poll 60 seconds later costs another stalled check and fetch. If that follow-up is empty, the chain stops.

`IMPORT_QUEUE_DRIVER=memory` does not create a publisher or a worker, so it issues none of these commands. `REDIS_URL` can still be set for health, and later for sessions or analytics.

### What we are not using

- `worker.run()`, `QueueEvents`, sandboxed processors, repeatable jobs, job schedulers, flows, and rate-limit groups.
- A separate worker process. The Nest API process is the worker unless `QUEUE_WORKER_ENABLED=false`.
- Priority, delay-on-add, or LIFO. Jobs run in queue order, except delayed retries.
- Shared job payloads across instances. Prefix and queue name both include the instance namespace.

### Multiple instances

```text
EZ Prep process                          ExamFlex process
INSTANCE_ID=ezprep                       INSTANCE_ID=examflex
prefix {ezprep}:bull                     prefix {examflex}:bull
queue  ezprep-import-parse               queue  examflex-import-parse
queue  ezprep-import-enrich              queue  examflex-import-enrich
```

Same `REDIS_URL` is safe because those names do not overlap. A different `REDIS_URL` per deployment is also safe and is the simpler Upstash setup. `queueName` is the only builder of queue names. `IMPORT_PARSE_QUEUE` and `IMPORT_ENRICH_QUEUE` in `redis.constants.ts` are the only logical names.

---

## Request flow

`ImportService.startParsePdfUpload` and `startEnrichUpload`:

1. Reject the call if the upload is already running, already parsed (for parse), or missing markdown (for enrich).
2. Save `parsing` or `processing` on the upload, and remember the previous status.
3. If `IMPORT_JOB_PUBLISHER` is present, enqueue a validated payload and store `activeJobId` and `activeJobName` on the upload. Return `202` with an optional `jobId`.
4. If enqueue throws, restore the previous status and return `503`. A payload that fails validation returns `400`.
5. If Redis is not configured, the service runs the job in this process and returns `202` with no `jobId`.

The publisher (`BullImportJobPublisher`) is created only when `REDIS_URL` is set. `createImportJobPublisher` returns `null` otherwise. `ImportService` treats a missing publisher as the in-process path.

Payloads are built by `toParseJobPayload` and `toEnrichJobPayload` in `src/queues/import-job.payload.ts`. They keep only the fields the worker needs (`uploadId`, poll intervals, chunk flags). They do not copy the PDF or the markdown into Redis.

`processImportJob` checks the job name and the payload. An invalid payload or an unknown job name throws BullMQ's `UnrecoverableError`, so it is not retried. A thrown processing error is recorded with `job.moveToFailed`, and BullMQ may retry it according to `IMPORT_QUEUE_ATTEMPTS` (default 3, exponential backoff).

---

## Startup, crash, and stale uploads

On startup, when Redis and the worker are enabled:

1. `ImportQueueRecovery.recoverStaleUploads` looks at MongoDB, not at every Redis key.
2. Uploads in `parsing` or `processing` whose `updatedAt` is older than `IMPORT_QUEUE_STALE_MS` (default 30 minutes) are inspected.
3. If the BullMQ job is still `active`, `waiting`, `delayed`, `prioritized`, or `waiting-children`, the upload is left alone.
4. Otherwise the upload is marked `failed` with "PDF parsing interrupted by server restart" or "Enrichment interrupted by server restart". The update is conditional on the current status, so two processes cannot both claim it.
5. The same recovery runs every `IMPORT_QUEUE_RECOVERY_INTERVAL_MS` (default 60 seconds). That timer queries MongoDB. It touches Redis only for uploads that are already stale.

A live job is not failed just because it has been running for a long time. Mathpix and DeepSeek are allowed to run. Only an upload that is stuck and whose queue job is gone is failed.

---

## Key layout

Future session and cache code must use `RedisKeyBuilder`, not string concatenation.

```text
ezprep:session:<sessionId>
ezprep:cache:questions:<id>
ezprep:config:instance
ezprep:ratelimit:<key>
```

`RedisKeyBuilder.key('session', sessionId)` produces the first example when `INSTANCE_ID` is `ezprep`. Segments that contain `:`, `*`, or spaces are rejected so a caller cannot escape the prefix.

BullMQ keys are separate and look like:

```text
{ezprep}:bull:ezprep-import-parse:...
{ezprep}:bull:ezprep-import-enrich:...
```

The `{ezprep}` hash tag keeps every key for that instance on the same Redis Cluster slot. Do not call `FLUSHDB` or `FLUSHALL`. A shared database holds both instances. Delete exact keys, or rely on the job retention settings above.

The ioredis `keyPrefix` option is not used. It would prefix BullMQ's Lua keys a second time and break the scripts. Isolation is the BullMQ `prefix` option plus `queueName()`.

---

## Connections

`RedisConnectionRegistry` creates ioredis clients and closes them on shutdown. Clients are lazy (`lazyConnect: true`) and are not opened during boot if Redis is disabled.

| Role | Used for | `maxRetriesPerRequest` | Command timeout |
| --- | --- | --- | --- |
| `command` | Health `PING` | `1` | Yes, `REDIS_COMMAND_TIMEOUT_MS` |
| `producer` | `Queue.add` and the non-blocking poll | `null` | No |

`maxRetriesPerRequest: null` is required by BullMQ. A command timeout is not set on the producer, because a timeout during a queue script aborts the job incorrectly. `enableReadyCheck` is false because Upstash does not need the `INFO` check BullMQ would otherwise send.

Connection URLs are redacted by `redactConnectionSecrets` before they are logged.

Health (`GET /api/v1/health`) adds `redis`: `disabled`, `up`, or `down`. The top-level `status` stays `OK` so a Redis blip does not fail the process check. The probe runs only when something calls health. It is not a polling loop.

---

## Files

### `src/redis`

| File | Role |
| --- | --- |
| `redis.module.ts` | Global Nest module. Builds settings from `ConfigService` and exports the registry, key builder, and health service. |
| `redis.settings.ts` | `resolveRedisSettings` and `readRedisEnv`. Every Redis and queue knob, with bounds. Throws if `REDIS_URL` is set and `INSTANCE_ID` is missing or invalid. |
| `redis.constants.ts` | Injection tokens and the two logical queue names. Do not type queue names anywhere else. |
| `redis-key.builder.ts` | `RedisKeyBuilder.key(...)` for future session, cache, config, and rate-limit keys. |
| `queue-name.ts` | `queueName(namespace, logicalName)` → `ezprep-import-parse`. |
| `redis-connection.options.ts` | `buildRedisOptions(settings, role)`. |
| `redis-connection.registry.ts` | Creates clients, attaches an error handler, quits them on shutdown. |
| `redis-readiness.ts` | `waitUntilReady`. Used before the first queue command and the first poll. Does not stop reconnects after a timeout. |
| `redis-health.service.ts` | `probe()` for the health endpoint. Logs once at startup whether Redis is configured. |
| `redis-log.ts` | `redactConnectionSecrets`, `errorMessage`. |

### `src/queues`

| File | Role |
| --- | --- |
| `import-queue.module.ts` | Wires the publisher. After a job is stored, `setOnEnqueued` calls `ImportQueueWorker.ensureStarted` and does not await the upload. |
| `bull-import-job.publisher.ts` | `BullImportJobPublisher` implements `ImportJobPublisher`. `enqueueParse`, `enqueueEnrich`, `getJobState`, `close`. `createImportJobPublisher` returns `null` when Redis is off. |
| `import-job.payload.ts` | Zod schemas and `toParseJobPayload` / `toEnrichJobPayload`. |
| `import-job.processor.ts` | `processImportJob`. Dispatches by job name into parse or enrich. |
| `import-queue.worker.ts` | `ImportQueueWorker`. The 60 second poll, lock renewal, stalled-job check, and manual completion. |
| `import-queue.recovery.ts` | `ImportQueueRecovery.recoverStaleUploads`. |
| `import-queue.lifecycle.ts` | On shutdown, closes workers before queues. |

### Touched outside those folders

| File | Role |
| --- | --- |
| `src/imports/import.service.ts` | Decides Redis versus in-process, stores `activeJobId` / `activeJobName`, rolls back status if enqueue fails. |
| `src/imports/import.module.ts` | Imports `ImportQueueModule`. |
| `src/imports/schemas/question-upload.schema.ts` | `activeJobId`, `activeJobName`, index on `{ status, updatedAt }` for recovery. |
| `src/app.module.ts` | Imports `RedisModule`. |
| `src/app.controller.ts` | Adds `redis` to `GET /api/v1/health`. |
| `.env.example` | Every Redis and queue variable, with defaults in comments. |

---

## Important functions

| Function | What it does |
| --- | --- |
| `resolveRedisSettings` | Turns environment variables into a typed object. Empty `REDIS_URL` means `enabled: false` and `workerEnabled: false`. |
| `queueName` | Builds the BullMQ queue name. Call sites pass `import-parse` or `import-enrich` from `redis.constants.ts`. |
| `RedisKeyBuilder.key` | Builds a future non-queue key. Not used by the import flow. |
| `createImportJobPublisher` | `null` without Redis, otherwise a `BullImportJobPublisher`. |
| `BullImportJobPublisher.enqueue` | `Queue.add`, then starts the poller in the background. Returns the job id to the HTTP handler. |
| `ImportQueueWorker.poll` | One pass over both queues. If another enqueue arrives mid-poll, one extra pass runs after the current one. |
| `ImportQueueWorker.finishJob` | Runs `processImportJob`, renews the lock every poll interval, then `moveToCompleted` or `moveToFailed`. |
| `processImportJob` | Validates payload and calls `runParsePdfInBackground` or `runEnrichUploadInBackground`. |
| `ImportQueueRecovery.recoverStaleUploads` | Fails Mongo uploads that are stuck and have no live BullMQ job. |
| `RedisHealthService.probe` | `disabled`, `up`, or `down`. |

`resolveImportService` exists so the worker and `ImportService` can be constructed in either order. Nest module imports use `forwardRef` for the same cycle.

---

## Code map

Use this section to inspect a behavior. Each heading is a file. Under it, every function that participates in Redis or BullMQ, and the branch that decides what happens.

Spec files sit next to the source (`*.spec.ts`) unless noted. Nest modules have no spec. They only declare providers.

### `src/redis/redis.constants.ts`

| Symbol | Value | Used by |
| --- | --- | --- |
| `REDIS_SETTINGS` | injection token | Settings object from `resolveRedisSettings` |
| `REDIS_CONNECTION_REGISTRY` | injection token | Declared for the registry. The class itself is injected by type |
| `IMPORT_PARSE_QUEUE` | `import-parse` | Queue name helper, publisher, worker, recovery |
| `IMPORT_ENRICH_QUEUE` | `import-enrich` | Same |
| `IMPORT_JOB_PUBLISHER` | injection token | `ImportService`, recovery, lifecycle |
| `IMPORT_WORKER_FACTORY` | injection token | Tests replace `new Worker`. Production leaves it unset |

### `src/redis/redis.settings.ts`

`resolveRedisSettings(env)` is the only public entry that interprets the environment.

| Branch | Result |
| --- | --- |
| `REDIS_URL` missing or blank | `enabled: false`, `queueDriver: memory`, `workerEnabled: false`, `url: ''` |
| `IMPORT_QUEUE_DRIVER` unset or `auto` | `bullmq` when Redis is on, otherwise `memory` |
| `IMPORT_QUEUE_DRIVER` `memory`, `in-memory`, or `inmemory` | In-process uploads even when `REDIS_URL` is set. Publisher is not created |
| `IMPORT_QUEUE_DRIVER` `bullmq` or `redis` | Durable queue. Throws if `REDIS_URL` is missing |
| Any other driver value | Throws `IMPORT_QUEUE_DRIVER must be memory or bullmq` |
| `QUEUE_WORKER_ENABLED` unset and driver is `bullmq` | `true`, unless `NODE_ENV` is `test` |
| `QUEUE_WORKER_ENABLED` unset and driver is `memory` | `false` |
| `REDIS_URL` set | `assertRedisUrl`. Scheme must be `redis:` or `rediss:`. Host required. The raw URL is never included in the error |
| `INSTANCE_ID` missing while Redis is on | Throws `INSTANCE_ID is required when REDIS_URL is set` |
| `INSTANCE_ID` missing while Redis is off | Namespace `local` |
| `INSTANCE_ID` present | Trimmed and lowercased. Must match `^[a-z0-9][a-z0-9_-]{0,62}$` or startup throws |
| `REDIS_KEY_PREFIX` set | Replaces the namespace used for keys and the hash tag, after the same character check (`assertNamespace`) |
| `REDIS_KEY_PREFIX` unset | `keyPrefix` equals `instanceId` |
| `BULLMQ_PREFIX` set | `assertBullPrefix`. Must contain `{...}` with a non-empty tag |
| `BULLMQ_PREFIX` unset | `{keyPrefix}:bull` |
| `QUEUE_WORKER_ENABLED` set and driver is `bullmq` | `readBool`: `1/true/yes/on` or `0/false/no/off`. Anything else throws |
| Any integer setting empty | That setting's default |
| Integer not digits, or outside min/max | Throws `must be an integer` or `must be between` (`readBoundedInt`) |

`readRedisEnv(config)` copies only keys `ConfigService` actually has. Undefined keys are omitted so empty defaults stay in `resolveRedisSettings`.

### `src/redis/redis-key.builder.ts`

| Function | Branch |
| --- | --- |
| `assertKeySegment` | Trim. Empty or characters outside letters, digits, `.`, `_`, `-` throws. Length 1–201 |
| `RedisKeyBuilder.key` | No parts throws. Each part is checked, then joined as `prefix:part:part` |
| Constructor | Checks `settings.keyPrefix` with `assertKeySegment` |

### `src/redis/queue-name.ts`

`queueName(namespace, logicalName)` checks both segments and returns `namespace-logicalName`. A colon in either segment is rejected by `assertKeySegment`. This is the only function that builds a BullMQ queue name.

### `src/redis/redis-log.ts`

| Function | Branch |
| --- | --- |
| `redactConnectionSecrets` | Replaces `redis://...` and `rediss://...` with `redis://redacted` |
| `errorMessage` | `Error.message` if the value is an `Error`, otherwise `String(value)`, then redact |

### `src/redis/redis-connection.options.ts`

`buildRedisOptions(settings, role)`:

| Role | Branch |
| --- | --- |
| `command` | `maxRetriesPerRequest: 1`, `commandTimeout` set. Used by health |
| `producer` or `worker` | `maxRetriesPerRequest: null`, no command timeout. BullMQ requirement |

Both roles: `enableReadyCheck: false`, `lazyConnect: true`, `connectTimeout`, `keepAlive`, `connectionName` of `instanceId:role`, retry delay `min(attempt * 200, 2000)`. `keyPrefix` is not set.

The `worker` role exists so a future blocking consumer can have its own connection. Today's poller uses the `producer` role because it does not block.

### `src/redis/redis-readiness.ts`

`waitUntilReady(client, timeoutMs)`:

| Branch | Result |
| --- | --- |
| `client.status === 'ready'` | Resolves immediately. `connect()` is not called |
| Status `wait` | Calls `connect()`, then waits for `ready` or `end` |
| Status already `connecting` | Does not call `connect()` again. Waits for `ready` or `end` |
| `ready` event | Resolves |
| `end` event | Rejects `Redis connection closed` |
| Timeout | Rejects `Redis did not become ready in time`. Reconnects keep running |
| `connect()` rejects with an `Error` | That error is rejected |
| `connect()` rejects with a non-Error | Rejects `Redis connect failed` |
| A second event after the attempt settled | Ignored |

### `src/redis/redis-connection.registry.ts`

| Method | Branch |
| --- | --- |
| `create(role)` | Throws `Redis is not configured` when `enabled` is false. Otherwise `new Redis(url, options)`, `error` listener logs a redacted message, client is tracked |
| `onModuleDestroy` | `quit()` on every client. If `quit` throws, log and `disconnect()` |

### `src/redis/redis-health.service.ts`

| Method | Branch |
| --- | --- |
| `onModuleInit` | Disabled: log that jobs stay in-process. Enabled: log instance id, key prefix, and BullMQ prefix. The URL is not logged |
| `probe` | Disabled returns `disabled` and does not open a client. Enabled reuses one `command` client. `PING` of `PONG` returns `up`. Any other reply or any throw returns `down` |

### `src/redis/redis.module.ts`

`useFactory` calls `readRedisEnv` then `resolveRedisSettings`. Exports settings, `RedisConnectionRegistry`, `RedisKeyBuilder`, `RedisHealthService`. The module is global. There is no spec file.

### `src/queues/import-job.payload.ts`

| Function | Branch |
| --- | --- |
| `definedFields` | Drops keys whose value is `undefined` so Zod optional fields are omitted |
| `toEnrichJobPayload` | `enrichJobSchema.parse`. Throws `ZodError` on a bad id or out-of-range flag |
| `toParseJobPayload` | Same for the parse schema |
| `describeSchemaIssues` | Joins Zod issue paths. An issue with an empty path is labeled `payload` |

Schemas are `.strict()`, so extra keys fail.

### `src/queues/import-job.processor.ts`

`processImportJob(job, handlers)`:

| Branch | Result |
| --- | --- |
| `job.name === import-enrich` and payload valid | `handlers.enrich` |
| Enrich payload invalid | `UnrecoverableError` with `describeSchemaIssues`. No retry |
| `job.name === import-parse` and payload valid | `handlers.parse` |
| Parse payload invalid | `UnrecoverableError`. No retry |
| Any other name | `UnrecoverableError` `Unknown import job` |
| Handler throws | The error propagates. The worker then calls `moveToFailed` |

### `src/queues/bull-import-job.publisher.ts`

| Function | Branch |
| --- | --- |
| `createImportJobPublisher` | `enabled === false` returns `null`. Otherwise `new BullImportJobPublisher` |
| `setOnEnqueued` | Stores the listener the module sets to `worker.ensureStarted` |
| `enqueueEnrich` / `enqueueParse` | Builds the payload (may throw `ZodError`), then `enqueue` |
| `enqueue` | `Queue.add` with a custom `jobId`. Missing `job.id` throws. Then `onEnqueued` is started and not awaited. A listener rejection is logged and does not fail the HTTP call |
| `jobIdFor` | `${logicalQueue}-${uploadId}-${uuid}`. No colon |
| `queueFor` | Reuses a `Queue` if that name was already opened. Otherwise waits until the producer is ready, constructs `Queue` with the default job options, and listens for `error` |
| `producerClient` | One Redis client for every queue this process publishes |
| `getJobState` | `queue.getJob`. Missing job returns `null`. Otherwise `job.getState()` |
| `close` | Closes every cached queue. A close error is logged and the others still close |

### `src/queues/import-queue.worker.ts`

| Function | Branch |
| --- | --- |
| `defaultManualWorkerFactory` | `new Worker(name, null, { ...options, autorun: false })` |
| `onModuleInit` | Returns immediately when the driver is `memory` or `workerEnabled` is false. Otherwise runs recovery once, starts the Mongo recovery timer, then one poll. It does not start a Redis interval |
| `scheduleFollowUp` | One `setTimeout` after a poll that did work. A later empty poll does not schedule another |
| `ensureStarted` | Returns when Redis is off, the worker flag is off, or `close()` has run. Otherwise `poll()` |
| `poll` | Returns if closed. If a poll is already running, sets `pollAgain` and returns. Otherwise loops `pollQueue` for parse then enrich. If `pollAgain` was set and the worker is still open, one more pass runs |
| `pollQueue` setup | `workerFor` or `moveStalledJobsToWait` throws: log and skip this queue |
| `pollQueue` fetch | Up to `concurrency` times. `getNextJob` throws: log and stop this queue. No job: stop this queue. A job: `finishJob` with `job.token` or the token we generated |
| `pollQueue` closed mid-fetch | The for-loop stops when `this.closed` is set |
| `finishJob` | Interval calls `extendLock` every `pollIntervalMs`. Extension errors are logged. `processImportJob` success calls `moveToCompleted('ok', token, false)`. A thrown `Error` or a non-Error is passed to `moveToFailed`. If `moveToFailed` throws, that is logged. `clearInterval` always runs |
| `workerFor` | Reuses the worker for that logical name. First time: shared connection, `queueName`, factory, `error` listener, log the interval |
| `sharedConnection` | One producer client. `waitUntilReady` failure is logged. The same client is still returned so the next command can retry |
| `targets` | Parse queue with `parseConcurrency`, then enrich queue with `enrichConcurrency` |
| `recoverSafely` | Logs the recovery counts. A thrown recovery is logged. The poll timer is not stopped |
| `close` | Sets `closed`, clears both timers, closes workers. A worker `close` error is logged |
| `clearTimers` | Each timer is cleared only if it was started |

### `src/queues/import-queue.recovery.ts`

`recoverStaleUploads(now)`:

| Branch | Result |
| --- | --- |
| Redis disabled or publisher is `null` | `{ examined: 0, failed: 0, spared: 0 }` and no Mongo query |
| Query | `status` in `parsing` or `processing`, `updatedAt` older than `staleJobMs`, oldest first, batches of 100, at most 20 batches |
| Spared ids exist | Next batch excludes them with `_id: { $nin }` so a live job cannot make the loop repeat |
| Empty batch | Stop |
| `jobIsLive` true | Count as spared |
| `jobIsLive` false and status `parsing` | Conditional update to `failed` with the parsing-interrupted message. Unset `activeJobId` and `activeJobName` |
| Any other stuck status | Same update with the enrichment-interrupted message |
| `findOneAndUpdate` returns null | Another process already changed the row. `failed` is not incremented |

`jobIsLive`:

| Branch | Result |
| --- | --- |
| No `activeJobId` or no publisher | `false` (the upload will be failed) |
| `activeJobName` set | Check only that queue |
| `activeJobName` missing | Check `import-enrich`, then `import-parse` |
| State is in `LIVE_JOB_STATES` | `true` |
| State missing or not live | Keep looking. If none are live, `false` |
| `getJobState` throws | Log a warning and return `true`, so a Redis blip does not fail a running upload |

`LIVE_JOB_STATES` is `active`, `waiting`, `delayed`, `prioritized`, `waiting-children`.

### `src/queues/import-queue.lifecycle.ts`

`onModuleDestroy` closes the worker first, then `publisher.close()` if a publisher exists. Workers are closed before queues so an in-flight command is not cut off by a closed queue first.

### `src/queues/import-queue.module.ts`

The factory builds the publisher, then `setOnEnqueued(() => worker.ensureStarted())` only when the publisher is a `BullImportJobPublisher`. When Redis is off the factory returns `null` and that call is skipped. `ImportModule` and this module import each other through `forwardRef`. No spec file.

### `src/imports/import.service.ts`

These methods are the queue boundary. The rest of the file is the import pipeline and is unchanged.

`startEnrichUpload` and `startParsePdfUpload` share one handoff:

| Branch | Result |
| --- | --- |
| Invalid id, missing upload, already running, parse-already-done, or enrich without markdown | The existing `400` / `404` / `409` responses. Nothing is queued |
| `this.importJobs` is set | `enqueueUploadJob`, then `202` with `jobId` |
| `this.importJobs` is missing or `null` | In-process `void run...InBackground`, in-memory `activeEnrichJobs` or `activeParseJobs`, `202` without `jobId` |

`enqueueUploadJob`:

| Branch | Result |
| --- | --- |
| `enqueue()` resolves | Save `activeJobId` and `activeJobName` (`import-enrich` or `import-parse`). If that save throws, the job is still accepted and the error is logged. Returns the job id |
| `enqueue()` throws `ZodError` | Restore the snapshot. `400` with the Zod messages joined by `;`. Redis errors are not logged for this case |
| `enqueue()` throws anything else | Log the redacted message, restore the snapshot, `503` with the unavailable message passed by the caller |
| Restore `save()` throws | Logged. The `400` or `503` is still thrown |

`captureUploadJobSnapshot` stores `status`, `errorMessage`, and `parsingStartedAt` before the row is marked in progress. `restoreUploadJobSnapshot` writes those three fields back.

`runEnrichUploadInBackground` and `runParsePdfInBackground` are the methods the poller calls. They are also the in-process path.

| Branch | Result |
| --- | --- |
| `execute...` resolves | Upload status is whatever that method saved (`parsed`, `enriched`, or `failed` for a handled pipeline error) |
| `execute...` throws and the row is still `processing` or `parsing` | Status set to `failed` with the error message |
| The row is no longer in progress when the catch runs | Status is left as-is |
| Loading or saving the failure throws | Logged. The BullMQ job still finishes or fails based on whether this method rethrows. These methods catch and do not rethrow, so BullMQ sees success |

The in-process sets `activeEnrichJobs` / `activeParseJobs` are removed in a `finally` on the background promise. The Redis path does not use those sets. Cross-process exclusion is the Mongo status check at the start of the request.

### `src/imports/schemas/question-upload.schema.ts`

| Field | Branch that writes it |
| --- | --- |
| `activeJobId` | Set after a successful enqueue. Unset when stale recovery marks the upload failed |
| `activeJobName` | `import-enrich` or `import-parse`. Recovery uses it to know which queue to inspect. If it is missing, both queues are checked |
| Index `{ status: 1, updatedAt: 1 }` | Supports the stale-upload query |

### `src/app.controller.ts`

`getHealth` is async. If `RedisHealthService` was not injected, `redis` is `disabled`. Otherwise it is the result of `probe()`.

### Spec files

| Spec | What it locks in |
| --- | --- |
| `src/redis/redis.settings.spec.ts` | Disabled URL, required instance id, two deployments, URL schemes, hash tag, boolean and integer bounds |
| `src/redis/redis-key.builder.spec.ts` | Prefix and rejected segments |
| `src/redis/queue-name.spec.ts` | Hyphenated names, rejected colons |
| `src/redis/redis-log.spec.ts` | URL redaction |
| `src/redis/redis-connection.options.spec.ts` | Command client versus BullMQ client |
| `src/redis/redis-readiness.spec.ts` | Ready, connecting, timeout, close, connect failure |
| `src/redis/redis-connection.registry.spec.ts` | Disabled create, redacted errors, quit failure |
| `src/redis/redis-health.service.spec.ts` | `disabled`, `up`, `down`, client reuse |
| `src/queues/import-job.payload.spec.ts` | Field picking and schema rejection |
| `src/queues/import-job.processor.spec.ts` | Enrich, parse, invalid payload, unknown name, thrown handler |
| `src/queues/bull-import-job.publisher.spec.ts` | Queue options, job id without `:`, worker started after add, enqueue resolves before the worker finishes, enqueue failure still returns the id |
| `src/queues/import-queue.worker.spec.ts` | No poll when disabled, non-blocking fetch, shared connection, failure recording, lock renewal, Redis down, overlapping poll, `autorun: false`, close during a poll |
| `src/queues/import-queue.recovery.spec.ts` | Disabled skip, fail when the job is gone, spare a live job, spare when Redis errors, lost claim, batch cap |
| `src/queues/import-queue.lifecycle.spec.ts` | Workers close before queues |
| `src/imports/import.service.spec.ts` | `queued dispatch`: job id stored, in-process work not started, save-id failure still returns the id, 503 restores status, Zod 400, parse path |

---

## Configuration

Defaults are applied when the variable is unset. Values outside the range prevent the process from starting.

| Variable | Default | Meaning |
| --- | --- | --- |
| `REDIS_URL` | empty | Enables Redis. Must be `redis://` or `rediss://`. |
| `INSTANCE_ID` | `local` if Redis is off; required if Redis is on | Namespace. Lowercased. |
| `REDIS_KEY_PREFIX` | `INSTANCE_ID` | Override for keys and the hash tag. |
| `BULLMQ_PREFIX` | `{PREFIX}:bull` | Must contain a non-empty hash tag, for example `{ezprep}:bull`. |
| `IMPORT_QUEUE_DRIVER` | `bullmq` when `REDIS_URL` is set, otherwise `memory` | `memory` keeps Redis and runs uploads in-process. `bullmq` is the durable queue. |
| `QUEUE_WORKER_ENABLED` | `true` when the driver is `bullmq`, except `NODE_ENV=test` | `false` on API replicas that should only enqueue. Ignored when the driver is `memory`. |
| `IMPORT_QUEUE_POLL_INTERVAL_MS` | `60000` | Delay before the single follow-up check after a job. Not an idle poll. Minimum `15000`. |
| `IMPORT_QUEUE_LOCK_DURATION_MS` | `180000` | How long a running job keeps its lock. |
| `IMPORT_QUEUE_STALE_MS` | `1800000` | How old a `parsing` or `processing` upload must be before recovery will fail it. |
| `IMPORT_QUEUE_RECOVERY_INTERVAL_MS` | `60000` | How often recovery looks at MongoDB. |
| `IMPORT_PARSE_CONCURRENCY` | `2` | Jobs taken from the parse queue in one poll. |
| `IMPORT_ENRICH_CONCURRENCY` | `2` | Jobs taken from the enrich queue in one poll. |
| `IMPORT_QUEUE_ATTEMPTS` | `3` | BullMQ retries after `moveToFailed`. |
| `IMPORT_QUEUE_BACKOFF_MS` | `5000` | Exponential backoff base. |
| `IMPORT_QUEUE_MAX_STALLED_COUNT` | `2` | Times a dead worker's job can be returned to the wait list. |
| `IMPORT_QUEUE_REMOVE_ON_COMPLETE_COUNT` | `1000` | Completed jobs kept. |
| `IMPORT_QUEUE_REMOVE_ON_COMPLETE_AGE_SEC` | `86400` | Completed jobs older than this can be removed. |
| `IMPORT_QUEUE_REMOVE_ON_FAIL_COUNT` | `5000` | Failed jobs kept. |
| `IMPORT_QUEUE_REMOVE_ON_FAIL_AGE_SEC` | `604800` | Failed jobs older than this can be removed. |
| `REDIS_CONNECT_TIMEOUT_MS` | `10000` | How long to wait before the first command is attempted. |
| `REDIS_COMMAND_TIMEOUT_MS` | `5000` | Health client only. |
| `REDIS_HEALTH_TIMEOUT_MS` | `1000` | Health probe budget. |
| `REDIS_KEEP_ALIVE_MS` | `30000` | TCP keep-alive. |

`QUEUE_WORKER_ENABLED=false` on a replica means that process only enqueues. Another process with the worker enabled must be running or jobs will sit in Redis until one starts.

---

## What developers should not do

- Do not construct `new Worker(name, processor)` with the default `autorun`. That starts the blocking loop and will spend the Upstash allowance.
- Do not put `:` in a BullMQ queue name.
- Do not set the ioredis `keyPrefix` option on a BullMQ connection.
- Do not `await` `ensureStarted()` from the HTTP path. `BullImportJobPublisher` starts it in the background on purpose.
- Do not log `REDIS_URL`. Use `errorMessage`.
- Do not add session or cache keys by hand. Use `RedisKeyBuilder`.
- Do not store the PDF, markdown, or enriched question bodies in the job payload.

---

## Tests

Redis and queue code is covered by unit tests under `src/redis` and `src/queues`. Statement, branch, function, and line coverage for those files, excluding Nest modules, is 100 percent. Run:

```bash
npx jest --config jest.config.js --coverage \
  --collectCoverageFrom='src/queues/**/*.ts' \
  --collectCoverageFrom='src/redis/**/*.ts' \
  --collectCoverageFrom='!src/**/*.module.ts' \
  --testPathPatterns='src/queues|src/redis'
```

The HTTP handoff (enqueue versus in-process, status rollback, `202` shape) is covered in `src/imports/import.service.spec.ts` under `queued dispatch`. Publisher tests assert that `enqueue` resolves before the worker finishes, which is what keeps the API on `202`.

Modules (`redis.module.ts`, `import-queue.module.ts`) are excluded from coverage the same way as the rest of the Nest modules in this repo. They only declare providers.

---

## Local check

```bash
curl http://localhost:3000/api/v1/health
```

`"redis": "up"` means the URL connected. `"disabled"` means `REDIS_URL` was empty at startup. `"down"` usually means the scheme is `redis://` instead of `rediss://`, or the read-only Upstash token was used. The normal token is required because the queue writes.

---

## Student sessions

Student (non-admin) auth stores revocable sessions in Redis. Admin JWTs never touch this path.

Full login / refresh / cookie / SPA design: [`STUDENT_SESSION_AUTH.md`](./STUDENT_SESSION_AUTH.md).

### Keys (`RedisKeyBuilder`)

| Key | Purpose | TTL |
| --- | --- | --- |
| `{prefix}:session:{sid}` | Session JSON (`userId`, current refresh hash, last 10 rotated-out hashes, `client`, timestamps) | Idle window, slid on refresh, capped at the absolute lifetime (web 30d/90d, mobile 90d/365d) |
| `{prefix}:user-sessions:{userId}` | SET of `sid`s for future logout-all | Absolute lifetime of the newest session |

The refresh token embeds its `sid` (`<sid>.<secret>`), so there is no separate refresh-token index key. Refresh rotation and activity touches use a Lua compare-and-set (`EVAL`).

### Command budget (same rules as the import worker)

Idle authenticated traffic must not poll Redis on a timer.

Upstash meters a Lua script as the `EVAL` **plus every command inside it**, so the compare-and-set below costs 3 (successful) or 2 (lost race).

| Event | Redis commands (typical) |
| --- | --- |
| Login / session create | Pipeline: `SET` session + `SADD` + `EXPIRE` (3) |
| Access-token validate (cache hit) | **0** — in-process positive `sid` cache (90s) |
| Access-token validate (cache miss) | **1** `GET` |
| Activity touch (at most every ~12 min per sid) | `GET` + CAS `EVAL` (1 + 2 inner) = **4** when due; otherwise 0 |
| Refresh (every ~15 min of use, and every page load on web) | `GET` + CAS `EVAL` = **4** |
| Logout | `GET` + pipeline `DEL` + `SREM` (~3–4) |

Rule of thumb: about **70 commands per hour of continuous use per session**, and about 4 per page load. At the free tier's 500K commands/month that is roughly 200 users studying an hour a day, before any other Redis use (health probes, accounting cache, import queue).

### Web refresh cookie vs mobile body

| Client | Access JWT | Refresh delivery |
| --- | --- | --- |
| **Web** (`client=web`) | **15m** in SPA memory; JSON omits `refreshToken` | HttpOnly `examflex_rt` cookie (`Path=/api/v1/auth`, `SameSite=Lax`, `Secure` in prod). Set `AUTH_COOKIE_DOMAIN=.ezprep.in` in production so `www` → `api` credentialed calls receive it. |
| **Mobile** (`client=mobile`) | **30m**, renewed silently from the refresh token | Opaque `refreshToken` in JSON body; store in Android Keystore-backed storage |
| **Admin** | Unchanged | No Redis session / no refresh cookie |

`POST /auth/refresh` prefers the cookie, else body. Cookie-based refresh/logout enforce Origin/Referer ∈ `CORS_ORIGINS`.

Do **not** add background session sweepers, `SMEMBERS` on the request path, pub/sub, or BullMQ for auth.

Student sessions fail closed: if Redis is unavailable, login/refresh/uncached auth return 503 (no legacy sid-less JWTs, no degraded mode). Failures log `auth.session: Redis unavailable during <op>`.

Mongo remains the source of truth for the user row and throttled `lastActiveAt`. Redis is only the revoke/session glue.
