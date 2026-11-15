import type { ActiveSession, LocalState, Settings } from "@/lib/types";
import type { SyncEvent } from "@/shared/api";

const PREFIX = "studydeck:state:v1";
export const GUEST_SCOPE = "guest";

export const DEFAULT_SETTINGS: Settings = {
  dailyGoal: 20,
  defaultMockCount: 50,
  defaultMockMinutes: 30,
  showSourceInPractice: true,
  activeBankId: "",
};

export function defaultState(): LocalState {
  return {
    schemaVersion: 1,
    events: [],
    ackedEventIds: [],
    activeSession: null,
    settings: { ...DEFAULT_SETTINGS },
    displayName: "",
    syncCursor: 0,
    lastSyncedAt: null,
  };
}

function keyFor(scope: string): string {
  return `${PREFIX}:${scope}`;
}

const EVENT_TYPES: Record<string, true> = {
  "attempt.record": true,
  "favorite.set": true,
  "exam.completed": true,
  "card.reviewed": true,
  "card.state": true,
};

function isOptionIdArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function hasValidPayload(event: Record<string, unknown>): boolean {
  const payload = event.payload as Record<string, unknown> | null;
  if (!payload) return false;
  switch (event.type) {
    case "attempt.record":
      return (
        typeof payload.bankId === "string" &&
        typeof payload.questionId === "string" &&
        isOptionIdArray(payload.selected) &&
        (payload.mode === "practice" || payload.mode === "mock")
      );
    case "favorite.set":
      return (
        typeof payload.bankId === "string" &&
        typeof payload.questionId === "string" &&
        typeof payload.favorite === "boolean"
      );
    case "exam.completed":
      return (
        typeof payload.bankId === "string" &&
        typeof payload.totalQuestions === "number" &&
        payload.totalQuestions > 0 &&
        Array.isArray(payload.answers) &&
        payload.answers.every(
          (answer) =>
            Boolean(answer) &&
            typeof answer === "object" &&
            typeof (answer as Record<string, unknown>).questionId === "string" &&
            isOptionIdArray((answer as Record<string, unknown>).selected),
        ) &&
        isIsoDate(payload.startedAt) &&
        isIsoDate(payload.completedAt) &&
        typeof payload.durationMs === "number"
      );
    case "card.reviewed":
      return (
        typeof payload.cardId === "string" &&
        (payload.rating === "again" ||
          payload.rating === "hard" ||
          payload.rating === "good" ||
          payload.rating === "easy")
      );
    case "card.state": {
      if (typeof payload.cardId !== "string") return false;
      if (payload.state === null) return true;
      if (!payload.state || typeof payload.state !== "object") return false;
      const state = payload.state as Record<string, unknown>;
      return (
        typeof state.intervalDays === "number" &&
        typeof state.ease === "number" &&
        isIsoDate(state.dueAt) &&
        typeof state.reps === "number" &&
        typeof state.lapses === "number"
      );
    }
    default:
      return false;
  }
}

function isSyncEvent(value: unknown): value is SyncEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    event.id.length > 0 &&
    isIsoDate(event.at) &&
    typeof event.type === "string" &&
    EVENT_TYPES[event.type] === true &&
    Boolean(event.payload) &&
    typeof event.payload === "object" &&
    hasValidPayload(event)
  );
}

export function dedupeEvents(events: readonly SyncEvent[]): SyncEvent[] {
  const seen = new Set<string>();
  const result: SyncEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    result.push(event);
  }
  return result;
}

export function mergeEvents(base: readonly SyncEvent[], incoming: readonly SyncEvent[]): SyncEvent[] {
  const merged = dedupeEvents([...base, ...incoming]);
  merged.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return merged;
}

function migrateActiveSession(session: ActiveSession | null | undefined): ActiveSession | null {
  if (!session) return null;
  if (
    session.kind === "practice" &&
    session.status === "active" &&
    Array.isArray(session.questionIds) &&
    session.questionIds.length > 0 &&
    session.questionIds.every((id) => Boolean(session.revealed?.[id]))
  ) {
    // Older builds left fully answered practice sessions "active" and showed
    // them as resumable. Preserve every event/answer, migrate only the status.
    return { ...session, status: "completed" };
  }
  return session;
}

export function normalizeState(raw: unknown): LocalState {
  if (!raw || typeof raw !== "object") return defaultState();
  const value = raw as Partial<LocalState>;
  if (value.schemaVersion !== 1) throw new Error("备份/本地数据的 schemaVersion 不是 1");
  const rawEvents = Array.isArray(value.events) ? value.events : [];
  const invalid = rawEvents.find((event) => !isSyncEvent(event));
  if (invalid) throw new Error("本地数据包含无法识别的事件，已停止写入以保留原始数据");
  const events = rawEvents as SyncEvent[];
  const settings = { ...DEFAULT_SETTINGS, ...(value.settings ?? {}) };
  return {
    schemaVersion: 1,
    events: mergeEvents([], events),
    ackedEventIds: Array.isArray(value.ackedEventIds)
      ? value.ackedEventIds.filter((id): id is string => typeof id === "string")
      : [],
    activeSession: migrateActiveSession(value.activeSession),
    settings: {
      dailyGoal: clampNumber(settings.dailyGoal, 1, 300, DEFAULT_SETTINGS.dailyGoal),
      defaultMockCount: clampNumber(settings.defaultMockCount, 1, 10_000, DEFAULT_SETTINGS.defaultMockCount),
      defaultMockMinutes: clampNumber(settings.defaultMockMinutes, 1, 300, DEFAULT_SETTINGS.defaultMockMinutes),
      showSourceInPractice: Boolean(settings.showSourceInPractice),
      activeBankId: typeof settings.activeBankId === "string" ? settings.activeBankId : "",
    },
    displayName: typeof value.displayName === "string" ? value.displayName.slice(0, 32) : "",
    syncCursor: typeof value.syncCursor === "number" && value.syncCursor >= 0 ? Math.floor(value.syncCursor) : 0,
    lastSyncedAt: typeof value.lastSyncedAt === "string" ? value.lastSyncedAt : null,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

let lastStorageError: string | null = null;
const blockedScopes = new Set<string>();

export function takeStorageError(): string | null {
  const error = lastStorageError;
  lastStorageError = null;
  return error;
}

export function loadState(scope: string): LocalState {
  try {
    const raw = localStorage.getItem(keyFor(scope));
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    lastStorageError =
      error instanceof Error
        ? `本地数据读取失败：${error.message}。原始数据未被覆盖；当前进度仅保存在内存中，请先导出或清除。`
        : "本地数据读取失败；原始数据未被覆盖。";
    blockedScopes.add(scope);
    return defaultState();
  }
}

export function saveState(scope: string, state: LocalState): { ok: boolean; error?: string } {
  if (blockedScopes.has(scope)) {
    return { ok: false, error: lastStorageError ?? "本地数据处于保护状态，未写入新数据。" };
  }
  try {
    localStorage.setItem(keyFor(scope), JSON.stringify(state));
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "浏览器存储不可用";
    lastStorageError = `本地保存失败：${detail}。当前进度保留在内存中，请导出备份或释放浏览器存储空间。`;
    return { ok: false, error: lastStorageError };
  }
}

export function clearState(scope: string): void {
  try {
    localStorage.removeItem(keyFor(scope));
    blockedScopes.delete(scope);
    lastStorageError = null;
  } catch {
    lastStorageError = "无法清除本地数据，请检查浏览器存储权限。";
  }
}

export interface BackupFile {
  app: "study-deck";
  version: 1;
  exportedAt: string;
  scope: string;
  state: LocalState;
}

export function exportBackup(scope: string, state: LocalState): BackupFile {
  return {
    app: "study-deck",
    version: 1,
    exportedAt: new Date().toISOString(),
    scope,
    // Backups carry learning data only. Auth is a cookie, and sync cursors /
    // ack state are per-device metadata that must never be restored across users.
    state: {
      ...state,
      ackedEventIds: [],
      syncCursor: 0,
      lastSyncedAt: null,
    },
  };
}

export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("不是有效的 JSON 文件");
  }
  if (!raw || typeof raw !== "object") throw new Error("备份内容为空或格式错误");
  const backup = raw as Partial<BackupFile>;
  if (backup.app !== "study-deck" || backup.version !== 1) {
    throw new Error("不是砺知 StudyDeck v1 备份文件");
  }
  if (!backup.state) throw new Error("备份缺少 state");
  const state = normalizeState(backup.state);
  if (state.events.length === 0 && !state.activeSession) {
    throw new Error("备份中没有可恢复的学习数据");
  }
  return {
    app: "study-deck",
    version: 1,
    exportedAt: typeof backup.exportedAt === "string" ? backup.exportedAt : new Date().toISOString(),
    scope: typeof backup.scope === "string" ? backup.scope : GUEST_SCOPE,
    state,
  };
}

export function makeEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
