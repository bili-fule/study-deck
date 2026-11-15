export interface HttpErrorOptions {
  detail?: string;
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * An error that maps directly to a JSON API response. Anything else that
 * escapes a handler is treated as an internal error (no detail is leaked).
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly options: HttpErrorOptions;

  constructor(status: number, code: string, options: HttpErrorOptions = {}) {
    super(code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.options = options;
  }

  toResponse(): Response {
    const body: Record<string, unknown> = { error: this.code };
    if (this.options.detail) body.detail = this.options.detail;
    if (this.options.extra) Object.assign(body, this.options.extra);
    return jsonResponse(body, this.status, this.options.headers);
  }
}

export function jsonResponse(
  data: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

export function assertMethod(request: Request, ...allowed: string[]): void {
  const method = request.method.toUpperCase();
  if (!allowed.includes(method)) {
    throw new HttpError(405, "method_not_allowed", {
      headers: { allow: allowed.join(", ") },
    });
  }
}

/** Reject cross-site state changes even though SameSite=Lax already blocks the
 *  cookie on cross-site POSTs. Defence in depth for same-origin-only design. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "origin_mismatch");
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    throw new HttpError(403, "cross_site_request");
  }
}

/** Read a JSON object with a hard byte cap. Content-Length is checked first,
 *  then the stream is counted so chunked bodies cannot exceed the cap. */
export async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", {
      detail: "expected application/json",
    });
  }
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "payload_too_large");
  }
  if (!request.body) {
    throw new HttpError(400, "invalid_request", { detail: "missing body" });
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "payload_too_large");
    }
    chunks.push(value);
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_request", {
      detail: "expected a JSON object",
    });
  }
  return parsed as Record<string, unknown>;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function sessionCookie(
  name: string,
  token: string | null,
  secure: boolean,
): string {
  const parts = [
    `${name}=${token === null ? "" : encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    token === null ? "Max-Age=0" : "Max-Age=2592000",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}
