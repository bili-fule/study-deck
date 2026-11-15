import type { HealthResponse } from "../shared/api";
import { handleAdminStats } from "./admin";
import { handleAuth } from "./auth";
import { catalog } from "./catalog";
import { assertMethod, HttpError, jsonResponse } from "./lib/http";
import { handlePull, handlePush } from "./sync";

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const pathname = url.pathname;

  if (pathname === "/api/health") {
    assertMethod(request, "GET");
    const body: HealthResponse = {
      ok: true,
      banks: catalog.bankCount,
      questions: catalog.questionCount,
      catalogGeneratedAt: catalog.generatedAt,
    };
    return jsonResponse(body);
  }

  if (pathname.startsWith("/api/auth/")) {
    return handleAuth(request, env, pathname);
  }

  if (pathname === "/api/sync/push") {
    assertMethod(request, "POST");
    return handlePush(request, env);
  }

  if (pathname === "/api/sync/pull") {
    assertMethod(request, "GET");
    return handlePull(request, env, url);
  }

  if (pathname === "/api/admin/stats") {
    assertMethod(request, "GET");
    return handleAdminStats(request, env, url);
  }

  throw new HttpError(404, "not_found");
}

export default {
  async fetch(request, env): Promise<Response> {
    const startedAt = Date.now();
    const url = new URL(request.url);
    let response: Response;

    try {
      response = await route(request, env, url);
    } catch (error) {
      if (error instanceof HttpError) {
        response = error.toResponse();
      } else {
        console.error(
          JSON.stringify({
            message: "unhandled_error",
            method: request.method,
            path: url.pathname,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        response = jsonResponse({ error: "internal_error" }, 500);
      }
    }

    console.log(
      JSON.stringify({
        message: "http_request",
        method: request.method,
        path: url.pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
      }),
    );
    return response;
  },
} satisfies ExportedHandler<Env>;
