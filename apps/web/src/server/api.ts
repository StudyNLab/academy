import "server-only";
import type { Role } from "@aionit/db";
import type { z } from "zod";
import { getAuth } from "./auth-instance";
import { getDb } from "./db";
import { getEnv } from "./env";
import type { Viewer } from "./viewer";
import { loadViewer, staffAccess } from "./viewer";

// /api/v1 공통: 오류 형식 { error: { code, message } }, 쓰기 요청의 Origin 확인(CSRF), 로그인 · 역할 확인

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/** 쓰기 요청은 우리 사이트에서 온 것만 받는다. 쿠키 세션이라 다른 사이트의 요청을 막아야 한다 (docs/기술설계.md 3.3). */
export function assertSameOrigin(request: Request): void {
  const expected = new URL(getEnv().BETTER_AUTH_URL).origin;
  const origin = request.headers.get("origin");
  if (origin === expected) return;
  if (!origin && request.headers.get("sec-fetch-site") === "same-origin") return;
  throw new ApiError(403, "BAD_ORIGIN", "허용되지 않은 요청입니다.");
}

export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const raw = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new ApiError(400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "입력 오류");
  return parsed.data;
}

export async function requireApiViewer(request: Request): Promise<Viewer> {
  const viewer = await loadViewer(getAuth(), getDb(), request.headers);
  if (!viewer) throw new ApiError(401, "UNAUTHORIZED", "로그인이 필요합니다.");
  return viewer;
}

export async function requireApiStaff(request: Request, role: Role): Promise<Viewer> {
  const viewer = await loadViewer(getAuth(), getDb(), request.headers);
  const access = staffAccess(viewer, role);
  if (access === "login") throw new ApiError(401, "UNAUTHORIZED", "로그인이 필요합니다.");
  if (access === "forbidden") throw new ApiError(403, "FORBIDDEN", "권한이 없습니다.");
  if (access !== "ok") throw new ApiError(403, "TWO_FACTOR_REQUIRED", "2단계 인증이 필요합니다.");
  return viewer!;
}

/** 라우트 처리 함수를 감싼다: 쓰기 요청 Origin 확인 + 오류를 같은 형식으로 */
export function route<C>(handler: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request);
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ error: { code: error.code, message: error.message } }, error.status);
      }
      const traceId = crypto.randomUUID().slice(0, 8);
      console.error(`[api] ${request.method} ${new URL(request.url).pathname} 실패 (${traceId})`, error);
      return json(
        { error: { code: "INTERNAL", message: `잠시 뒤 다시 시도해 주세요. (오류 번호 ${traceId})` } },
        500,
      );
    }
  };
}
