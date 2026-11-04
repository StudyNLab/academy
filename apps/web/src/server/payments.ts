import "server-only";
import type { CommerceDeps } from "./commerce";
import { CommerceError } from "./commerce";
import { getDb } from "./db";
import { getEnv } from "./env";
import { enqueueMail } from "./queue";
import { createTossGateway } from "./toss";
import { createFakeToss } from "./toss-fake";

// 토스 키(결제위젯 연동 키)가 있을 때만 결제를 연다. 실오픈 전까지 테스트 키만 쓴다 (docs/개발계획.md M5)

/**
 * 개발 서버 화면 흐름 테스트용 가짜 결제 (TOSS_FAKE=1). 운영 빌드(NODE_ENV=production)에서는 켜지지 않는다.
 * 토스 테스트 모드도 카드 결제는 카드사 본인 인증을 거쳐 자동화할 수 없어서 둔다.
 */
export function fakeMode(): boolean {
  return getEnv().TOSS_FAKE === "1" && process.env.NODE_ENV !== "production";
}

export function paymentsEnabled(): boolean {
  const env = getEnv();
  return fakeMode() || (!!env.TOSS_CLIENT_KEY && !!env.TOSS_SECRET_KEY);
}

const globalForFake = globalThis as unknown as { aionitFakeToss?: ReturnType<typeof createFakeToss> };

/** 개발 서버 안에서 하나만 (라우트마다 같은 가짜 결제 기록을 본다) */
export function fakeToss() {
  if (!fakeMode()) throw new CommerceError(404, "NOT_FOUND", "찾을 수 없습니다.");
  globalForFake.aionitFakeToss ??= createFakeToss();
  return globalForFake.aionitFakeToss;
}

let gateway: ReturnType<typeof createTossGateway> | undefined;

export function commerceDeps(): CommerceDeps {
  const env = getEnv();
  const base = { db: getDb(), enqueueMail, baseUrl: env.BETTER_AUTH_URL.replace(/\/$/, "") };
  if (fakeMode()) return { ...base, gateway: fakeToss().gateway };
  if (!env.TOSS_SECRET_KEY) throw new CommerceError(503, "PAYMENTS_DISABLED", "결제를 준비하고 있습니다.");
  gateway ??= createTossGateway({ secretKey: env.TOSS_SECRET_KEY });
  return { ...base, gateway };
}
