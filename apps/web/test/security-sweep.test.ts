// 보안 점검 (개발계획 M10): 모든 API 라우트 파일을 찾아 문을 두드려 본다.
// 새 라우트를 만들면 자동으로 이 점검에 들어간다. 일부러 열어 둔 주소는 PUBLIC 에 까닭과 함께 적는다.
// - 로그인 없이 ➔ 401 (또는 없는 것처럼 404). 2xx · 400 · 500 이 나오면 실패
// - 수강생 ➔ /admin · /instructor 는 403
// - 운영자 역할이 있어도 2단계 인증을 안 켰으면 /admin 은 403 TWO_FACTOR_REQUIRED
// - 다른 사이트(Origin)에서 온 쓰기 요청 ➔ 403 BAD_ORIGIN (로그인한 쿠키가 있어도)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema } from "@aionit/db";
import { createVerifiedUser, ORIGIN, resetDb, setupTestAuth } from "./helpers";
import type { Browser } from "./helpers";

const t = setupTestAuth();
afterAll(() => t.close());

type Handler = (request: Request, context: { params: Promise<Record<string, unknown>> }) => Promise<Response>;
type RouteModule = Partial<Record<Method, Handler>>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const modules = import.meta.glob<RouteModule>("../src/app/**/route.ts", { eager: true });

/** 일부러 로그인 없이 여는 주소 (까닭) */
const PUBLIC: Record<string, string> = {
  "/api/health": "감시 도구 · 배포 스크립트의 상태 확인. 내부 정보를 내보내지 않는다",
  "/api/v1/auth/[...all]": "Better Auth (가입 · 로그인). 자체 Origin 확인 · 횟수 제한",
  "/api/v1/nickname-available": "가입 화면의 닉네임 중복 확인",
  "/api/v1/media/check": "Caddy forward_auth. 서명한 재생 토큰만 본다",
  "/media/[...path]": "개발 서버 영상 조각. 서명한 재생 토큰만 본다",
  "/api/v1/payments/toss/webhook": "토스 서버가 부른다. 내용은 믿지 않고 토스에 다시 조회한다",
  "/api/v1/content/[versionId]/[...path]": "무료 미리보기 그림 · 교재 자료. 수강권 판단 함수로 거른다",
  "/api/v1/hls/keys/[assetId]": "영상 키. 토큰 + 로그인 + 수강권을 모두 확인하고, 아니면 403",
  "/api/v1/notifications/[id]": "알림 열기 (GET). 로그인이 없으면 로그인 화면으로 보낸다",
};

const SAMPLE: Record<string, unknown> = {
  action: "publish",
  n: "1",
  month: "2026-10",
  kind: "terms",
};

interface Target {
  pattern: string;
  url: string;
  params: Record<string, unknown>;
  methods: Method[];
  handlers: RouteModule;
}

const targets: Target[] = Object.entries(modules).map(([file, mod]) => {
  const pattern = file.replace("../src/app", "").replace(/\/route\.ts$/, "");
  const params: Record<string, unknown> = {};
  const url = pattern
    .split("/")
    .map((segment) => {
      const rest = segment.match(/^\[\.\.\.(\w+)\]$/);
      if (rest) {
        params[rest[1]!] = ["x"];
        return "x";
      }
      const one = segment.match(/^\[(\w+)\]$/);
      if (!one) return segment;
      const value = (SAMPLE[one[1]!] as string | undefined) ?? crypto.randomUUID();
      params[one[1]!] = value;
      return value;
    })
    .join("/");
  return {
    pattern,
    url,
    params,
    methods: METHODS.filter((m) => typeof mod[m] === "function"),
    handlers: mod,
  };
});

const guarded = targets.filter((r) => !(r.pattern in PUBLIC));

async function knock(
  target: Target,
  method: Method,
  options: { browser?: Browser; origin?: string } = {},
): Promise<{ status: number; code?: string }> {
  const headers = options.browser ? options.browser.headers() : new Headers({ origin: ORIGIN });
  if (options.origin) headers.set("origin", options.origin);
  const write = method !== "GET";
  if (write) headers.set("content-type", "application/json");
  const response = await target.handlers[method]!(
    new Request(`${ORIGIN}${target.url}`, { method, headers, body: write ? "{}" : undefined }),
    { params: Promise.resolve(target.params) },
  );
  const text = await response.text();
  let code: string | undefined;
  try {
    code = (JSON.parse(text) as { error?: { code?: string } }).error?.code;
  } catch {
    code = undefined;
  }
  return { status: response.status, code };
}

let student: Browser;
let operatorNoMfa: Browser;

beforeAll(async () => {
  await resetDb(t.db);
  student = (await createVerifiedUser(t, { email: "sweep-student@example.com", name: "점검수강생" })).browser;
  await student.call("POST", "/sign-in/email", {
    email: "sweep-student@example.com",
    password: "Blue-Harbor-Tiger-42",
  });
  const op = await createVerifiedUser(t, { email: "sweep-op@example.com", name: "점검관리" });
  await op.browser.call("POST", "/sign-in/email", { email: op.email, password: op.password });
  const [row] = await t.db.select().from(schema.users).where(eq(schema.users.email, op.email));
  await t.db.insert(schema.userRoles).values({ userId: row!.id, role: "operator", reason: "점검" });
  operatorNoMfa = op.browser;
});

describe("보안 점검: 모든 API", () => {
  it("라우트 파일을 찾았고, 공개 목록에 없는 주소가 남아 있지 않다", () => {
    expect(targets.length).toBeGreaterThan(80);
    const patterns = new Set(targets.map((r) => r.pattern));
    for (const p of Object.keys(PUBLIC)) expect(patterns, `PUBLIC 의 ${p} 가 없다`).toContain(p);
  });

  it("로그인 없이 부르면 401 이나 404 (데이터를 돌려주거나 500 이 나지 않는다)", async () => {
    const leaks: string[] = [];
    for (const target of guarded)
      for (const method of target.methods) {
        const { status } = await knock(target, method);
        if (status !== 401 && status !== 404) leaks.push(`${method} ${target.pattern} ➔ ${status}`);
      }
    expect(leaks).toEqual([]);
  });

  it("수강생이 /admin · /instructor API 를 부르면 403 (또는 404)", async () => {
    const leaks: string[] = [];
    for (const target of guarded.filter((r) => /^\/api\/v1\/(admin|instructor)\//.test(r.pattern)))
      for (const method of target.methods) {
        const { status } = await knock(target, method, { browser: student });
        if (status !== 403 && status !== 404) leaks.push(`${method} ${target.pattern} ➔ ${status}`);
      }
    expect(leaks).toEqual([]);
  });

  it("운영자 역할이 있어도 2단계 인증 없이는 /admin API 가 막힌다", async () => {
    const leaks: string[] = [];
    for (const target of guarded.filter((r) => r.pattern.startsWith("/api/v1/admin/")))
      for (const method of target.methods) {
        const { status, code } = await knock(target, method, { browser: operatorNoMfa });
        if (status === 404) continue; // 주소 안의 값 확인이 먼저인 곳
        if (status !== 403 || code !== "TWO_FACTOR_REQUIRED")
          leaks.push(`${method} ${target.pattern} ➔ ${status} ${code}`);
      }
    expect(leaks).toEqual([]);
  });

  it("다른 사이트에서 온 쓰기 요청은 로그인 쿠키가 있어도 403 BAD_ORIGIN", async () => {
    const leaks: string[] = [];
    for (const target of guarded)
      for (const method of target.methods.filter((m) => m !== "GET")) {
        const { status, code } = await knock(target, method, {
          browser: student,
          origin: "https://evil.example",
        });
        if (status !== 403 || code !== "BAD_ORIGIN")
          leaks.push(`${method} ${target.pattern} ➔ ${status} ${code}`);
      }
    expect(leaks).toEqual([]);
  });

  it("공개 주소도 로그인 없이 내부 정보를 내주지 않는다", async () => {
    const health = targets.find((r) => r.pattern === "/api/health")!;
    const response = await health.handlers.GET!(new Request(`${ORIGIN}/api/health`), {
      params: Promise.resolve({}),
    });
    expect(await response.json()).toEqual({ status: "ok" });

    const check = targets.find((r) => r.pattern === "/api/v1/media/check")!;
    const forged = await check.handlers.GET!(
      new Request(`${ORIGIN}/api/v1/media/check`, {
        headers: { "x-forwarded-uri": `/media/v/${crypto.randomUUID()}/hls/index.m3u8` },
      }),
      { params: Promise.resolve({}) },
    );
    expect(forged.status).toBe(401);

    const key = targets.find((r) => r.pattern === "/api/v1/hls/keys/[assetId]")!;
    expect((await knock(key, "GET")).status).toBe(403);
  });
});
