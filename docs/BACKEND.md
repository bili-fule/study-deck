# Study Deck backend (optional cloud)

Static-first study app: the SPA works fully offline with local storage/backups.
The Cloudflare Worker in `worker/` adds invite-only accounts, cross-device sync
of learning records, and aggregate-only admin statistics. Question banks are
build-time files (`data/catalog.json`, `data/bank.bundle.json`); the cloud never
edits or serves banks and stores only learning records.

## Stack and layout

- Cloudflare Worker + static assets, `wrangler.jsonc`, `compatibility_date` 2026-11-15.
- D1 (`DB` binding, database name `study-deck`) for accounts, sessions, invites,
  append-only learning events and aggregate queries.
- `shared/api.ts` is the single source of truth for HTTP/event types; the SPA
  imports it. Same-origin only (`/api/*`); no CORS, no bearer tokens.
- `worker/` — routing (`index.ts`), auth (`auth.ts`), sync (`sync.ts`), admin
  aggregates (`admin.ts`), seeded catalog validation (`catalog.ts`).
- `migrations/` — D1 schema. `scripts/admin.mjs` — admin/invite CLI.

## Local development

```bash
npm install                 # pinned wrangler 4.162.0 (see package.json)
npm run build               # required: the Worker serves the real SPA from dist/
npm run cf:migrate          # applies migrations to the local Miniflare D1
npm run cf:dev              # Worker + API on http://127.0.0.1:8787
npm run dev                 # Vite SPA on :5173, proxies /api -> :8787
```

Vite proxy (frontend-owned `vite.config.ts`):

```ts
server: { proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } } }
```

Local state lives in `.wrangler/state` (gitignored). `wrangler dev` serves the
real `dist/` output, so `npm run build` must run first on a fresh clone (and
again after frontend changes).

The CLI uses the project-local Wrangler; if it is not installed it falls back to
exactly `wrangler@4.162.0` through `npx`. No secrets are required at runtime.

### Windows note (runtime blocker seen in this environment)

On this Windows 10 build, `workerd 1.20261113.1` (bundled with wrangler 4.162.0)
aborts before serving when Miniflare passes `--experimental`:

```
kj/filesystem-disk-win32.c++:745: failed: CreateDirectory: #5 拒绝访问。; path = miniflare-email-store
```

This reproduces with a minimal bare `workerd serve --experimental` config that
declares Durable Object `localDisk` storage, independent of this project, and
also with workerd 1.20261115.1. The same config runs when `--experimental` is
omitted, and `wrangler dev`/`migrations apply --local` work on Linux with the
same pinned Wrangler. No project workaround or alternate binary is committed;
use Linux/macOS/WSL or CI for local Worker/D1 runs on Windows until the runtime
issue is fixed upstream.

## Deployment

Single main path (each step depends on the previous one):

1. `npx wrangler login` (or `CLOUDFLARE_API_TOKEN`) on the account you intend to
   target. `npx wrangler whoami` must show that account before continuing.
2. Create the database once:
   `npx wrangler d1 create study-deck`.
3. Add the **actual** returned `database_id` to the `d1_databases[0]` entry in
   `wrangler.jsonc` (the committed config intentionally has no invented id).
4. Apply schema to that database: `npm run cf:migrate:remote`.
5. `npm run cf:deploy` (runs the SPA build, then `wrangler deploy`).
6. Bootstrap the admin inside the deployed database:
   `npm run admin:init -- --remote --username admin` (password is prompted).
7. Mint an invite: `npm run admin:invite -- --remote --uses 1`.

Do not deploy before step 4: the Worker expects the created database and the
applied schema. Remote steps require a real account and are unverified here.

## Accounts and security

- Registration is invite-only and creates `role = 'user'`. There is no
  first-signup-admin path. Admins exist only via `scripts/admin.mjs`.
- Usernames: 3-32 chars `[A-Za-z0-9_.-]`, case-insensitive unique.
- Passwords: 10-200 chars (max 1024 UTF-8 bytes), hashed with PBKDF2-HMAC-SHA256,
  random 16-byte salt, 32-byte derived key, encoded as
  `pbkdf2-sha256$<iterations>$<salt>$<hash>` (base64url).
  Iterations are pinned to **100,000** because production Workers WebCrypto
  rejects PBKDF2 counts above that cap by default (workerd
  `DEFAULT_MAX_PBKDF2_ITERATIONS`; a change to 1M is proposed but not shipped).
  Do not lower this silently; the encoded scheme allows future upgrades without
  a migration. Verification uses `crypto.subtle.timingSafeEqual`.
- Unknown usernames still run a dummy PBKDF2 hash so login timing does not
  reveal account existence.
- Sessions: 32 random bytes (base64url) in the `sd_session` cookie
  (`HttpOnly; SameSite=Lax; Path=/; Max-Age=30d`, plus `Secure` on HTTPS).
  Only SHA-256(token) is stored. A session is valid only if
  `session.created_at >= user.password_changed_at`, so a password reset revokes
  every old session; the reset CLI also deletes session rows explicitly.
- CSRF: same-origin `Origin`/`Sec-Fetch-Site` check on auth/logout/push plus
  `SameSite=Lax`. JSON bodies are required and size-capped (8 KiB auth,
  256 KiB / 200 events sync).
- Abuse: fixed-window throttle table (15 min) for login per IP+username
  (10 failures), registration per IP (30 attempts), pruned on use. 429 includes
  `Retry-After`.
- SQL is always parameterized. Dynamic identifiers are not user-controlled.

### Atomic registration

`INSERT INTO users ... SELECT ... WHERE EXISTS (invite quota check)` and an
`AFTER INSERT` trigger consume the invite use in the same statement; the session
row is inserted in the same D1 transaction. `RAISE(ABORT)` rolls back the user
insert if the quota was taken concurrently. Consequences:

- a duplicate username or any failure consumes no invite and leaves no account;
- concurrent registrations cannot oversubscribe a multi-use invite;
- the session is issued only if the user row exists.

## API

All routes under `/api`, JSON, `Cache-Control: no-store`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | public: bank/question counts + catalog timestamp |
| POST | `/api/auth/register` | `{username,password,inviteCode}` → 201 + cookie |
| POST | `/api/auth/login` | `{username,password}` → 200 + cookie |
| POST | `/api/auth/logout` | 204, clears cookie, deletes session |
| GET | `/api/auth/me` | `{user}` or 401 |
| POST | `/api/sync/push` | `{events:[...]}` ≤200 events → `{accepted,duplicates}` |
| GET | `/api/sync/pull?cursor=&limit=` | keyset by server `seq` → `{events,nextCursor,hasMore}` |
| GET | `/api/admin/stats?minSamples=&limit=&bankId=&chapterId=` | admin only, aggregate-only |

Error body: `{ "error": "code", "detail"?: string, "index"?: number }`.
Codes: `invalid_request`, `invalid_json`, `unauthorized`, `forbidden`,
`origin_mismatch`, `cross_site_request`, `invalid_credentials`, `invalid_invite`,
`username_taken`, `rate_limited`, `payload_too_large`, `invalid_event`,
`method_not_allowed`, `not_found`, `internal_error`.

## Sync model

Append-only, per-user event log. The client generates a UUID `id` (idempotency
key, unique per user); `at` is an ISO timestamp used for LWW ordering
(tie-break: id); the server assigns a monotonic `seq` used only for pulls. The
whole push batch is validated before any write and inserted atomically with
`INSERT OR IGNORE`, so re-pushes return `duplicates` and never double-count.
One invalid event returns 422 with its index and writes nothing.

Event types (payloads in `shared/api.ts`):

- `attempt.record` `{bankId,questionId,selected,string[],mode:"practice"|"mock"}` —
  real submissions only. Answered mock items are sent once with mode `mock`;
  unanswered items emit nothing. The server verifies `selected` against the
  seeded option ids and recomputes correctness (client flags are ignored).
- `favorite.set` `{bankId,questionId,favorite}` — `false` is a tombstone; apply
  per-item LWW, never hard-delete.
- `exam.completed` `{bankId,totalQuestions,answers,startedAt,completedAt,durationMs}` —
  mock history. The server validates every answer and recomputes the score.
  This event does not feed attempt/error aggregates (no double counting).
- `card.reviewed` `{cardId,rating}` — append-only review log.
- `card.state` `{cardId,state|null}` — per-card scheduling state, LWW; `null`
  resets the card.

Favorites and card state converge by `(at, id)` LWW on both sides, so a stale
device cannot clobber a newer tombstone. Anonymous local practice must be
adopted into the same event log at login (explicit user choice, frontend-side),
and per-user separation on logout is frontend-local.

## Seeded bank catalog

`data/catalog.json` is generated by the shared data compiler and imported by
`worker/catalog.ts` at build time. It must contain, per question:
`{questionId, bankId, chapterId, type, optionKeys[], answerKey[]}` plus
`banks[]` and `chapters[]`. `optionKeys` are content-stable option ids (display
letters are UI-only). The parser fails fast on duplicates, unknown banks,
missing/empty keys, answer keys outside `optionKeys`, wrong single/judgment
cardinality, or a `questionCount` mismatch. `selected` must be a subset of
`optionKeys`; unknown ids are rejected with 422. Any bank/question change
requires rebuilding and redeploying the Worker; old event ids referencing
removed questions are rejected by design.

## Admin privacy

`GET /api/admin/stats` returns only population aggregates: total registered
users, total attempts/errors/rates, an easy-error leaderboard filtered by
`minSamples` (attempts denominator), and chapter roll-ups. `bankId` and
`chapterId` optionally scope attempts/leaderboard/chapters (totals follow the
same filter); `users` stays global. Unknown ids return 400. There is no admin
endpoint (or planned UI) that lists an individual user's attempts, favorites,
exams or card progress. Question aggregates are computed from
`attempt.record` only.

## Verification

- `npm run cf:typecheck` (Worker TS) — passes.
- `npm run build` (SPA + `tsc -b`) — passes with `CloudPage`/`AdminPage`.
- `npx wrangler deploy --dry-run --outdir …` — Worker bundles (139 KiB, 22 KiB gzip) with the D1 binding and static assets.
- Isolated Linux run with the same pinned Wrangler 4.162.0: migrations applied,
  admin/invite CLI used, Worker served `/api/health` (`banks: 1, questions: 296`)
  and a 33-assertion API smoke passed: invite registration, session cookie,
  sync push/pull, idempotent re-push (0 accepted / 7 duplicates), tombstone
  retention, fabricated option rejection with atomic no-write, two-user
  isolation, admin aggregate totals (`attempts: 3`, `errors: 2`,
  `errorRate: 0.6667`), no user identifiers in the response, single-use invite,
  duplicate username not consuming an invite, logout invalidating the cookie.
- Admin password reset verified against the running Worker: old cookie → 401,
  new login → 200.
- Not exercised: the `bankId`/`chapterId` admin filters added after that smoke
  (typecheck + dry-run only), browser-level acceptance, remote deployment.
- Remote deployment is unverified: a Cloudflare account is authenticated in
  Wrangler, but no Worker/D1 resources were created or deployed.
