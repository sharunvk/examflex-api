# ExamFlex API

NestJS backend for ExamFlex. CORS, branding, and commerce settings come from environment variables and `instance-config`. Do not commit `.env`.

Routes live under `/api/v1`. Interactive docs: `/api/docs`. Health: `GET /api/v1/health`.

## Stack

- **NestJS** 11 + **TypeScript**
- **MongoDB** via Mongoose
- **JWT** auth (students + admins); httpOnly refresh cookies for web
- **Redis** + **BullMQ** for durable import queues (optional; falls back to in-process)
- **Razorpay** for checkout (optional; local can use `fake`)
- **AWS S3** for question images and GST invoice PDFs
- **Mathpix** + **DeepSeek** for paper import
- **Jest** for unit/e2e tests (coverage gate **80%**)

Node **`24.16.0`** (`engines` in `package.json`).

## What the API covers

| Area | Notes |
|---|---|
| Auth | OTP (MSG91), Google authorization-code exchange, admin password login |
| Catalog | Categories, exam groups, exams, subjects, topics, tags |
| Content | Question bank, imports, current affairs, search |
| Tests | Topic-wise mocks, full-mock drafts, sprint tests, attempts, analytics |
| Commerce | Products, offers, entitlements, checkout, orders, refunds, GST invoices, accounting |
| Admin | Users, dashboard, feedback, commerce health, instance config |

Request/response shapes are in Swagger. Deeper docs live under [`docs/`](docs/).

## Prerequisites

- Node.js **24.16.0**
- MongoDB reachable at `MONGODB_URI`
- Optional: Redis (`REDIS_URL`) for BullMQ import workers
- Optional: Razorpay keys when `PAYMENT_PROVIDER=razorpay` and `COMMERCE_ENABLED=true`

## Local setup

1. **Clone and install**

   ```bash
   git clone git@github.com:sharunvk/examflex-api.git
   cd examflex-api
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Fill values before starting. Nest reads `.env` once at startup — restart after changes. If a key appears twice, the **last** value wins; an empty duplicate can wipe a real value.

   | Variable | Purpose |
   |---|---|
   | `MONGODB_URI` | Database connection |
   | `INSTANCE_ID`, `INSTANCE_NAME` | App identity (`examflex` / `ExamFlex`) |
   | `CORS_ORIGINS` | Comma-separated browser origins. Required in production. Local apps often use `http://localhost:3001` (student) and `http://localhost:3002` (admin) |
   | `PORT` | Default `3000` |
   | `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | Session tokens (default expiry `7d`). Must match admin console `JWT_SECRET` |
   | `AUTH_COOKIE_DOMAIN` | Optional refresh-cookie Domain for production same-site web (e.g. `.examflex.in`) |
   | `MSG91_AUTH_KEY` | Mobile OTP verification |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Web OAuth; secret stays server-side only |
   | `GOOGLE_CLIENT_IDS` | Optional extra audiences (Android, iOS), comma-separated |
   | `GOOGLE_REDIRECT_URIS` | Exact redirect URIs allowed for the code exchange |
   | `ACCESS_ENFORCEMENT_MODE` | `LEGACY` (local default) or `ENFORCED` for entitlement gates |
   | `COMMERCE_ENABLED` | Exact `true` turns on checkout / verify / my orders / invoices / Razorpay webhook |
   | `PAYMENT_PROVIDER` | `fake` (local only) or `razorpay` |
   | `RAZORPAY_*` | Key id, secret, webhook secret — never put these in admin or `NEXT_PUBLIC_*` |
   | `AWS_*` | S3 buckets for images and invoice PDFs |
   | `MATHPIX_*`, `DEEPSEEK_*` | Paper import |
   | `REDIS_URL` | Optional. Blank disables Redis. Use Upstash `rediss://...` when set |
   | `IMPORT_QUEUE_DRIVER` | `memory` or `bullmq` (defaults to bullmq when Redis is set) |
   | `OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET` | Optional NestJS Observe tracing |

   Full commented list: [`.env.example`](.env.example). Runtime ops overrides can also live on `PUT /api/v1/instance-config` (admin JWT).

3. **Run**

   ```bash
   npm run start:dev
   ```

   API: [http://localhost:3000](http://localhost:3000) · Swagger: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)

## Authentication

Students get the same JWT from either sign-in method.

- `POST /api/v1/auth/verify-otp` — MSG91 access token from the phone widget. New numbers create an account.
- `POST /api/v1/auth/google` — one-time authorization code, redirect URI, and PKCE verifier. The API exchanges the code with Google using the client secret, then checks the ID token (signature, audience, issuer, expiry, verified email). A token sent by the browser is not trusted. The redirect URI must match `GOOGLE_REDIRECT_URIS` exactly, including a trailing slash.
- `POST /api/v1/auth/admin/login` — admin username and password. Admins cannot use OTP or Google.

Google accounts match by stable Google subject first, then by email. See **Account linking** below before relying on that email match.

First admin: `POST /api/v1/auth/admins` when none exists; after that, only an admin JWT can create another.

On production, omit localhost from `GOOGLE_REDIRECT_URIS` and `CORS_ORIGINS`.

More detail: [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md), [`docs/STUDENT_SESSION_AUTH.md`](docs/STUDENT_SESSION_AUTH.md).

## Scripts

| Command | Description |
|---|---|
| `npm run start:dev` | Nest watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | `node dist/main` |
| `npm test` / `npm run test:unit` | Unit tests |
| `npm run test:e2e` | E2E tests |
| `npm run test:cov` | Coverage (80% minimum) |
| `npm run test:all` | Unit + e2e |
| `npm run smoke` | `scripts/smoke-api.sh` |
| `npm run commerce:seed-tax-config` | Seed GST tax config |

## Deploy

Set `MONGODB_URI`, `JWT_SECRET`, `CORS_ORIGINS`, `INSTANCE_ID=examflex`, `INSTANCE_NAME=ExamFlex`, and the Google / MSG91 / AWS values for the host. For paid checkout, set `COMMERCE_ENABLED=true`, `PAYMENT_PROVIDER=razorpay`, Razorpay secrets, and prefer `ACCESS_ENFORCEMENT_MODE=ENFORCED`.

```bash
npm run build
npm run start:prod
```

PM2 config: [`ecosystem.config.js`](ecosystem.config.js). Deploy helpers: [`scripts/deploy.sh`](scripts/deploy.sh), [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

Commerce go-live checklist: [`docs/payment-gateway/GO_LIVE_GUIDE.md`](docs/payment-gateway/GO_LIVE_GUIDE.md).

## Account linking

If an OTP account’s email was typed on the profile and never verified, a later Google sign-in with that same address joins the existing account. Do not treat that as proof the phone account owns the Gmail address.

## Related clients

- **examflex-admin** — staff console (default local port **3002**); proxies to this API and shares `JWT_SECRET`
- Student app — typically local port **3001**; must appear in `CORS_ORIGINS` and `GOOGLE_REDIRECT_URIS`

## Docs index

| Doc | Topic |
|---|---|
| [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md) | Auth flows |
| [`docs/MOCK-TEST-CREATION.md`](docs/MOCK-TEST-CREATION.md) | Topic-wise mocks |
| [`docs/FULL-MOCK-TESTS.md`](docs/FULL-MOCK-TESTS.md) | Full mock drafts |
| [`docs/MOCK-TEST-ATTEMPTS.md`](docs/MOCK-TEST-ATTEMPTS.md) | Attempt lifecycle |
| [`docs/QUEUE_IMPLEMENTATION.md`](docs/QUEUE_IMPLEMENTATION.md) | Import queue |
| [`docs/REDIS.md`](docs/REDIS.md) | Redis usage |
| [`docs/PAYMENT_GATEWAY.md`](docs/PAYMENT_GATEWAY.md) | Commerce overview |
| [`docs/payment-gateway/`](docs/payment-gateway/) | Phased commerce design + go-live |
