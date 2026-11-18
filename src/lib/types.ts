import type { PublicUser, SyncEvent } from "@/shared/api";

export type QuestionType = "single" | "judgment" | "multiple";

export interface BankOption {
  id: string;
  label: string;
  text: string;
}

export interface BankChapter {
  chapterId: string;
  bankId: string;
  title: string;
  category: string;
  questionCount: number;
}

export interface BankQuestion {
  questionId: string;
  bankId: string;
  chapterId: string;
  order: number;
  type: QuestionType;
  stem: string;
  options: BankOption[];
  optionKeys: string[];
  answerKey: string[];
  answerText: string[];
  explanation?: string;
  sourceTitle: string;
  score: string | null;
  rounds: number[];
  occurrences: number | null;
}

export interface BankStats {
  single: number;
  judgment: number;
  multiple: number;
}

export interface Bank {
  bankId: string;
  title: string;
  shortTitle: string;
  description: string;
  sourceUrl: string;
  expectedTotal: number | null;
  collected: number;
  coverageNote: string;
  rounds: number[];
  stats: BankStats;
  chapters: BankChapter[];
  questions: BankQuestion[];
}

export interface BankBundle {
  schemaVersion: 1;
  generatedAt: string;
  banks: Bank[];
}

export interface KnowledgeCard {
  cardId: string;
  title: string;
  prompt: string;
  summary: string;
  facts: string[];
  misconception: string;
  category: string;
  tags: string[];
  questionIds: string[];
}

export interface KnowledgeCardsFile {
  schemaVersion: 1;
  generatedAt: string;
  note: string;
  cards: KnowledgeCard[];
}

export type PracticeMode = "chapter" | "unanswered" | "random" | "adaptive" | "mistakes" | "favorites";

export interface SessionConfig {
  kind: "practice" | "mock";
  mode: PracticeMode | "mock";
  bankId: string;
  chapterId?: string;
  count: number;
  seed?: string;
  durationMinutes?: number;
  title?: string;
  /** Sequential practice: start at the first unanswered question of the chapter. */
  resume?: boolean;
  /** 背题模式：直接显示答案与解析，作答不计入统计。 */
  studyMode?: boolean;
}

export interface ActiveSession {
  id: string;
  kind: "practice" | "mock";
  mode: PracticeMode | "mock";
  title: string;
  bankId: string;
  chapterId?: string;
  questionIds: string[];
  seed: string;
  createdAt: string;
  startedAt: string;
  currentIndex: number;
  /** Content-stable option ids keyed by questionId. */
  answers: Record<string, string[]>;
  /** Practice-only: the answer for this question has been checked. */
  revealed: Record<string, true>;
  /** 背题模式：进入会话即显示答案与解析，作答不计入统计。 */
  studyMode?: boolean;
  flagged: string[];
  status: "active" | "completed" | "submitted";
  deadlineAt?: number;
  durationMinutes?: number;
  submittedAt?: string;
  examEventId?: string;
}

export interface Settings {
  dailyGoal: number;
  defaultMockCount: number;
  defaultMockMinutes: number;
  showSourceInPractice: boolean;
  /** 答对后自动跳到下一题（驾考宝典式节奏）。 */
  autoNextOnCorrect: boolean;
  /** 练习页直接显示答案与解析（背题模式）。 */
  studyMode: boolean;
  /** Empty means the primary bank; resolved through getBank() so unknown ids never break the app. */
  activeBankId: string;
}

export interface LocalState {
  schemaVersion: 1;
  events: SyncEvent[];
  /** Event ids already stored server-side (or pulled from it); local-only metadata. */
  ackedEventIds: string[];
  /** Anonymous usage acknowledgments; never substitute for account synchronization. */
  telemetryAckedEventIds: string[];
  activeSession: ActiveSession | null;
  settings: Settings;
  displayName: string;
  syncCursor: number;
  lastSyncedAt: string | null;
}

export interface QuestionStat {
  questionId: string;
  bankId: string;
  attempts: number;
  correct: number;
  lastAt: string | null;
  lastCorrect: boolean | null;
  lastSelected: string[];
  favorite: boolean;
}

export interface ExamHistoryItem {
  eventId: string;
  at: string;
  bankId: string;
  totalQuestions: number;
  answered: number;
  correct: number;
  accuracy: number;
  durationMs: number;
}

export interface CardProjection {
  cardId: string;
  intervalDays: number;
  ease: number;
  dueAt: string;
  reps: number;
  lapses: number;
  lastRating: string | null;
}

export interface AppProjection {
  statsByQuestion: Map<string, QuestionStat>;
  examHistory: ExamHistoryItem[];
  cardStates: Map<string, CardProjection>;
  attempted: number;
  correct: number;
  accuracy: number;
  wrongQuestionIds: string[];
  favoriteQuestionIds: string[];
  dueCardIds: string[];
  todayAttempts: number;
  streakDays: number;
  daily: Array<{ date: string; label: string; attempts: number; correct: number }>;
}

export interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  error: string | null;
}

export interface SyncState {
  status: "offline" | "idle" | "syncing" | "error";
  lastError: string | null;
  pending: number;
  lastPulledAt: string | null;
}
