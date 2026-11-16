import { assertMethod, HttpError, isAllowedOrigin } from "./http";

const PREFLIGHT_METHODS = "GET, POST";

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("vary");
  if (
    current
      ?.split(",")
      .some((entry) => entry.trim().toLowerCase() === value.toLowerCase())
  ) {
    return;
  }
  headers.set("vary", current ? `${current}, ${value}` : value);
}

function rejectUntrustedOrigin(): never {
  throw new HttpError(403, "origin_mismatch");
}

export function handlePreflight(
  request: Request,
  allowedOrigins: string,
): Response {
  assertMethod(request, "OPTIONS");

  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin, request, allowedOrigins)) rejectUntrustedOrigin();

  const requestedMethod = request.headers.get("access-control-request-method");
  if (requestedMethod !== "GET" && requestedMethod !== "POST") {
    throw new HttpError(403, "cors_method_not_allowed");
  }

  const requestedHeaders = request.headers.get("access-control-request-headers");
  const headers = requestedHeaders?.split(",").map((header) => header.trim());
  if (headers?.some((header) => header.toLowerCase() !== "content-type")) {
    throw new HttpError(403, "cors_headers_not_allowed");
  }

  const responseHeaders = new Headers({
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": PREFLIGHT_METHODS,
  });
  if (headers?.length) {
    responseHeaders.set("access-control-allow-headers", "Content-Type");
  }
  appendVary(responseHeaders, "Origin");
  appendVary(responseHeaders, "Access-Control-Request-Method");
  appendVary(responseHeaders, "Access-Control-Request-Headers");

  return new Response(null, { status: 204, headers: responseHeaders });
}

export function applyCors(
  request: Request,
  response: Response,
  allowedOrigins: string,
): Response {
  const origin = request.headers.get("origin");
  const headers = response.headers;
  appendVary(headers, "Origin");

  if (isAllowedOrigin(origin, request, allowedOrigins)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
  } else {
    headers.delete("access-control-allow-origin");
    headers.delete("access-control-allow-credentials");
  }

  return response;
}
