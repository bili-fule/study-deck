import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(join(root, '.artifacts'), { recursive: true });
const output = mkdtempSync(join(root, '.artifacts', 'cloud-test-'));
try {
  const require = createRequire(import.meta.url);
  const wranglerPackage = require.resolve('wrangler/package.json');
  const executable = join(dirname(wranglerPackage), JSON.parse(readFileSync(wranglerPackage, 'utf8')).bin.wrangler);
  const bundled = spawnSync(process.execPath, [executable, 'deploy', '--dry-run', '--outdir', output], { cwd: root, stdio: 'inherit', timeout: 60000 });
  if (bundled.error) throw bundled.error;
  if (bundled.status !== 0) throw new Error('Worker test bundle failed');
  const { default: worker } = await import(pathToFileURL(join(output, 'index.js')).href);

// Verification-only bridge: run the real bundled handlers and real SQLite SQL.
// Node supplies the constant-time primitive that Workers exposes on SubtleCrypto.
crypto.subtle.timingSafeEqual ??= timingSafeEqual;
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
  sql.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
}
class Statement {
  constructor(query, values = []) { this.query = query; this.values = values; }
  bind(...values) { return new Statement(this.query, values); }
  execute() {
    const stmt = sql.prepare(this.query);
    if (stmt.columns().length) {
      const results = stmt.all(...this.values);
      return { success: true, results, meta: { changes: /^\s*(INSERT|UPDATE|DELETE)/i.test(this.query) ? sql.prepare('SELECT changes() AS n').get().n : 0 } };
    }
    const result = stmt.run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async run() { return this.execute(); }
  async all() { return this.execute(); }
  async first(column) { const row = this.execute().results[0]; return row ? (column ? row[column] : row) : null; }
}
const env = {
  ALLOWED_ORIGINS: 'https://st.xmfu.cn,http://127.0.0.1:18273',
  DB: {
    prepare(query) { return new Statement(query); },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const results = statements.map(s => s.execute()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  },
};
const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const question = catalog.questions.find(q => q.type === 'single' && q.optionKeys.some(id => !q.answerKey.includes(id)));
const wrong = question.optionKeys.find(id => !question.answerKey.includes(id));
const now = Date.now();
const password = 'isolated-proof-password';
const salt = randomBytes(16);
const passwordHash = `pbkdf2-sha256$100000$${salt.toString('base64url')}$${pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('base64url')}`;
sql.prepare('INSERT INTO users (id,username,username_lower,role,password_hash,password_changed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), 'proofadmin', 'proofadmin', 'admin', passwordHash, now - 1, now - 1, now - 1);
const checks = [];
async function api(path, { method = 'GET', body, cookie, origin = 'https://st.xmfu.cn', site = 'same-site', headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (origin !== null) requestHeaders.set('Origin', origin);
  if (site !== null) requestHeaders.set('Sec-Fetch-Site', site);
  if (cookie) requestHeaders.set('Cookie', cookie);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  const response = await worker.fetch(new Request('https://stapi.xmfu.cn' + path, { method, headers: requestHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
  return response;
}
function cors(response) {
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://st.xmfu.cn');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.match(response.headers.get('Vary') ?? '', /\borigin\b/i);
}
let response = await api('/api/health');
assert.equal(response.status, 200); cors(response);
assert.equal((await response.json()).questions, catalog.questions.length);
checks.push('Trusted cross-origin health includes exact credentialed CORS');
response = await api('/api/telemetry', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
assert.equal(response.status, 204); cors(response);
assert.match(response.headers.get('Access-Control-Allow-Headers'), /content-type/i);
checks.push('JSON preflight succeeds without authentication');
for (const options of [
  { origin: 'https://evil.xmfu.cn' }, { origin: 'null' },
  { headers: { 'Access-Control-Request-Method': 'DELETE' } },
  { headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-unsafe' } },
]) {
  response = await api('/api/telemetry', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' }, ...options });
  assert.equal(response.status, 403);
  if (options.origin) assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
}
response = await api('/api/health', { origin: 'https://st.xmfu.cn.evil.test' });
assert.equal(response.status, 403);
response = await api('/api/health', { origin: null });
assert.equal(response.status, 403);
response = await api('/api/health', { origin: null, site: null });
assert.equal(response.status, 200);
checks.push('Hostile sibling/lookalike/null origins, unsafe preflight and missing-Origin same-site requests rejected; CLI preserved');
response = await api('/api/auth/me'); assert.equal(response.status, 401); cors(response);
response = await api('/api/auth/login', { method: 'POST', body: { username: 'proofadmin', password: 'incorrect-password' } });
assert.equal(response.status, 401); cors(response);
response = await api('/api/auth/login', { method: 'POST', body: { username: 'proofadmin', password } });
assert.equal(response.status, 200); cors(response);
const sessionHeader = response.headers.get('Set-Cookie');
assert.match(sessionHeader, /HttpOnly/i); assert.match(sessionHeader, /SameSite=Lax/i); assert.match(sessionHeader, /Secure/i); assert.doesNotMatch(sessionHeader, /Domain=/i);
const adminCookie = sessionHeader.split(';')[0];
response = await api('/api/auth/me', { cookie: adminCookie }); assert.equal(response.status, 200);
assert.equal((await response.json()).user.role, 'admin');
checks.push('Cross-origin login/me succeeds with a host-only Secure HttpOnly Lax session; errors retain CORS');
response = await api('/api/auth/register', { method: 'POST', body: { username: 'ab', password } });
assert.equal(response.status, 400);
response = await api('/api/auth/register', { method: 'POST', body: { username: 'proofuser', password } });
assert.equal(response.status, 201); cors(response);
const userCookie = response.headers.get('Set-Cookie').split(';')[0];
response = await api('/api/auth/register', { method: 'POST', body: { username: 'proofuser', password } });
assert.equal(response.status, 409);
response = await api('/api/admin/stats', { cookie: userCookie }); assert.equal(response.status, 403); cors(response);
response = await api('/api/auth/me', { cookie: userCookie }); assert.equal(response.status, 200);
checks.push('Open registration creates a user without an invite; duplicate usernames and short names are rejected; ordinary accounts remain forbidden from admin');
const attempt = { id: randomUUID(), type: 'attempt.record', at: new Date().toISOString(), payload: { bankId: question.bankId, questionId: question.questionId, selected: [wrong], mode: 'practice', correct: true } };
const favorite = { id: randomUUID(), type: 'favorite.set', at: attempt.at, payload: { bankId: question.bankId, questionId: question.questionId, favorite: true } };
response = await api('/api/telemetry', { method: 'POST', body: { events: [attempt, favorite] } });
assert.equal(response.status, 200); cors(response);
assert.deepEqual(await response.json(), { accepted: 2, duplicates: 0 });
const visitorHeader = response.headers.get('Set-Cookie');
assert.match(visitorHeader, /sd_visitor=/); assert.match(visitorHeader, /HttpOnly/i); assert.match(visitorHeader, /Secure/i); assert.match(visitorHeader, /SameSite=Lax/i); assert.doesNotMatch(visitorHeader, /Domain=/i);
const visitorCookie = visitorHeader.split(';')[0];
for (const cookie of [visitorCookie, undefined]) {
  response = await api('/api/telemetry', { method: 'POST', cookie, body: { events: [attempt, favorite] } });
  assert.deepEqual(await response.json(), { accepted: 0, duplicates: 2 });
}
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM anonymous_events').get().n, 2);
assert.equal(sql.prepare('SELECT is_correct FROM anonymous_events WHERE event_id=?').get(attempt.id).is_correct, 0);
checks.push('Anonymous events recorded without login, server regrades answers, retries/lost-cookie responses never duplicate');
const fresh = { ...favorite, id: randomUUID() };
const invalid = { ...attempt, id: randomUUID(), payload: { ...attempt.payload, selected: ['fabricated_option'] } };
response = await api('/api/telemetry', { method: 'POST', cookie: visitorCookie, body: { events: [fresh, invalid] } });
assert.equal(response.status, 422); cors(response); assert.equal((await response.json()).index, 1);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM anonymous_events').get().n, 2);
response = await api('/api/telemetry', { method: 'POST', origin: 'https://evil.xmfu.cn', body: { events: [fresh] } });
assert.equal(response.status, 403); assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM anonymous_events').get().n, 2);
response = await api('/api/telemetry', { method: 'POST', body: { events: Array.from({ length: 201 }, () => fresh) } });
assert.equal(response.status, 413); cors(response);
response = await api('/api/telemetry', { method: 'POST', body: { padding: 'x'.repeat(270000), events: [fresh] } });
assert.equal(response.status, 413); cors(response);
checks.push('Invalid batches are atomic; blocked origins and oversized bodies/events cannot write anonymous rows');
const rows = sql.prepare('SELECT * FROM anonymous_events').all();
assert.doesNotMatch(JSON.stringify(rows), /selected|payload|user_agent|ip_address/);
assert(!JSON.stringify(rows).includes(visitorCookie.split('=')[1]));
assert.match(rows[0].visitor_hash, /^[a-f0-9]{64}$/);
response = await api('/api/admin/stats?minSamples=1', { cookie: adminCookie });
assert.equal(response.status, 200); cors(response);
let stats = await response.json();
assert.equal(stats.totals.attempts, 0); assert.equal(stats.anonymous.visitors, 1); assert.equal(stats.anonymous.events, 2); assert.equal(stats.anonymous.attempts, 1); assert.equal(stats.anonymous.errors, 1); assert.equal(stats.anonymous.byType['favorite.set'], 1);
assert(!JSON.stringify(stats).includes('visitor_hash')); assert(!JSON.stringify(stats).includes(rows[0].visitor_hash));
const otherBank = catalog.banks.find(b => b.bankId !== question.bankId).bankId;
response = await api('/api/admin/stats?bankId=' + otherBank, { cookie: adminCookie });
assert.equal((await response.json()).anonymous.events, 0);
response = await api('/api/admin/stats?bankId=' + question.bankId + '&chapterId=' + question.chapterId, { cookie: adminCookie });
assert.equal((await response.json()).anonymous.events, 2);
checks.push('Anonymous aggregates are bank/chapter scoped and expose no raw answers or visitor identities');
response = await api('/api/sync/push', { method: 'POST', cookie: userCookie, body: { events: [attempt] } });
assert.deepEqual(await response.json(), { accepted: 1, duplicates: 0 });
response = await api('/api/sync/push', { method: 'POST', cookie: userCookie, body: { events: [attempt] } });
assert.deepEqual(await response.json(), { accepted: 0, duplicates: 1 });
response = await api('/api/sync/pull', { cookie: userCookie });
const pulled = await response.json(); assert.equal(pulled.events[0].id, attempt.id); assert(pulled.nextCursor > 0);
response = await api('/api/admin/stats?minSamples=1', { cookie: adminCookie });
stats = await response.json(); assert.equal(stats.totals.attempts, 1); assert.equal(stats.anonymous.attempts, 1);
checks.push('Account push/pull and idempotency remain intact; adopted anonymous events are not added twice to account statistics');
sql.prepare("UPDATE auth_throttle SET attempts=1000000 WHERE key LIKE 'telemetry:%'").run();
response = await api('/api/telemetry', { method: 'POST', cookie: visitorCookie, body: { events: [fresh] } });
assert.equal(response.status, 429); cors(response); assert(Number(response.headers.get('Retry-After')) > 0);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM anonymous_events').get().n, 2);
sql.prepare("DELETE FROM auth_throttle WHERE key LIKE 'telemetry:%'").run();
checks.push('Anonymous abuse limit returns readable 429 with Retry-After and no inserted event');
response = await api('/api/auth/logout', { method: 'POST', cookie: adminCookie });
assert.equal(response.status, 204); cors(response); assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/i);
response = await api('/api/auth/me', { cookie: adminCookie }); assert.equal(response.status, 401); cors(response);
checks.push('Cross-origin logout revokes the server session and clears its cookie');
console.log('Cloud API regression checks passed: ' + checks.length);
} finally {
  rmSync(output, { recursive: true, force: true });
}
