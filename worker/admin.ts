import rawCatalog from "../data/catalog.json";
import {
  LIMITS,
  type AdminChapterRow,
  type AdminQuestionRow,
  type AdminStatsResponse,
  type AnonymousStats,
  type EventType,
} from "../shared/api";
import { requireAdmin } from "./auth";
import { catalog } from "./catalog";
import { assertMethod, HttpError, jsonResponse } from "./lib/http";

interface UsersRow {
  users: number;
}

interface QuestionAggregateRow {
  bank_id: string;
  question_id: string;
  attempts: number;
  errors: number;
}

interface AnonymousAggregateRow {
  visitors: number;
  events: number;
  attempts: number;
  errors: number;
  kind: EventType | null;
  kind_events: number | null;
}

interface CatalogQuestionDimension {
  bankId: string;
  chapterId: string;
  questionId: string;
}


interface ChapterAccumulator {
  bankId: string;
  chapterId: string;
  attempts: number;
  errors: number;
}

function errorRate(errors: number, attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.round((errors / attempts) * 10_000) / 10_000;
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

const FILTER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function optionalFilter(value: string | null, name: string): string | null {
  if (value === null || value === "") return null;
  if (!FILTER_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_request", { detail: `${name} is invalid` });
  }
  return value;
}

function anonymousFilter(
  bankId: string | null,
  chapterId: string | null,
): { sql: string; values: string[] } {
  if (chapterId === null) {
    return bankId === null
      ? { sql: "", values: [] }
      : { sql: "WHERE bank_id = ?", values: [bankId] };
  }

  const questions: readonly CatalogQuestionDimension[] = rawCatalog.questions;
  const questionIdsByBank = new Map<string, string[]>();
  for (const question of questions) {
    if (question.chapterId !== chapterId || (bankId !== null && question.bankId !== bankId)) {
      continue;
    }
    const questionIds = questionIdsByBank.get(question.bankId) ?? [];
    questionIds.push(question.questionId);
    questionIdsByBank.set(question.bankId, questionIds);
  }

  if (questionIdsByBank.size === 0) return { sql: "WHERE 0", values: [] };
  const clauses: string[] = [];
  const values: string[] = [];
  for (const [filteredBankId, questionIds] of questionIdsByBank) {
    clauses.push(
      "(bank_id = ? AND question_id IN (SELECT value FROM json_each(?)))",
    );
    values.push(filteredBankId, JSON.stringify(questionIds));
  }
  return { sql: `WHERE ${clauses.join(" OR ")}`, values };
}


/**
 * Aggregate-only admin statistics. Deliberately no per-user endpoint and no
 * user identifiers in the response: the admin can see population health, not
 * individual histories.
 */
export async function handleAdminStats(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  assertMethod(request, "GET");
  await requireAdmin(request, env);

  const minSamples = queryInteger(
    url.searchParams.get("minSamples"),
    LIMITS.adminMinSamplesDefault,
    1,
    100_000,
    "minSamples",
  );
  const limit = queryInteger(
    url.searchParams.get("limit"),
    LIMITS.adminLeaderboardLimit,
    1,
    LIMITS.adminLeaderboardMax,
    "limit",
  );
  const bankId = optionalFilter(url.searchParams.get("bankId"), "bankId");
  const chapterId = optionalFilter(url.searchParams.get("chapterId"), "chapterId");
  if (bankId !== null && !catalog.getBank(bankId)) {
    throw new HttpError(400, "invalid_request", { detail: `unknown bankId ${bankId}` });
  }
  if (chapterId !== null) {
    const knownChapter = [...catalog.chapters.values()].some(
      (chapter) =>
        chapter.chapterId === chapterId && (bankId === null || chapter.bankId === bankId),
    );
    if (!knownChapter) {
      throw new HttpError(400, "invalid_request", { detail: `unknown chapterId ${chapterId}` });
    }
  }

  const anonymousQueryFilter = anonymousFilter(bankId, chapterId);
  const [usersResult, questionResult, anonymousResult] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS users FROM users"),
    env.DB.prepare(
      `SELECT bank_id, question_id,
              COUNT(*) AS attempts,
              COALESCE(SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END), 0) AS errors
       FROM events
       WHERE kind = 'attempt.record'
       GROUP BY bank_id, question_id`,
    ),
    env.DB.prepare(
      `WITH filtered AS (
         SELECT visitor_hash, kind, is_correct FROM anonymous_events
         ${anonymousQueryFilter.sql}
       ), totals AS (
         SELECT COUNT(DISTINCT visitor_hash) AS visitors,
                COUNT(*) AS events,
                COALESCE(SUM(CASE WHEN kind = 'attempt.record' THEN 1 ELSE 0 END), 0) AS attempts,
                COALESCE(SUM(CASE WHEN kind = 'attempt.record' AND is_correct = 0 THEN 1 ELSE 0 END), 0) AS errors
         FROM filtered
       ), kinds AS (
         SELECT kind, COUNT(*) AS kind_events FROM filtered GROUP BY kind
       )
       SELECT totals.*, kinds.kind, kinds.kind_events
       FROM totals LEFT JOIN kinds ON 1 = 1`,
    ).bind(...anonymousQueryFilter.values),
  ]);

  const users = Number((usersResult.results[0] as unknown as UsersRow | undefined)?.users ?? 0);

  const anonymousTotals = anonymousResult.results[0] as unknown as AnonymousAggregateRow | undefined;
  const anonymous: AnonymousStats = {
    visitors: Number(anonymousTotals?.visitors ?? 0),
    events: Number(anonymousTotals?.events ?? 0),
    attempts: Number(anonymousTotals?.attempts ?? 0),
    errors: Number(anonymousTotals?.errors ?? 0),
    errorRate: 0,
    byType: {},
  };
  for (const raw of anonymousResult.results as unknown as AnonymousAggregateRow[]) {
    if (raw.kind !== null) anonymous.byType[raw.kind] = Number(raw.kind_events);
  }
  anonymous.errorRate = errorRate(anonymous.errors, anonymous.attempts);


  const questionRows: AdminQuestionRow[] = [];
  const chapterAccumulators = new Map<string, ChapterAccumulator>();
  let attempts = 0;
  let errors = 0;
  for (const raw of questionResult.results as unknown as QuestionAggregateRow[]) {
    const question = catalog.getQuestion(raw.bank_id, raw.question_id);
    if (!question) continue;
    if (bankId !== null && question.bankId !== bankId) continue;
    if (chapterId !== null && question.chapterId !== chapterId) continue;
    const rowAttempts = Number(raw.attempts);
    const rowErrors = Number(raw.errors);
    attempts += rowAttempts;
    errors += rowErrors;
    questionRows.push({
      bankId: question.bankId,
      questionId: question.questionId,
      chapterId: question.chapterId,
      attempts: rowAttempts,
      errors: rowErrors,
      errorRate: errorRate(rowErrors, rowAttempts),
    });

    const key = `${question.bankId}\u0000${question.chapterId}`;
    const chapter = chapterAccumulators.get(key) ?? {
      bankId: question.bankId,
      chapterId: question.chapterId,
      attempts: 0,
      errors: 0,
    };
    chapter.attempts += rowAttempts;
    chapter.errors += rowErrors;
    chapterAccumulators.set(key, chapter);
  }

  const leaderboard = questionRows
    .filter((row) => row.attempts >= minSamples)
    .sort(
      (a, b) =>
        b.errorRate - a.errorRate ||
        b.attempts - a.attempts ||
        a.questionId.localeCompare(b.questionId),
    )
    .slice(0, limit);

  const chapters: AdminChapterRow[] = [...chapterAccumulators.values()]
    .map((chapter) => ({
      bankId: chapter.bankId,
      chapterId: chapter.chapterId,
      attempts: chapter.attempts,
      errors: chapter.errors,
      errorRate: errorRate(chapter.errors, chapter.attempts),
    }))
    .sort((a, b) => b.attempts - a.attempts || a.chapterId.localeCompare(b.chapterId));

  const body: AdminStatsResponse = {
    generatedAt: new Date().toISOString(),
    minSamples,
    totals: {
      users,
      attempts,
      errors,
      errorRate: errorRate(errors, attempts),
    },
    anonymous,
    leaderboard,
    chapters,
  };
  return jsonResponse(body);
}
