import {
  LIMITS,
  type AttemptRecordPayload,
  type CardRating,
  type CardReviewedPayload,
  type CardStatePayload,
  type ExamCompletedPayload,
  type FavoriteSetPayload,
  type PulledEvent,
  type SyncEvent,
} from "../shared/api";
import { requireUser } from "./auth";
import { catalog, isAnswerCorrect, type CatalogQuestion } from "./catalog";
import {
  HttpError,
  jsonResponse,
  readJsonObject,
} from "./lib/http";

const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 7 * DAY_MS;
const MIN_EVENT_TIME = Date.UTC(2020, 0, 1);
const MAX_EXAM_DURATION_MS = 24 * 60 * 60 * 1000;
const CARD_RATINGS: readonly CardRating[] = ["again", "hard", "good", "easy"];

class EventError extends Error {}

export interface NormalizedSyncEvent {
  id: string;
  kind: SyncEvent["type"];
  atMs: number;
  bankId: string | null;
  questionId: string | null;
  isCorrect: number | null;
  scoreCorrect: number | null;
  scoreTotal: number | null;
  payloadJson: string;
}

interface EventRow {
  seq: number;
  id: string;
  kind: SyncEvent["type"];
  at: number;
  payload: string;
}

function fail(reason: string): never {
  throw new EventError(reason);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    fail(`${field} must be 1-128 chars of A-Z a-z 0-9 _ . : -`);
  }
  return value;
}

function asIsoTime(value: unknown, field: string): number {
  if (typeof value !== "string") fail(`${field} must be an ISO-8601 string`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(`${field} must be an ISO-8601 string`);
  return parsed;
}

function asInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function asFiniteNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(`${field} must be a number between ${min} and ${max}`);
  }
  return value;
}

function requireQuestion(bankId: string, questionId: string): CatalogQuestion {
  const question = catalog.getQuestion(bankId, questionId);
  if (!question) fail(`unknown question ${bankId}/${questionId}`);
  return question;
}

/** Validate and normalize a submission's selected option ids. */
function asSelected(value: unknown, question: CatalogQuestion): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("selected must be a non-empty array of option ids");
  }
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !question.optionKeySet.has(item)) {
      fail(`unknown option id for question ${question.questionId}`);
    }
    if (unique.has(item)) fail("selected contains a duplicate option id");
    unique.add(item);
  }
  if (question.type !== "multiple" && unique.size !== 1) {
    fail(`${question.type} questions must select exactly one option`);
  }
  return [...unique].sort();
}

function normalizeEvent(value: unknown, now: number): NormalizedSyncEvent {
  const event = asRecord(value, "event");
  const id = event.id;
  if (typeof id !== "string" || !EVENT_ID_PATTERN.test(id)) {
    fail("event id must be 8-64 chars of A-Z a-z 0-9 _ -");
  }
  const type = event.type;
  if (typeof type !== "string") fail("event type is required");
  const atMs = asIsoTime(event.at, "at");
  if (atMs > now + FUTURE_SKEW_MS) fail("event at is too far in the future");
  if (atMs < MIN_EVENT_TIME) fail("event at is implausibly old");
  const payload = asRecord(event.payload, "payload");

  switch (type) {
    case "attempt.record": {
      const bankId = asId(payload.bankId, "bankId");
      const questionId = asId(payload.questionId, "questionId");
      const question = requireQuestion(bankId, questionId);
      const selected = asSelected(payload.selected, question);
      const mode = payload.mode;
      if (mode !== "practice" && mode !== "mock") {
        fail("mode must be practice or mock");
      }
      return {
        id,
        kind: "attempt.record",
        atMs,
        bankId,
        questionId,
        isCorrect: isAnswerCorrect(question, selected) ? 1 : 0,
        scoreCorrect: null,
        scoreTotal: null,
        payloadJson: JSON.stringify({ bankId, questionId, selected, mode }),
      };
    }

    case "favorite.set": {
      const bankId = asId(payload.bankId, "bankId");
      const questionId = asId(payload.questionId, "questionId");
      requireQuestion(bankId, questionId);
      if (typeof payload.favorite !== "boolean") fail("favorite must be a boolean");
      return {
        id,
        kind: "favorite.set",
        atMs,
        bankId,
        questionId,
        isCorrect: null,
        scoreCorrect: null,
        scoreTotal: null,
        payloadJson: JSON.stringify({
          bankId,
          questionId,
          favorite: payload.favorite,
        }),
      };
    }

    case "exam.completed": {
      const bankId = asId(payload.bankId, "bankId");
      const bank = catalog.getBank(bankId);
      if (!bank) fail(`unknown bank ${bankId}`);
      const totalQuestions = asInteger(
        payload.totalQuestions,
        "totalQuestions",
        1,
        bank.questionCount,
      );
      if (!Array.isArray(payload.answers)) fail("answers must be an array");
      if (payload.answers.length > totalQuestions) {
        fail("answers cannot exceed totalQuestions");
      }
      const startedAt = asIsoTime(payload.startedAt, "startedAt");
      const completedAt = asIsoTime(payload.completedAt, "completedAt");
      if (completedAt < startedAt) fail("completedAt must not precede startedAt");
      const durationMs = asInteger(payload.durationMs, "durationMs", 0, MAX_EXAM_DURATION_MS);

      const seen = new Set<string>();
      let correct = 0;
      const answers: Array<{ questionId: string; selected: string[] }> = [];
      for (const entry of payload.answers) {
        const answer = asRecord(entry, "answers[]");
        const questionId = asId(answer.questionId, "questionId");
        if (seen.has(questionId)) fail("duplicate answer for the same question");
        seen.add(questionId);
        const question = requireQuestion(bankId, questionId);
        const selected = asSelected(answer.selected, question);
        if (isAnswerCorrect(question, selected)) correct++;
        answers.push({ questionId, selected });
      }

      return {
        id,
        kind: "exam.completed",
        atMs,
        bankId,
        questionId: null,
        isCorrect: null,
        scoreCorrect: correct,
        scoreTotal: totalQuestions,
        payloadJson: JSON.stringify({
          bankId,
          totalQuestions,
          answers,
          startedAt: new Date(startedAt).toISOString(),
          completedAt: new Date(completedAt).toISOString(),
          durationMs,
        }),
      };
    }

    case "card.reviewed": {
      const cardId = asId(payload.cardId, "cardId");
      const rating = payload.rating;
      if (typeof rating !== "string" || !CARD_RATINGS.includes(rating as CardRating)) {
        fail("rating must be again, hard, good or easy");
      }
      return {
        id,
        kind: "card.reviewed",
        atMs,
        bankId: null,
        questionId: null,
        isCorrect: null,
        scoreCorrect: null,
        scoreTotal: null,
        payloadJson: JSON.stringify({ cardId, rating }),
      };
    }

    case "card.state": {
      const cardId = asId(payload.cardId, "cardId");
      const rawState = payload.state;
      let state: null | {
        intervalDays: number;
        ease: number;
        dueAt: string;
        reps: number;
        lapses: number;
      } = null;
      if (rawState !== null) {
        const record = asRecord(rawState, "state");
        state = {
          intervalDays: asFiniteNumber(record.intervalDays, "intervalDays", 0, 36_500),
          ease: asFiniteNumber(record.ease, "ease", 1, 5),
          dueAt: new Date(asIsoTime(record.dueAt, "dueAt")).toISOString(),
          reps: asInteger(record.reps, "reps", 0, 1_000_000),
          lapses: asInteger(record.lapses, "lapses", 0, 1_000_000),
        };
      }
      return {
        id,
        kind: "card.state",
        atMs,
        bankId: null,
        questionId: null,
        isCorrect: null,
        scoreCorrect: null,
        scoreTotal: null,
        payloadJson: JSON.stringify({ cardId, state }),
      };
    }

    default:
      fail(`unsupported event type ${JSON.stringify(type)}`);
  }
}

/**
 * Validate a push/telemetry request's event batch completely before any writes.
 * Event failures report their zero-based index in the original batch.
 */
export function normalizeSyncEventBatch(
  body: Record<string, unknown>,
  now = Date.now(),
): NormalizedSyncEvent[] {
  const rawEvents = body.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    throw new HttpError(400, "invalid_request", {
      detail: "events must be a non-empty array",
    });
  }
  if (rawEvents.length > LIMITS.pushMaxEvents) {
    throw new HttpError(413, "payload_too_large", {
      detail: `at most ${LIMITS.pushMaxEvents} events per push`,
    });
  }

  const normalized: NormalizedSyncEvent[] = [];
  for (let index = 0; index < rawEvents.length; index++) {
    try {
      normalized.push(normalizeEvent(rawEvents[index], now));
    } catch (error) {
      if (error instanceof EventError) {
        throw new HttpError(422, "invalid_event", {
          detail: error.message,
          extra: { index },
        });
      }
      throw error;
    }
  }
  return normalized;
}


export async function handlePush(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJsonObject(request, LIMITS.pushMaxBodyBytes);
  const now = Date.now();
  const normalized = normalizeSyncEventBatch(body, now);

  // Validation completes before the append-only batch begins.
  const results = await env.DB.batch(
    normalized.map((event) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO events
           (user_id, id, kind, at, bank_id, question_id, is_correct,
            score_correct, score_total, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        user.id,
        event.id,
        event.kind,
        event.atMs,
        event.bankId,
        event.questionId,
        event.isCorrect,
        event.scoreCorrect,
        event.scoreTotal,
        event.payloadJson,
        now,
      ),
    ),
  );

  let accepted = 0;
  for (const result of results) {
    if (result.meta.changes === 1) accepted++;
  }
  return jsonResponse({
    accepted,
    duplicates: normalized.length - accepted,
  });
}

function queryInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    throw new HttpError(400, "invalid_request", { detail: `${name} must be an integer` });
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, "invalid_request", {
      detail: `${name} must be between ${min} and ${max}`,
    });
  }
  return parsed;
}

export async function handlePull(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const user = await requireUser(request, env);
  const cursor = queryInteger(
    url.searchParams.get("cursor"),
    0,
    0,
    Number.MAX_SAFE_INTEGER,
    "cursor",
  );
  const limit = queryInteger(
    url.searchParams.get("limit"),
    LIMITS.pullDefaultLimit,
    1,
    LIMITS.pullMaxLimit,
    "limit",
  );

  const rows = await env.DB.prepare(
    `SELECT seq, id, kind, at, payload
     FROM events
     WHERE user_id = ? AND seq > ?
     ORDER BY seq
     LIMIT ?`,
  )
    .bind(user.id, cursor, limit + 1)
    .all<EventRow>();

  const page = rows.results.slice(0, limit);
  const events: PulledEvent[] = page.map((row) => {
    // Payloads are validated before insert and replayed verbatim. The cast is
    // the JSON boundary, keyed by the stored event kind.
    const payload = JSON.parse(row.payload) as unknown;
    const base = {
      seq: row.seq,
      id: row.id,
      at: new Date(row.at).toISOString(),
    };
    switch (row.kind) {
      case "attempt.record":
        return { ...base, type: row.kind, payload: payload as AttemptRecordPayload };
      case "favorite.set":
        return { ...base, type: row.kind, payload: payload as FavoriteSetPayload };
      case "exam.completed":
        return { ...base, type: row.kind, payload: payload as ExamCompletedPayload };
      case "card.reviewed":
        return { ...base, type: row.kind, payload: payload as CardReviewedPayload };
      case "card.state":
        return { ...base, type: row.kind, payload: payload as CardStatePayload };
    }
  });
  const nextCursor = page.length > 0 ? page[page.length - 1]!.seq : cursor;
  return jsonResponse({
    events,
    nextCursor,
    hasMore: rows.results.length > limit,
  });
}
