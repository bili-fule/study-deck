import { LIMITS, SESSION_COOKIE, type PublicUser, type Role } from "../shared/api";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "./lib/crypto";
import {
  assertMethod,
  clientIp,
  HttpError,
  isSecureRequest,
  jsonResponse,
  readCookie,
  readJsonObject,
  sessionCookie,
} from "./lib/http";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const REGISTER_MAX_ATTEMPTS = 30;
const MAX_AUTH_BODY_BYTES = 8 * 1024;

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
const INVITE_PATTERN = /^[A-Z0-9-]{3,64}$/;

/**
 * A syntactically valid hash used to burn the same PBKDF2 cost when the
 * username does not exist, so login timing does not reveal account existence.
 * The salt/hash are all-zero and never verify.
 */
const DUMMY_PASSWORD_HASH = `pbkdf2-sha256$100000$${"A".repeat(22)}$${"A".repeat(43)}`;

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
}

interface UserRow {
  id: string;
  username: string;
  role: Role;
  password_hash: string;
  password_changed_at: number;
  created_at: number;
}

interface InviteRow {
  max_uses: number;
  used_count: number;
  expires_at: number | null;
}

interface SessionRow {
  id: string;
  username: string;
  role: Role;
  created_at: number;
}

interface ThrottleRow {
  window_start: number;
  attempts: number;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function usernameFrom(value: unknown): { username: string; lower: string } {
  if (typeof value !== "string" || !USERNAME_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", {
      detail: "username must be 3-32 characters of A-Z a-z 0-9 _ . -",
    });
  }
  return { username: value, lower: value.toLowerCase() };
}

function registrationPasswordFrom(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", { detail: "password is required" });
  }
  const characters = [...value].length;
  const bytes = new TextEncoder().encode(value).length;
  if (
    characters < LIMITS.passwordMin ||
    characters > LIMITS.passwordMax ||
    bytes > 1024
  ) {
    throw new HttpError(400, "invalid_request", {
      detail: "password must be 10-200 characters (max 1024 UTF-8 bytes)",
    });
  }
  return value;
}

function loginPasswordFrom(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "invalid_request", { detail: "password is required" });
  }
  if (new TextEncoder().encode(value).length > 1024) {
    throw new HttpError(400, "invalid_request", { detail: "password is too long" });
  }
  return value;
}

function inviteCodeFrom(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!INVITE_PATTERN.test(code)) {
    throw new HttpError(400, "invalid_request", {
      detail: "invite code must be 3-64 characters of A-Z 0-9 -",
    });
  }
  return code;
}

/** Map D1/SQLite errors from the atomic registration transaction. */
function registrationFailure(error: unknown): HttpError {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  if (message.includes("invite_exhausted") || message.includes("FOREIGN KEY")) {
    return new HttpError(403, "invalid_invite", {
      detail: "invite code is invalid or exhausted",
    });
  }
  if (message.includes("UNIQUE constraint failed")) {
    return new HttpError(409, "username_taken", {
      detail: "username is already registered",
    });
  }
  if (/database is locked|SQLITE_BUSY|busy/i.test(message)) {
    return new HttpError(503, "registration_busy", {
      detail: "registration is busy, retry",
    });
  }
  console.error(
    JSON.stringify({ message: "registration_failed", error: message }),
  );
  return new HttpError(500, "internal_error");
}

/* ------------------------------------------------------------------ */
/* Throttle                                                            */
/* ------------------------------------------------------------------ */

async function throttleKey(scope: string, ...parts: string[]): Promise<string> {
  return `${scope}:${await sha256Hex(parts.join("|"))}`;
}

async function assertNotThrottled(
  env: Env,
  key: string,
  limit: number,
  now: number,
): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT window_start, attempts FROM auth_throttle WHERE key = ?",
  )
    .bind(key)
    .first<ThrottleRow>();
  if (!row) return;
  if (now - row.window_start >= THROTTLE_WINDOW_MS) return;
  if (row.attempts < limit) return;
  const retryAfter = Math.max(
    1,
    Math.ceil((row.window_start + THROTTLE_WINDOW_MS - now) / 1000),
  );
  throw new HttpError(429, "rate_limited", {
    detail: "too many attempts, retry later",
    headers: { "retry-after": String(retryAfter) },
  });
}

async function bumpThrottle(env: Env, key: string, now: number): Promise<number> {
  await env.DB.prepare(
    `INSERT INTO auth_throttle (key, window_start, attempts)
     VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       attempts = CASE
         WHEN excluded.window_start - auth_throttle.window_start >= ? THEN 1
         ELSE auth_throttle.attempts + 1
       END,
       window_start = CASE
         WHEN excluded.window_start - auth_throttle.window_start >= ? THEN excluded.window_start
         ELSE auth_throttle.window_start
       END`,
  )
    .bind(key, now, THROTTLE_WINDOW_MS, THROTTLE_WINDOW_MS)
    .run();
  const row = await env.DB.prepare(
    "SELECT attempts FROM auth_throttle WHERE key = ?",
  )
    .bind(key)
    .first<{ attempts: number }>();
  return row?.attempts ?? 1;
}

async function pruneThrottle(env: Env, now: number): Promise<void> {
  await env.DB.prepare("DELETE FROM auth_throttle WHERE window_start <= ?")
    .bind(now - THROTTLE_WINDOW_MS * 2)
    .run();
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

function publicUser(row: SessionRow | UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function issueSession(env: Env, userId: string, now: number): Promise<string> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(tokenHash, userId, now, now + SESSION_TTL_MS)
    .run();
  return token;
}

/**
 * Resolve the cookie session to a user. `created_at >= password_changed_at`
 * makes a password reset revoke every existing session atomically.
 */
export async function getSessionUser(
  request: Request,
  env: Env,
): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
       AND s.expires_at > ?
       AND s.created_at >= u.password_changed_at`,
  )
    .bind(tokenHash, Date.now())
    .first<SessionRow>();
  return row ? publicUser(row) : null;
}

export async function requireUser(request: Request, env: Env): Promise<SessionUser> {
  const user = await getSessionUser(request, env);
  if (!user) throw new HttpError(401, "unauthorized");
  return user;
}

export async function requireAdmin(request: Request, env: Env): Promise<SessionUser> {
  const user = await requireUser(request, env);
  if (user.role !== "admin") throw new HttpError(403, "forbidden");
  return user;
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

async function register(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  const body = await readJsonObject(request, MAX_AUTH_BODY_BYTES);
  const { username, lower } = usernameFrom(body.username);
  const password = registrationPasswordFrom(body.password);
  const inviteCode = inviteCodeFrom(body.inviteCode);

  const ipKey = await throttleKey("register-ip", clientIp(request));
  await assertNotThrottled(env, ipKey, REGISTER_MAX_ATTEMPTS, now);
  await bumpThrottle(env, ipKey, now);
  await pruneThrottle(env, now);

  const codeHash = await sha256Hex(inviteCode);
  const invite = await env.DB.prepare(
    "SELECT max_uses, used_count, expires_at FROM invites WHERE code_hash = ?",
  )
    .bind(codeHash)
    .first<InviteRow>();
  if (
    !invite ||
    invite.used_count >= invite.max_uses ||
    (invite.expires_at !== null && invite.expires_at <= now)
  ) {
    throw new HttpError(403, "invalid_invite", {
      detail: "invite code is invalid or exhausted",
    });
  }

  const passwordHash = await hashPassword(password);

  // Atomic registration: the user row is inserted only if the invite quota
  // still allows it, and an AFTER INSERT trigger consumes the use inside the
  // same statement. The session insert is part of the same D1 transaction and
  // only fires if the user row exists. Any failure rolls back everything, so
  // a failed request never consumes an invite or leaves a stray account.
  const id = crypto.randomUUID();
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = now + SESSION_TTL_MS;

  const userStatement = env.DB.prepare(
    `INSERT INTO users
       (id, username, username_lower, role, password_hash, password_changed_at, created_at, updated_at, invite_code_hash)
     SELECT ?, ?, ?, 'user', ?, ?, ?, ?, ?
     WHERE EXISTS (
       SELECT 1 FROM invites
       WHERE code_hash = ? AND used_count < max_uses
         AND (expires_at IS NULL OR expires_at > ?)
     )`,
  ).bind(id, username, lower, passwordHash, now, now, now, codeHash, codeHash, now);

  const sessionStatement = env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
     SELECT ?, ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
  ).bind(tokenHash, id, now, expiresAt, id);

  let results: D1Result[];
  try {
    results = await env.DB.batch([userStatement, sessionStatement]);
  } catch (error) {
    throw registrationFailure(error);
  }
  // `meta.changes` counts the user INSERT plus the trigger's invite UPDATE, so
  // any committed row means the guarded insert succeeded; 0 means the invite
  // quota check failed and nothing (not even the session) was written.
  if ((results[0]?.meta.changes ?? 0) < 1) {
    throw new HttpError(403, "invalid_invite", {
      detail: "invite code is invalid or exhausted",
    });
  }

  const user: PublicUser = {
    id,
    username,
    role: "user",
    createdAt: new Date(now).toISOString(),
  };
  return jsonResponse({ user }, 201, {
    "set-cookie": sessionCookie(SESSION_COOKIE, token, isSecureRequest(request)),
  });
}

async function login(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  const body = await readJsonObject(request, MAX_AUTH_BODY_BYTES);
  const { lower } = usernameFrom(body.username);
  const password = loginPasswordFrom(body.password);

  const key = await throttleKey("login", clientIp(request), lower);
  await assertNotThrottled(env, key, LOGIN_MAX_FAILURES, now);

  const user = await env.DB.prepare(
    "SELECT id, username, role, password_hash, password_changed_at, created_at FROM users WHERE username_lower = ?",
  )
    .bind(lower)
    .first<UserRow>();

  const valid = await verifyPassword(
    password,
    user ? user.password_hash : DUMMY_PASSWORD_HASH,
  );

  if (!user || !valid) {
    const attempts = await bumpThrottle(env, key, now);
    if (attempts >= LOGIN_MAX_FAILURES) {
      throw new HttpError(429, "rate_limited", {
        detail: "too many failed attempts, retry later",
        headers: {
          "retry-after": String(Math.ceil(THROTTLE_WINDOW_MS / 1000)),
        },
      });
    }
    throw new HttpError(401, "invalid_credentials", {
      detail: "invalid username or password",
    });
  }

  await env.DB.prepare("DELETE FROM auth_throttle WHERE key = ? OR window_start <= ?")
    .bind(key, now - THROTTLE_WINDOW_MS * 2)
    .run();
  await env.DB.prepare(
    "DELETE FROM sessions WHERE user_id = ? AND (expires_at <= ? OR created_at < ?)",
  )
    .bind(user.id, now, user.password_changed_at)
    .run();

  const token = await issueSession(env, user.id, now);
  return jsonResponse({ user: publicUser(user) }, 200, {
    "set-cookie": sessionCookie(SESSION_COOKIE, token, isSecureRequest(request)),
  });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
  }
  return new Response(null, {
    status: 204,
    headers: {
      "set-cookie": sessionCookie(SESSION_COOKIE, null, isSecureRequest(request)),
      "cache-control": "no-store",
    },
  });
}

async function me(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  return jsonResponse({ user });
}

export async function handleAuth(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  switch (pathname) {
    case "/api/auth/register":
      assertMethod(request, "POST");
      return register(request, env);
    case "/api/auth/login":
      assertMethod(request, "POST");
      return login(request, env);
    case "/api/auth/logout":
      assertMethod(request, "POST");
      return logout(request, env);
    case "/api/auth/me":
      assertMethod(request, "GET");
      return me(request, env);
    default:
      throw new HttpError(404, "not_found");
  }
}
