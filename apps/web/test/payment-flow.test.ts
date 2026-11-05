// 단건 결제 · 환불 (개발계획 M5): 상품 · 가격 버전 · 구독자 할인 ➔ 주문서 ➔ (가짜) 토스 승인 ➔ 수강권 ➔ 영수증,
// 금액 위조 · 중복 승인 · 응답 끊김 · 웹훅 재확인, 환불 요청 ➔ 승인(토스 취소) · 거절, 연장권, 만료 알림.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, schema } from "@aionit/db";
import type { MailJob } from "@aionit/mail";
import { createMemoryStore } from "@aionit/storage";
import { processCourseVersion } from "../../worker/src/content";
import { sendExpiryReminders } from "../../worker/src/reminders";
import { buildZip, normalEntries } from "../../../packages/content/test/fixtures";
import type { CommerceDeps } from "@/server/commerce";
import {
  addDiscountPolicy,
  addPrice,
  agreeToOrder,
  checkoutView,
  confirmPayment,
  courseOffers,
  createOrder,
  createProduct,
  myOrders,
  updateProduct,
} from "@/server/commerce";
import { currentPolicies } from "@/server/consents";
import { createCourse, createInstructor, publishVersion, uploadPackage } from "@/server/courses";
import { canLearn, grantEntitlement, viewAccess } from "@/server/entitlements";
import {
  adminRefundDetail,
  approveRefund,
  handleTossWebhook,
  refundQuote,
  rejectRefund,
  requestRefund,
  withdrawRefundRequest,
} from "@/server/refunds";
import { GatewayError } from "@aionit/payments";
import type { Viewer } from "@/server/viewer";
import { createFakeToss } from "@aionit/payments";
import { resetDb, setupTestAuth } from "./helpers";

const t = setupTestAuth();
const store = createMemoryStore();
afterAll(() => t.close());

const DAY = 86_400_000;
const viewerOf = (userId: string, email: string): Viewer => ({
  userId,
  email,
  nickname: "사는사람",
  emailVerified: true,
  twoFactorEnabled: false,
  sessionId: "s",
  sessionCreatedAt: new Date(),
  mfaVerifiedAt: null,
  roles: [],
});

let toss: ReturnType<typeof createFakeToss>;
let mails: MailJob[];
let deps: CommerceDeps;
let operatorId: string;
let buyer: Viewer;
let other: Viewer;
let course: { id: string; inSubscription: boolean; slug: string; ownerInstructorId: string };
let productId: string;
const AGREE = { baseUrl: "http://localhost:3000", ip: null };

beforeEach(async () => {
  await resetDb(t.db);
  toss = createFakeToss();
  mails = [];
  deps = {
    db: t.db,
    gateway: toss.gateway,
    enqueueMail: async (job) => void mails.push(job),
    baseUrl: "http://localhost:3000",
  };
  const [op, a, b] = await t.db
    .insert(schema.users)
    .values([
      { email: "op@example.com", nickname: "운영하는사람", emailVerified: true },
      { email: "buyer@example.com", nickname: "사는사람", emailVerified: true },
      { email: "other@example.com", nickname: "다른사람", emailVerified: true },
    ])
    .returning();
  operatorId = op!.id;
  buyer = viewerOf(a!.id, a!.email);
  other = viewerOf(b!.id, b!.email);
  const instructor = await createInstructor(t.db, { displayName: "홍길동", actorId: operatorId });
  const created = await createCourse(t.db, {
    slug: "ai-agent-basics",
    title: "AI Agent 개발 · 초급",
    field: "ai",
    level: "초급",
    ownerInstructorId: instructor.id,
    summary: "",
    descriptionMd: "",
    audienceMd: "",
    requirementsMd: "",
    inSubscription: false, // 프리미엄 (구독자 할인 대상)
    actorId: operatorId,
  });
  course = {
    id: created.id,
    inSubscription: false,
    slug: "ai-agent-basics",
    ownerInstructorId: instructor.id,
  };
  const version = await uploadPackage(
    { db: t.db, store, enqueueContent: async () => undefined },
    { courseId: course.id, zip: buildZip(await normalEntries()), fileName: "pkg.zip", actorId: operatorId },
  );
  await processCourseVersion({ db: t.db, store }, version.id);
  await publishVersion(t.db, version.id, { actorId: operatorId });
  productId = await createProduct(
    t.db,
    {
      actorId: operatorId,
      type: "course",
      courseId: course.id,
      name: "AI Agent 개발 · 초급 (1년)",
      accessDays: 365,
      amount: 59_000,
    },
    new Date(Date.now() - 30 * DAY), // 지난 날짜로 산 경우를 시험하려고 한 달 전부터 판매
  );
});

/** 주문서 ➔ 동의 ➔ 결제창에서 결제 ➔ 돌아와서 승인 */
async function buy(viewer = buyer, now = new Date(), product = productId) {
  const { orderId } = await createOrder(t.db, viewer, product, now);
  const params = await agreeToOrder(t.db, viewer, orderId, AGREE, now);
  const paymentKey = toss.authorize(orderId, params.amount);
  const result = await confirmPayment(deps, viewer, { paymentKey, orderId, amount: params.amount }, now);
  return { orderId, paymentKey, result, amount: params.amount };
}

const purchaseEntitlements = (userId: string) =>
  t.db
    .select()
    .from(schema.entitlements)
    .where(and(eq(schema.entitlements.userId, userId), eq(schema.entitlements.sourceType, "purchase")));

describe("상품 · 가격 버전 · 구독자 할인 (AD-07)", () => {
  it("가격을 바꿔도 이전 주문 · 열린 주문서는 그때 가격 그대로", async () => {
    const paid = await buy();
    expect(paid.amount).toBe(59_000);
    // 다른 사람이 주문서를 연 뒤 가격이 오른다
    const { orderId: openOrder } = await createOrder(t.db, other, productId);
    await addPrice(t.db, {
      actorId: operatorId,
      productId,
      amount: 69_000,
      effectiveFrom: new Date(Date.now() - 1000),
    });
    // 새 주문은 새 가격
    const offers = await courseOffers(t.db, course, null);
    expect(offers.purchase?.quote.paidAmount).toBe(69_000);
    // 이전 주문 항목은 59,000 그대로
    const [item] = await t.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, paid.orderId));
    expect(item).toMatchObject({
      listPrice: 59_000,
      paidAmount: 59_000,
      supplyAmount: 53_636,
      vatAmount: 5_364,
    });
    // 열린 주문서는 30분 안이면 그때 가격으로 결제된다
    const params = await agreeToOrder(t.db, other, openOrder, AGREE);
    expect(params.amount).toBe(59_000);
    const key = toss.authorize(openOrder, 59_000);
    await confirmPayment(deps, other, { paymentKey: key, orderId: openOrder, amount: 59_000 });
    // 같은 상품을 다시 주문서로 열면 새 가격의 새 주문
    const third = await t.db
      .insert(schema.users)
      .values({ email: "c@example.com", nickname: "세번째" })
      .returning();
    const { orderId } = await createOrder(t.db, viewerOf(third[0]!.id, "c@example.com"), productId);
    const [newItem] = await t.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));
    expect(newItem!.paidAmount).toBe(69_000);
    // 가격 기록은 고칠 수 없다
    await expect(t.db.update(schema.prices).set({ amount: 1 })).rejects.toThrow();
  });

  it("예약한 가격은 시행일부터", async () => {
    await addPrice(t.db, {
      actorId: operatorId,
      productId,
      amount: 49_000,
      effectiveFrom: new Date(Date.now() + DAY),
    });
    expect((await courseOffers(t.db, course, null)).purchase?.quote.paidAmount).toBe(59_000);
    expect(
      (await courseOffers(t.db, course, null, new Date(Date.now() + 2 * DAY))).purchase?.quote.paidAmount,
    ).toBe(49_000);
  });

  it("구독자가 프리미엄 강의를 사면 구독자 할인 (59,000 ➔ 44,250), 비구독자에게는 할인가를 보여 주기만", async () => {
    await addDiscountPolicy(t.db, {
      actorId: operatorId,
      ratePercent: 25,
      effectiveFrom: new Date(Date.now() - 1000),
    });
    const plain = await courseOffers(t.db, course, buyer);
    expect(plain).toMatchObject({ subscriber: false, purchase: { quote: { paidAmount: 59_000 } } });
    expect(plain.subscriberPrice?.paidAmount).toBe(44_250);
    // 구독 수강권 (M6 전에는 운영자가 만든다)
    await t.db.insert(schema.entitlements).values({
      userId: buyer.userId,
      scope: "subscription_catalog",
      sourceType: "subscription",
      startsAt: new Date(Date.now() - DAY),
    });
    const sub = await courseOffers(t.db, course, buyer);
    expect(sub.purchase?.quote).toMatchObject({
      listPrice: 59_000,
      discountAmount: 14_750,
      discountReason: "구독자 할인 25%",
      paidAmount: 44_250,
      supplyAmount: 40_227,
      vatAmount: 4_023,
    });
    const { amount, orderId } = await buy();
    expect(amount).toBe(44_250);
    const [item] = await t.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    expect(item).toMatchObject({
      discountAmount: 14_750,
      discountReason: "구독자 할인 25%",
      paidAmount: 44_250,
    });
  });

  it("판매 중지하면 주문서를 만들 수 없고, 같은 과정에 판매 중 상품은 하나만", async () => {
    await expect(
      createProduct(t.db, {
        actorId: operatorId,
        type: "course",
        courseId: course.id,
        name: "또",
        accessDays: 90,
        amount: 1000,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_ON_SALE" });
    await updateProduct(t.db, { actorId: operatorId, productId, status: "stopped" });
    await expect(createOrder(t.db, buyer, productId)).rejects.toMatchObject({ code: "NOT_ON_SALE" });
    expect((await courseOffers(t.db, course, null)).purchase).toBeNull();
    const actions = await t.db.select({ action: schema.auditLogs.action }).from(schema.auditLogs);
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(["product.create", "product.update"]),
    );
  });
});

describe("주문서 ➔ 토스 승인 ➔ 수강권 (C-01 ~ C-03)", () => {
  it("결제하면 수강권(1년) · 결제 기록 · 영수증 메일, 동의한 환불 규정 버전이 남는다", async () => {
    const now = new Date();
    const { orderId, result } = await buy();
    expect(result).toMatchObject({ orderId, courseSlug: "ai-agent-basics", paidAmount: 59_000 });
    const [order] = await t.db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order).toMatchObject({ status: "paid" });
    const [payment] = await t.db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
    expect(payment).toMatchObject({ status: "done", amount: 59_000, method: "카드" });
    expect(payment!.receiptUrl).toContain("receipt");
    const ents = await purchaseEntitlements(buyer.userId);
    expect(ents).toHaveLength(1);
    expect(ents[0]!.endsAt!.getTime() - now.getTime()).toBeGreaterThan(365 * DAY);
    expect(ents[0]!.endsAt!.getTime() - now.getTime()).toBeLessThanOrEqual(366 * DAY);
    expect(canLearn(await viewAccess(t.db, buyer, course))).toBe(true);
    const [item] = await t.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    expect(item!.entitlementId).toBe(ents[0]!.id);
    const [refundDoc] = await t.db
      .select()
      .from(schema.policyDocuments)
      .where(eq(schema.policyDocuments.id, item!.refundPolicyDocumentId!));
    expect(refundDoc).toMatchObject({
      kind: "refund",
      version: (await currentPolicies(t.db, ["refund"])).get("refund")!.version,
    });
    expect(mails).toEqual([
      expect.objectContaining({ template: "payment-receipt", to: buyer.email, paidAmount: 59_000 }),
    ]);
    // 결제 내역 (M-04)
    expect(await myOrders(t.db, buyer.userId)).toHaveLength(1);
    expect(await myOrders(t.db, other.userId)).toHaveLength(0);
  });

  it("이미 수강 중이면 주문서를 만들지 않는다", async () => {
    await buy();
    await expect(createOrder(t.db, buyer, productId)).rejects.toMatchObject({ code: "ALREADY_OWNED" });
    await grantEntitlement(t.db, {
      actorId: operatorId,
      userId: other.userId,
      courseId: course.id,
      days: 10,
      reason: "베타",
    });
    await expect(createOrder(t.db, other, productId)).rejects.toMatchObject({ code: "ALREADY_OWNED" });
  });

  it("금액 위조: 돌아온 금액이 주문 금액과 다르면 토스를 부르지 않고 수강권도 없다", async () => {
    const { orderId } = await createOrder(t.db, buyer, productId);
    await agreeToOrder(t.db, buyer, orderId, AGREE);
    // 결제창 요청을 가로채 100원으로 바꿈
    const paymentKey = toss.authorize(orderId, 100);
    await expect(confirmPayment(deps, buyer, { paymentKey, orderId, amount: 100 })).rejects.toMatchObject({
      code: "AMOUNT_MISMATCH",
    });
    expect(toss.calls.confirm).toBe(0);
    // 주소의 금액만 원래대로 고쳐 보내도: 토스가 결제창 금액(100원)과 다르다고 거절한다
    const second = toss.authorize(orderId, 100);
    await expect(
      confirmPayment(deps, buyer, { paymentKey: second, orderId, amount: 59_000 }),
    ).rejects.toMatchObject({
      code: "PAYMENT_FAILED",
    });
    expect(await purchaseEntitlements(buyer.userId)).toHaveLength(0);
    const [order] = await t.db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("pending");
    const attempts = await t.db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
    expect(attempts.map((p) => [p.status, p.failCode]).sort()).toEqual([
      ["failed", "AMOUNT_MISMATCH"],
      ["failed", "FORBIDDEN_REQUEST"],
    ]);
    // 정상 결제는 여전히 된다
    const ok = toss.authorize(orderId, 59_000);
    await confirmPayment(deps, buyer, { paymentKey: ok, orderId, amount: 59_000 });
    expect(await purchaseEntitlements(buyer.userId)).toHaveLength(1);
  });

  it("토스 응답 금액이 주문과 다르면 받은 돈을 바로 돌려준다", async () => {
    const { orderId } = await createOrder(t.db, buyer, productId);
    await agreeToOrder(t.db, buyer, orderId, AGREE);
    const paymentKey = toss.authorize(orderId, 59_000);
    const real = toss.gateway.confirm;
    toss.gateway.confirm = async (input) => ({ ...(await real(input)), totalAmount: 1 });
    await expect(confirmPayment(deps, buyer, { paymentKey, orderId, amount: 59_000 })).rejects.toMatchObject({
      code: "AMOUNT_MISMATCH",
    });
    toss.gateway.confirm = real;
    expect(toss.payments.get(paymentKey)!.status).toBe("CANCELED");
    expect(await purchaseEntitlements(buyer.userId)).toHaveLength(0);
  });

  it("중복 승인: 새로고침 · 동시에 두 번 와도 토스 승인 1번 · 수강권 1개", async () => {
    const { orderId } = await createOrder(t.db, buyer, productId);
    await agreeToOrder(t.db, buyer, orderId, AGREE);
    const paymentKey = toss.authorize(orderId, 59_000);
    const input = { paymentKey, orderId, amount: 59_000 };
    const results = await Promise.allSettled([
      confirmPayment(deps, buyer, input),
      confirmPayment(deps, buyer, input),
      confirmPayment(deps, buyer, input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    for (const r of results)
      if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "PAYMENT_IN_PROGRESS" });
    // 새로고침: 같은 결과를 다시 보여 준다
    await expect(confirmPayment(deps, buyer, input)).resolves.toMatchObject({ orderId });
    expect(toss.calls.confirm).toBe(1);
    expect(await purchaseEntitlements(buyer.userId)).toHaveLength(1);
    expect(mails.filter((m) => m.template === "payment-receipt")).toHaveLength(1);
  });

  it("탭 두 개로 같은 강의를 두 번 결제하려 하면 두 번째는 승인하지 않는다", async () => {
    const first = await createOrder(t.db, buyer, productId);
    // 같은 주문서를 다시 열면 같은 주문
    expect((await createOrder(t.db, buyer, productId)).orderId).toBe(first.orderId);
    // 30분 지난 뒤 다른 탭에서 새 주문서 (같은 주문이 아님)
    const later = new Date(Date.now() + 28 * 60_000);
    const second = await createOrder(t.db, buyer, productId, later);
    expect(second.orderId).not.toBe(first.orderId);
    await agreeToOrder(t.db, buyer, first.orderId, AGREE);
    await agreeToOrder(t.db, buyer, second.orderId, AGREE, later);
    const k1 = toss.authorize(first.orderId, 59_000);
    const k2 = toss.authorize(second.orderId, 59_000);
    await confirmPayment(deps, buyer, { paymentKey: k1, orderId: first.orderId, amount: 59_000 });
    await expect(
      confirmPayment(deps, buyer, { paymentKey: k2, orderId: second.orderId, amount: 59_000 }),
    ).rejects.toMatchObject({ code: "ALREADY_OWNED" });
    expect(toss.calls.confirm).toBe(1);
    expect(toss.payments.get(k2)!.status).toBe("READY"); // 돈을 받지 않았다
  });

  it("승인 응답이 끊겨도 토스에 다시 물어 결제를 마친다", async () => {
    const { orderId } = await createOrder(t.db, buyer, productId);
    await agreeToOrder(t.db, buyer, orderId, AGREE);
    const paymentKey = toss.authorize(orderId, 59_000);
    toss.dropNextConfirmResponse();
    await expect(confirmPayment(deps, buyer, { paymentKey, orderId, amount: 59_000 })).resolves.toMatchObject(
      {
        orderId,
      },
    );
    expect(toss.calls.get).toBe(1);
    expect(await purchaseEntitlements(buyer.userId)).toHaveLength(1);
  });

  it("동의 전 · 남의 주문 · 30분 지난 주문서", async () => {
    const { orderId } = await createOrder(t.db, buyer, productId);
    const paymentKey = toss.authorize(orderId, 59_000);
    await expect(confirmPayment(deps, buyer, { paymentKey, orderId, amount: 59_000 })).rejects.toMatchObject({
      code: "NOT_AGREED",
    });
    await expect(agreeToOrder(t.db, other, orderId, AGREE)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(checkoutView(t.db, other, orderId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(confirmPayment(deps, other, { paymentKey, orderId, amount: 59_000 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const late = new Date(Date.now() + 31 * 60_000);
    expect((await checkoutView(t.db, buyer, orderId, late)).expired).toBe(true);
    await expect(agreeToOrder(t.db, buyer, orderId, AGREE, late)).rejects.toMatchObject({
      code: "ORDER_EXPIRED",
    });
    expect(toss.calls.confirm).toBe(0);
  });

  it("결제 기록은 지울 수 없다", async () => {
    const { orderId } = await buy();
    await expect(t.db.delete(schema.payments).where(eq(schema.payments.orderId, orderId))).rejects.toThrow();
    await expect(t.db.delete(schema.orders).where(eq(schema.orders.id, orderId))).rejects.toThrow();
  });
});

describe("환불 (M-04 요청 ➔ AD-10 처리 ➔ 토스 취소)", () => {
  const itemOf = async (orderId: string) =>
    (await t.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)))[0]!;

  it("7일 이내 + 이용 전: 전액 환불 ➔ 토스 전액 취소 ➔ 수강권 끝 ➔ 메일. 두 번 처리되지 않는다", async () => {
    const paidAt = new Date(Date.now() - 3 * DAY);
    const { orderId, paymentKey } = await buy(buyer, paidAt);
    const item = await itemOf(orderId);
    const view = await refundQuote(t.db, buyer.userId, item.id);
    expect(view.quote).toMatchObject({
      ok: true,
      calculation: { tier: "full", amount: 59_000, basis: "cooling_off" },
    });
    const refundId = await requestRefund(deps, buyer, { itemId: item.id, reason: "실수로 결제했어요" });
    await expect(requestRefund(deps, buyer, { itemId: item.id, reason: "기타" })).rejects.toMatchObject({
      code: "ALREADY_REQUESTED",
    });
    await expect(refundQuote(t.db, other.userId, item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const detail = await adminRefundDetail(t.db, refundId);
    expect(detail!.current).toMatchObject({ tier: "full", amount: 59_000 });
    await Promise.allSettled([
      approveRefund(deps, { actorId: operatorId, refundId }),
      approveRefund(deps, { actorId: operatorId, refundId }),
    ]);
    expect(toss.calls.cancel).toBe(1);
    expect(toss.payments.get(paymentKey)!.status).toBe("CANCELED");
    const [refund] = await t.db.select().from(schema.refunds).where(eq(schema.refunds.id, refundId));
    expect(refund).toMatchObject({ status: "done", approvedAmount: 59_000, decidedBy: operatorId });
    expect(refund!.providerCancelKey).toMatch(/^tx-/);
    expect(refund!.calculation).toMatchObject({ ruleVersion: "2026-11-v1", tier: "full" });
    const [order] = await t.db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("refunded");
    const [payment] = await t.db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
    expect(payment).toMatchObject({ status: "canceled", canceledAmount: 59_000 });
    expect(canLearn(await viewAccess(t.db, buyer, course))).toBe(false);
    expect(mails.map((m) => m.template)).toEqual(["payment-receipt", "refund-done"]);
    await expect(approveRefund(deps, { actorId: operatorId, refundId })).rejects.toMatchObject({
      code: "ALREADY_DECIDED",
    });
    // 환불 뒤 다시 살 수 있다
    await buy();
  });

  it("이용 뒤 · 기간 경과: 규정 단계 금액으로 부분 취소 (2/3 ➔ 1/2 ➔ 없음)", async () => {
    const paidAt = new Date(Date.now() - 10 * DAY);
    const { orderId, paymentKey } = await buy(buyer, paidAt);
    const item = await itemOf(orderId);
    await t.db.update(schema.entitlements).set({ firstUsedAt: new Date(paidAt.getTime() + DAY) });
    // 진도 0/2, 10일/365일 ➔ 2/3
    expect((await refundQuote(t.db, buyer.userId, item.id)).quote).toMatchObject({
      ok: true,
      calculation: { tier: "two_thirds", amount: 39_333, used: true },
    });
    // 기간 1/3 이 지난 시점에 다시 계산하면 1/2
    expect(
      (await refundQuote(t.db, buyer.userId, item.id, new Date(paidAt.getTime() + 130 * DAY))).quote,
    ).toMatchObject({ ok: true, calculation: { tier: "half", amount: 29_500, basis: "elapsed" } });
    // 챕터 1/2 완료 ➔ 환불 없음 (버튼 대신 이유)
    await t.db.insert(schema.chapterProgress).values({
      userId: buyer.userId,
      courseId: course.id,
      chapterKey: "ch01",
      completedAt: new Date(),
    });
    const none = await refundQuote(t.db, buyer.userId, item.id);
    expect(none.quote).toMatchObject({ ok: false, code: "NO_REFUND" });
    expect(none.quote.ok ? "" : none.quote.message).toContain("진도율 50%");
    await expect(requestRefund(deps, buyer, { itemId: item.id, reason: "기타" })).rejects.toMatchObject({
      code: "NO_REFUND",
    });
    // 진도 기록을 되돌린 경우로 보고 2/3 요청 ➔ 승인 ➔ 부분 취소
    await t.db.delete(schema.chapterProgress);
    const refundId = await requestRefund(deps, buyer, {
      itemId: item.id,
      reason: "시간이 없어 들을 수 없어요",
    });
    await approveRefund(deps, { actorId: operatorId, refundId });
    expect(toss.payments.get(paymentKey)!.status).toBe("PARTIAL_CANCELED");
    const [order] = await t.db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("partially_refunded");
    const [payment] = await t.db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
    expect(payment).toMatchObject({ status: "partially_canceled", canceledAmount: 39_333 });
    expect(canLearn(await viewAccess(t.db, buyer, course))).toBe(false);
    // 끝난 주문은 다시 환불 요청할 수 없다
    expect((await refundQuote(t.db, buyer.userId, item.id)).quote).toMatchObject({
      ok: false,
      code: "NOT_REFUNDABLE",
    });
  });

  it("운영자가 금액을 바꾸려면 이유가 있어야 하고, 남은 결제 금액을 넘을 수 없다", async () => {
    const { orderId } = await buy();
    const item = await itemOf(orderId);
    const refundId = await requestRefund(deps, buyer, {
      itemId: item.id,
      reason: "기타",
      detail: "개인 사정",
    });
    await expect(approveRefund(deps, { actorId: operatorId, refundId, amount: 1000 })).rejects.toMatchObject({
      code: "NOTE_REQUIRED",
    });
    await expect(
      approveRefund(deps, { actorId: operatorId, refundId, amount: 60_000, note: "x" }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await approveRefund(deps, { actorId: operatorId, refundId, amount: 50_000, note: "협의 금액" });
    const [refund] = await t.db.select().from(schema.refunds).where(eq(schema.refunds.id, refundId));
    expect(refund).toMatchObject({ status: "done", approvedAmount: 50_000, decisionNote: "협의 금액" });
  });

  it("거절하면 사유 메일, 수강권은 그대로. 수강생은 다시 요청할 수 있다. 요청을 거둘 수도 있다", async () => {
    const { orderId } = await buy();
    const item = await itemOf(orderId);
    const refundId = await requestRefund(deps, buyer, { itemId: item.id, reason: "기타", detail: "?" });
    await rejectRefund(deps, { actorId: operatorId, refundId, note: "확인 결과 규정 밖입니다" });
    expect(mails.at(-1)).toMatchObject({ template: "refund-rejected", note: "확인 결과 규정 밖입니다" });
    expect(canLearn(await viewAccess(t.db, buyer, course))).toBe(true);
    const again = await requestRefund(deps, buyer, { itemId: item.id, reason: "실수로 결제했어요" });
    await expect(withdrawRefundRequest(t.db, other, again)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await withdrawRefundRequest(t.db, buyer, again);
    await expect(approveRefund(deps, { actorId: operatorId, refundId: again })).rejects.toMatchObject({
      code: "ALREADY_DECIDED",
    });
    expect(toss.calls.cancel).toBe(0);
  });

  it("토스 취소가 실패하면 요청 상태로 되돌려 다시 처리할 수 있다", async () => {
    const { orderId } = await buy();
    const item = await itemOf(orderId);
    const refundId = await requestRefund(deps, buyer, { itemId: item.id, reason: "실수로 결제했어요" });
    const real = toss.gateway.cancel;
    toss.gateway.cancel = async () => {
      throw new GatewayError("PROVIDER_ERROR", "일시적인 오류", 500);
    };
    await expect(approveRefund(deps, { actorId: operatorId, refundId })).rejects.toMatchObject({
      code: "CANCEL_FAILED",
    });
    toss.gateway.cancel = real;
    const [refund] = await t.db.select().from(schema.refunds).where(eq(schema.refunds.id, refundId));
    expect(refund).toMatchObject({ status: "requested" });
    expect(refund!.failMessage).toContain("PROVIDER_ERROR");
    expect(canLearn(await viewAccess(t.db, buyer, course))).toBe(true);
    await approveRefund(deps, { actorId: operatorId, refundId });
    expect(canLearn(await viewAccess(t.db, buyer, course))).toBe(false);
  });
});

describe("토스 웹훅 (다시 조회해서 맞춘다)", () => {
  it("토스 상점 관리자에서 직접 취소 ➔ 환불 기록 · 수강권 끝. 같은 웹훅이 또 와도 한 번만", async () => {
    const { orderId, paymentKey } = await buy();
    toss.cancelOutside(paymentKey, 59_000);
    const hook = { eventType: "PAYMENT_STATUS_CHANGED", paymentKey };
    expect(await handleTossWebhook(deps, hook)).toBe("canceled 59000");
    expect(await handleTossWebhook(deps, hook)).toBe("already synced");
    const refunds = await t.db.select().from(schema.refunds);
    expect(refunds).toEqual([
      expect.objectContaining({ status: "done", approvedAmount: 59_000, reason: "토스에서 직접 취소" }),
    ]);
    const [order] = await t.db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("refunded");
    expect(canLearn(await viewAccess(t.db, buyer, course))).toBe(false);
    expect(await t.db.select().from(schema.paymentWebhooks)).toHaveLength(2);
  });

  it("웹훅 내용은 믿지 않는다: 모르는 결제 · 토스에서는 그대로인 결제", async () => {
    const { paymentKey } = await buy();
    expect(
      await handleTossWebhook(deps, { eventType: "PAYMENT_STATUS_CHANGED", paymentKey: "tpk_forged" }),
    ).toBe("unknown payment");
    // "취소됐다"는 가짜 웹훅이 와도 토스에 물어보면 DONE ➔ 아무것도 바꾸지 않는다
    expect(await handleTossWebhook(deps, { eventType: "PAYMENT_STATUS_CHANGED", paymentKey })).toBe(
      "no change (DONE)",
    );
    expect(canLearn(await viewAccess(t.db, buyer, course))).toBe(true);
    expect(await handleTossWebhook(deps, { eventType: "DEPOSIT_CALLBACK", paymentKey })).toBe("ignored");
  });

  it("승인 뒤 서버가 멈춰 ready 로 남은 결제를 웹훅이 마무리한다", async () => {
    const { orderId } = await createOrder(t.db, buyer, productId);
    await agreeToOrder(t.db, buyer, orderId, AGREE);
    const paymentKey = toss.authorize(orderId, 59_000);
    await t.db.insert(schema.payments).values({ orderId, providerPaymentKey: paymentKey, amount: 59_000 });
    await toss.gateway.confirm({ paymentKey, orderId, amount: 59_000 }); // 토스는 승인됨
    expect(await handleTossWebhook(deps, { eventType: "PAYMENT_STATUS_CHANGED", paymentKey })).toBe(
      "paid (late)",
    );
    expect(await purchaseEntitlements(buyer.userId)).toHaveLength(1);
  });
});

describe("연장권", () => {
  let extensionId: string;
  beforeEach(async () => {
    extensionId = await createProduct(t.db, {
      actorId: operatorId,
      type: "extension",
      courseId: course.id,
      name: "AI Agent 개발 · 초급 연장 90일",
      accessDays: 90,
      amount: 17_700,
    });
  });

  it("수강권이 없으면 살 수 없다", async () => {
    await expect(createOrder(t.db, buyer, extensionId)).rejects.toMatchObject({
      code: "NO_BASE_ENTITLEMENT",
    });
  });

  it("이용 중에 사면 끝나는 날 + 90일, 만료 뒤에 사면 오늘부터 90일. 알림 기록은 다시 시작", async () => {
    await buy();
    const [before] = await purchaseEntitlements(buyer.userId);
    await t.db
      .update(schema.entitlements)
      .set({ remindedD30At: new Date() })
      .where(eq(schema.entitlements.id, before!.id));
    const offers = await courseOffers(t.db, course, buyer);
    expect(offers.extension?.quote.paidAmount).toBe(17_700);
    const { orderId } = await createOrder(t.db, buyer, extensionId);
    const view = await checkoutView(t.db, buyer, orderId);
    expect(view.accessUntil).toEqual(new Date(before!.endsAt!.getTime() + 90 * DAY));
    await buy(buyer, new Date(), extensionId);
    const [after] = await purchaseEntitlements(buyer.userId);
    expect(after!.endsAt).toEqual(new Date(before!.endsAt!.getTime() + 90 * DAY));
    expect(after!.remindedD30At).toBeNull();

    // 다른 사람: 운영자 발급 수강권이 끝난 뒤 연장
    const grantId = await grantEntitlement(t.db, {
      actorId: operatorId,
      userId: other.userId,
      courseId: course.id,
      days: 10,
      reason: "베타",
    });
    const later = new Date(Date.now() + 20 * DAY);
    expect(canLearn(await viewAccess(t.db, other, course, later))).toBe(false);
    await buy(other, later, extensionId);
    const [granted] = await t.db
      .select()
      .from(schema.entitlements)
      .where(eq(schema.entitlements.id, grantId));
    expect(granted!.endsAt!.getTime() - later.getTime()).toBeGreaterThan(90 * DAY);
    expect(granted!.endsAt!.getTime() - later.getTime()).toBeLessThanOrEqual(91 * DAY);
    expect(canLearn(await viewAccess(t.db, other, course, later))).toBe(true);
  });

  it("연장권 환불: 늘어난 기간 시작 전이면 전액, 늘린 날을 거둔다", async () => {
    await buy();
    const [before] = await purchaseEntitlements(buyer.userId);
    const { orderId } = await buy(buyer, new Date(), extensionId);
    const [item] = await t.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    const view = await refundQuote(t.db, buyer.userId, item!.id);
    expect(view.quote).toMatchObject({
      ok: true,
      calculation: { kind: "extension", tier: "full", amount: 17_700 },
    });
    const refundId = await requestRefund(deps, buyer, { itemId: item!.id, reason: "실수로 결제했어요" });
    await approveRefund(deps, { actorId: operatorId, refundId });
    const [ent] = await purchaseEntitlements(buyer.userId);
    expect(ent!.endsAt).toEqual(before!.endsAt);
    expect(ent!.revokedAt).toBeNull(); // 원래 수강권은 그대로
  });
});

describe("만료 알림 메일 D-30 · D-7 (worker)", () => {
  it("30일 · 7일 남았을 때 한 번씩, 더 오래 가는 수강권이 있으면 보내지 않는다", async () => {
    await grantEntitlement(t.db, {
      actorId: operatorId,
      userId: buyer.userId,
      courseId: course.id,
      days: 40,
      reason: "베타",
    });
    const sent: MailJob[] = [];
    const run = (now: Date) =>
      sendExpiryReminders(
        t.db,
        { enqueueMail: async (j) => void sent.push(j), baseUrl: "http://localhost:3000" },
        now,
      );
    expect(await run(new Date())).toEqual({ d30: 0, d7: 0, skipped: 0 });
    const d30 = new Date(Date.now() + 11 * DAY);
    expect(await run(d30)).toEqual({ d30: 1, d7: 0, skipped: 0 });
    expect(await run(d30)).toEqual({ d30: 0, d7: 0, skipped: 0 });
    const d7 = new Date(Date.now() + 34 * DAY);
    expect(await run(d7)).toEqual({ d30: 0, d7: 1, skipped: 0 });
    expect(sent.map((m) => m.template === "expiry-reminder" && m.daysLeft)).toEqual([30, 7]);
    expect(sent[0]).toMatchObject({
      to: buyer.email,
      courseUrl: "http://localhost:3000/courses/ai-agent-basics",
    });

    // 다른 사람: 짧은 수강권 + 1년 구매 수강권 ➔ 알리지 않는다
    await grantEntitlement(t.db, {
      actorId: operatorId,
      userId: other.userId,
      courseId: course.id,
      days: 5,
      reason: "베타",
    });
    await t.db.insert(schema.entitlements).values({
      userId: other.userId,
      scope: "course",
      courseId: course.id,
      sourceType: "purchase",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 365 * DAY),
    });
    expect(await run(new Date())).toEqual({ d30: 0, d7: 0, skipped: 1 });
  });
});
