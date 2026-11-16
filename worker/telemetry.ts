import { LIMITS, type SyncPushResponse } from "../shared/api";
import { randomToken, sha256Hex } from "./lib/crypto";
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
import { normalizeSyncEventBatch } from "./sync";

const VISITOR_COOKIE = "sd_visitor";
const VISITOR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const THROTTLE_MAX_REQUESTS = 600;
const THROTTLE_KEY_PREFIX = "telemetry:";

interface TelemetryThrottleRow {
  attempts: number;
  window_start: number;
}

async function enforceTelemetryRateLimit(
  request: Request,
  env: Env,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM auth_throttle WHERE key LIKE 'telemetry:%' AND window_start <= ?",
  )
    .bind(now - THROTTLE_WINDOW_MS * 2)
    .run();

  const key = `${THROTTLE_KEY_PREFIX}${await sha256Hex(clientIp(request))}`;
  const row = await env.DB.prepare(
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
       END
     RETURNING attempts, window_start`,
  )
    .bind(key, now, THROTTLE_WINDOW_MS, THROTTLE_WINDOW_MS)
    .first<TelemetryThrottleRow>();

  if (!row) throw new Error("telemetry throttle counter was not returned");
  if (row.attempts > THROTTLE_MAX_REQUESTS) {
    const retryAfter = Math.max(
      1,
      Math.ceil((row.window_start + THROTTLE_WINDOW_MS - now) / 1000),
    );
    throw new HttpError(429, "rate_limited", {
      detail: "too many telemetry submissions, retry later",
      headers: { "retry-after": String(retryAfter) },
    });
  }
}

/** Store anonymous, aggregate-safe event dimensions without account linkage. */
export async function handleTelemetry(request: Request, env: Env): Promise<Response> {
  assertMethod(request, "POST");
  const now = Date.now();
  await enforceTelemetryRateLimit(request, env, now);

  const body = await readJsonObject(request, LIMITS.pushMaxBodyBytes);
  const normalized = normalizeSyncEventBatch(body, now);

  const existingToken = readCookie(request, VISITOR_COOKIE);
  const hasVisitorCookie =
    existingToken !== null && VISITOR_TOKEN_PATTERN.test(existingToken);
  const visitorToken = hasVisitorCookie ? existingToken : randomToken();
  const visitorHash = await sha256Hex(visitorToken);

  const results = await env.DB.batch(
    normalized.map((event) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO anonymous_events
           (event_id, visitor_hash, kind, client_at, received_at,
            bank_id, question_id, is_correct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        event.id,
        visitorHash,
        event.kind,
        event.atMs,
        now,
        event.bankId,
        event.questionId,
        event.kind === "attempt.record" ? event.isCorrect : null,
      ),
    ),
  );

  let accepted = 0;
  for (const result of results) {
    if (result.meta.changes === 1) accepted++;
  }
  const response = jsonResponse({
    accepted,
    duplicates: normalized.length - accepted,
  } satisfies SyncPushResponse);
  if (!hasVisitorCookie) {
    response.headers.append(
      "set-cookie",
      sessionCookie(VISITOR_COOKIE, visitorToken, isSecureRequest(request)),
    );
  }
  return response;
}
