// 통합 테스트 도우미: 테스트 DB 위에 인증 객체를 만들고, 쿠키를 기억하는 가짜 브라우저로 API 를 부른다.
import { createHmac } from "node:crypto";
import { createDb, sql } from "@aionit/db";
import type { MailJob } from "@aionit/mail";
import { createAuth } from "@/server/auth";
import type { Env } from "@/server/env";

export const ORIGIN = "http://localhost:3000";

export function setupTestAuth(extraEnv: Partial<Env> = {}) {
  const env: Env = {
    DATABASE_URL: process.env.DATABASE_URL!,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL!,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
    ...extraEnv,
  };
  const { db, close } = createDb(env.DATABASE_URL, { max: 4, quiet: true });
  const mails: MailJob[] = [];
  const auth = createAuth({ db, env, enqueueMail: async (job) => void mails.push(job) });
  return { db, close, auth, env, mails };
}

export type TestAuth = ReturnType<typeof setupTestAuth>;

/** 정책 문서(마이그레이션이 넣은 것)만 남기고 모두 비운다 */
export async function resetDb(db: TestAuth["db"]) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local aionit.retention_purge = 'on'`);
    await tx.execute(
      sql`truncate users, sessions, auth_accounts, verifications, two_factors, rate_limits, user_roles,
          user_consents, login_logs, audit_logs, pii_access_logs, email_logs cascade`,
    );
  });
}

let ipCounter = 1;
/** 요청마다 다른 IP 를 쓰면 IP 횟수 제한에 걸리지 않는다 */
export function nextIp(): string {
  ipCounter += 1;
  return `10.20.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

export interface ApiResult {
  status: number;
  body: Record<string, unknown> & { code?: string; message?: string };
  headers: Headers;
}

/** 쿠키를 기억하는 가짜 브라우저 */
export class Browser {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly auth: TestAuth["auth"],
    public ip = nextIp(),
  ) {}

  headers(extra: Record<string, string> = {}): Headers {
    const headers = new Headers({
      origin: ORIGIN,
      "x-forwarded-for": this.ip,
      "user-agent": "vitest",
      ...extra,
    });
    if (this.cookies.size > 0) {
      headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    return headers;
  }

  async call(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult> {
    const url = path.startsWith("http") ? path : `${ORIGIN}/api/v1/auth${path}`;
    const headers = this.headers(body === undefined ? {} : { "content-type": "application/json" });
    const response = await this.auth.handler(
      new Request(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(";");
      const [name, ...rest] = pair!.split("=");
      const value = rest.join("=");
      const expired = attributes.some((a) => /max-age=0/i.test(a.trim())) || value === "";
      if (expired) this.cookies.delete(name!.trim());
      else this.cookies.set(name!.trim(), value);
    }
    const text = await response.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = text ? ((JSON.parse(text) as Record<string, unknown> | null) ?? {}) : {};
    } catch {
      parsed = { raw: text };
    }
    return { status: response.status, body: parsed, headers: response.headers };
  }
}

export const STRONG_PASSWORD = "Blue-Harbor-Tiger-42";

export function signupBody(overrides: Record<string, unknown> = {}) {
  return {
    email: "learner@example.com",
    password: STRONG_PASSWORD,
    name: "클라우드고양이",
    age14: true,
    consents: { terms: true, privacy: true, marketing: false },
    callbackURL: "/login?verified=1",
    ...overrides,
  };
}

/** 메일에 든 링크에서 토큰을 꺼낸다 */
export function tokenFromMail(mails: MailJob[], template: MailJob["template"], to: string): string {
  const mail = [...mails].reverse().find((m) => m.template === template && m.to === to);
  if (!mail || !("url" in mail)) throw new Error(`${to} 에게 간 ${template} 메일이 없습니다`);
  const url = new URL(mail.url);
  return url.searchParams.get("token") ?? url.pathname.split("/").pop()!;
}

/** 가입 ➔ 메일 인증까지 마친 회원 */
export async function createVerifiedUser(t: TestAuth, overrides: Record<string, unknown> = {}) {
  const body = signupBody(overrides);
  const browser = new Browser(t.auth);
  const signup = await browser.call("POST", "/sign-up/email", body);
  if (signup.status !== 200) throw new Error(`가입 실패: ${JSON.stringify(signup.body)}`);
  const token = tokenFromMail(t.mails, "verify-email", body.email as string);
  await browser.call("GET", `/verify-email?token=${token}`);
  return {
    email: body.email as string,
    password: body.password as string,
    nickname: body.name as string,
    browser,
  };
}

// ---- TOTP (RFC 6238): 인증 앱 대신 코드를 만든다 ----
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpFromUri(uri: string, at = Date.now()): string {
  const url = new URL(uri);
  const secret = base32Decode(url.searchParams.get("secret")!);
  const period = Number(url.searchParams.get("period") ?? 30);
  const digits = Number(url.searchParams.get("digits") ?? 6);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / period)));
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, "0");
}
