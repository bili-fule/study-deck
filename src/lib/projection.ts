import { cardBelongsToBank, getQuestion, knowledgeCards } from "@/lib/bank";
import { isCorrect } from "@/lib/scoring";
import type { AppProjection, CardProjection, QuestionStat } from "@/lib/types";
import type { SyncEvent } from "@/shared/api";

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sortedEvents(events: readonly SyncEvent[]): SyncEvent[] {
  return [...events].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export function projectEvents(events: readonly SyncEvent[], bankId?: string): AppProjection {
  const statsByQuestion = new Map<string, QuestionStat>();
  const favorites = new Map<string, boolean>();
  const cardStates = new Map<string, CardProjection>();
  const examHistory: AppProjection["examHistory"] = [];
  let totalAttempts = 0;
  let totalCorrect = 0;

  const ordered = sortedEvents(events);
  const today = dateKey(new Date());
  const dailyMap = new Map<string, { attempts: number; correct: number }>();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    dailyMap.set(dateKey(date), { attempts: 0, correct: 0 });
  }

  for (const event of ordered) {
    if (event.type === "attempt.record") {
      const payload = event.payload;
      const question = getQuestion(payload.questionId);
      if (!question || (bankId && question.bankId !== bankId)) continue;
      const correct = isCorrect(question, payload.selected);
      const current =
        statsByQuestion.get(payload.questionId) ??
        ({
          questionId: payload.questionId,
          bankId: payload.bankId,
          attempts: 0,
          correct: 0,
          lastAt: null,
          lastCorrect: null,
          lastSelected: [],
          favorite: false,
        } satisfies QuestionStat);
      current.attempts += 1;
      current.correct += correct ? 1 : 0;
      current.lastAt = event.at;
      current.lastCorrect = correct;
      current.lastSelected = payload.selected;
      current.bankId = payload.bankId;
      statsByQuestion.set(payload.questionId, current);
      totalAttempts += 1;
      totalCorrect += correct ? 1 : 0;
      const day = dailyMap.get(dateKey(new Date(event.at)));
      if (day) {
        day.attempts += 1;
        day.correct += correct ? 1 : 0;
      }
    } else if (event.type === "favorite.set") {
      if (bankId && getQuestion(event.payload.questionId)?.bankId !== bankId) continue;
      favorites.set(event.payload.questionId, event.payload.favorite);
    } else if (event.type === "card.state") {
      if (bankId && !cardBelongsToBank(event.payload.cardId, bankId)) continue;
      const payload = event.payload;
      if (payload.state === null) {
        cardStates.delete(payload.cardId);
      } else {
        cardStates.set(payload.cardId, {
          cardId: payload.cardId,
          intervalDays: payload.state.intervalDays,
          ease: payload.state.ease,
          dueAt: payload.state.dueAt,
          reps: payload.state.reps,
          lapses: payload.state.lapses,
          lastRating: null,
        });
      }
    } else if (event.type === "card.reviewed") {
      if (bankId && !cardBelongsToBank(event.payload.cardId, bankId)) continue;
      const current = cardStates.get(event.payload.cardId);
      if (current) current.lastRating = event.payload.rating;
    } else if (event.type === "exam.completed") {
      if (bankId && event.payload.bankId !== bankId) continue;
      const payload = event.payload;
      let correct = 0;
      for (const answer of payload.answers) {
        const question = getQuestion(answer.questionId);
        if (question && isCorrect(question, answer.selected)) correct += 1;
      }
      examHistory.push({
        eventId: event.id,
        at: event.at,
        bankId: payload.bankId,
        totalQuestions: payload.totalQuestions,
        answered: payload.answers.length,
        correct,
        accuracy: payload.answers.length ? Math.round((correct / payload.answers.length) * 100) : 0,
        durationMs: payload.durationMs,
      });
    }
  }

  for (const [questionId, favorite] of favorites) {
    const current = statsByQuestion.get(questionId);
    if (current) current.favorite = favorite;
    else if (favorite) {
      const question = getQuestion(questionId);
      if (question) {
        statsByQuestion.set(questionId, {
          questionId,
          bankId: question.bankId,
          attempts: 0,
          correct: 0,
          lastAt: null,
          lastCorrect: null,
          lastSelected: [],
          favorite: true,
        });
      }
    }
  }

  const wrongQuestionIds: string[] = [];
  const favoriteQuestionIds: string[] = [];
  for (const stat of statsByQuestion.values()) {
    if (stat.lastCorrect === false) wrongQuestionIds.push(stat.questionId);
    if (stat.favorite) favoriteQuestionIds.push(stat.questionId);
  }

  const dueCardIds: string[] = [];
  for (const card of knowledgeCards) {
    if (bankId && !cardBelongsToBank(card.cardId, bankId)) continue;
    const state = cardStates.get(card.cardId);
    if (!state || new Date(state.dueAt).getTime() <= Date.now()) dueCardIds.push(card.cardId);
  }

  const daily = [...dailyMap.entries()].map(([date, value]) => ({
    date,
    label: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${date}T12:00:00`)),
    ...value,
  }));

  const attemptDays = new Set<string>();
  for (const event of ordered) {
    if (event.type === "attempt.record") attemptDays.add(dateKey(new Date(event.at)));
  }
  let streakDays = 0;
  const cursor = new Date();
  if (!attemptDays.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (attemptDays.has(dateKey(cursor))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    statsByQuestion,
    examHistory: examHistory.sort((a, b) => b.at.localeCompare(a.at)),
    cardStates,
    attempted: statsByQuestion.size ? [...statsByQuestion.values()].filter((stat) => stat.attempts > 0).length : 0,
    correct: totalCorrect,
    accuracy: totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
    wrongQuestionIds: wrongQuestionIds.sort(),
    favoriteQuestionIds: favoriteQuestionIds.sort(),
    dueCardIds,
    todayAttempts: dailyMap.get(today)?.attempts ?? 0,
    streakDays,
    daily,
  };
}
