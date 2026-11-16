/**
 * Study Deck cloud API contract — shared by the Worker (backend) and the SPA.
 *
 * Deployment: the Worker API may run on a separate configured origin and
 * allows credentialed CORS only for its origin allowlist. Requests authenticate
 * with the HttpOnly `sd_session` cookie; there is no bearer-token mode.
 */

export const API_PREFIX = "/api";
export const SESSION_COOKIE = "sd_session";

export const LIMITS = {
  usernameMin: 3,
  usernameMax: 32,
  passwordMin: 10,
  passwordMax: 200,
  inviteCodeMin: 8,
  inviteCodeMax: 64,
  pushMaxEvents: 200,
  pushMaxBodyBytes: 256 * 1024,
  pullDefaultLimit: 200,
  pullMaxLimit: 500,
  adminMinSamplesDefault: 20,
  adminLeaderboardLimit: 50,
  adminLeaderboardMax: 200,
} as const;

export type Role = "user" | "admin";

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  /** ISO-8601 */
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export interface RegisterRequest {
  username: string;
  password: string;
  inviteCode: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: PublicUser;
}

/* ------------------------------------------------------------------ */
/* Sync: append-only, per-user event log                               */
/* ------------------------------------------------------------------ */

export type EventType =
  | "attempt.record"
  | "favorite.set"
  | "exam.completed"
  | "card.reviewed"
  | "card.state";

/** A single submitted answer. Only actual submissions become events: unanswered
 *  questions in a mock must NOT produce an attempt event. Answered mock items
 *  are emitted once with `mode: "mock"` so they count toward easy-error stats;
 *  the enclosing `exam.completed` event is history only and never contributes
 *  to attempt/error aggregates (no double counting). */
export interface AttemptRecordPayload {
  bankId: string;
  questionId: string;
  /** Content-stable option ids, e.g. ["o_1a2b3c4d5e"]. Display labels like
   *  "A"/"B"/"C"/"D" are UI-only and must never be persisted or sent.
   *  Set equality against the seeded answer key. */
  selected: string[];
  mode: "practice" | "mock";
}

/** Favorite flag per question. `false` is a tombstone; never hard-delete. */
export interface FavoriteSetPayload {
  bankId: string;
  questionId: string;
  favorite: boolean;
}

export interface ExamAnswer {
  questionId: string;
  selected: string[];
}

/** Completed mock exam. `answers` contains answered questions only; the server
 *  recomputes the verified score. Mock answers do not feed attempt/error stats. */
export interface ExamCompletedPayload {
  bankId: string;
  totalQuestions: number;
  answers: ExamAnswer[];
  /** ISO-8601 */
  startedAt: string;
  /** ISO-8601 */
  completedAt: string;
  durationMs: number;
}

export type CardRating = "again" | "hard" | "good" | "easy";

export interface CardReviewedPayload {
  cardId: string;
  rating: CardRating;
}

export interface CardStateValue {
  intervalDays: number;
  ease: number;
  /** ISO-8601 */
  dueAt: string;
  reps: number;
  lapses: number;
}

/** Per-card scheduling state. `null` is a reset tombstone. LWW by event `at`. */
export interface CardStatePayload {
  cardId: string;
  state: CardStateValue | null;
}

interface EventEnvelope<TType extends EventType, TPayload> {
  /** Client-generated UUID; idempotency key, unique per user. */
  id: string;
  type: TType;
  /** ISO-8601; used for LWW ordering (tie-break: id) and attempt timestamps. */
  at: string;
  payload: TPayload;
}

export type AttemptEvent = EventEnvelope<"attempt.record", AttemptRecordPayload>;
export type FavoriteEvent = EventEnvelope<"favorite.set", FavoriteSetPayload>;
export type ExamEvent = EventEnvelope<"exam.completed", ExamCompletedPayload>;
export type CardReviewedEvent = EventEnvelope<"card.reviewed", CardReviewedPayload>;
export type CardStateEvent = EventEnvelope<"card.state", CardStatePayload>;

export type SyncEvent =
  | AttemptEvent
  | FavoriteEvent
  | ExamEvent
  | CardReviewedEvent
  | CardStateEvent;

export interface SyncPushRequest {
  events: SyncEvent[];
}

export interface SyncPushResponse {
  /** Events inserted for the first time. */
  accepted: number;
  /** Events already stored for this user (idempotent re-push). */
  duplicates: number;
}

/** Pulled events carry the server cursor. Cursor only advances from pull
 *  responses; never derive your pull cursor from a push response. */
export type PulledEvent = SyncEvent & { seq: number };

export interface SyncPullResponse {
  events: PulledEvent[];
  nextCursor: number;
  hasMore: boolean;
}

/* ------------------------------------------------------------------ */
/* Admin aggregates (no per-user data, by design)                      */
/* ------------------------------------------------------------------ */

export interface AdminTotals {
  users: number;
  attempts: number;
  errors: number;
  /** errors / attempts, 0 when attempts === 0 */
  errorRate: number;
}

export interface AdminQuestionRow {
  bankId: string;
  questionId: string;
  chapterId: string;
  attempts: number;
  errors: number;
  errorRate: number;
}

export interface AdminChapterRow {
  bankId: string;
  chapterId: string;
  attempts: number;
  errors: number;
  errorRate: number;
}

export interface AnonymousStats {
  /** Distinct visitor-cookie hashes with at least one accepted event. */
  visitors: number;
  events: number;
  attempts: number;
  errors: number;
  /** errors / attempts, 0 when attempts === 0 */
  errorRate: number;
  byType: Partial<Record<EventType, number>>;
}


export interface AdminStatsResponse {
  /** ISO-8601 */
  generatedAt: string;
  minSamples: number;
  totals: AdminTotals;
  /** Anonymous aggregates remain separate from registered account totals. */
  anonymous: AnonymousStats;
  /** Easy-error leaderboard: questions with >= minSamples attempts, highest
   *  error rate first. Contains no user identifiers. */
  leaderboard: AdminQuestionRow[];
  /** Chapter roll-up of the same attempt aggregates. */
  chapters: AdminChapterRow[];
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export interface ApiErrorBody {
  error: string;
  detail?: string;
  /** Index of the offending event for `invalid_event`. */
  index?: number;
}

export interface HealthResponse {
  ok: true;
  banks: number;
  questions: number;
  /** ISO-8601 */
  catalogGeneratedAt: string;
}
