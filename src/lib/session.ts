import { buildQuestionSet, getQuestion } from "@/lib/bank";
import { createRandomSeed } from "@/lib/prng";
import { isCorrect } from "@/lib/scoring";
import type {
  ActiveSession,
  AppProjection,
  BankQuestion,
  CardProjection,
  SessionConfig,
} from "@/lib/types";
import type { CardRating } from "@/shared/api";

export function createSession(config: SessionConfig, projection: AppProjection): ActiveSession {
  const seed = config.seed?.trim() || createRandomSeed();
  const questions = buildQuestionSet({
    bankId: config.bankId,
    mode: config.mode,
    chapterId: config.chapterId,
    count: config.count,
    seed,
    projection,
  });
  const now = new Date();
  const startedAt = now.toISOString();
  return {
    id: `session_${now.getTime().toString(36)}_${seed}`,
    kind: config.kind,
    mode: config.mode,
    title: config.title ?? "练习",
    bankId: config.bankId,
    chapterId: config.chapterId,
    questionIds: questions.map((question) => question.questionId),
    seed,
    createdAt: startedAt,
    startedAt,
    currentIndex: 0,
    answers: {},
    revealed: {},
    flagged: [],
    status: "active",
    deadlineAt:
      config.kind === "mock" && config.durationMinutes
        ? now.getTime() + config.durationMinutes * 60_000
        : undefined,
    durationMinutes: config.durationMinutes,
  };
}

export function sessionQuestions(session: ActiveSession): BankQuestion[] {
  return session.questionIds
    .map((id) => getQuestion(id))
    .filter((question): question is BankQuestion => Boolean(question));
}

export interface SessionSummary {
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  unanswered: number;
  accuracy: number;
  perQuestion: Array<{
    question: BankQuestion;
    selected: string[];
    answered: boolean;
    correct: boolean;
  }>;
}

export function summarizeSession(session: ActiveSession): SessionSummary {
  const perQuestion = sessionQuestions(session).map((question) => {
    const selected = session.answers[question.questionId] ?? [];
    return {
      question,
      selected,
      answered: selected.length > 0,
      correct: isCorrect(question, selected),
    };
  });
  const answered = perQuestion.filter((entry) => entry.answered).length;
  const correct = perQuestion.filter((entry) => entry.correct).length;
  return {
    total: perQuestion.length,
    answered,
    correct,
    wrong: answered - correct,
    unanswered: perQuestion.length - answered,
    accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    perQuestion,
  };
}

export function srsNext(
  current: CardProjection | undefined,
  rating: CardRating,
): { intervalDays: number; ease: number; dueAt: string; reps: number; lapses: number } {
  const now = Date.now();
  let interval = current?.intervalDays ?? 0;
  let ease = current?.ease ?? 2.5;
  let reps = current?.reps ?? 0;
  let lapses = current?.lapses ?? 0;

  if (rating === "again") {
    interval = 10 / (24 * 60);
    ease = Math.max(1.3, ease - 0.2);
    lapses += 1;
  } else if (rating === "hard") {
    interval = Math.max(1, interval * 1.2);
    ease = Math.max(1.3, ease - 0.15);
    reps += 1;
  } else if (rating === "good") {
    interval = Math.max(1, interval * ease);
    reps += 1;
  } else {
    interval = Math.max(2, interval * ease * 1.3);
    ease = Math.min(3.2, ease + 0.15);
    reps += 1;
  }

  return {
    intervalDays: Math.round(interval * 100) / 100,
    ease: Math.round(ease * 100) / 100,
    dueAt: new Date(now + interval * 86_400_000).toISOString(),
    reps,
    lapses,
  };
}
