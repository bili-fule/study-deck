import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { primaryBank, getQuestion, getBank } from "@/lib/bank";
import { projectEvents } from "@/lib/projection";
import { createSession, srsNext, summarizeSession, type SessionSummary } from "@/lib/session";
import {
  GUEST_SCOPE,
  defaultState,
  exportBackup,
  loadState,
  makeEventId,
  mergeEvents,
  parseBackup,
  saveState,
  clearState,
  takeStorageError,
  type BackupFile,
} from "@/lib/storage";
import { pendingEvents, runSync, SyncAbortedError } from "@/lib/sync";
import * as cloud from "@/lib/cloud";
import type {
  ActiveSession,
  AppProjection,
  AuthState,
  Bank,
  CardProjection,
  LocalState,
  SessionConfig,
  Settings,
  SyncState,
} from "@/lib/types";
import { LIMITS } from "@/shared/api";
import type {
  AttemptEvent,
  CardRating,
  CardReviewedEvent,
  CardStateEvent,
  ExamCompletedPayload,
  ExamEvent,
  FavoriteEvent,
  PublicUser,
} from "@/shared/api";

interface AdoptionPrompt {
  user: PublicUser;
  guestEventCount: number;
}

interface StoreActions {
  startSession: (config: SessionConfig) => ActiveSession | null;
  abandonSession: () => void;
  setSessionAnswer: (questionId: string, selected: string[]) => void;
  answerPractice: (questionId: string, selected: string[]) => void;
  finishPractice: () => void;
  moveQuestion: (index: number) => void;
  toggleFlag: (questionId: string) => void;
  submitMock: () => SessionSummary | null;
  toggleFavorite: (questionId: string) => void;
  rateCard: (cardId: string, rating: CardRating) => void;
  resetCardState: (cardId: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  selectBank: (bankId: string) => void;
  setDisplayName: (name: string) => void;
  restoreBackup: (text: string, mode: "merge" | "replace") => { events: number; questions: number };
  clearLocalData: () => void;
  exportBackupFile: () => BackupFile;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, inviteCode: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  syncNow: () => Promise<void>;
  resolveAdoption: (accept: boolean) => Promise<void>;
  dismissAuthError: () => void;
}

interface StoreValue {
  state: LocalState;
  scope: string;
  activeBank: Bank;
  projection: AppProjection;
  session: ActiveSession | null;
  auth: AuthState;
  sync: SyncState;
  adoption: AdoptionPrompt | null;
  storageError: string | null;
  actions: StoreActions;
}

const StoreContext = createContext<StoreValue | null>(null);

function userScope(user: PublicUser): string {
  return `user:${user.id}`;
}

function attemptEvent(
  questionId: string,
  bankId: string,
  selected: string[],
  mode: "practice" | "mock",
  at: string,
): AttemptEvent {
  return {
    id: makeEventId(),
    type: "attempt.record",
    at,
    payload: { bankId, questionId, selected: [...selected], mode },
  };
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState(GUEST_SCOPE);
  const [state, setState] = useState<LocalState>(() => loadState(GUEST_SCOPE));
  const [auth, setAuth] = useState<AuthState>({ user: null, loading: true, error: null });
  const [sync, setSync] = useState<SyncState>({
    status: "offline",
    lastError: null,
    pending: 0,
    lastPulledAt: null,
  });
  const [adoption, setAdoption] = useState<AdoptionPrompt | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const stateRef = useRef(state);
  const scopeRef = useRef(scope);
  const authRef = useRef(auth);
  const adoptionRef = useRef<AdoptionPrompt | null>(null);
  const generationRef = useRef(0);
  const syncAbortRef = useRef<AbortController | null>(null);
  const syncRunRef = useRef<Promise<void> | null>(null);
  stateRef.current = state;
  scopeRef.current = scope;
  authRef.current = auth;
  adoptionRef.current = adoption;

  const invalidateSync = useCallback(() => {
    generationRef.current += 1;
    syncAbortRef.current?.abort();
    syncAbortRef.current = null;
  }, []);

  const commit = useCallback((next: LocalState, nextScope = scopeRef.current) => {
    stateRef.current = next;
    setState(next);
    const saved = saveState(nextScope, next);
    setStorageError(saved.ok ? null : (saved.error ?? "本地保存失败"));
    setSync((current) => ({
      ...current,
      pending: pendingEvents(next.events, next.ackedEventIds).length,
    }));
  }, []);

  const update = useCallback(
    (producer: (current: LocalState) => LocalState) => {
      commit(producer(stateRef.current));
    },
    [commit],
  );

  const switchScope = useCallback(
    (nextScope: string) => {
      invalidateSync();
      setAdoption(null);
      const next = loadState(nextScope);
      setStorageError(takeStorageError());
      scopeRef.current = nextScope;
      stateRef.current = next;
      setScope(nextScope);
      setState(next);
      setSync((current) => ({
        ...current,
        pending: pendingEvents(next.events, next.ackedEventIds).length,
      }));
    },
    [invalidateSync],
  );

  const activeBank = useMemo(() => getBank(state.settings.activeBankId), [state.settings.activeBankId]);
  const projection = useMemo(
    () => projectEvents(state.events, activeBank.bankId),
    [activeBank.bankId, state.events],
  );
  const session = state.activeSession;

  const performSync = useCallback(async () => {
    if (syncRunRef.current) return syncRunRef.current;
    if (authRef.current.loading) return;
    const user = authRef.current.user;
    if (!user || adoptionRef.current) return;
    const expectedScope = userScope(user);
    if (scopeRef.current !== expectedScope) return;

    const generation = generationRef.current;
    const controller = new AbortController();
    syncAbortRef.current = controller;
    const snapshot = stateRef.current;
    const queued = pendingEvents(snapshot.events, snapshot.ackedEventIds);

    const run = (async () => {
      setSync((current) => ({ ...current, status: "syncing", lastError: null }));
      try {
        const result = await runSync({
          api: {
            push: (events, signal) => cloud.pushEvents(events, signal),
            pull: (cursor, signal) => cloud.pullEvents(cursor, 500, signal),
          },
          events: queued,
          cursor: snapshot.syncCursor,
          signal: controller.signal,
          isCurrent: () =>
            generationRef.current === generation &&
            scopeRef.current === expectedScope &&
            !controller.signal.aborted,
        });
        if (generationRef.current !== generation || scopeRef.current !== expectedScope) return;

        const current = stateRef.current;
        const merged = mergeEvents(current.events, result.pulled);
        const acked = new Set(current.ackedEventIds);
        for (const id of result.pushedIds) acked.add(id);
        for (const event of result.pulled) acked.add(event.id);
        const liveIds = new Set(merged.map((event) => event.id));
        const next: LocalState = {
          ...current,
          events: merged,
          ackedEventIds: [...acked].filter((id) => liveIds.has(id)),
          syncCursor: result.cursor,
          lastSyncedAt: new Date().toISOString(),
        };
        commit(next);
        setSync({
          status: "idle",
          lastError: null,
          pending: pendingEvents(next.events, next.ackedEventIds).length,
          lastPulledAt: new Date().toISOString(),
        });
      } catch (error) {
        if (error instanceof SyncAbortedError || controller.signal.aborted) return;
        if (generationRef.current !== generation || scopeRef.current !== expectedScope) return;
        setSync((current) => ({
          ...current,
          status: "error",
          lastError: error instanceof Error ? error.message : "同步失败",
        }));
      } finally {
        if (syncAbortRef.current === controller) syncAbortRef.current = null;
      }
    })();

    const tracked = run.finally(() => {
      if (syncRunRef.current === tracked) syncRunRef.current = null;
    });
    syncRunRef.current = tracked;
    return tracked;
  }, [commit]);

  const activateUser = useCallback(
    async (user: PublicUser, adoptGuest: boolean) => {
      invalidateSync();
      const nextAuth = { user, loading: false, error: null };
      setAuth(nextAuth);
      authRef.current = nextAuth;
      const key = userScope(user);
      const guestState = stateRef.current;
      if (adoptGuest && guestState.events.length > 0) {
        const prompt = { user, guestEventCount: guestState.events.length };
        adoptionRef.current = prompt;
        setAdoption(prompt);
        return;
      }
      switchScope(key);
      await performSync();
    },
    [invalidateSync, performSync, switchScope],
  );

  const refreshAuth = useCallback(async () => {
    invalidateSync();
    const loadingAuth = { ...authRef.current, loading: true };
    authRef.current = loadingAuth;
    setAuth(loadingAuth);
    try {
      const response = await cloud.me();
      const nextAuth = { user: response.user, loading: false, error: null };
      setAuth(nextAuth);
      authRef.current = nextAuth;
      const cookieScope = userScope(response.user);
      if (scopeRef.current !== cookieScope) {
        if (scopeRef.current === GUEST_SCOPE && stateRef.current.events.length > 0) {
          const prompt = { user: response.user, guestEventCount: stateRef.current.events.length };
          adoptionRef.current = prompt;
          setAdoption(prompt);
          return;
        }
        switchScope(cookieScope);
      }
      await performSync();
    } catch (error) {
      const status = error instanceof cloud.CloudError ? error.status : 0;
      setAuth({
        user: null,
        loading: false,
        error: status === 401 || status === 0 ? null : "云端账号状态不可用",
      });
    }
  }, [invalidateSync, performSync, switchScope]);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (auth.loading || auth.user || scope !== GUEST_SCOPE) return;
    const generation = generationRef.current;
    const controller = new AbortController();
    let running = false;
    const isCurrent = () =>
      !controller.signal.aborted &&
      generationRef.current === generation &&
      scopeRef.current === GUEST_SCOPE &&
      !authRef.current.loading &&
      !authRef.current.user;
    const upload = async () => {
      if (running || !isCurrent()) return;
      const current = stateRef.current;
      const batch = pendingEvents(current.events, current.telemetryAckedEventIds).slice(0, LIMITS.pushMaxEvents);
      if (batch.length === 0) return;
      running = true;
      try {
        const result = await cloud.recordAnonymousEvents(batch, controller.signal);
        if (!isCurrent()) return;
        if (result.accepted + result.duplicates !== batch.length) throw new Error("匿名行为记录未确认完整接收");
        const latest = stateRef.current;
        const liveIds = new Set(latest.events.map((event) => event.id));
        commit({
          ...latest,
          telemetryAckedEventIds: [...new Set([
            ...latest.telemetryAckedEventIds,
            ...batch.map((event) => event.id),
          ])].filter((id) => liveIds.has(id)),
        });
      } catch (error) {
        if (isCurrent()) console.warn("匿名行为暂未上传，保留本机记录，联网或下次学习时继续。", error);
      } finally {
        running = false;
      }
    };
    const onOnline = () => { void upload(); };
    const timer = window.setTimeout(onOnline, 750);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      controller.abort();
    };
  }, [auth.loading, auth.user, scope, state.events, state.telemetryAckedEventIds, commit]);

  useEffect(() => {
    setStorageError(takeStorageError());
    setSync((current) => ({
      ...current,
      pending: pendingEvents(stateRef.current.events, stateRef.current.ackedEventIds).length,
    }));
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      invalidateSync();
      const loadingAuth = { ...authRef.current, error: null, loading: true };
      authRef.current = loadingAuth;
      setAuth(loadingAuth);
      try {
        const response = await cloud.login({ username, password });
        await activateUser(response.user, true);
      } catch (error) {
        setAuth((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "登录失败",
        }));
        throw error;
      }
    },
    [activateUser, invalidateSync],
  );

  const register = useCallback(
    async (username: string, password: string, inviteCode: string) => {
      invalidateSync();
      const loadingAuth = { ...authRef.current, error: null, loading: true };
      authRef.current = loadingAuth;
      setAuth(loadingAuth);
      try {
        const response = await cloud.register({ username, password, inviteCode });
        await activateUser(response.user, true);
      } catch (error) {
        setAuth((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "注册失败",
        }));
        throw error;
      }
    },
    [activateUser, invalidateSync],
  );

  const logout = useCallback(async () => {
    invalidateSync();
    const loadingAuth = { ...authRef.current, loading: true };
    authRef.current = loadingAuth;
    setAuth(loadingAuth);
    try {
      await cloud.logout();
    } catch (error) {
      // Never claim a server logout that did not happen: the HttpOnly cookie
      // would still restore the session on refresh.
      setAuth((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? `退出登录失败：${error.message}` : "退出登录失败",
      }));
      throw error;
    }
    const signedOut: AuthState = { user: null, loading: false, error: null };
    setAuth(signedOut);
    authRef.current = signedOut;
    adoptionRef.current = null;
    setAdoption(null);
    setSync({ status: "offline", lastError: null, pending: 0, lastPulledAt: null });
    switchScope(GUEST_SCOPE);
  }, [invalidateSync, switchScope]);

  const resolveAdoption = useCallback(
    async (accept: boolean) => {
      if (!adoption) return;
      const key = userScope(adoption.user);
      const target = loadState(key);
      if (accept) {
        target.events = mergeEvents(target.events, stateRef.current.events);
        target.ackedEventIds = [];
        saveState(key, target);
      }
      adoptionRef.current = null;
      setAdoption(null);
      switchScope(key);
      await performSync();
    },
    [adoption, performSync, switchScope],
  );

  const startSession = useCallback(
    (config: SessionConfig): ActiveSession | null => {
      const next = createSession(
        { ...config, studyMode: config.kind === "practice" && stateRef.current.settings.studyMode },
        projectEvents(stateRef.current.events),
      );
      if (next.questionIds.length === 0) return null;
      update((current) => ({ ...current, activeSession: next }));
      return next;
    },
    [update],
  );

  const abandonSession = useCallback(() => {
    update((current) => ({ ...current, activeSession: null }));
  }, [update]);

  const setSessionAnswer = useCallback(
    (questionId: string, selected: string[]) => {
      update((current) => {
        const active = current.activeSession;
        if (!active || active.status !== "active") return current;
        if (active.revealed[questionId]) return current;
        return {
          ...current,
          activeSession: {
            ...active,
            answers: { ...active.answers, [questionId]: selected },
          },
        };
      });
    },
    [update],
  );

  const answerPractice = useCallback(
    (questionId: string, selected: string[]) => {
      const active = stateRef.current.activeSession;
      const question = getQuestion(questionId);
      if (!active || !question || active.status !== "active" || active.revealed[questionId]) return;
      const answer = [...new Set(selected)].filter((id) => question.optionKeys.includes(id));
      if (answer.length === 0) return;
      // 背题模式：只翻答案，不生成答题事件、不影响错题/正确率。
      if (active.studyMode) {
        update((current) => {
          const currentSession = current.activeSession;
          if (!currentSession || currentSession.revealed[questionId]) return current;
          return {
            ...current,
            activeSession: {
              ...currentSession,
              answers: { ...currentSession.answers, [questionId]: answer },
              revealed: { ...currentSession.revealed, [questionId]: true },
            },
          };
        });
        return;
      }
      const at = new Date().toISOString();
      const event = attemptEvent(questionId, question.bankId, answer, "practice", at);
      update((current) => {
        const currentSession = current.activeSession;
        if (!currentSession || currentSession.revealed[questionId]) return current;
        const revealed: Record<string, true> = { ...currentSession.revealed, [questionId]: true };
        const allAnswered = currentSession.questionIds.every((id) => revealed[id]);
        return {
          ...current,
          events: mergeEvents(current.events, [event]),
          activeSession: {
            ...currentSession,
            answers: { ...currentSession.answers, [questionId]: answer },
            revealed,
            status: allAnswered ? "completed" : currentSession.status,
          },
        };
      });
    },
    [update],
  );

  const finishPractice = useCallback(() => {
    update((current) =>
      current.activeSession?.kind === "practice" ? { ...current, activeSession: null } : current,
    );
  }, [update]);

  const moveQuestion = useCallback(
    (index: number) => {
      update((current) => {
        const active = current.activeSession;
        if (!active) return current;
        return {
          ...current,
          activeSession: {
            ...active,
            currentIndex: Math.max(0, Math.min(active.questionIds.length - 1, index)),
          },
        };
      });
    },
    [update],
  );

  const toggleFlag = useCallback(
    (questionId: string) => {
      update((current) => {
        const active = current.activeSession;
        if (!active) return current;
        const flagged = active.flagged.includes(questionId)
          ? active.flagged.filter((id) => id !== questionId)
          : [...active.flagged, questionId];
        return { ...current, activeSession: { ...active, flagged } };
      });
    },
    [update],
  );

  const submitMock = useCallback((): SessionSummary | null => {
    const active = stateRef.current.activeSession;
    if (!active || active.kind !== "mock" || active.status !== "active") return null;
    const summary = summarizeSession(active);
    const completedAt = new Date();
    const answers = summary.perQuestion
      .filter((entry) => entry.answered)
      .map((entry) => ({ questionId: entry.question.questionId, selected: entry.selected }));
    const payload: ExamCompletedPayload = {
      bankId: active.bankId,
      totalQuestions: summary.total,
      answers,
      startedAt: active.startedAt,
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - new Date(active.startedAt).getTime(),
    };
    const exam: ExamEvent = {
      id: makeEventId(),
      type: "exam.completed",
      at: completedAt.toISOString(),
      payload,
    };
    const attempts = summary.perQuestion
      .filter((entry) => entry.answered)
      .map((entry) =>
        attemptEvent(entry.question.questionId, entry.question.bankId, entry.selected, "mock", completedAt.toISOString()),
      );
    update((current) => {
      const currentSession = current.activeSession;
      if (!currentSession) return current;
      return {
        ...current,
        events: mergeEvents(current.events, [exam, ...attempts]),
        activeSession: {
          ...currentSession,
          status: "submitted",
          submittedAt: completedAt.toISOString(),
          examEventId: exam.id,
        },
      };
    });
    return summary;
  }, [update]);

  const toggleFavorite = useCallback(
    (questionId: string) => {
      const question = getQuestion(questionId);
      if (!question) return;
      const currently =
        projectEvents(stateRef.current.events).statsByQuestion.get(questionId)?.favorite ?? false;
      const event: FavoriteEvent = {
        id: makeEventId(),
        type: "favorite.set",
        at: new Date().toISOString(),
        payload: {
          bankId: question.bankId,
          questionId,
          favorite: !currently,
        },
      };
      update((current) => ({ ...current, events: mergeEvents(current.events, [event]) }));
    },
    [update],
  );

  const rateCard = useCallback(
    (cardId: string, rating: CardRating) => {
      const currentProjection = projectEvents(stateRef.current.events);
      const cardState: CardProjection | undefined = currentProjection.cardStates.get(cardId);
      const next = srsNext(cardState, rating);
      const at = new Date().toISOString();
      const reviewed: CardReviewedEvent = {
        id: makeEventId(),
        type: "card.reviewed",
        at,
        payload: { cardId, rating },
      };
      const stateEvent: CardStateEvent = {
        id: makeEventId(),
        type: "card.state",
        at,
        payload: { cardId, state: next },
      };
      update((current) => ({
        ...current,
        events: mergeEvents(current.events, [reviewed, stateEvent]),
      }));
    },
    [update],
  );

  const resetCardState = useCallback(
    (cardId: string) => {
      const event: CardStateEvent = {
        id: makeEventId(),
        type: "card.state",
        at: new Date().toISOString(),
        payload: { cardId, state: null },
      };
      update((current) => ({ ...current, events: mergeEvents(current.events, [event]) }));
    },
    [update],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      update((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
    },
    [update],
  );

  const selectBank = useCallback(
    (bankId: string) => {
      update((current) => ({ ...current, settings: { ...current.settings, activeBankId: bankId } }));
    },
    [update],
  );

  const setDisplayName = useCallback(
    (name: string) => {
      update((current) => ({ ...current, displayName: name.trim().slice(0, 32) }));
    },
    [update],
  );

  const restoreBackup = useCallback(
    (text: string, mode: "merge" | "replace") => {
      const backup = parseBackup(text);
      const current = stateRef.current;
      if (mode === "replace") {
        const next: LocalState = {
          ...backup.state,
          // Restored data belongs to the current device; never inherit another
          // device's cursor/ack metadata or skip server history.
          ackedEventIds: [],
          telemetryAckedEventIds: [],
          syncCursor: 0,
          lastSyncedAt: null,
          settings: { ...backup.state.settings, ...current.settings },
          displayName: current.displayName || backup.state.displayName,
        };
        commit(next);
        return { events: next.events.length, questions: projectEvents(next.events).attempted };
      }
      const next: LocalState = {
        ...current,
        events: mergeEvents(current.events, backup.state.events),
        ackedEventIds: [],
        telemetryAckedEventIds: [],
        syncCursor: 0,
        lastSyncedAt: null,
        activeSession: current.activeSession ?? backup.state.activeSession,
      };
      commit(next);
      return {
        events: next.events.length - current.events.length,
        questions: projectEvents(next.events).attempted,
      };
    },
    [commit],
  );

  const clearLocalData = useCallback(() => {
    clearState(scopeRef.current);
    update((current) => {
      const next = defaultState();
      next.settings = current.settings;
      next.displayName = current.displayName;
      return next;
    });
  }, [update]);

  const exportBackupFile = useCallback(() => exportBackup(scopeRef.current, stateRef.current), []);

  const actions = useMemo<StoreActions>(
    () => ({
      startSession,
      abandonSession,
      setSessionAnswer,
      answerPractice,
      finishPractice,
      moveQuestion,
      toggleFlag,
      submitMock,
      toggleFavorite,
      rateCard,
      resetCardState,
      updateSettings,
      selectBank,
      setDisplayName,
      restoreBackup,
      clearLocalData,
      exportBackupFile,
      login,
      register,
      logout,
      refreshAuth,
      syncNow: performSync,
      resolveAdoption,
      dismissAuthError: () => setAuth((current) => ({ ...current, error: null })),
    }),
    [
      abandonSession,
      clearLocalData,
      exportBackupFile,
      login,
      logout,
      moveQuestion,
      performSync,
      rateCard,
      refreshAuth,
      register,
      resetCardState,
      resolveAdoption,
      restoreBackup,
      setDisplayName,
      selectBank,
      setSessionAnswer,
      finishPractice,
      answerPractice,
      startSession,
      submitMock,
      toggleFavorite,
      toggleFlag,
      updateSettings,
    ],
  );

  const value = useMemo<StoreValue>(
    () => ({
      state,
      scope,
      activeBank,
      projection,
      session,
      auth,
      sync,
      adoption,
      storageError,
      actions,
    }),
    [actions, activeBank, adoption, auth, projection, scope, session, state, storageError, sync],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore 必须在 AppStoreProvider 内使用");
  return value;
}

export function useBankName(): string {
  return primaryBank.title;
}
