import type { SyncEvent, SyncPullResponse } from "../../shared/api";

export interface SyncApi {
  push: (events: SyncEvent[], signal: AbortSignal) => Promise<{ accepted: number; duplicates: number }>;
  pull: (cursor: number, signal: AbortSignal) => Promise<SyncPullResponse>;
}

export class SyncAbortedError extends Error {
  constructor(message = "同步已取消") {
    super(message);
    this.name = "SyncAbortedError";
  }
}

export function pendingEvents(events: readonly SyncEvent[], ackedEventIds: readonly string[]): SyncEvent[] {
  const acked = new Set(ackedEventIds);
  return events.filter((event) => !acked.has(event.id));
}

export async function runSync({
  api,
  events,
  cursor,
  isCurrent,
  signal,
}: {
  api: SyncApi;
  events: SyncEvent[];
  cursor: number;
  isCurrent: () => boolean;
  signal: AbortSignal;
}): Promise<{ pushedIds: string[]; pulled: SyncEvent[]; cursor: number }> {
  const ensureCurrent = () => {
    if (signal.aborted || !isCurrent()) throw new SyncAbortedError();
  };
  const pushedIds: string[] = [];

  for (let index = 0; index < events.length; index += 200) {
    ensureCurrent();
    const chunk = events.slice(index, index + 200);
    await api.push(chunk, signal);
    ensureCurrent();
    pushedIds.push(...chunk.map((event) => event.id));
  }

  const pulled: SyncEvent[] = [];
  let nextCursor = cursor;
  // Pull until the server says there is no more. Never silently stop at a
  // page cap: a partial pull must not be reported as a completed sync.
  for (;;) {
    ensureCurrent();
    const response = await api.pull(nextCursor, signal);
    ensureCurrent();
    for (const item of response.events) {
      const { seq: _seq, ...event } = item;
      void _seq;
      pulled.push(event);
    }
    nextCursor = response.nextCursor;
    if (!response.hasMore) break;
  }

  return { pushedIds, pulled, cursor: nextCursor };
}
