// 구독 · 자동결제 (docs/기술설계.md 6.2, M6). web(신청 · 카드 등록 · 해지 · 결제 수단 변경)과 worker(매일 자동결제)가 함께 쓴다.
//   신청 ➔ subscriptions(pending) ➔ 토스 카드 등록창 ➔ authKey ➔ 빌링키 발급(암호화 보관) ➔ 1회차 결제 ➔ active + 구독 수강권
//   매일: 결제일이 된 구독 ➔ 다음 회차 결제 (멱등 키 = 구독 id + 회차 + 시도) ➔ 실패: past_due + 1 · 3 · 7일 뒤 재시도 ➔ 계속 실패: ended
//   해지 예약 ➔ 기간 끝에 ended. 회차마다 주문 · 결제 기록을 만들어 결제 내역 · 영수증 · 환불을 단건과 같이 쓴다.
import { createHmac } from "node:crypto";
import type { BillingInterval } from "@aionit/core";
import {
  billingDateOf,
  graceEndOf,
  kstDate,
  nextRetryAt,
  periodEndOf,
  priceAt,
  priceChangeCycle,
  RENEWAL_NOTICE_DAYS,
  splitVat,
} from "@aionit/core";
import { openBillingKey, sealBillingKey } from "@aionit/core/media";
import type { Db } from "@aionit/db";
import { and, desc, eq, inArray, isNull, lte, schema } from "@aionit/db";
import type { MailJob } from "@aionit/mail";
import type { PaymentGateway, TossPayment } from "./toss";
import { GatewayError, trimPayment } from "./toss";

export class SubscriptionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SubscriptionDeps {
  db: Db;
  /** 자동결제용 키 묶음(API 개별 연동)의 토스 어댑터 */
  gateway: PaymentGateway;
  /** 빌링키 암호화 · 고객 키에 쓰는 앱 비밀값 */
  secret: string;
  enqueueMail: (job: MailJob) => Promise<void>;
  baseUrl: string;
}

type Subscription = typeof schema.subscriptions.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const LIVE_STATUSES = ["active", "past_due", "cancel_scheduled"] as const;

/** 토스 고객 키: 회원 id 를 그대로 주지 않고 앱 비밀값으로 만든 값 (유추할 수 없게, 결제위젯 · 자동결제 공통) */
export function tossCustomerKey(secret: string, userId: string): string {
  return `c_${createHmac("sha256", secret).update(`toss-customer:${userId}`).digest("hex").slice(0, 40)}`;
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

async function userEmail(db: Pick<Db, "select">, userId: string) {
  const [u] = await db
    .select({ email: schema.users.email, status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return u?.status === "withdrawn" ? null : (u?.email ?? null);
}

async function mail(deps: SubscriptionDeps, userId: string, build: (to: string) => MailJob) {
  const to = await userEmail(deps.db, userId);
  if (!to) return;
  await deps
    .enqueueMail(build(to))
    .catch((error: unknown) => console.error("[subscription] 메일 넣기 실패", error));
}

/** 같은 회차에 같은 안내는 한 번만 (법정 고지 기록). 처음이면 true */
async function recordNotice(
  db: Pick<Db, "insert">,
  sub: Pick<Subscription, "id">,
  kind: (typeof schema.SUBSCRIPTION_NOTICE_KINDS)[number],
  cycleNo: number,
  newAmount: number | null = null,
): Promise<boolean> {
  const [row] = await db
    .insert(schema.subscriptionNotices)
    .values({ subscriptionId: sub.id, kind, cycleNo, newAmount })
    .onConflictDoNothing()
    .returning({ id: schema.subscriptionNotices.id });
  return !!row;
}

const manageUrl = (deps: SubscriptionDeps) => `${deps.baseUrl}/my/subscription`;

// ---- 신청 (C-04) ----

/** 구독 요금제 (판매 중 + 지금 가격) */
export async function subscriptionPlans(db: Db, now = new Date()) {
  const rows = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.type, "subscription"), eq(schema.products.status, "on_sale")));
  const prices = rows.length
    ? await db
        .select()
        .from(schema.prices)
        .where(
          inArray(
            schema.prices.productId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows
    .map((p) => ({
      product: p,
      price: priceAt(
        prices.filter((x) => x.productId === p.id),
        now,
      ),
    }))
    .filter((p): p is { product: typeof p.product; price: NonNullable<typeof p.price> } => !!p.price)
    .sort(
      (a, b) =>
        (a.product.billingInterval === "month" ? -1 : 1) - (b.product.billingInterval === "month" ? -1 : 1),
    );
}

export async function liveSubscription(db: Pick<Db, "select">, userId: string) {
  const [row] = await db
    .select()
    .from(schema.subscriptions)
    .where(
      and(eq(schema.subscriptions.userId, userId), inArray(schema.subscriptions.status, [...LIVE_STATUSES])),
    );
  return row ?? null;
}

/**
 * 구독 신청: 자동결제 동의와 약관 · 환불 규정 동의를 따로 받아 pending 구독을 만든다. 카드 등록창에 넘길 고객 키를 돌려준다.
 * 금액은 지금 가격을 스냅샷 (이후 가격 변경은 알림 · 동의를 거친다).
 */
export async function startSubscription(
  deps: Pick<SubscriptionDeps, "db" | "secret">,
  input: {
    userId: string;
    productId: string;
    autoRenewAgreed: boolean;
    termsAgreed: boolean;
    refundPolicyDocumentId: string | null;
    ip: string | null;
  },
  now = new Date(),
) {
  const { db } = deps;
  if (!input.autoRenewAgreed || !input.termsAgreed)
    throw new SubscriptionError(
      400,
      "NOT_AGREED",
      "자동결제와 구독 약관 · 환불 규정에 모두 동의해야 합니다.",
    );
  if (await liveSubscription(db, input.userId))
    throw new SubscriptionError(
      409,
      "ALREADY_SUBSCRIBED",
      "이미 구독 중입니다. 구독 관리에서 확인해 주세요.",
    );
  const plan = (await subscriptionPlans(db, now)).find((p) => p.product.id === input.productId);
  if (!plan || !plan.product.billingInterval)
    throw new SubscriptionError(404, "NOT_ON_SALE", "지금은 신청할 수 없는 요금제입니다.");
  return db.transaction(async (tx) => {
    // 카드 등록을 마치지 않은 이전 신청은 닫는다
    await tx
      .update(schema.subscriptions)
      .set({ status: "canceled", endedAt: now, endReason: "새 신청으로 대체" })
      .where(and(eq(schema.subscriptions.userId, input.userId), eq(schema.subscriptions.status, "pending")));
    const [sub] = await tx
      .insert(schema.subscriptions)
      .values({
        userId: input.userId,
        productId: plan.product.id,
        interval: plan.product.billingInterval!,
        planName: plan.product.name,
        amount: plan.price.amount,
        customerKey: tossCustomerKey(deps.secret, input.userId),
        autoRenewAgreedAt: now,
        termsAgreedAt: now,
        agreedIp: input.ip,
        refundPolicyDocumentId: input.refundPolicyDocumentId,
      })
      .returning();
    if (input.refundPolicyDocumentId)
      await tx.insert(schema.userConsents).values({
        userId: input.userId,
        policyDocumentId: input.refundPolicyDocumentId,
        agreed: true,
        ip: input.ip,
      });
    return sub!;
  });
}

async function loadOwn(db: Pick<Db, "select">, userId: string, subscriptionId: string) {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.id, subscriptionId), eq(schema.subscriptions.userId, userId)));
  if (!sub) throw new SubscriptionError(404, "NOT_FOUND", "구독을 찾을 수 없습니다.");
  return sub;
}

function cardLabelOf(auth: {
  cardCompany?: string | null;
  cardNumber?: string | null;
  card?: { number?: string | null } | null;
}) {
  const number = auth.cardNumber ?? auth.card?.number ?? "";
  const tail = number.replace(/[^0-9*]/g, "").slice(-4);
  return `${auth.cardCompany ?? "카드"}${tail ? ` •••• ${tail}` : ""}`;
}

/**
 * 카드 등록창에서 돌아옴: authKey ➔ 빌링키(암호화 보관) ➔ 1회차 결제 ➔ active + 구독 수강권 + 영수증.
 * 새로고침 · 두 번 요청: 이미 시작했으면 그대로 돌려준다.
 */
export async function activateSubscription(
  deps: SubscriptionDeps,
  input: { userId: string; subscriptionId: string; authKey: string; customerKey: string },
  now = new Date(),
): Promise<Subscription> {
  const sub = await loadOwn(deps.db, input.userId, input.subscriptionId);
  if (sub.status !== "pending") {
    if ((LIVE_STATUSES as readonly string[]).includes(sub.status)) return sub;
    throw new SubscriptionError(409, "CLOSED", "끝난 신청입니다. 다시 신청해 주세요.");
  }
  if (input.customerKey !== sub.customerKey)
    throw new SubscriptionError(400, "CUSTOMER_MISMATCH", "카드 등록 정보가 신청과 다릅니다.");
  let auth;
  try {
    auth = await deps.gateway.issueBillingKey({ authKey: input.authKey, customerKey: sub.customerKey });
  } catch (error) {
    if (error instanceof GatewayError)
      throw new SubscriptionError(400, "CARD_FAILED", `카드를 등록하지 못했습니다: ${error.message}`);
    throw error;
  }
  const anchor = kstDate(now);
  const [updated] = await deps.db
    .update(schema.subscriptions)
    .set({
      billingKeySealed: sealBillingKey(deps.secret, auth.billingKey),
      cardLabel: cardLabelOf(auth),
      anchorDate: anchor,
    })
    .where(and(eq(schema.subscriptions.id, sub.id), eq(schema.subscriptions.status, "pending")))
    .returning();
  if (!updated) return loadOwn(deps.db, input.userId, input.subscriptionId);
  const result = await chargeCycle(deps, updated, 1, now);
  if (!result.ok)
    throw new SubscriptionError(400, "PAYMENT_FAILED", `첫 결제를 하지 못했습니다: ${result.message}`);
  return loadOwn(deps.db, input.userId, input.subscriptionId);
}

// ---- 회차 결제 ----

export type ChargeResult = { ok: true; cycleNo: number } | { ok: false; message: string; ended: boolean };

/** 이 회차에 받을 금액: 가격 변경이 이 회차부터면 새 금액 (올림은 동의했을 때만 — 동의가 없으면 호출 전에 끝낸다) */
function amountFor(sub: Subscription, cycleNo: number): number {
  if (sub.pendingAmount !== null && sub.pendingFromCycle !== null && cycleNo >= sub.pendingFromCycle) {
    if (!sub.pendingNeedsConsent || sub.pendingAgreedAt) return sub.pendingAmount;
  }
  return sub.amount;
}

/**
 * 회차 n 결제. 회차 행을 잠가 같은 회차가 동시에 두 번 결제되지 않게 하고(worker 가 겹쳐 돌아도),
 * 토스 멱등 키 = 구독 + 회차 + 시도 번호.
 */
export async function chargeCycle(
  deps: SubscriptionDeps,
  sub: Subscription,
  cycleNo: number,
  now = new Date(),
): Promise<ChargeResult> {
  const { db } = deps;
  if (!sub.billingKeySealed || !sub.anchorDate)
    return { ok: false, message: "등록된 카드가 없습니다", ended: false };
  const interval = sub.interval as BillingInterval;
  const billingDate = billingDateOf(sub.anchorDate, interval, cycleNo);
  const periodStart = cycleNo === 1 ? now : (sub.currentPeriodEnd ?? now);
  const periodEnd = periodEndOf(sub.anchorDate, interval, cycleNo);
  const amount = amountFor(sub, cycleNo);
  const { supply, vat } = splitVat(amount);

  // 회차 행 + 주문 (재시도면 그대로 쓴다)
  await db
    .insert(schema.subscriptionCycles)
    .values({
      subscriptionId: sub.id,
      cycleNo,
      billingDate,
      periodStart,
      periodEnd,
      amount,
      supplyAmount: supply,
      vatAmount: vat,
    })
    .onConflictDoNothing();

  return db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(schema.subscriptionCycles)
      .where(
        and(
          eq(schema.subscriptionCycles.subscriptionId, sub.id),
          eq(schema.subscriptionCycles.cycleNo, cycleNo),
        ),
      )
      .for("update");
    if (!cycle) throw new Error("회차 행이 없습니다");
    if (cycle.status === "paid" || cycle.status === "refunded") return { ok: true as const, cycleNo };
    let orderId = cycle.orderId;
    const orderName = `AIONIT ${sub.planName} ${cycleNo}회차`;
    if (!orderId) {
      const [order] = await tx
        .insert(schema.orders)
        .values({
          userId: sub.userId,
          totalAmount: cycle.amount,
          orderName: orderName.slice(0, 100),
          agreedAt: sub.autoRenewAgreedAt,
          expiresAt: periodEnd,
          createdAt: now,
        })
        .returning({ id: schema.orders.id });
      orderId = order!.id;
      await tx.insert(schema.orderItems).values({
        orderId,
        productId: sub.productId,
        productType: "subscription",
        courseId: null,
        productName: `${sub.planName} (${cycleNo}회차)`,
        listPrice: cycle.amount,
        discountAmount: 0,
        paidAmount: cycle.amount,
        supplyAmount: cycle.supplyAmount,
        vatAmount: cycle.vatAmount,
        accessDays: Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000),
        refundPolicyDocumentId: sub.refundPolicyDocumentId,
      });
      await tx
        .update(schema.subscriptionCycles)
        .set({ orderId })
        .where(eq(schema.subscriptionCycles.id, cycle.id));
    }

    let payment: TossPayment;
    try {
      payment = await deps.gateway.chargeBilling({
        billingKey: openBillingKey(deps.secret, sub.billingKeySealed!),
        customerKey: sub.customerKey,
        amount: cycle.amount,
        orderId,
        orderName,
        idempotencyKey: `sub-${sub.id}-${cycleNo}-a${cycle.retryCount}`,
      });
      if (payment.status !== "DONE" || payment.totalAmount !== cycle.amount)
        throw new GatewayError("RESPONSE_MISMATCH", "결제 응답이 요청과 다릅니다", 500);
    } catch (error) {
      const message =
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      return failCycle(deps, tx, sub, cycle, message.slice(0, 300), now);
    }

    // 성공: 결제 · 주문 · 회차 · 구독 · 수강권
    const [pay] = await tx
      .insert(schema.payments)
      .values({
        orderId,
        providerPaymentKey: payment.paymentKey,
        keySet: "billing",
        method: payment.method ?? "카드",
        amount: cycle.amount,
        status: "done",
        receiptUrl: payment.receipt?.url ?? null,
        raw: trimPayment(payment),
        approvedAt: payment.approvedAt ? new Date(payment.approvedAt) : now,
      })
      .returning({ id: schema.payments.id });
    await tx
      .update(schema.orders)
      .set({ status: "paid", paidAt: now, failReason: null })
      .where(eq(schema.orders.id, orderId));
    await tx
      .update(schema.subscriptionCycles)
      .set({ status: "paid", paymentId: pay!.id, nextRetryAt: null, lastError: null })
      .where(eq(schema.subscriptionCycles.id, cycle.id));
    let entitlementId = sub.entitlementId;
    if (entitlementId) {
      await tx
        .update(schema.entitlements)
        .set({ endsAt: periodEnd, revokedAt: null, revokeReason: null })
        .where(eq(schema.entitlements.id, entitlementId));
    } else {
      const [ent] = await tx
        .insert(schema.entitlements)
        .values({
          userId: sub.userId,
          scope: "subscription_catalog",
          sourceType: "subscription",
          sourceId: sub.id,
          startsAt: now,
          endsAt: periodEnd,
        })
        .returning({ id: schema.entitlements.id });
      entitlementId = ent!.id;
    }
    const priceApplied = sub.pendingFromCycle !== null && cycleNo >= sub.pendingFromCycle;
    await tx
      .update(schema.subscriptions)
      .set({
        status: sub.status === "cancel_scheduled" ? "cancel_scheduled" : "active",
        currentCycle: cycleNo,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        entitlementId,
        amount: cycle.amount,
        ...(priceApplied
          ? { pendingAmount: null, pendingFromCycle: null, pendingNeedsConsent: null, pendingAgreedAt: null }
          : {}),
      })
      .where(eq(schema.subscriptions.id, sub.id));
    await mail(deps, sub.userId, (to) => ({
      template: "payment-receipt",
      to,
      userId: sub.userId,
      productName: `${sub.planName} (${cycleNo}회차)`,
      listPrice: cycle.amount,
      discountAmount: 0,
      paidAmount: cycle.amount,
      supplyAmount: cycle.supplyAmount,
      vatAmount: cycle.vatAmount,
      paidAt: now.toISOString(),
      accessUntil: periodEnd.toISOString(),
      receiptUrl: payment.receipt?.url ?? null,
      historyUrl: `${deps.baseUrl}/my/payments`,
    }));
    return { ok: true as const, cycleNo };
  });
}

/** 결제 실패: 1회차는 신청 화면에 알리고 끝. 갱신은 past_due + 다음 재시도, 재시도가 다 끝났으면 구독을 끝낸다 */
async function failCycle(
  deps: SubscriptionDeps,
  tx: Tx,
  sub: Subscription,
  cycle: typeof schema.subscriptionCycles.$inferSelect,
  message: string,
  now: Date,
): Promise<ChargeResult> {
  const retriesDone = cycle.retryCount; // 이번이 몇 번째 시도였나 (0 = 결제일 첫 시도)
  const next = cycle.cycleNo === 1 ? null : nextRetryAt(cycle.billingDate, retriesDone);
  await tx
    .update(schema.subscriptionCycles)
    .set({ status: "failed", retryCount: retriesDone + 1, nextRetryAt: next, lastError: message })
    .where(eq(schema.subscriptionCycles.id, cycle.id));
  if (cycle.orderId)
    await tx
      .update(schema.orders)
      .set({ failReason: message })
      .where(and(eq(schema.orders.id, cycle.orderId), eq(schema.orders.status, "pending")));
  if (cycle.cycleNo === 1) return { ok: false, message, ended: false };

  if (!next) {
    await endSubscription(tx, sub, "자동결제 실패 (재시도 모두 실패)", now);
    if (await recordNotice(tx, sub, "ended", cycle.cycleNo))
      await mail(deps, sub.userId, (to) => ({
        template: "subscription-notice",
        to,
        userId: sub.userId,
        kind: "ended",
        planName: sub.planName,
        amount: cycle.amount,
        date: now.toISOString(),
        reason: "자동결제에 계속 실패해 구독이 끝났습니다.",
        url: manageUrl(deps),
      }));
    return { ok: false, message, ended: true };
  }
  // 재시도하는 동안은 마지막 재시도 날까지 계속 볼 수 있다
  const grace = graceEndOf(cycle.billingDate);
  await tx
    .update(schema.subscriptions)
    .set({ status: "past_due" })
    .where(eq(schema.subscriptions.id, sub.id));
  if (sub.entitlementId)
    await tx
      .update(schema.entitlements)
      .set({ endsAt: grace })
      .where(eq(schema.entitlements.id, sub.entitlementId));
  if (await recordNotice(tx, sub, "payment_failed", cycle.cycleNo))
    await mail(deps, sub.userId, (to) => ({
      template: "subscription-notice",
      to,
      userId: sub.userId,
      kind: "payment_failed",
      planName: sub.planName,
      amount: cycle.amount,
      date: grace.toISOString(),
      reason: message,
      url: manageUrl(deps),
    }));
  return { ok: false, message, ended: false };
}

/** 구독을 끝낸다: 자동결제 중지(빌링키 지움), 구독 수강권은 지금 끝, 진도는 남긴다 */
async function endSubscription(
  tx: Pick<Db, "update">,
  sub: Subscription,
  reason: string,
  now: Date,
  status: "ended" | "canceled" = "ended",
) {
  await tx
    .update(schema.subscriptions)
    .set({ status, endedAt: now, endReason: reason, billingKeySealed: null })
    .where(eq(schema.subscriptions.id, sub.id));
  if (sub.entitlementId)
    await tx
      .update(schema.entitlements)
      .set({ endsAt: now })
      .where(and(eq(schema.entitlements.id, sub.entitlementId)));
}

// ---- 구독 관리 (M-03) ----

/** 해지 예약 (확인 한 번). 이미 결제한 기간 끝까지 이용, 그 뒤 자동결제 안 함 */
export async function scheduleCancel(
  deps: SubscriptionDeps,
  input: { userId: string; subscriptionId: string; reason?: string | null },
  now = new Date(),
) {
  const sub = await loadOwn(deps.db, input.userId, input.subscriptionId);
  if (sub.status === "cancel_scheduled") return sub;
  if (sub.status !== "active" && sub.status !== "past_due")
    throw new SubscriptionError(409, "NOT_ACTIVE", "해지할 수 있는 구독이 아닙니다.");
  // 결제 실패 중이면 더 시도하지 않고 지금까지 결제한 기간 끝에 끝낸다
  const [row] = await deps.db
    .update(schema.subscriptions)
    .set({ status: "cancel_scheduled", cancelRequestedAt: now, cancelReason: input.reason?.trim() || null })
    .where(
      and(eq(schema.subscriptions.id, sub.id), inArray(schema.subscriptions.status, ["active", "past_due"])),
    )
    .returning();
  if (sub.status === "past_due" && sub.entitlementId && sub.currentPeriodEnd)
    await deps.db
      .update(schema.entitlements)
      .set({ endsAt: sub.currentPeriodEnd < now ? now : sub.currentPeriodEnd })
      .where(eq(schema.entitlements.id, sub.entitlementId));
  if (await recordNotice(deps.db, sub, "cancel_scheduled", sub.currentCycle))
    await mail(deps, sub.userId, (to) => ({
      template: "subscription-notice",
      to,
      userId: sub.userId,
      kind: "cancel_scheduled",
      planName: sub.planName,
      amount: sub.amount,
      date: (sub.currentPeriodEnd ?? now).toISOString(),
      reason: null,
      url: manageUrl(deps),
    }));
  return row!;
}

/** 해지 예약 취소 (기간이 끝나기 전) */
export async function undoCancel(
  deps: SubscriptionDeps,
  input: { userId: string; subscriptionId: string },
  now = new Date(),
) {
  const sub = await loadOwn(deps.db, input.userId, input.subscriptionId);
  if (sub.status !== "cancel_scheduled" || !sub.currentPeriodEnd || sub.currentPeriodEnd <= now)
    throw new SubscriptionError(409, "NOT_SCHEDULED", "해지 예약 중인 구독이 아닙니다.");
  if (!sub.billingKeySealed) throw new SubscriptionError(400, "NO_CARD", "결제 수단을 다시 등록해 주세요.");
  const [row] = await deps.db
    .update(schema.subscriptions)
    .set({ status: "active", cancelRequestedAt: null, cancelReason: null })
    .where(and(eq(schema.subscriptions.id, sub.id), eq(schema.subscriptions.status, "cancel_scheduled")))
    .returning();
  return row!;
}

/** 가격 인상 동의 */
export async function agreePriceChange(
  deps: SubscriptionDeps,
  input: { userId: string; subscriptionId: string },
  now = new Date(),
) {
  const sub = await loadOwn(deps.db, input.userId, input.subscriptionId);
  if (!sub.pendingNeedsConsent || sub.pendingAmount === null)
    throw new SubscriptionError(409, "NO_PENDING", "동의할 가격 변경이 없습니다.");
  await deps.db
    .update(schema.subscriptions)
    .set({ pendingAgreedAt: now })
    .where(eq(schema.subscriptions.id, sub.id));
  await deps.db
    .update(schema.subscriptionNotices)
    .set({ agreedAt: now })
    .where(
      and(
        eq(schema.subscriptionNotices.subscriptionId, sub.id),
        eq(schema.subscriptionNotices.kind, "price_change"),
        eq(schema.subscriptionNotices.cycleNo, sub.pendingFromCycle!),
      ),
    );
}

/** 결제 수단 변경: 새 카드 등록창에서 받은 authKey ➔ 새 빌링키. 결제 실패 중이었으면 바로 다시 결제 */
export async function changeCard(
  deps: SubscriptionDeps,
  input: { userId: string; subscriptionId: string; authKey: string; customerKey: string },
  now = new Date(),
) {
  const sub = await loadOwn(deps.db, input.userId, input.subscriptionId);
  if (!(LIVE_STATUSES as readonly string[]).includes(sub.status))
    throw new SubscriptionError(409, "NOT_ACTIVE", "이용 중인 구독이 아닙니다.");
  if (input.customerKey !== sub.customerKey)
    throw new SubscriptionError(400, "CUSTOMER_MISMATCH", "카드 등록 정보가 구독과 다릅니다.");
  let auth;
  try {
    auth = await deps.gateway.issueBillingKey({ authKey: input.authKey, customerKey: sub.customerKey });
  } catch (error) {
    if (error instanceof GatewayError)
      throw new SubscriptionError(400, "CARD_FAILED", `카드를 등록하지 못했습니다: ${error.message}`);
    throw error;
  }
  const [updated] = await deps.db
    .update(schema.subscriptions)
    .set({ billingKeySealed: sealBillingKey(deps.secret, auth.billingKey), cardLabel: cardLabelOf(auth) })
    .where(eq(schema.subscriptions.id, sub.id))
    .returning();
  if (updated!.status === "past_due") {
    const result = await chargeCycle(deps, updated!, updated!.currentCycle + 1, now);
    return { retried: true, ok: result.ok, message: result.ok ? null : result.message };
  }
  return { retried: false, ok: true, message: null };
}

/** 환불(즉시 해지)이 끝났을 때: 구독을 바로 끝내고 그 회차를 환불로 표시 (web refunds.applyCancel 이 부른다) */
export async function endByRefund(tx: Pick<Db, "update" | "select">, orderId: string, now: Date) {
  const [cycle] = await tx
    .select()
    .from(schema.subscriptionCycles)
    .where(eq(schema.subscriptionCycles.orderId, orderId));
  if (!cycle) return;
  await tx
    .update(schema.subscriptionCycles)
    .set({ status: "refunded" })
    .where(eq(schema.subscriptionCycles.id, cycle.id));
  const [sub] = await tx
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, cycle.subscriptionId));
  if (sub && sub.status !== "ended" && sub.status !== "canceled")
    await endSubscription(tx, sub, "즉시 해지 · 환불", now, "canceled");
}

// ---- 매일 (worker) ----

export interface BillingRunResult {
  charged: number;
  failed: number;
  ended: number;
  renewalNotices: number;
  priceNotices: number;
}

/**
 * 매일 도는 일 (worker, 다시 돌려도 같은 결과):
 *   1. 해지 예약 · 가격 변경 미동의로 기간이 끝난 구독 ➔ ended
 *   2. 가격 변경 감지 ➔ 적용할 회차를 정하고 알림 (올림은 동의 요청)
 *   3. 갱신 안내 (연간 30일 · 월간 7일 전)
 *   4. 결제일이 된 구독 ➔ 다음 회차 결제 (가격 인상에 동의하지 않았으면 결제하지 않고 기간 끝에 끝냄)
 *   5. 재시도할 때가 된 past_due ➔ 다시 결제
 */
export async function runSubscriptionBilling(
  deps: SubscriptionDeps,
  now = new Date(),
): Promise<BillingRunResult> {
  const { db } = deps;
  const result: BillingRunResult = { charged: 0, failed: 0, ended: 0, renewalNotices: 0, priceNotices: 0 };
  const today = kstDate(now);

  // 1. 기간이 끝난 해지 예약
  const finished = await db
    .select()
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.status, "cancel_scheduled"),
        lte(schema.subscriptions.currentPeriodEnd, now),
      ),
    );
  for (const sub of finished) {
    await endSubscription(
      db,
      sub,
      sub.cancelReason === "가격 변경 미동의" ? "가격 변경 미동의" : "해지 예약",
      sub.currentPeriodEnd ?? now,
    );
    result.ended += 1;
    if (await recordNotice(db, sub, "ended", sub.currentCycle))
      await mail(deps, sub.userId, (to) => ({
        template: "subscription-notice",
        to,
        userId: sub.userId,
        kind: "ended",
        planName: sub.planName,
        amount: sub.amount,
        date: (sub.currentPeriodEnd ?? now).toISOString(),
        reason: "해지 예약한 구독이 끝났습니다. 진도 기록은 남아 있습니다.",
        url: `${deps.baseUrl}/subscribe`,
      }));
  }

  const live = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.status, "active"));
  const plans = await db.select().from(schema.prices);

  for (let sub of live) {
    const anchor = sub.anchorDate;
    if (!anchor) continue;
    const interval = sub.interval as BillingInterval;
    const nextCycle = sub.currentCycle + 1;
    const nextBilling = billingDateOf(anchor, interval, nextCycle);

    // 2. 가격 변경
    const current = priceAt(
      plans.filter((p) => p.productId === sub.productId),
      now,
    );
    if (current && current.amount !== sub.amount && current.amount !== sub.pendingAmount) {
      const change = priceChangeCycle({
        anchor,
        interval,
        currentCycle: sub.currentCycle,
        oldAmount: sub.amount,
        newAmount: current.amount,
        now,
      });
      if (change) {
        [sub] = (await db
          .update(schema.subscriptions)
          .set({
            pendingAmount: current.amount,
            pendingFromCycle: change.cycle,
            pendingNeedsConsent: change.needsConsent,
            pendingAgreedAt: null,
          })
          .where(eq(schema.subscriptions.id, sub.id))
          .returning()) as [Subscription];
        if (await recordNotice(db, sub, "price_change", change.cycle, current.amount)) {
          result.priceNotices += 1;
          const from = billingDateOf(anchor, interval, change.cycle);
          await mail(deps, sub.userId, (to) => ({
            template: "subscription-notice",
            to,
            userId: sub.userId,
            kind: "price_change",
            planName: sub.planName,
            amount: current.amount,
            date: `${from}T00:00:00+09:00`,
            reason: change.needsConsent
              ? `${won(sub.amount)} ➔ ${won(current.amount)}. 구독 관리에서 동의해야 이 날부터 새 가격으로 이어집니다. 동의하지 않으면 그 전 기간 끝에 구독이 끝납니다.`
              : `${won(sub.amount)} ➔ ${won(current.amount)} 으로 내려갑니다.`,
            url: manageUrl(deps),
          }));
        }
      }
    }

    // 3. 갱신 안내
    const noticeFrom = nextBilling;
    const daysBefore = Math.round(
      (new Date(`${noticeFrom}T00:00:00+09:00`).getTime() - new Date(`${today}T00:00:00+09:00`).getTime()) /
        86_400_000,
    );
    if (daysBefore <= RENEWAL_NOTICE_DAYS[interval] && daysBefore > 0) {
      if (await recordNotice(db, sub, "renewal", nextCycle)) {
        result.renewalNotices += 1;
        const amount = amountFor(sub, nextCycle);
        await mail(deps, sub.userId, (to) => ({
          template: "subscription-notice",
          to,
          userId: sub.userId,
          kind: "renewal",
          planName: sub.planName,
          amount,
          date: `${nextBilling}T00:00:00+09:00`,
          reason: null,
          url: manageUrl(deps),
        }));
      }
    }

    // 4. 결제일
    if (nextBilling > today) continue;
    if (
      sub.pendingNeedsConsent &&
      sub.pendingFromCycle !== null &&
      nextCycle >= sub.pendingFromCycle &&
      !sub.pendingAgreedAt
    ) {
      await db
        .update(schema.subscriptions)
        .set({ status: "cancel_scheduled", cancelRequestedAt: now, cancelReason: "가격 변경 미동의" })
        .where(eq(schema.subscriptions.id, sub.id));
      continue;
    }
    const charged = await chargeCycle(deps, sub, nextCycle, now);
    if (charged.ok) result.charged += 1;
    else {
      result.failed += 1;
      if (charged.ended) result.ended += 1;
    }
  }

  // 5. 재시도
  const pastDue = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.status, "past_due"));
  for (const sub of pastDue) {
    const [cycle] = await db
      .select()
      .from(schema.subscriptionCycles)
      .where(
        and(
          eq(schema.subscriptionCycles.subscriptionId, sub.id),
          eq(schema.subscriptionCycles.cycleNo, sub.currentCycle + 1),
        ),
      );
    if (!cycle?.nextRetryAt || cycle.nextRetryAt > now) continue;
    const charged = await chargeCycle(deps, sub, cycle.cycleNo, now);
    if (charged.ok) result.charged += 1;
    else {
      result.failed += 1;
      if (charged.ended) result.ended += 1;
    }
  }
  return result;
}

// ---- 읽기 ----

export async function subscriptionView(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.userId, userId), isNull(schema.subscriptions.endedAt)))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);
  const sub = rows[0] ?? null;
  const last = sub
    ? null
    : ((
        await db
          .select()
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.userId, userId))
          .orderBy(desc(schema.subscriptions.createdAt))
          .limit(1)
      )[0] ?? null);
  const cycles = sub
    ? await db
        .select()
        .from(schema.subscriptionCycles)
        .where(eq(schema.subscriptionCycles.subscriptionId, sub.id))
        .orderBy(desc(schema.subscriptionCycles.cycleNo))
    : [];
  const nextBilling =
    sub?.anchorDate && sub.status !== "pending"
      ? billingDateOf(sub.anchorDate, sub.interval as BillingInterval, sub.currentCycle + 1)
      : null;
  return { sub, last, cycles, nextBilling, nextAmount: sub ? amountFor(sub, sub.currentCycle + 1) : null };
}
