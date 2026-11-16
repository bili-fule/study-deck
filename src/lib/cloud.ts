import type {
  AdminStatsResponse,
  ApiErrorBody,
  AuthResponse,
  LoginRequest,
  PublicUser,
  RegisterRequest,
  SyncEvent,
  SyncPullResponse,
  SyncPushResponse,
} from "@/shared/api";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? "https://stapi.xmfu.cn" : "")
).replace(/\/+$/, "");

export class CloudError extends Error {
  status: number;
  body: ApiErrorBody | null;

  constructor(message: string, status: number, body: ApiErrorBody | null) {
    super(message);
    this.name = "CloudError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api${path}`, {
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
      ...init,
    });
  } catch {
    throw new CloudError("无法连接云端服务，请检查网络或稍后重试。", 0, null);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const errorBody = (body && typeof body === "object" ? body : null) as ApiErrorBody | null;
    const message =
      errorBody?.error === "invalid_credentials"
        ? "用户名或密码不正确。"
        : errorBody?.error === "invalid_invite"
          ? "邀请码无效或已用完。"
          : errorBody?.error === "username_taken"
            ? "该用户名已被注册。"
            : errorBody?.error === "invalid_event"
              ? `同步事件被拒绝${errorBody.detail ? `：${errorBody.detail}` : ""}`
              : errorBody?.error || `云端请求失败（${response.status}）`;
    throw new CloudError(message, response.status, errorBody);
  }
  return body as T;
}

export function me(): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/me");
}

export function login(payload: LoginRequest): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(payload) });
}

export function register(payload: RegisterRequest): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(payload) });
}

export function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

export function pushEvents(events: SyncEvent[], signal?: AbortSignal): Promise<SyncPushResponse> {
  return request<SyncPushResponse>("/sync/push", {
    method: "POST",
    body: JSON.stringify({ events }),
    signal,
  });
}

export function recordAnonymousEvents(events: SyncEvent[], signal?: AbortSignal): Promise<SyncPushResponse> {
  return request<SyncPushResponse>("/telemetry", {
    method: "POST",
    body: JSON.stringify({ events }),
    signal,
  });
}

export function pullEvents(cursor: number, limit = 500, signal?: AbortSignal): Promise<SyncPullResponse> {
  return request<SyncPullResponse>(`/sync/pull?cursor=${cursor}&limit=${limit}`, { signal });
}

export function adminStats(params: {
  minSamples: number;
  bankId?: string;
  chapterId?: string;
}): Promise<AdminStatsResponse> {
  const search = new URLSearchParams({ minSamples: String(params.minSamples) });
  if (params.bankId) search.set("bankId", params.bankId);
  if (params.chapterId) search.set("chapterId", params.chapterId);
  return request<AdminStatsResponse>(`/admin/stats?${search.toString()}`);
}

export function isAdmin(user: PublicUser | null): boolean {
  return user?.role === "admin";
}
