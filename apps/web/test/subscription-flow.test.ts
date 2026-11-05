// 구독 (개발계획 M6): 요금제 ➔ 신청(자동결제 동의 따로) ➔ 카드 등록 ➔ 1회차 결제 ➔ 구독 수강권,
// 매일 자동결제(시각을 앞당겨) · 갱신 안내 · 실패 재시도(1 · 3 · 7일) · 끝남 · 결제 수단 변경, 해지 예약 · 취소,
// 가격 변경(내림 · 올림 + 동의), 즉시 해지 · 환불(토스 취소). 토스는 가짜 어댑터.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { openBillingKey } from "@aionit/core/media";
import { and, asc, eq, schema } from "@aionit/db";
import type { MailJob } from "@aionit/mail";
import type { SubscriptionDeps } from "@aionit/payments";
import {
  activateSubscription,
  agreePriceChange,
  changeCard,
  BILLING_KEY_DELETE_ATTEMPTS,
  createFakeToss,
  deleteRetiredBillingKeys,
  GatewayError,
  runSubscriptionBilling,
  scheduleCancel,
  startSubscription,
  subscriptionPlans,
  subscriptionView,
  undoCancel,
} from "@aionit/payments";
import type { CommerceDeps } from "@/server/commerce";
import { addPrice, courseOffers, createProduct, myOrders } from "@/server/commerce";
import { createCourse, createInstructor } from "@/server/courses";
import { canLearn, viewAccess } from "@/server/entitlements";
import { approveRefund, refundQuote, requestRefund } from "@/server/refunds";
import type { Viewer } from "@/server/viewer";
import { resetDb, setupTestAuth } from "./helpers";

const t = setupTestAuth();
afterAll(() => t.close());

const kst = (s: string) => new Date(`${s}+09:00`);
const T0 = kst("2026-11-04T10:00:00");
const SECRET = "s".repeat(40);

let toss: ReturnType<typeof createFakeToss>;
let mails: MailJob[];
let deps: SubscriptionDeps;
let commerce: CommerceDeps;
let me: Viewer;
let monthly: string;
let yearly: string;
let included: { id: string; inSubscription: boolean; ownerInstructorId: string };
let premium: { id: string; inSubscription: boolean; ownerInstructorId: string };

beforeEach(async () => {
  await resetDb(t.db);
  toss = createFakeToss();
  mails = [];
  const enqueueMail = async (job: MailJob) => void mails.push(job);
  deps = { db: t.db, gateway: toss.gateway, secret: SECRET, enqueueMail, baseUrl: "http://localhost:3000" };
  commerce = {
    db: t.db,
    gateway: toss.gateway,
    billingGateway: toss.gateway,
    enqueueMail,
    baseUrl: "http://localhost:3000",
  };
  const [op, user] = await t.db
    .insert(schema.users)
    .values([
      { email: "op@example.com", nickname: "운영하는사람", emailVerified: true },
      { email: "sub@example.com", nickname: "구독하는사람", emailVerified: true },
    ])
    .returning();
  me = {
    userId: user!.id,
    email: user!.email,
    nickname: "구독하는사람",
    emailVerified: true,
    twoFactorEnabled: false,
    sessionId: "s",
    sessionCreatedAt: new Date(),
    mfaVerifiedAt: null,
    roles: [],
  };
  const instructor = await createInstructor(t.db, { displayName: "홍길동", actorId: op!.id });
  const course = (slug: string, inSubscription: boolean) =>
    createCourse(t.db, {
      slug,
      title: slug,
      field: "ai",
      level: "초급",
      ownerInstructorId: instructor.id,
      summary: "",
      descriptionMd: "",
      audienceMd: "",
      requirementsMd: "",
      inSubscription,
      actorId: op!.id,
    });
  const a = await course("included-course", true);
  const b = await course("premium-course", false);
  included = { id: a.id, inSubscription: true, ownerInstructorId: instructor.id };
  premium = { id: b.id, inSubscription: false, ownerInstructorId: instructor.id };
  const before = new Date(T0.getTime() - 86_400_000);
  const plan = (interval: "month" | "year", name: string, amount: number) =>
    createProduct(
      t.db,
      {
        actorId: op!.id,
        type: "subscription",
        courseId: null,
        billingInterval: interval,
        name,
        accessDays: null,
        amount,
      },
      before,
    );
  monthly = await plan("month", "월간 구독", 19_900);
  yearly = await plan("year", "연간 구독", 199_000);
  // 프리미엄 강의 단건 + 구독자 할인 25%
  await createProduct(
    t.db,
    {
      actorId: op!.id,
      type: "course",
      courseId: premium.id,
      name: "프리미엄",
      accessDays: 365,
      amount: 59_000,
    },
    before,
  );
  await t.db.insert(schema.subscriberDiscountPolicies).values({ ratePercent: 25, effectiveFrom: before });
});

const startAndActivate = async (productId = monthly, now = T0) => {
  const sub = await startSubscription(
    { db: t.db, secret: SECRET },
    {
      userId: me.userId,
      productId,
      autoRenewAgreed: true,
      termsAgreed: true,
      refundPolicyDocumentId: null,
      ip: null,
    },
    now,
  );
  const authKey = toss.authorizeBilling(sub.customerKey);
  return activateSubscription(
    deps,
    { userId: me.userId, subscriptionId: sub.id, authKey, customerKey: sub.customerKey },
    now,
  );
};

const loadSub = async (id: string) =>
  (await t.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id)))[0]!;
const cyclesOf = (id: string) =>
  t.db
    .select()
    .from(schema.subscriptionCycles)
    .where(eq(schema.subscriptionCycles.subscriptionId, id))
    .orderBy(asc(schema.subscriptionCycles.cycleNo));
const entOf = async (id: string) =>
  (await t.db.select().from(schema.entitlements).where(eq(schema.entitlements.id, id)))[0]!;

describe("요금제 · 신청 · 1회차 (C-04)", () => {
  it("판매 중인 요금제는 월간 · 연간 하나씩", async () => {
    const plans = await subscriptionPlans(t.db, T0);
    expect(plans.map((p) => [p.product.billingInterval, p.price.amount])).toEqual([
      ["month", 19_900],
      ["year", 199_000],
    ]);
    await expect(
      createProduct(t.db, {
        actorId: me.userId,
        type: "subscription",
        courseId: null,
        billingInterval: "month",
        name: "또 월간",
        accessDays: null,
        amount: 1000,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_ON_SALE" });
  });

  it("자동결제 동의와 약관 동의가 둘 다 있어야 신청된다", async () => {
    await expect(
      startSubscription(
        { db: t.db, secret: SECRET },
        {
          userId: me.userId,
          productId: monthly,
          autoRenewAgreed: false,
          termsAgreed: true,
          refundPolicyDocumentId: null,
          ip: null,
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_AGREED" });
  });

  it("카드 등록 ➔ 1회차 결제 ➔ 구독 수강권(구독 포함 강의만) · 구독자 할인 · 영수증 · 결제 내역. 빌링키는 암호화", async () => {
    const sub = await startAndActivate();
    expect(sub).toMatchObject({
      status: "active",
      currentCycle: 1,
      anchorDate: "2026-11-04",
      amount: 19_900,
    });
    expect(sub.currentPeriodEnd).toEqual(kst("2026-12-05T00:00:00")); // 12월 4일까지
    expect(sub.billingKeySealed).not.toContain("bk_fake");
    expect(openBillingKey(SECRET, sub.billingKeySealed!)).toMatch(/^bk_fake_/);
    expect(sub.cardLabel).toBe("신한카드 •••• 123*");
    const [cycle] = await cyclesOf(sub.id);
    expect(cycle).toMatchObject({ status: "paid", amount: 19_900, supplyAmount: 18_091, vatAmount: 1_809 });
    const [pay] = await t.db.select().from(schema.payments).where(eq(schema.payments.id, cycle!.paymentId!));
    expect(pay).toMatchObject({ status: "done", keySet: "billing", amount: 19_900 });
    const ent = await entOf(sub.entitlementId!);
    expect(ent).toMatchObject({
      scope: "subscription_catalog",
      sourceType: "subscription",
      endsAt: sub.currentPeriodEnd,
    });
    expect(canLearn(await viewAccess(t.db, me, included, T0))).toBe(true);
    expect(canLearn(await viewAccess(t.db, me, premium, T0))).toBe(false);
    expect((await courseOffers(t.db, premium, me, T0)).purchase?.quote.paidAmount).toBe(44_250);
    expect(mails.map((m) => m.template)).toEqual(["payment-receipt"]);
    const orders = await myOrders(t.db, me.userId);
    expect(orders.map((o) => [o.item.productType, o.item.productName, o.course])).toEqual([
      ["subscription", "월간 구독 (1회차)", null],
    ]);
    // 새로고침 · 두 번째 신청
    await expect(startAndActivate()).rejects.toMatchObject({ code: "ALREADY_SUBSCRIBED" });
    expect(toss.calls.charge).toBe(1);
  });

  it("다른 사람의 카드 등록 결과 · 쓴 authKey 로는 시작되지 않는다", async () => {
    const sub = await startSubscription(
      { db: t.db, secret: SECRET },
      {
        userId: me.userId,
        productId: monthly,
        autoRenewAgreed: true,
        termsAgreed: true,
        refundPolicyDocumentId: null,
        ip: null,
      },
      T0,
    );
    const authKey = toss.authorizeBilling(sub.customerKey);
    await expect(
      activateSubscription(
        deps,
        { userId: me.userId, subscriptionId: sub.id, authKey, customerKey: "c_other" },
        T0,
      ),
    ).rejects.toMatchObject({ code: "CUSTOMER_MISMATCH" });
    await activateSubscription(
      deps,
      { userId: me.userId, subscriptionId: sub.id, authKey, customerKey: sub.customerKey },
      T0,
    );
    // 이미 시작했으면 같은 결과
    await expect(
      activateSubscription(
        deps,
        { userId: me.userId, subscriptionId: sub.id, authKey, customerKey: sub.customerKey },
        T0,
      ),
    ).resolves.toMatchObject({ status: "active" });
    expect(toss.calls.issue).toBe(1);
  });
});

describe("매일 자동결제 (worker, 시각을 앞당겨)", () => {
  it("갱신 안내(7일 전) ➔ 결제일에 2회차 결제 ➔ 기간 · 수강권이 이어진다. 같은 날 다시 돌려도 한 번만", async () => {
    const sub = await startAndActivate();
    expect(await runSubscriptionBilling(deps, kst("2026-11-26T06:00:00"))).toMatchObject({
      renewalNotices: 0,
    });
    expect(await runSubscriptionBilling(deps, kst("2026-11-27T06:00:00"))).toMatchObject({
      renewalNotices: 1,
    });
    expect(await runSubscriptionBilling(deps, kst("2026-11-28T06:00:00"))).toMatchObject({
      renewalNotices: 0,
    });
    expect(mails.at(-1)).toMatchObject({ template: "subscription-notice", kind: "renewal", amount: 19_900 });

    expect(await runSubscriptionBilling(deps, kst("2026-12-04T06:00:00"))).toMatchObject({ charged: 1 });
    expect(await runSubscriptionBilling(deps, kst("2026-12-04T07:00:00"))).toMatchObject({ charged: 0 });
    const after = await loadSub(sub.id);
    expect(after).toMatchObject({ status: "active", currentCycle: 2 });
    expect(after.currentPeriodStart).toEqual(kst("2026-12-05T00:00:00"));
    expect(after.currentPeriodEnd).toEqual(kst("2027-01-05T00:00:00"));
    expect((await entOf(sub.entitlementId!)).endsAt).toEqual(kst("2027-01-05T00:00:00"));
    expect(toss.calls.charge).toBe(2);
    expect(canLearn(await viewAccess(t.db, me, included, kst("2027-01-04T23:00:00")))).toBe(true);
    expect(canLearn(await viewAccess(t.db, me, included, kst("2027-01-05T00:00:00")))).toBe(false);
  });

  it("결제 실패 ➔ past_due · 안내 메일 · 7일째까지 이용 ➔ 1 · 3 · 7일 뒤 재시도 ➔ 모두 실패하면 끝", async () => {
    const sub = await startAndActivate();
    toss.setDeclined(openBillingKey(SECRET, sub.billingKeySealed!), true);
    expect(await runSubscriptionBilling(deps, kst("2026-12-04T06:00:00"))).toMatchObject({ failed: 1 });
    let now = await loadSub(sub.id);
    expect(now.status).toBe("past_due");
    expect((await entOf(sub.entitlementId!)).endsAt).toEqual(kst("2026-12-12T00:00:00"));
    expect(mails.at(-1)).toMatchObject({
      kind: "payment_failed",
      reason: expect.stringContaining("한도 초과"),
    });
    // 재시도 전날에는 시도하지 않는다
    expect(await runSubscriptionBilling(deps, kst("2026-12-04T23:00:00"))).toMatchObject({ failed: 0 });
    for (const day of ["2026-12-05", "2026-12-07"]) {
      expect(await runSubscriptionBilling(deps, kst(`${day}T06:00:00`))).toMatchObject({
        failed: 1,
        ended: 0,
      });
    }
    expect(await runSubscriptionBilling(deps, kst("2026-12-11T06:00:00"))).toMatchObject({
      failed: 1,
      ended: 1,
    });
    now = await loadSub(sub.id);
    expect(now).toMatchObject({ status: "ended", billingKeySealed: null });
    expect(canLearn(await viewAccess(t.db, me, included, kst("2026-12-11T07:00:00")))).toBe(false);
    expect((await cyclesOf(sub.id))[1]).toMatchObject({ status: "failed", retryCount: 4 });
    expect(
      mails.filter((m) => m.template === "subscription-notice").map((m) => "kind" in m && m.kind),
    ).toEqual(["payment_failed", "ended"]);
    expect(toss.calls.charge).toBe(5);
  });

  it("결제 실패 중 결제 수단을 바꾸면 바로 다시 결제해 이어진다", async () => {
    const sub = await startAndActivate();
    toss.setDeclined(openBillingKey(SECRET, sub.billingKeySealed!), true);
    await runSubscriptionBilling(deps, kst("2026-12-04T06:00:00"));
    const authKey = toss.authorizeBilling(sub.customerKey, "국민카드");
    await expect(
      changeCard(
        deps,
        { userId: me.userId, subscriptionId: sub.id, authKey, customerKey: sub.customerKey },
        kst("2026-12-04T12:00:00"),
      ),
    ).resolves.toMatchObject({ retried: true, ok: true });
    const now = await loadSub(sub.id);
    expect(now).toMatchObject({ status: "active", currentCycle: 2, cardLabel: "국민카드 •••• 123*" });
    expect((await entOf(sub.entitlementId!)).endsAt).toEqual(kst("2027-01-05T00:00:00"));

    // 바꾸기 전 카드의 빌링키는 다음 날 작업에서 토스에서 지운다. 새 카드 키는 그대로
    const oldKey = openBillingKey(SECRET, sub.billingKeySealed!);
    expect(toss.billingKeys.has(oldKey)).toBe(true);
    expect(await runSubscriptionBilling(deps, kst("2026-12-05T06:00:00"))).toMatchObject({
      billingKeysDeleted: 1,
    });
    expect(toss.billingKeys.has(oldKey)).toBe(false);
    expect(toss.billingKeys.has(openBillingKey(SECRET, now.billingKeySealed!))).toBe(true);
    const [retired] = await t.db.select().from(schema.billingKeyDeletions);
    expect(retired).toMatchObject({ subscriptionId: sub.id, reason: "카드 변경", keySealed: null });
    expect(retired!.deletedAt).not.toBeNull();
  });

  it("해지 예약 ➔ 결제일에 결제하지 않고 기간 끝에 끝. 끝나기 전에는 해지를 취소할 수 있다", async () => {
    const sub = await startAndActivate();
    await scheduleCancel(
      deps,
      { userId: me.userId, subscriptionId: sub.id, reason: "시간이 없어서" },
      kst("2026-11-10T10:00:00"),
    );
    expect(mails.at(-1)).toMatchObject({ kind: "cancel_scheduled" });
    await undoCancel(deps, { userId: me.userId, subscriptionId: sub.id }, kst("2026-11-11T10:00:00"));
    expect((await loadSub(sub.id)).status).toBe("active");
    await scheduleCancel(deps, { userId: me.userId, subscriptionId: sub.id }, kst("2026-11-12T10:00:00"));
    expect(await runSubscriptionBilling(deps, kst("2026-12-04T06:00:00"))).toMatchObject({
      charged: 0,
      ended: 0,
    });
    expect(canLearn(await viewAccess(t.db, me, included, kst("2026-12-04T23:59:00")))).toBe(true);
    expect(await runSubscriptionBilling(deps, kst("2026-12-05T06:00:00"))).toMatchObject({ ended: 1 });
    expect(await loadSub(sub.id)).toMatchObject({
      status: "ended",
      endReason: "해지 예약",
      billingKeySealed: null,
    });
    expect(canLearn(await viewAccess(t.db, me, included, kst("2026-12-05T06:00:00")))).toBe(false);
    expect(toss.calls.charge).toBe(1);
    // 끝난 구독의 빌링키는 같은 작업 끝에 토스에서도 지운다. 실패하면 다음 날 다시, 이미 없으면(404) 지운 것으로 본다
    expect(toss.calls.deleteKey).toBe(1);
    expect(toss.billingKeys.size).toBe(0);
    const deletions = await t.db.select().from(schema.billingKeyDeletions);
    expect(deletions).toHaveLength(1);
    expect(deletions[0]).toMatchObject({ reason: "해지 예약", keySealed: null, attempts: 1 });
    // 끝난 뒤에는 다시 구독할 수 있다 (진도는 그대로)
    await startAndActivate(yearly, kst("2026-12-06T10:00:00"));
  });
});

describe("빌링키 삭제 (M10)", () => {
  it("토스가 실패하면 다음에 다시, 5번 실패하면 멈춘다. 이미 없다는 응답(404)은 지운 것으로 본다", async () => {
    const sub = await startAndActivate();
    await scheduleCancel(deps, { userId: me.userId, subscriptionId: sub.id }, kst("2026-11-12T10:00:00"));
    let answer: "down" | "gone" = "down";
    const flaky = {
      ...deps,
      gateway: {
        ...toss.gateway,
        deleteBillingKey: async () => {
          throw answer === "down"
            ? new GatewayError("PROVIDER_ERROR", "토스 응답 500", 500)
            : new GatewayError("NOT_FOUND_BILLING", "존재하지 않는 빌링키입니다.", 404);
        },
      },
    };
    await runSubscriptionBilling(flaky, kst("2026-12-05T06:00:00"));
    let [row] = await t.db.select().from(schema.billingKeyDeletions);
    expect(row).toMatchObject({ attempts: 1, lastError: "토스 응답 500", deletedAt: null });
    expect(row!.keySealed).not.toBeNull();

    for (let i = 1; i < BILLING_KEY_DELETE_ATTEMPTS; i += 1) await deleteRetiredBillingKeys(flaky);
    [row] = await t.db.select().from(schema.billingKeyDeletions);
    expect(row!.attempts).toBe(BILLING_KEY_DELETE_ATTEMPTS);
    expect(await deleteRetiredBillingKeys(flaky)).toEqual({ deleted: 0, failed: 0 }); // 멈춤

    await t.db.update(schema.billingKeyDeletions).set({ attempts: 0 }); // 운영자가 다시 시도하게 하면
    answer = "gone";
    expect(await deleteRetiredBillingKeys(flaky)).toEqual({ deleted: 1, failed: 0 });
    [row] = await t.db.select().from(schema.billingKeyDeletions);
    expect(row).toMatchObject({ keySealed: null, lastError: null });
  });
});

describe("가격 변경 (법정 고지 · 동의)", () => {
  it("올림: 30일 이상 남은 회차부터, 동의해야 새 가격 / 동의하지 않으면 그 회차 전에 끝", async () => {
    const sub = await startAndActivate();
    await addPrice(t.db, {
      actorId: me.userId,
      productId: monthly,
      amount: 24_900,
      effectiveFrom: kst("2026-11-10T00:00:00"),
    });
    expect(await runSubscriptionBilling(deps, kst("2026-11-20T06:00:00"))).toMatchObject({ priceNotices: 1 });
    expect(await loadSub(sub.id)).toMatchObject({
      pendingAmount: 24_900,
      pendingFromCycle: 3,
      pendingNeedsConsent: true,
    });
    expect(mails.at(-1)).toMatchObject({ kind: "price_change", amount: 24_900 });
    // 2회차는 원래 가격
    await runSubscriptionBilling(deps, kst("2026-12-04T06:00:00"));
    expect((await cyclesOf(sub.id))[1]).toMatchObject({ cycleNo: 2, amount: 19_900, status: "paid" });
    // 동의하지 않으면 3회차 결제일에 결제하지 않고 기간 끝에 끝난다
    expect(await runSubscriptionBilling(deps, kst("2027-01-04T06:00:00"))).toMatchObject({ charged: 0 });
    expect(await loadSub(sub.id)).toMatchObject({
      status: "cancel_scheduled",
      cancelReason: "가격 변경 미동의",
    });
    await runSubscriptionBilling(deps, kst("2027-01-05T06:00:00"));
    expect(await loadSub(sub.id)).toMatchObject({ status: "ended", endReason: "가격 변경 미동의" });
  });

  it("올림에 동의하면 그 회차부터 새 가격", async () => {
    const sub = await startAndActivate();
    await addPrice(t.db, {
      actorId: me.userId,
      productId: monthly,
      amount: 24_900,
      effectiveFrom: kst("2026-11-10T00:00:00"),
    });
    await runSubscriptionBilling(deps, kst("2026-11-20T06:00:00"));
    await agreePriceChange(deps, { userId: me.userId, subscriptionId: sub.id }, kst("2026-11-21T10:00:00"));
    const [notice] = await t.db
      .select()
      .from(schema.subscriptionNotices)
      .where(
        and(
          eq(schema.subscriptionNotices.subscriptionId, sub.id),
          eq(schema.subscriptionNotices.kind, "price_change"),
        ),
      );
    expect(notice!.agreedAt).not.toBeNull();
    await runSubscriptionBilling(deps, kst("2026-12-04T06:00:00"));
    await runSubscriptionBilling(deps, kst("2027-01-04T06:00:00"));
    expect((await cyclesOf(sub.id)).map((c) => c.amount)).toEqual([19_900, 19_900, 24_900]);
    expect(await loadSub(sub.id)).toMatchObject({ status: "active", amount: 24_900, pendingAmount: null });
  });

  it("내림: 동의 없이 다음 회차부터", async () => {
    const sub = await startAndActivate();
    await addPrice(t.db, {
      actorId: me.userId,
      productId: monthly,
      amount: 15_900,
      effectiveFrom: kst("2026-11-10T00:00:00"),
    });
    await runSubscriptionBilling(deps, kst("2026-11-20T06:00:00"));
    await runSubscriptionBilling(deps, kst("2026-12-04T06:00:00"));
    expect((await cyclesOf(sub.id)).map((c) => c.amount)).toEqual([19_900, 15_900]);
    const view = await subscriptionView(t.db, me.userId);
    expect(view).toMatchObject({ nextBilling: "2027-01-04", nextAmount: 15_900 });
  });
});

describe("즉시 해지 · 환불 (M-03 ➔ AD-10)", () => {
  it("7일 이내 + 이번 회차 학습 전 ➔ 전액 ➔ 토스 취소 ➔ 구독 바로 끝 · 자동결제 멈춤", async () => {
    const sub = await startAndActivate(yearly);
    const [cycle] = await cyclesOf(sub.id);
    const [item] = await t.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, cycle!.orderId!));
    const now = kst("2026-11-06T10:00:00");
    const view = await refundQuote(t.db, me.userId, item!.id, now);
    expect(view.quote).toMatchObject({
      ok: true,
      calculation: { kind: "subscription", tier: "full", amount: 199_000 },
    });
    const refundId = await requestRefund(
      commerce,
      me,
      { itemId: item!.id, reason: "실수로 결제했어요" },
      now,
    );
    await approveRefund(commerce, { actorId: me.userId, refundId }, now);
    expect(await loadSub(sub.id)).toMatchObject({
      status: "canceled",
      endReason: "즉시 해지 · 환불",
      billingKeySealed: null,
    });
    expect((await cyclesOf(sub.id))[0]!.status).toBe("refunded");
    expect(canLearn(await viewAccess(t.db, me, included, kst("2026-11-06T11:00:00")))).toBe(false);
    expect(await runSubscriptionBilling(deps, kst("2027-11-04T06:00:00"))).toMatchObject({ charged: 0 });
  });

  it("학습한 뒤에는 남은 날 일할 − 위약금 10%", async () => {
    const sub = await startAndActivate(yearly);
    await t.db.insert(schema.learningHeartbeats).values({
      userId: me.userId,
      courseId: included.id,
      chapterKey: "ch01",
      kind: "text",
      at: kst("2026-11-05T10:00:00"),
      payload: { activeSec: 30 },
    });
    const [cycle] = await cyclesOf(sub.id);
    const [item] = await t.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, cycle!.orderId!));
    const view = await refundQuote(t.db, me.userId, item!.id, kst("2026-11-06T10:00:00"));
    // 366일 중 3일 사용, 363일 남음
    expect(view.quote).toMatchObject({
      ok: true,
      calculation: {
        kind: "subscription",
        tier: "pro_rata",
        amount: Math.floor((199_000 * 363) / 366) - 19_900,
      },
    });
  });
});
