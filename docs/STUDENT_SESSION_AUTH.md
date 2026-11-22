# Student session authentication (web + mobile)

This document describes how student (non-admin) login, access tokens, refresh, and logout work after the Redis session + HttpOnly web refresh hardening. Admin username/password auth is out of scope except where noted as unchanged.

Related: Redis key budget and session keys — [`REDIS.md`](./REDIS.md) § Student sessions. Legacy OTP overview (partially outdated on storage) — [`AUTHENTICATION.md`](./AUTHENTICATION.md).

---

## Goals and non-goals

### Goals

- Keep product behaviour the same: OTP, Google, dashboard, attempts, checkout, sliding web “stay signed in”, logout, redirects.
- Shrink XSS blast radius: long-lived refresh secret must not be readable by JavaScript on the web.
- Keep web access JWTs short-lived (15 minutes) with silent refresh.
- Keep mobile JSON refresh contract intact until native SecureStore (Phase 12).
- Keep admin JWT path untouched (no Redis session, no refresh cookie).
- Stay within Upstash Redis free-tier command budget (event-driven only; no idle polling).

### Non-goals

- Next.js BFF / proxy for cookies.
- Putting the **access** JWT in an HttpOnly cookie (Bearer-in-memory keeps the existing axios pattern).
- Mobile SecureStore / shortened mobile access TTL (Phase 12).
- Full XSS audit of every frontend dependency.

---

## Actors and hosts (production)

| Piece | Host (EzPrep) | Role |
| --- | --- | --- |
| Student web (Next.js) | `https://ezprep.in` / `https://www.ezprep.in` | SPA; holds access JWT in **memory** only |
| API (NestJS) | `https://api.ezprep.in` | Issues JWTs, Redis sessions, `Set-Cookie` |
| Redis (Upstash) | managed | Revocable session + hashed refresh index |
| MongoDB | managed | User row; throttled `lastActiveAt` |

Production is **same-site, cross-origin** (`www` → `api` under `.ezprep.in`). CORS uses `credentials: true`. The refresh cookie uses `Domain=.ezprep.in` so credentialed calls from the SPA receive it.

Locally: SPA `http://localhost:3001`, API typically `http://localhost:3000`. Omit `AUTH_COOKIE_DOMAIN` so the cookie is host-only `localhost` (shared across ports).

---

## Token model

| Credential | Lifetime (web) | Lifetime (mobile) | Where it lives | Readable by JS? |
| --- | --- | --- | --- | --- |
| Access JWT | **15m** | **30m** | Authorization Bearer; web = memory | Yes (accepted trade-off; short TTL) |
| Refresh (opaque, `<sid>.<secret>`) | **30d idle, sliding**; hard cap **90d** from login | **90d idle, sliding**; hard cap **365d** from login | Web: HttpOnly cookie `examflex_rt`; mobile: JSON body (store in Android Keystore-backed storage) | Web: **No**; mobile: app storage |
| Middleware marker `authSession=1` | **30d**, rewritten on every refresh (frontend only) | N/A | Cookie on the **web** origin | Yes — non-secret presence flag |
| Admin JWT | Long-lived (admin login) | N/A | Client-chosen | N/A — no Redis `sid` |

Constants: `src/auth/session/session.constants.ts`

- Web: `WEB_ACCESS_TTL_SEC` 15m, `WEB_SESSION_IDLE_TTL_SEC` 30d, `WEB_SESSION_ABSOLUTE_TTL_SEC` 90d  
- Mobile: `MOBILE_ACCESS_TTL_SEC` 30m, `MOBILE_SESSION_IDLE_TTL_SEC` 90d, `MOBILE_SESSION_ABSOLUTE_TTL_SEC` 365d  
- `REFRESH_GRACE_MS` 60s, `MAX_PREVIOUS_REFRESH_HASHES` 10

Access JWT claims (student): `sub`, `role`, optional `phoneNumber`, **`sid`** (Redis session id). Admin tokens have no `sid`.

---

## Architecture overview

```mermaid
sequenceDiagram
  participant Browser
  participant Next as NextWww
  participant API as ApiEzprep
  participant Redis
  participant Mongo

  Browser->>API: login client=web (OTP or Google) credentials include
  API->>Mongo: resolve / create user
  API->>Redis: create session (sid + refresh hash)
  API-->>Browser: JSON accessToken 15m + Set-Cookie examflex_rt HttpOnly
  Note over Browser: memory access only; authSession=1 on ezprep.in (30d, sliding)
  Browser->>API: API calls Bearer access + withCredentials
  Note over Browser,API: full page reload
  Browser->>API: POST /auth/refresh cookie only
  API->>Redis: rotate refresh; slide idle window (capped by absolute)
  API-->>Browser: new access 15m + rotated Set-Cookie
  Browser->>API: POST /auth/logout Bearer and/or cookie
  API->>Redis: revoke sid
  API-->>Browser: Clear-Cookie examflex_rt
```

### Why not put access in HttpOnly?

- Existing clients and axios interceptors expect `Authorization: Bearer`.
- Dual extraction (cookie vs header) adds complexity for little gain while access TTL is 15m and logout revokes Redis.
- XSS can still use an in-memory access token until it expires; that is accepted with short TTL + revoke on logout.

### Why a frontend `authSession` marker?

Next.js Edge middleware runs on `ezprep.in` **before** any JS. It cannot see `examflex_rt` (set by `api.ezprep.in`, path `/api/v1/auth`). The marker is a **non-secret** “maybe logged in” signal so hard navigations to `/today` are not bounced to login before silent refresh runs.

**Marker Max-Age must follow the session length (30d, rewritten on every refresh), not 15m.** Aligning it to access TTL caused hard-reload logouts after idle: middleware redirected before JS could refresh. Access expiry is enforced by the API + silent refresh, not by Edge.

---

## Login flows

### Phone OTP (web)

1. MSG91 widget (`verify.msg91.com`) collects phone + OTP (and hCaptcha).
2. Widget returns an MSG91 access token to the SPA.
3. SPA: `POST /api/v1/auth/verify-otp` with `{ accessToken, client: 'web' }` and `credentials: 'include'`.
4. API verifies with MSG91, resolves/creates user, creates Redis session, returns:
   - JSON: `accessToken`, `expiresIn` (~900), `user`, `isNewUser` — **no `refreshToken` for web**
   - `Set-Cookie: examflex_rt=…; HttpOnly; Secure (prod); SameSite=Lax; Path=/api/v1/auth; Domain=.ezprep.in (prod); Max-Age=<session remaining>`
5. SPA stores access in memory + writes `authSession=1` (30d).

### Google (web)

1. Authorization code + PKCE in the browser.
2. SPA: `POST /api/v1/auth/google` with code/verifier/`client: 'web'` and `credentials: 'include'`.
3. Same session issue path as OTP (HttpOnly refresh, omit JSON refresh).

### Google (mobile)

- `POST /api/v1/auth/google/mobile` with ID token.
- Defaults to `client=mobile`; returns `refreshToken` in JSON; **no** HttpOnly cookie.

### Client forcing (security)

`AuthService.resolveStudentClient`: if request `Origin` is listed in `CORS_ORIGINS`, the session is forced to **`web`** even if the body says `client: 'mobile'`. Native apps typically send no Origin, so they keep mobile semantics. This blocks browsers from opting into JSON refresh + long access JWT.

---

## Refresh

### Endpoint

`POST /api/v1/auth/refresh`

1. Refresh credential = **HttpOnly cookie first**, else JSON `{ refreshToken }` (mobile).
2. If cookie was used → `assertCookieRequestOrigin` (Origin/Referer ∈ `CORS_ORIGINS`; in production Origin or Referer required).
3. The token is `<sid>.<secret>`; Redis holds only the secret's hash plus the last 10 rotated-out hashes (`previousRefreshes`). No separate refresh index key.
   - Matches the live hash → rotate.
   - Matches a rotated-out hash that was rotated **less than** `REFRESH_GRACE_MS` (60s) ago → rotate again. This covers a lost response (client retries with the old token) and two refreshes racing. Trade-off: a stolen token replayed inside that window also gets a valid successor.
   - Matches a rotated-out hash **after** the grace window → **reuse / theft → revoke session** and fail.
   - Unknown secret → fail with no side effects.
4. Rotation is an atomic compare-and-set (Lua `EVAL`), so concurrent refreshes and activity touches cannot overwrite each other's rotation. The idle window slides forward (web 30d / mobile 90d) but never past the absolute cap from login.
5. Issue new access JWT (15m web / 30m mobile).
6. Web: new `Set-Cookie`; omit `refreshToken` from JSON. Mobile: include new `refreshToken` in JSON.
7. On failure: `Clear-Cookie` for web.

### Frontend silent refresh

- **Boot:** `AuthSessionProvider` calls `refreshAccessToken()` once per page load (module-level boot promise).
- **401:** axios interceptor retries after the same refresh helper.
- **Single-flight (critical):** all refresh calls share one in-flight promise in `examflex-app/lib/auth/tokens.ts`, and the request itself runs under the Web Locks API (`examflex-auth-refresh`) so different tabs never rotate the cookie concurrently. Parallel refresh (React Strict Mode remount + dashboard API 401 during boot) previously rotated twice; the second call looked like token reuse and **revoked the live session**, logging the user out on hard reload. Single-flight fixes that.
- Do not clear `authSession` while a refresh is in flight (marker is the only Edge signal until hydrate).
- A **401** from refresh ends the session client-side (memory token and marker dropped → login). A **503/5xx/offline** with nothing in memory clears only the marker (prevents a `/login` ↔ `/today` redirect loop) and leaves the HttpOnly cookie, so the next successful refresh restores the session.

---

## Logout

`POST /api/v1/auth/logout` (no auth guard: the Bearer token's signature is checked but expiry and session state are ignored, so logout still works when access has expired, the session was revoked, or Redis is down)

1. If refresh cookie present → Origin check.
2. Revoke Redis session by access `sid` when JWT present; else **`revokeByRefreshToken`** from the cookie (common after 15m access expiry).
3. Always `Clear-Cookie examflex_rt`.
4. SPA: clear memory + `authSession` marker; navigate home.

---

## Request authentication (API)

1. `Authorization: Bearer <access JWT>`.
2. JWT signature + expiry.
3. If payload has `sid` (student Redis session): assert session still in Redis (positive in-process sid cache ~90s to save Upstash commands).
4. Throttled activity touch (~12 min): Redis `lastSeenAt` + optionally Mongo `lastActiveAt`.
5. Admin JWTs carry no `sid` and skip the Redis check. A **student** JWT without `sid` is rejected (401).

**Fails closed.** If Redis cannot confirm a session (outage, timeout, not configured), login, refresh and uncached request auth return **503** instead of issuing or accepting unverifiable tokens. Student JWTs without a `sid` are rejected (401). A 503 on refresh does **not** clear the refresh cookie, so users are not signed out by a blip. Logout is best-effort: the cookie is cleared client-side and a failed Redis revoke is logged at error level (session expires at its TTL).

---

## Cookie specification (`examflex_rt`)

| Attribute | Value |
| --- | --- |
| Name | `examflex_rt` |
| HttpOnly | yes |
| Secure | yes when `NODE_ENV=production` |
| SameSite | `Lax` |
| Path | `/api/v1/auth` (only sent to auth routes) |
| Domain | `AUTH_COOKIE_DOMAIN` if set (prod: `.ezprep.in`); omit locally |
| Max-Age | Remaining Redis session TTL (seconds) |

Helpers: `src/auth/session/auth-cookie.ts`.

---

## Environment

| Variable | Purpose |
| --- | --- |
| `CORS_ORIGINS` | Comma-separated absolute origins (SPA + admin as needed). Required in production. Used for CORS **and** cookie Origin checks / web-client forcing. |
| `AUTH_COOKIE_DOMAIN` | Prod: `.ezprep.in`. Local: unset. |
| `JWT_SECRET` | Access JWT signing. |
| `REDIS_URL` | **Required** (Upstash `rediss://…`); without it student auth returns 503. |
| `NEXT_PUBLIC_API_URL` | SPA → API base (must match cookie host). |

Frontend CSP (Next.js `headers`) must allow MSG91, hCaptcha, hostnsoft, cdnjs, Google, Razorpay, and the API origin — otherwise OTP/widget breaks under enforcing CSP.

---

## Threat model (what this closes vs leaves)

| Measure | Effect |
| --- | --- |
| HttpOnly refresh | XSS cannot read the long-lived secret |
| 15m web access in memory | Stolen access dies quickly |
| No refresh in `localStorage` | Removes the previous main theft vector |
| Origin allowlist on cookie refresh/logout | CSRF hardening for credentialed cookie use |
| SameSite=Lax | Cross-site POST does not send the cookie |
| Refresh rotation + reuse revoke | Stolen refresh used after rotation kills the session |
| Force web when Origin ∈ CORS | Browser cannot request mobile JSON refresh |
| Next.js CSP | Shrinks XSS script/connect surface (OTP deps explicitly allowlisted) |

Still possible: XSS can call APIs with the **in-memory** access JWT until it expires. Mitigated by short TTL + Redis revoke on logout.

---

## Design decisions (summary)

1. **Direct API `Set-Cookie`**, not a Next BFF — simpler ops; works with same-site subdomain cookie Domain.
2. **Sliding idle window + absolute cap for both clients** — users who keep using the app are never asked to sign in again; the cap bounds a stolen rotating token.
3. **Access in memory + Bearer** — minimal client churn; 15m limits exposure.
4. **30d middleware marker** — Edge cannot see API cookies; must not track 15m access TTL.
5. **Cookie path `/api/v1/auth`** — refresh not attached to every API request.
6. **Single-flight refresh on the SPA** — required for correctness with rotating refresh tokens.
7. **Cutover: pre-session tokens are not honoured** — sessions issued before the `<sid>.<secret>` refresh format fail their first refresh and the user signs in once more.
8. **Admin unchanged** — separate login, no Redis session cookie path.

---

## Code map

| Area | Location |
| --- | --- |
| Cookie helpers / Origin | `src/auth/session/auth-cookie.ts` |
| Redis sessions | `src/auth/session/student-session.service.ts` |
| TTLs | `src/auth/session/session.constants.ts` |
| Issue / refresh / logout / client resolve | `src/auth/auth.service.ts` |
| HTTP + Set-Cookie | `src/auth/auth.controller.ts` |
| JWT validate + sid | `src/auth/strategies/jwt.strategy.ts` + `AuthService.validateJwtPayload` |
| SPA memory / single-flight / logout | `ezprep-app/lib/auth.ts` |
| Axios credentials + 401 | `ezprep-app/lib/api/client.ts` |
| Boot hydrate | `ezprep-app/components/providers/AuthSessionProvider.tsx` |
| Edge marker | `ezprep-app/middleware.ts` + `authSession` cookie |
| CSP | `ezprep-app/next.config.js` |

---

## Operational checklist

### Deploy

1. Set `AUTH_COOKIE_DOMAIN=.ezprep.in` and complete `CORS_ORIGINS` (apex + `www` if both serve students).
2. Deploy **API and web together**.
3. Existing web users **re-login once** (expected).

### Smoke after deploy

1. Login (OTP + Google) → `examflex_rt` HttpOnly present; no auth tokens in `localStorage`.
2. Hard reload `/today` → still authenticated (boot cookie refresh).
3. After ~15m → API call triggers one `POST /auth/refresh` 200; no login UI.
4. After 30d idle or 90d from login → re-login.
5. Logout → cookie cleared; refresh fails; Redis session gone.
6. Mobile body refresh unchanged; admin login unchanged.
7. OTP widget + Razorpay under CSP.

### Known failure mode (fixed)

Parallel `POST /auth/refresh` (boot + axios 401, or Strict Mode double mount) caused refresh-token reuse detection to revoke the session and log users out on reload. Fix: module-level single-flight refresh + shared boot promise on the SPA.

---

## Future (Phase 12 mobile)

- Store refresh in SecureStore; shorten mobile access JWT (e.g. 1h).
- Keep Redis sliding 90d idle semantics unless product changes.
- Do not regress web HttpOnly cookie path.
