import rawBundle from "@/data/bank.bundle.json";
import rawCards from "@/data/cards.json";
import type {
  AppProjection,
  Bank,
  BankBundle,
  BankQuestion,
  KnowledgeCard,
  KnowledgeCardsFile,
  PracticeMode,
  QuestionStat,
} from "@/lib/types";
import { shuffle, weightedSample } from "@/lib/prng";

const bundle = rawBundle as BankBundle;
const cardsFile = rawCards as KnowledgeCardsFile;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[StudyDeck] 数据校验失败：${message}`);
}

export function validateData(): void {
  invariant(bundle.schemaVersion === 1, "bank.bundle schemaVersion 必须为 1");
  invariant(bundle.banks.length > 0, "题库为空");
  const questionIds = new Set<string>();
  for (const bank of bundle.banks) {
    invariant(bank.questions.length === bank.collected, `${bank.bankId} 题量不一致`);
    for (const question of bank.questions) {
      invariant(question.optionKeys.length >= 2, `${question.questionId} 选项不足`);
      invariant(new Set(question.optionKeys).size === question.optionKeys.length, `${question.questionId} 选项 ID 重复`);
      invariant(question.answerKey.length > 0, `${question.questionId} 缺少答案`);
      for (const key of question.answerKey) {
        invariant(question.optionKeys.includes(key), `${question.questionId} 答案不在选项内`);
      }
      invariant(!questionIds.has(question.questionId), `${question.questionId} 题目 ID 重复`);
      questionIds.add(question.questionId);
    }
  }
  const cardIds = new Set<string>();
  for (const card of cardsFile.cards) {
    invariant(!cardIds.has(card.cardId), `${card.cardId} 卡片 ID 重复`);
    cardIds.add(card.cardId);
    invariant(card.questionIds.length > 0, `${card.cardId} 未关联题目`);
    for (const questionId of card.questionIds) {
      invariant(questionIds.has(questionId), `${card.cardId} 关联了不存在的题目 ${questionId}`);
    }
  }
}

validateData();

export const bankBundle = bundle;
export const banks = bundle.banks;
export const primaryBank = bundle.banks[0];
export const knowledgeCards: KnowledgeCard[] = cardsFile.cards;

const questionIndex = new Map<string, BankQuestion>();
for (const bank of banks) for (const question of bank.questions) questionIndex.set(question.questionId, question);

export function getQuestion(questionId: string): BankQuestion | undefined {
  return questionIndex.get(questionId);
}

export function getBank(bankId: string): Bank {
  const bank = banks.find((candidate) => candidate.bankId === bankId);
  return bank ?? primaryBank;
}

export function getChapter(bankId: string, chapterId: string) {
  return getBank(bankId).chapters.find((chapter) => chapter.chapterId === chapterId);
}

export function cardsForBank(bankId: string): KnowledgeCard[] {
  const questionIds = new Set(getBank(bankId).questions.map((question) => question.questionId));
  return knowledgeCards.filter((card) => card.questionIds.some((id) => questionIds.has(id)));
}

const cardBankIndex = new Map<string, Set<string>>();
for (const card of knowledgeCards) {
  const bankIds = new Set<string>();
  for (const questionId of card.questionIds) {
    const question = questionIndex.get(questionId);
    if (question) bankIds.add(question.bankId);
  }
  cardBankIndex.set(card.cardId, bankIds);
}

export function cardBelongsToBank(cardId: string, bankId: string): boolean {
  return cardBankIndex.get(cardId)?.has(bankId) ?? false;
}

export function chapterQuestions(bankId: string, chapterId: string): BankQuestion[] {
  return getBank(bankId).questions.filter((question) => question.chapterId === chapterId);
}

export function filterQuestions(
  bankId: string,
  chapterId: string | undefined,
  questionIds?: readonly string[],
): BankQuestion[] {
  const bank = getBank(bankId);
  const allow = questionIds ? new Set(questionIds) : null;
  return bank.questions.filter(
    (question) =>
      (!chapterId || question.chapterId === chapterId) && (!allow || allow.has(question.questionId)),
  );
}

export function buildQuestionSet({
  bankId,
  mode,
  chapterId,
  count,
  seed,
  projection,
}: {
  bankId: string;
  mode: PracticeMode | "mock";
  chapterId?: string;
  count: number;
  seed: string;
  projection: AppProjection;
}): BankQuestion[] {
  const bank = getBank(bankId);
  let pool = bank.questions;
  if (chapterId) pool = pool.filter((question) => question.chapterId === chapterId);
  if (mode === "mistakes") {
    const wrong = new Set(projection.wrongQuestionIds);
    pool = pool.filter((question) => wrong.has(question.questionId));
  }
  if (mode === "favorites") {
    const favorites = new Set(projection.favoriteQuestionIds);
    pool = pool.filter((question) => favorites.has(question.questionId));
  }
  if (mode === "chapter" || mode === "unanswered") {
    const ordered = mode === "unanswered"
      ? pool.filter(({ questionId }) => !projection.statsByQuestion.get(questionId)?.attempts)
      : [...pool];
    ordered.sort((a, b) => a.chapterId.localeCompare(b.chapterId) || a.order - b.order);
    return ordered.length > count ? ordered.slice(0, count) : ordered;
  }
  if (mode === "random" || mode === "mock" || mode === "mistakes" || mode === "favorites") {
    return shuffle(pool, seed).slice(0, count);
  }

  // Adaptive: guarantee chapter coverage first, then weight errors/new/due.
  const selected: BankQuestion[] = [];
  const chosen = new Set<string>();
  const byChapter = new Map<string, BankQuestion[]>();
  for (const question of pool) {
    const list = byChapter.get(question.chapterId) ?? [];
    list.push(question);
    byChapter.set(question.chapterId, list);
  }
  const chapterOrder = shuffle([...byChapter.keys()], `${seed}:chapters`);
  const now = Date.now();
  if (count >= byChapter.size) {
    for (const chapter of chapterOrder) {
      if (selected.length >= count) break;
      const candidates = (byChapter.get(chapter) ?? []).filter((q) => !chosen.has(q.questionId));
      if (candidates.length === 0) continue;
      const [pick] = weightedSample(candidates, adaptiveWeight(projection, now), 1, `${seed}:first:${chapter}`);
      if (pick) {
        selected.push(pick);
        chosen.add(pick.questionId);
      }
    }
  }
  const remaining = pool.filter((question) => !chosen.has(question.questionId));
  selected.push(
    ...weightedSample(remaining, adaptiveWeight(projection, now), count - selected.length, `${seed}:fill`),
  );
  return selected.slice(0, count);
}

function adaptiveWeight(projection: AppProjection, now: number) {
  return (question: BankQuestion): number => {
    const stat = projection.statsByQuestion.get(question.questionId);
    if (!stat || stat.attempts === 0) return 2.2;
    const errorRate = 1 - stat.correct / stat.attempts;
    let weight = 0.45 + errorRate * 3.2;
    if (stat.lastCorrect === false) weight += 2.6;
    if (stat.lastCorrect === true) weight -= 0.35;
    if (stat.lastAt) {
      const days = (now - new Date(stat.lastAt).getTime()) / 86_400_000;
      if (days >= 7) weight += 1.1;
      else if (days >= 3) weight += 0.55;
    }
    return Math.max(weight, 0.15);
  };
}

/** Latest-answer mistake set (not “ever wrong”), so corrected questions leave the drill list. */
export function computeWrongQuestionIds(statsByQuestion: Map<string, QuestionStat>): string[] {
  const result: string[] = [];
  for (const stat of statsByQuestion.values()) {
    if (stat.attempts > 0 && stat.lastCorrect === false) result.push(stat.questionId);
  }
  return result.sort();
}
