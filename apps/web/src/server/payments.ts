import "server-only";
import type { SubscriptionDeps } from "@aionit/payments";
import { createFakeToss, createTossGateway } from "@aionit/payments";
import type { CommerceDeps } from "./commerce";
import { CommerceError } from "./commerce";
import { getDb } from "./db";
import { getEnv } from "./env";
import { enqueueMail } from "./queue";

// 토스 키 묶음 둘 (실오픈 전까지 테스트 키만, docs/개발계획.md M5 · M6):
//   단건 = 결제위젯 연동 키 (TOSS_CLIENT_KEY · TOSS_SECRET_KEY)
//   구독 자동결제 = API 개별 연동 키 (TOSS_BILLING_CLIENT_KEY · TOSS_BILLING_SECRET_KEY)
// 토스는 결제한 키 묶음으로만 취소된다 ➔ payments.key_set 으로 고른다

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

export function billingEnabled(): boolean {
  const env = getEnv();
  return fakeMode() || (!!env.TOSS_BILLING_CLIENT_KEY && !!env.TOSS_BILLING_SECRET_KEY);
}

const globalForFake = globalThis as unknown as { aionitFakeToss?: ReturnType<typeof createFakeToss> };

/** 개발 서버 안에서 하나만 (라우트마다 같은 가짜 결제 기록을 본다) */
export function fakeToss() {
  if (!fakeMode()) throw new CommerceError(404, "NOT_FOUND", "찾을 수 없습니다.");
  globalForFake.aionitFakeToss ??= createFakeToss();
  return globalForFake.aionitFakeToss;
}

let widgetGateway: ReturnType<typeof createTossGateway> | undefined;
let billingGateway: ReturnType<typeof createTossGateway> | undefined;

function gateways() {
  const env = getEnv();
  if (fakeMode()) return { widget: fakeToss().gateway, billing: fakeToss().gateway };
  if (env.TOSS_SECRET_KEY) widgetGateway ??= createTossGateway({ secretKey: env.TOSS_SECRET_KEY });
  if (env.TOSS_BILLING_SECRET_KEY)
    billingGateway ??= createTossGateway({ secretKey: env.TOSS_BILLING_SECRET_KEY });
  return { widget: widgetGateway ?? null, billing: billingGateway ?? null };
}

export function commerceDeps(): CommerceDeps {
  const env = getEnv();
  const { widget, billing } = gateways();
  if (!widget) throw new CommerceError(503, "PAYMENTS_DISABLED", "결제를 준비하고 있습니다.");
  return {
    db: getDb(),
    gateway: widget,
    billingGateway: billing,
    enqueueMail,
    baseUrl: env.BETTER_AUTH_URL.replace(/\/$/, ""),
  };
}

export function subscriptionDeps(): SubscriptionDeps {
  const env = getEnv();
  const { billing } = gateways();
  if (!billing) throw new CommerceError(503, "BILLING_DISABLED", "구독 신청을 준비하고 있습니다.");
  return {
    db: getDb(),
    gateway: billing,
    secret: env.BETTER_AUTH_SECRET,
    enqueueMail,
    baseUrl: env.BETTER_AUTH_URL.replace(/\/$/, ""),
  };
}

/** 카드 등록창(자동결제)에 쓰는 클라이언트 키. 가짜 모드면 null */
export function billingClientKey(): string | null {
  return fakeMode() ? null : (getEnv().TOSS_BILLING_CLIENT_KEY ?? null);
}
