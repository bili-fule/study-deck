# StudyDeck API · Cloudflare Workers + D1

The EdgeOne frontend (`https://st.xmfu.cn`) calls the separate Worker API
(`https://stapi.xmfu.cn/api`). Question banks remain build-time files; D1 stores
accounts, sessions, append-only account learning events and minimal anonymous
usage statistics. Local learning and backups do not require a working API.

## Layout

- `worker/index.ts`: routing, centralized origin checks, preflight and CORS.
- `worker/auth.ts`: invite-only accounts and HttpOnly cookie sessions.
- `worker/sync.ts`: shared event validation, verified scoring and account sync.
- `worker/telemetry.ts`: anonymous learning-event ingestion.
- `worker/admin.ts`: aggregate-only statistics; no individual-history endpoint.
- `worker/catalog.ts`: validates the generated `data/catalog.json`.
- `shared/api.ts`: browser/backend contracts.
- `migrations/`: apply every migration, including the anonymous statistics table.
- `scripts/admin.mjs`: initialize/reset admins and issue invitations.

## Frontend and origin configuration

Production builds default to `https://stapi.xmfu.cn`. To change the API origin,
set `VITE_API_BASE_URL` in EdgeOne's **build environment**, without `/api`, and
rebuild the frontend. This is a public origin, not a secret.

`wrangler.jsonc` sets `ALLOWED_ORIGINS` to `https://st.xmfu.cn`. Additional
origins, when genuinely needed, are comma-separated exact origins: scheme,
hostname and port. Wildcards, opaque `null`, hostile sibling subdomains and
untrusted preflights are not accepted. Same-origin requests remain supported.

All browser API requests use `credentials: "include"`. Allowed origins receive
their exact `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials:
true` and `Vary: Origin`, including on errors. Preflight permits GET/POST and
Content-Type. Request bodies remain JSON and size-capped. Origin checks happen
before routing or database writes; trusting CORS alone is not a CSRF defense.

Both configured production hosts are HTTPS and **same-site but cross-origin**.
`sd_session` and `sd_visitor` stay host-only to the API: `HttpOnly;
SameSite=Lax; Path=/; Max-Age=30d; Secure` on HTTPS. No `.xmfu.cn` Domain
attribute, browser-readable auth token or SameSite=None is needed. A different
registrable frontend domain is not covered by this cookie design; EdgeOne's
unlisted preview domains are deliberately not authorized.

## Local development

```bash
npm install
npm run cf:migrate
npm run cf:dev        # API :8787
npm run dev           # Vite :5173, /api proxy preserves the frontend Host
```

Worker development no longer depends on a prebuilt SPA: static assets are
deployed separately. Use `npm run build` for the frontend production bundle.

This Windows environment has an established workerd/Miniflare startup failure:
`CreateDirectory: #5` for `miniflare-email-store`. Do not change Defender, ACLs
or switch arbitrary binaries to work around it. Run local Worker/D1 on a
supported Linux/macOS/WSL environment. A Node/SQLite handler smoke, if used,
does not prove execution inside the Workers runtime.

## Production deployment

1. Authenticate to the intended Cloudflare account with `npx wrangler login`;
   verify that account with `npx wrangler whoami`.
2. Create D1 once: `npx wrangler d1 create study-deck`. Put the **actual**
   returned `database_id` in `wrangler.jsonc`; never invent a resource ID.
3. Apply all migrations: `npm run cf:migrate:remote`.
4. Ensure `xmfu.cn` is an active zone in the same Cloudflare account.
   `routes[].custom_domain` attaches `stapi.xmfu.cn` to the Worker. Resolve
   any existing conflicting CNAME deliberately; do not remove unrelated DNS.
   Keep the frontend's `st.xmfu.cn` pointing to EdgeOne.
5. Deploy API: `npm run cf:deploy`. This no longer builds/deploys static assets.
6. Initialize admin:
   `npm run admin:init -- --remote --username admin` (password prompted).
7. Issue an invitation: `npm run admin:invite -- --remote --uses 1`.
8. Rebuild/deploy the EdgeOne frontend with `npm run build`, output `dist`.
   Test login from the actual `https://st.xmfu.cn` origin.

Adding routes and passing a dry run do not create a working database or prove
live DNS, HTTPS, cross-domain cookies or production deployment.

## Accounts and sync invariants

- Usernames: case-insensitive unique, 3–32 `[A-Za-z0-9_.-]` characters.
- Passwords: 10–200 characters, at most 1024 UTF-8 bytes; PBKDF2-HMAC-SHA256,
  random 16-byte salt, 100,000 iterations and 32-byte derived key. Encoded
  parameters allow future upgrades. Verification uses Workers' timing-safe
  comparison; unknown usernames perform dummy hashing.
- Session tokens: 32 cryptographic random bytes; only SHA-256 is stored.
  Expiry and password-change checks apply; reset revokes prior sessions.
- Invitation consumption, new user and session insertion are transactional.
  Duplicate usernames or failures cannot consume an invitation without an
  account; concurrent registrations cannot exceed quota.
- Login/registration have bounded, short-lived hashed-key abuse throttles.
- Account event pushes validate the whole batch before a D1 transaction.
  Event IDs are idempotent per user. Pulls use a server-generated monotonic
  cursor, not client timestamps or push acknowledgments.
- Scores are recomputed from stable question/option IDs; client correctness
  flags are never trusted. Exam-history events do not double-count attempts.
- Favorites and card state use `(at,id)` last-write-wins ordering, including
  deletion/reset tombstones. Anonymous-to-account adoption still requires
  explicit confirmation in the browser.

## Anonymous behavior

`POST /api/telemetry` accepts the same validated learning events without login:
actual answer submissions, favorite changes, mock completion, card reviews
and card-state changes. It does not log arbitrary page content or clicks.

The API assigns a random `sd_visitor` cookie and stores its SHA-256 hash, not
the token. Stored event dimensions are ID, type, client/server time, bank,
question and verified correctness where applicable. Full selected answers,
exam payloads, usernames, raw IPs, user agents and fingerprints are not stored
in anonymous event rows. Hashed-IP rate-limit keys are short-lived abuse
protection, not visitor identities.

Every batch is validated before insertion. Anonymous IDs are globally
idempotent, so retries and a lost cookie response do not multiply events.
Anonymous visitors are cookie identities, **not a unique-person count**.
No anonymous-history retrieval endpoint exists.

The browser keeps anonymous acknowledgment IDs separately from account sync
acknowledgments and cursors. Failed uploads leave local events intact; another
learning action, page reload or browser online event tries the pending batch.
Statistics acknowledgment never marks guest learning as synchronized into an
account. Backups exclude both acknowledgment sets and reset them on restore.

## API

All routes are JSON, with `Cache-Control: no-store`.

| Method | Path | Access / result |
| --- | --- | --- |
| GET | `/api/health` | Public bank/question counts and catalog timestamp |
| POST | `/api/auth/register` | `{username,password,inviteCode}` → 201 + session cookie |
| POST | `/api/auth/login` | `{username,password}` → 200 + session cookie |
| POST | `/api/auth/logout` | 204, clears cookie and revokes server session |
| GET | `/api/auth/me` | Current user, or 401 |
| POST | `/api/telemetry` | Anonymous `{events}` → `{accepted,duplicates}` |
| POST | `/api/sync/push` | Authenticated `{events}` → `{accepted,duplicates}` |
| GET | `/api/sync/pull?cursor=&limit=` | Authenticated events, next cursor and hasMore |
| GET | `/api/admin/stats?minSamples=&limit=&bankId=&chapterId=` | Admin-only aggregates |
| OPTIONS | `/api/*` | Trusted-origin preflight |

Push/telemetry limits: 200 events / 256 KiB. Auth body limit: 8 KiB.
An invalid event returns 422 with its index and inserts no learning/telemetry
events. Error bodies use `{error,detail?,index?}`; trusted frontends can read
error responses through CORS.

Admin responses preserve registered-user totals, easy-error rankings and
chapter aggregates, and add a separate `anonymous` summary: visitor identities,
event count, attempts, errors, error rate and counts by event type. Anonymous
counts follow the same bank/chapter filters. Rows without a bank (such as card
reviews) are excluded by bank/chapter filters. Anonymous events are not added
to registered attempt totals, including after guest learning is adopted.
There are no user/visitor identifiers or individual histories in this response.

## Checks

```bash
npm run cf:typegen
npm run cf:typecheck
npm run build
npm run cloud:test   # Node 24+: real bundled handlers + isolated SQLite; not workerd
npx wrangler deploy --dry-run
```

Type generation and bundling are not a substitute for applying D1 migrations
or testing the live API from the deployed frontend origin.

References: [Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/),
[D1 API](https://developers.cloudflare.com/d1/worker-api/).

## Verification performed

Binding generation, frontend production build, Worker typecheck and deployment
dry-run passed. `npm run cloud:test` passed 11 regression groups against the
actual bundled handlers and isolated SQLite, including credentialed CORS,
host-only cookies, atomic anonymous ingestion, deduplication, mixed-event
aggregates, filters, authorization, account sync and throttling.

A real Edge browser on two separate local origins verified anonymous answer
and favorite uploads, independent acknowledgment metadata, HttpOnly cookies,
login, explicit guest adoption, account synchronization and the aggregate UI.
These checks do not prove production DNS/TLS or workerd runtime execution.
