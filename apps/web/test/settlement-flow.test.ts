// 정산 (개발계획 M9)
// 완료 기준: 정산 정책 9장의 규칙이 DB 위에서도 그대로 (단위 테스트는 packages/core settlement.test.ts),
// 계산 ➔ 확정 ➔ 명세 ➔ 이의 신청 ➔ 지급 기록, **확정 뒤 불변**(DB 트리거), 시행일 이후 매출만 새 정책, 확정 후 환불은 다음 달.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PolicyVersion } from "@aionit/core";
import {
  computeStatement,
  refundLine,
  resolvePolicy,
  singleSaleLine,
  splitVat,
  subscriptionPool,
  allocatePool,
} from "@aionit/core";
import { and, eq, schema, sql } from "@aionit/db";
import { calculateMonth, loadPolicies } from "@aionit/payments";
import { aggregateLearningDay } from "../../worker/src/learning";
import { setInstructorRate } from "@/server/instructors";
import {
  adjust,
  adminSettlement,
  answer,
  calculate,
  confirm,
  createPolicy,
  estimateThisMonth,
  myStatement,
  myStatements,
  objectAs,
  payout,
  settlementOverview,
  statementCsv,
} from "@/server/settlements";
import { resetDb, setupTestAuth } from "./helpers";

const t = setupTestAuth();
afterAll(() => t.close());

const kst = (s: string) => new Date(`${s}+09:00`);
let seq = 0;

async function user(roles: ("operator" | "instructor")[] = []) {
  seq += 1;
  const [row] = await t.db
    .insert(schema.users)
    .values({ email: `u${seq}@example.com`, nickname: `회원${seq}`, emailVerified: true })
    .returning();
  for (const role of roles) await t.db.insert(schema.userRoles).values({ userId: row!.id, role });
  return row!.id;
}

async function instructor(name: string, taxType: "individual" | "business" | null) {
  const userId = await user(["instructor"]);
  const [row] = await t.db.insert(schema.instructors).values({ userId, displayName: name }).returning();
  if (taxType)
    await t.db.insert(schema.payoutProfiles).values({
      instructorId: row!.id,
      taxType,
      rrnSealed: taxType === "individual" ? "v1.test.test.test" : null,
      businessNo: taxType === "business" ? "1234567891" : null,
      bankName: "국민은행",
      bankAccountSealed: "v1.test.test.test",
      bankAccountLast4: "5678",
      accountHolder: name,
    });
  return row!;
}

async function course(ownerId: string, slug: string, inSubscription = true) {
  const [row] = await t.db
    .insert(schema.courses)
    .values({ slug, ownerInstructorId: ownerId, title: `과정 ${slug}`, field: "ai", inSubscription })
    .returning();
  return row!.id;
}

let product: string;
let subProduct: string;

/** 결제된 단건 주문 (주문 · 항목 · 결제). fee 가 null 이면 수수료 기록 없음 (정책의 추정 수수료율) */
async function sale(
  buyer: string,
  courseId: string,
  paid: number,
  paidAt: string,
  fee: number | null = null,
) {
  const { supply, vat } = splitVat(paid);
  const at = kst(paidAt);
  const [order] = await t.db
    .insert(schema.orders)
    .values({
      userId: buyer,
      status: "paid",
      totalAmount: paid,
      orderName: "강의",
      expiresAt: at,
      paidAt: at,
    })
    .returning();
  const [item] = await t.db
    .insert(schema.orderItems)
    .values({
      orderId: order!.id,
      productId: product,
      productType: "course",
      courseId,
      productName: "강의",
      listPrice: paid,
      paidAmount: paid,
      supplyAmount: supply,
      vatAmount: vat,
    })
    .returning();
  await t.db.insert(schema.payments).values({
    orderId: order!.id,
    providerPaymentKey: `pk-${order!.id}`,
    amount: paid,
    status: "done",
    feeAmount: fee,
    approvedAt: at,
  });
  return { itemId: item!.id, paid, vat, fee, paidAt: at };
}

async function refund(itemId: string, buyer: string, amount: number, doneAt: string) {
  const [row] = await t.db
    .insert(schema.refunds)
    .values({
      orderItemId: itemId,
      userId: buyer,
      status: "done",
      calculation: {},
      requestedAmount: amount,
      approvedAmount: amount,
      reason: "test",
      doneAt: kst(doneAt),
    })
    .returning();
  return row!.id;
}

/** 구독 회차 결제 (구독 · 회차 · 주문 · 항목 · 결제) */
async function subPayment(buyer: string, paid: number, paidAt: string, interval: "month" | "year" = "month") {
  const { supply, vat } = splitVat(paid);
  const at = kst(paidAt);
  const [sub] = await t.db
    .insert(schema.subscriptions)
    .values({
      userId: buyer,
      productId: subProduct,
      status: "active",
      interval,
      planName: "구독",
      amount: paid,
      customerKey: `ck-${buyer}`,
      autoRenewAgreedAt: at,
      termsAgreedAt: at,
    })
    .returning();
  const [order] = await t.db
    .insert(schema.orders)
    .values({
      userId: buyer,
      status: "paid",
      totalAmount: paid,
      orderName: "구독",
      expiresAt: at,
      paidAt: at,
    })
    .returning();
  const [item] = await t.db
    .insert(schema.orderItems)
    .values({
      orderId: order!.id,
      productId: subProduct,
      productType: "subscription",
      productName: "구독",
      listPrice: paid,
      paidAmount: paid,
      supplyAmount: supply,
      vatAmount: vat,
    })
    .returning();
  await t.db.insert(schema.subscriptionCycles).values({
    subscriptionId: sub!.id,
    cycleNo: 1,
    billingDate: paidAt.slice(0, 10),
    periodStart: at,
    periodEnd: new Date(at.getTime() + 30 * 86_400_000),
    amount: paid,
    supplyAmount: supply,
    vatAmount: vat,
    status: "paid",
    orderId: order!.id,
  });
  await t.db.insert(schema.payments).values({
    orderId: order!.id,
    providerPaymentKey: `pk-${order!.id}`,
    keySet: "billing",
    amount: paid,
    status: "done",
    feeAmount: 0,
    approvedAt: at,
  });
  return { id: item!.id, paidAt: at, paid, vat, fee: 0, interval, refunds: [] };
}

async function study(
  userId: string,
  courseId: string,
  date: string,
  seconds: number,
  access: "subscription" | "course" | "none" | null,
) {
  await t.db.insert(schema.learningTimeDaily).values({
    userId,
    courseId,
    date,
    videoSec: seconds,
    textSec: 0,
    effectiveSec: seconds,
    ruleVersion: "2026-11-v1",
    access,
  });
}

let operator: string;
let teacherA: typeof schema.instructors.$inferSelect;
let teacherB: typeof schema.instructors.$inferSelect;
let teacherC: typeof schema.instructors.$inferSelect;
let courseA: string;
let courseB: string;
let courseC: string;
let buyer: string;
let subscriber: string;
let subscriber2: string;
let policies: PolicyVersion[];

beforeEach(async () => {
  await resetDb(t.db);
  operator = await user(["operator"]);
  teacherA = await instructor("가강사", "individual");
  teacherB = await instructor("나강사", "business");
  teacherC = await instructor("다강사", null);
  courseA = await course(teacherA.id, "a-course");
  courseB = await course(teacherB.id, "b-course");
  courseC = await course(teacherC.id, "c-course");
  buyer = await user();
  subscriber = await user();
  subscriber2 = await user();
  const [p] = await t.db.insert(schema.products).values({ type: "course", name: "강의" }).returning();
  product = p!.id;
  const [s] = await t.db
    .insert(schema.products)
    .values({ type: "subscription", name: "구독", billingInterval: "month" })
    .returning();
  subProduct = s!.id;
  policies = await loadPolicies(t.db);
});

const actor = () => ({ actorId: operator });
const settlementOf = async (month: string, instructorId: string) => {
  const [row] = await t.db
    .select({ s: schema.settlements })
    .from(schema.settlements)
    .innerJoin(schema.settlementPeriods, eq(schema.settlementPeriods.id, schema.settlements.periodId))
    .where(and(eq(schema.settlementPeriods.month, month), eq(schema.settlements.instructorId, instructorId)));
  return row?.s ?? null;
};
const linesOf = (settlementId: string) =>
  t.db.select().from(schema.settlementLines).where(eq(schema.settlementLines.settlementId, settlementId));

describe("월 정산 계산 (9.1 · 9.2)", () => {
  it("단건(정책의 추정 수수료 · 기록된 수수료) + 구독 배분(구독으로 본 시간만) = core 계산과 같다", async () => {
    const s1 = await sale(buyer, courseA, 59_000, "2026-11-10T10:00:00");
    const s2 = await sale(buyer, courseA, 44_250, "2026-11-20T10:00:00", 805);
    const s3 = await sale(buyer, courseB, 100_000, "2026-11-15T10:00:00", 2_000);
    // 다음 달 판매는 11월에 들어가지 않는다
    await sale(buyer, courseA, 59_000, "2026-12-01T00:00:00");
    const sub1 = await subPayment(subscriber, 17_700, "2026-11-05T10:00:00");
    const sub2 = await subPayment(subscriber2, 177_000, "2026-11-08T10:00:00", "year");
    await study(subscriber, courseA, "2026-11-06", 3_600, "subscription");
    await study(subscriber2, courseB, "2026-11-09", 1_800, "subscription");
    // 단건으로 가진 과정을 본 시간 (D3) · 무엇으로 봤는지 모르는 시간은 구독 배분에 넣지 않는다
    await study(buyer, courseA, "2026-11-11", 7_200, "course");
    await study(buyer, courseB, "2026-11-12", 7_200, "none");

    const now = kst("2026-12-02T05:00:00");
    const { result } = await calculate(t.db, "2026-11", actor(), now);
    expect(result.skippedNoPolicy).toBe(0);

    const policyAt = (at: Date) => resolvePolicy(policies, {}, at);
    const v1 = policyAt(s1.paidAt)!;
    expect(v1).toMatchObject({ singleRateBp: 6000, poolRateBp: 5000, pgFeeRateBp: 340 });
    const line = (s: { paid: number; vat: number; fee: number | null }) =>
      singleSaleLine(s, { singleRateBp: v1.singleRateBp, pgFeeRateBp: v1.pgFeeRateBp });
    const pool = subscriptionPool([sub1, sub2], "2026-11", policyAt);
    const alloc = allocatePool(
      pool.allocatable,
      new Map([
        [courseA, 3_600],
        [courseB, 1_800],
      ]),
    );
    const expectA = computeStatement({
      single: line(s1).amount + line(s2).amount,
      subscription: alloc.find((a) => a.courseId === courseA)!.amount,
      refund: 0,
      adjustment: 0,
      carriedIn: 0,
      taxType: "individual",
    });
    const a = (await settlementOf("2026-11", teacherA.id))!;
    expect(a).toMatchObject({
      status: "calculated",
      singleAmount: expectA.single,
      subscriptionAmount: expectA.subscription,
      grossAmount: expectA.gross,
      withheld: expectA.withheld,
      payoutAmount: expectA.payout,
    });
    expect(line(s2).amount).toBe(23_653); // I-08 예시 (44,250원, 수수료 805원)
    // 사업자: 원천징수 없이 + 부가세
    const b = (await settlementOf("2026-11", teacherB.id))!;
    const bGross = line(s3).amount + alloc.find((x) => x.courseId === courseB)!.amount;
    expect(b).toMatchObject({ grossAmount: bGross, withheld: 0, vatAmount: Math.floor(bGross / 10) });
    // 정산마다 어떤 정책 버전으로 계산했는지
    expect(a.policyIds).toEqual([v1.from.single]);
    const [period] = await t.db.select().from(schema.settlementPeriods);
    expect(period).toMatchObject({
      month: "2026-11",
      subscriptionPool: pool.pool,
      subscriptionSeconds: 5_400,
      policyIds: [v1.from.single],
    });
    // 판매가 없는 강사는 정산이 없다
    expect(await settlementOf("2026-11", teacherC.id)).toBeNull();
    // 근거 줄: 판매 3 + 구독 2
    const aLines = await linesOf(a.id);
    expect(aLines.map((l) => l.kind).sort()).toEqual(["single", "single", "subscription"]);
    expect(aLines.find((l) => l.orderItemId === s1.itemId)!.detail).toMatchObject({
      feeEstimated: true,
      fee: 2_006,
    });
  });

  it("다시 계산해도 같은 값, 줄이 늘지 않는다 (확정 전)", async () => {
    await sale(buyer, courseA, 59_000, "2026-11-10T10:00:00");
    const now = kst("2026-12-02T05:00:00");
    await calculate(t.db, "2026-11", actor(), now);
    const first = (await settlementOf("2026-11", teacherA.id))!;
    await calculate(t.db, "2026-11", actor(), now);
    const second = (await settlementOf("2026-11", teacherA.id))!;
    expect(second.payoutAmount).toBe(first.payoutAmount);
    expect(await t.db.select().from(schema.settlementLines)).toHaveLength(1);
    expect(await t.db.select().from(schema.settlementPeriods)).toHaveLength(1);
  });

  it("끝나지 않은 달 · 앞달을 확정하지 않은 달 · 건너뛴 달은 계산하지 않는다", async () => {
    const now = kst("2027-01-02T05:00:00");
    await expect(calculate(t.db, "2027-01", actor(), now)).rejects.toMatchObject({ code: "NOT_CLOSED" });
    await calculate(t.db, "2026-11", actor(), now);
    await expect(calculate(t.db, "2026-12", actor(), now)).rejects.toMatchObject({ code: "OTHER_OPEN" });
    await confirm(t.db, "2026-11", actor(), now);
    const overview = await settlementOverview(t.db, now);
    expect(overview.suggested).toBe("2026-12");
    expect(overview.block).toBeNull();
  });
});

describe("확정 ➔ 명세 ➔ 이의 신청 ➔ 지급 기록, 확정 뒤 불변", () => {
  it("흐름 전체와 DB 가 막는 것", async () => {
    const s1 = await sale(buyer, courseA, 59_000, "2026-11-10T10:00:00");
    await sale(buyer, courseA, 44_250, "2026-11-20T10:00:00", 805);
    await calculate(t.db, "2026-11", actor(), kst("2026-12-02T05:00:00"));
    // 확정 전에는 강사에게 보이지 않는다
    expect(await myStatement(t.db, teacherA, "2026-11", { actorId: teacherA.userId! })).toBeNull();

    const confirmedAt = kst("2026-12-10T09:00:00");
    const done = await confirm(t.db, "2026-11", actor(), confirmedAt);
    expect(done).toMatchObject({ objectionUntil: "2026-12-15", payOn: "2026-12-15" });
    const notified = await t.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, teacherA.userId!));
    expect(notified.map((n) => n.title)).toContain("11월 정산 명세가 공개되었습니다");

    // ---- 확정 뒤 불변: DB 트리거 ----
    const a = (await settlementOf("2026-11", teacherA.id))!;
    expect(a.status).toBe("confirmed");
    await expect(
      t.db.update(schema.settlements).set({ payoutAmount: 1 }).where(eq(schema.settlements.id, a.id)),
    ).rejects.toThrow();
    await expect(
      t.db.update(schema.settlements).set({ status: "calculated" }).where(eq(schema.settlements.id, a.id)),
    ).rejects.toThrow();
    await expect(t.db.delete(schema.settlements).where(eq(schema.settlements.id, a.id))).rejects.toThrow();
    await expect(
      t.db.delete(schema.settlementLines).where(eq(schema.settlementLines.settlementId, a.id)),
    ).rejects.toThrow();
    await expect(
      t.db
        .update(schema.settlementLines)
        .set({ amount: 999_999 })
        .where(eq(schema.settlementLines.settlementId, a.id)),
    ).rejects.toThrow();
    await expect(
      t.db.insert(schema.settlementLines).values({
        settlementId: a.id,
        kind: "adjustment",
        occurredAt: new Date(),
        baseAmount: 1,
        amount: 1,
      }),
    ).rejects.toThrow();
    await expect(
      t.db
        .update(schema.settlementPeriods)
        .set({ subscriptionPool: 1 })
        .where(eq(schema.settlementPeriods.month, "2026-11")),
    ).rejects.toThrow();
    await expect(t.db.delete(schema.settlementPeriods)).rejects.toThrow();
    await expect(
      t.db.execute(sql`truncate settlement_lines, settlements, settlement_periods`),
    ).rejects.toThrow();
    const [period] = await t.db.select().from(schema.settlementPeriods);
    await expect(
      t.db.insert(schema.settlements).values({
        periodId: period!.id,
        instructorId: teacherC.id,
        singleAmount: 0,
        subscriptionAmount: 0,
        refundAmount: 0,
        adjustmentAmount: 0,
        carriedIn: 0,
        grossAmount: 0,
        incomeTax: 0,
        localTax: 0,
        withheld: 0,
        vatAmount: 0,
        payoutAmount: 0,
        carryOut: 0,
      }),
    ).rejects.toThrow();
    // 앱에서도: 확정한 달은 다시 계산하지 않는다
    await expect(calculate(t.db, "2026-11", actor(), kst("2026-12-11T00:00:00"))).rejects.toMatchObject({
      code: "CONFIRMED",
    });
    expect((await settlementOf("2026-11", teacherA.id))!).toEqual(a);

    // ---- 강사 명세 (I-08): 자기 것만, 구매자 · 주문 번호 없음 ----
    const statement = (await myStatement(
      t.db,
      teacherA,
      "2026-11",
      { actorId: teacherA.userId! },
      confirmedAt,
    ))!;
    expect(statement.settlement.payoutAmount).toBe(a.payoutAmount);
    expect(statement.policies.map((p) => p.name)).toEqual(["기본 정책 v1 (2026.11.01 시행)"]);
    expect(statement.account).toEqual({ bankName: "국민은행", last4: "5678" });
    const text = JSON.stringify(statement.lines) + statementCsv(statement);
    expect(text).not.toContain(s1.itemId);
    expect(text).not.toContain(buyer);
    expect(text).not.toContain("example.com");
    expect(statementCsv(statement).startsWith("﻿구분,날짜,과정")).toBe(true);
    expect(await myStatement(t.db, teacherB, "2026-11", { actorId: teacherB.userId! })).toBeNull();
    expect((await myStatements(t.db, teacherA)).map((s) => s.month)).toEqual(["2026-11"]);
    // 명세를 볼 때 정산 정보(끝 4자리) 조회 기록
    const pii = await t.db
      .select()
      .from(schema.piiAccessLogs)
      .where(eq(schema.piiAccessLogs.subjectUserId, teacherA.userId!));
    expect(pii.map((p) => p.purpose)).toContain("정산 명세 보기 (I-08)");

    // ---- 이의 신청: 공개 뒤 5일, 답변을 기다리는 것은 하나만 ----
    const mine = { userId: teacherA.userId! };
    await expect(
      objectAs(t.db, teacherB, a.id, { body: "제 정산이 아닌데요", userId: teacherB.userId! }, confirmedAt),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const objection = await objectAs(
      t.db,
      teacherA,
      a.id,
      { body: "12.03 판매가 빠진 것 같습니다", ...mine },
      kst("2026-12-12T10:00:00"),
    );
    await expect(
      objectAs(t.db, teacherA, a.id, { body: "한 번 더 신청합니다", ...mine }, kst("2026-12-12T11:00:00")),
    ).rejects.toMatchObject({
      code: "OPEN",
    });
    const opNotes = await t.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, operator));
    expect(opNotes.some((n) => n.title.startsWith("정산 이의 신청"))).toBe(true);
    // 답변 + 조정 (다음 달에 들어간다). 이의 신청 내용은 고칠 수 없다
    await answer(t.db, objection.id, {
      answer: "확인했습니다. 다음 달에 반영합니다.",
      adjustment: 5_000,
      ...actor(),
    });
    await expect(
      answer(t.db, objection.id, { answer: "다시", adjustment: 0, ...actor() }),
    ).rejects.toMatchObject({ code: "ANSWERED" });
    await expect(
      t.db
        .update(schema.settlementObjections)
        .set({ body: "바꿈" })
        .where(eq(schema.settlementObjections.id, objection.id)),
    ).rejects.toThrow();
    await expect(
      objectAs(t.db, teacherA, a.id, { body: "기간이 지난 신청입니다", ...mine }, kst("2026-12-16T00:00:00")),
    ).rejects.toMatchObject({ code: "CLOSED" });

    // ---- 지급 기록 ----
    await expect(
      payout(t.db, a.id, { paidOn: "2027-01-01", memo: "", ...actor() }, kst("2026-12-15T10:00:00")),
    ).rejects.toMatchObject({
      code: "BAD_DATE",
    });
    const paid = await payout(
      t.db,
      a.id,
      { paidOn: "2026-12-15", memo: "국민은행 이체", ...actor() },
      kst("2026-12-15T10:00:00"),
    );
    expect(paid.amount).toBe(a.payoutAmount);
    await expect(
      payout(t.db, a.id, { paidOn: "2026-12-15", memo: "", ...actor() }, kst("2026-12-15T10:00:00")),
    ).rejects.toMatchObject({
      code: "PAID",
    });
    expect((await settlementOf("2026-11", teacherA.id))!.status).toBe("paid");
    await expect(t.db.update(schema.payouts).set({ amount: 1 })).rejects.toThrow();
    await expect(
      t.db.update(schema.settlements).set({ payoutAmount: 1 }).where(eq(schema.settlements.id, a.id)),
    ).rejects.toThrow();
    const detail = (await adminSettlement(t.db, a.id, actor()))!;
    expect(detail.payout).toMatchObject({ paidOn: "2026-12-15", recordedBy: operator });
    expect(detail.objections[0]!.adjustment!.amount).toBe(5_000);

    // ---- 확정 후 환불 ➔ 다음 달에 그 강사 몫만큼 뺀다, 조정도 다음 달에 한 번 ----
    await refund(s1.itemId, buyer, 59_000, "2026-12-11T10:00:00");
    await calculate(t.db, "2026-12", actor(), kst("2027-01-02T05:00:00"));
    const dec = (await settlementOf("2026-12", teacherA.id))!;
    const v1 = resolvePolicy(policies, {}, s1.paidAt)!;
    const saleLine = singleSaleLine(s1, { singleRateBp: v1.singleRateBp, pgFeeRateBp: v1.pgFeeRateBp });
    expect(dec).toMatchObject({
      singleAmount: 0,
      refundAmount: refundLine(saleLine, 59_000).amount,
      adjustmentAmount: 5_000,
    });
    expect(dec.refundAmount).toBe(-saleLine.amount);
    // 마이너스: 지급하지 않고 그다음 달로
    expect(dec).toMatchObject({ payoutAmount: 0, holdReason: "negative", carryOut: dec.grossAmount });
    const decLines = await linesOf(dec.id);
    expect(decLines.find((l) => l.kind === "refund")!.detail).toMatchObject({
      saleMonth: "2026-11",
      afterConfirm: true,
    });
    // 11월 확정본은 그대로
    expect((await settlementOf("2026-11", teacherA.id))!.payoutAmount).toBe(a.payoutAmount);
    // 12월을 다시 계산해도 환불 · 조정이 두 번 들어가지 않는다
    await calculate(t.db, "2026-12", actor(), kst("2027-01-03T05:00:00"));
    expect(
      await t.db.select().from(schema.settlementLines).where(eq(schema.settlementLines.kind, "refund")),
    ).toHaveLength(1);
    await confirm(t.db, "2026-12", actor(), kst("2027-01-10T09:00:00"));
    // 1월: 이월된 마이너스를 메운다
    await sale(buyer, courseA, 59_000, "2027-01-05T10:00:00");
    await calculate(t.db, "2027-01", actor(), kst("2027-02-02T05:00:00"));
    const jan = (await settlementOf("2027-01", teacherA.id))!;
    expect(jan.carriedIn).toBe(dec.carryOut);
    expect(
      await t.db.select().from(schema.settlementLines).where(eq(schema.settlementLines.kind, "adjustment")),
    ).toHaveLength(1);
  });

  it("확정 전의 환불은 그 달 매출에서 뺀다 (정산 차감 줄이 그 달에)", async () => {
    const s1 = await sale(buyer, courseA, 59_000, "2026-11-10T10:00:00");
    await sale(buyer, courseA, 59_000, "2026-11-11T10:00:00");
    // 11월 판매를 12월 3일에 환불, 11월은 12월 5일에 계산 (확정 전)
    await refund(s1.itemId, buyer, 29_500, "2026-12-03T10:00:00");
    await calculate(t.db, "2026-11", actor(), kst("2026-12-05T10:00:00"));
    const nov = (await settlementOf("2026-11", teacherA.id))!;
    const lines = await linesOf(nov.id);
    expect(lines.filter((l) => l.kind === "refund")).toHaveLength(1);
    expect(lines.find((l) => l.kind === "refund")!.detail).toMatchObject({ afterConfirm: false });
    await confirm(t.db, "2026-11", actor(), kst("2026-12-10T09:00:00"));
    await calculate(t.db, "2026-12", actor(), kst("2027-01-02T05:00:00"));
    // 12월에는 다시 빼지 않는다
    expect(await settlementOf("2026-12", teacherA.id)).toBeNull();
  });

  it("최소 지급액 미만 · 정산 정보 없음은 넘기고, 다음 달 합쳐서 준다", async () => {
    await sale(buyer, courseA, 11_000, "2026-11-10T10:00:00", 0); // 강사 몫 6,000원
    await sale(buyer, courseC, 59_000, "2026-11-10T10:00:00", 0);
    await calculate(t.db, "2026-11", actor(), kst("2026-12-02T05:00:00"));
    expect(await settlementOf("2026-11", teacherA.id)).toMatchObject({
      grossAmount: 6_000,
      payoutAmount: 0,
      withheld: 0,
      holdReason: "below_min",
      carryOut: 6_000,
    });
    expect(await settlementOf("2026-11", teacherC.id)).toMatchObject({
      holdReason: "no_profile",
      payoutAmount: 0,
    });
    await confirm(t.db, "2026-11", actor(), kst("2026-12-10T09:00:00"));
    const a = (await settlementOf("2026-11", teacherA.id))!;
    await expect(
      payout(t.db, a.id, { paidOn: "2026-12-15", memo: "", ...actor() }, kst("2026-12-15T10:00:00")),
    ).rejects.toMatchObject({
      code: "NOTHING_TO_PAY",
    });
    await sale(buyer, courseA, 11_000, "2026-12-10T10:00:00", 0);
    await calculate(t.db, "2026-12", actor(), kst("2027-01-02T05:00:00"));
    expect(await settlementOf("2026-12", teacherA.id)).toMatchObject({
      carriedIn: 6_000,
      grossAmount: 12_000,
      withheld: 390,
      payoutAmount: 11_610,
      holdReason: null,
    });
    // 판매가 없어도 넘어온 금액이 있으면 정산이 생긴다
    expect(await settlementOf("2026-12", teacherC.id)).toMatchObject({
      carriedIn: 32_181, // (59,000 − 부가세 5,364) × 60%
      holdReason: "no_profile",
    });
  });
});

describe("배분 정책 버전 (AD-16): 시행일 이후 매출만 새 정책", () => {
  it("강사 비율 · 과정 예외 · 기본 정책을 시행일과 함께 새 버전으로, 판매 시각의 정책으로 계산", async () => {
    const at = kst("2026-11-20T10:00:00");
    // 강사 A 70% (12.15 시행), 과정 B 예외 80% (12.20 시행), 기본 정책 v2 (단건 62%, 2027.01.01)
    await setInstructorRate(
      t.db,
      teacherA.id,
      { singleRateBp: 7000, effectiveOn: "2026-12-15", note: "", ...actor() },
      at,
    );
    await createPolicy(
      t.db,
      {
        scope: "course",
        courseId: courseB,
        singleRateBp: 8000,
        poolRateBp: null,
        pgFeeRateBp: null,
        dailyCapHours: null,
        effectiveOn: "2026-12-20",
        note: "B 과정 예외",
        ...actor(),
      },
      at,
    );
    await createPolicy(
      t.db,
      {
        scope: "default",
        singleRateBp: 6200,
        poolRateBp: 5000,
        pgFeeRateBp: 340,
        dailyCapHours: 3,
        effectiveOn: "2027-01-01",
        note: "기본 정책 v2",
        ...actor(),
      },
      at,
    );
    // 불리한 변경은 30일 뒤부터, 지난 날짜는 안 됨
    await expect(
      createPolicy(
        t.db,
        {
          scope: "default",
          singleRateBp: 5000,
          poolRateBp: 5000,
          pgFeeRateBp: 340,
          dailyCapHours: 3,
          effectiveOn: "2026-12-01",
          note: "",
          ...actor(),
        },
        at,
      ),
    ).rejects.toMatchObject({ code: "NEEDS_NOTICE" });
    await expect(
      setInstructorRate(
        t.db,
        teacherB.id,
        { singleRateBp: 5000, effectiveOn: "2026-12-01", note: "", ...actor() },
        at,
      ),
    ).rejects.toMatchObject({ code: "NEEDS_NOTICE" });
    await expect(
      createPolicy(
        t.db,
        {
          scope: "course",
          courseId: courseA,
          singleRateBp: 9000,
          poolRateBp: null,
          pgFeeRateBp: null,
          dailyCapHours: null,
          effectiveOn: "2026-11-20",
          note: "",
          ...actor(),
        },
        at,
      ),
    ).rejects.toMatchObject({ code: "PAST_DATE" });
    // 강사에게 알림
    const notes = await t.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, teacherB.userId!));
    expect(notes.map((n) => n.title)).toContain("배분 정책이 바뀝니다 (2026.12.20 시행)");

    await calculate(t.db, "2026-11", actor(), kst("2026-12-02T05:00:00"));
    await confirm(t.db, "2026-11", actor(), kst("2026-12-02T06:00:00"));
    const before = await sale(buyer, courseA, 11_000, "2026-12-14T23:59:59", 0);
    const after = await sale(buyer, courseA, 11_000, "2026-12-15T00:00:00", 0);
    const bBefore = await sale(buyer, courseB, 11_000, "2026-12-19T12:00:00", 0);
    const bAfter = await sale(buyer, courseB, 11_000, "2026-12-20T12:00:00", 0);
    await calculate(t.db, "2026-12", actor(), kst("2027-01-02T05:00:00"));
    const rate = async (itemId: string) =>
      (
        await t.db.select().from(schema.settlementLines).where(eq(schema.settlementLines.orderItemId, itemId))
      )[0]!.rateBp;
    expect(await rate(before.itemId)).toBe(6000);
    expect(await rate(after.itemId)).toBe(7000);
    expect(await rate(bBefore.itemId)).toBe(6000);
    expect(await rate(bAfter.itemId)).toBe(8000);
    const a = (await settlementOf("2026-12", teacherA.id))!;
    expect(a.policyIds).toHaveLength(2);
    // 11월 확정본은 그대로 (새 정책이 거꾸로 적용되지 않는다)
    expect(await settlementOf("2026-11", teacherA.id)).toBeNull();
  });
});

describe("유효 학습 시간 (M3 집계 ➔ 정산)", () => {
  it("집계할 때 그날 무엇으로 봤는지 남기고 (구독 · 단건), 강사 본인은 0", async () => {
    const day = "2026-11-06";
    const start = kst(`${day}T10:00:00`);
    await t.db.insert(schema.entitlements).values([
      {
        userId: subscriber,
        scope: "subscription_catalog",
        sourceType: "subscription",
        startsAt: kst("2026-11-01T00:00:00"),
      },
      {
        userId: buyer,
        scope: "course",
        courseId: courseA,
        sourceType: "purchase",
        startsAt: kst("2026-11-01T00:00:00"),
      },
      {
        userId: buyer,
        scope: "subscription_catalog",
        sourceType: "subscription",
        startsAt: kst("2026-11-01T00:00:00"),
      },
    ]);
    const beats = (userId: string) =>
      Array.from({ length: 4 }, (_, i) => ({
        userId,
        courseId: courseA,
        chapterKey: "ch01",
        kind: "text" as const,
        at: new Date(start.getTime() + i * 30_000),
        payload: { activeSec: 30 },
      }));
    await t.db
      .insert(schema.learningHeartbeats)
      .values([...beats(subscriber), ...beats(buyer), ...beats(teacherA.userId!)]);
    await aggregateLearningDay(t.db, day);
    const rows = await t.db.select().from(schema.learningTimeDaily);
    const of = (userId: string) => rows.find((r) => r.userId === userId)!;
    expect(of(subscriber)).toMatchObject({
      effectiveSec: 120,
      access: "subscription",
      ruleVersion: "2026-11-v1",
    });
    expect(of(buyer)).toMatchObject({ effectiveSec: 120, access: "course" });
    expect(of(teacherA.userId!)).toMatchObject({ effectiveSec: 0 });

    await subPayment(subscriber, 17_700, "2026-11-05T10:00:00");
    await calculate(t.db, "2026-11", actor(), kst("2026-12-02T05:00:00"));
    const [period] = await t.db.select().from(schema.settlementPeriods);
    expect(period!.subscriptionSeconds).toBe(120);
  });

  it("M9 전에 집계한 시간(access 없음)은 수강권으로 다시 판단한다", async () => {
    await t.db.insert(schema.entitlements).values({
      userId: subscriber,
      scope: "subscription_catalog",
      sourceType: "subscription",
      startsAt: kst("2026-11-01T00:00:00"),
    });
    await study(subscriber, courseA, "2026-11-03", 600, null);
    await study(buyer, courseA, "2026-11-03", 600, null);
    await subPayment(subscriber, 17_700, "2026-11-01T10:00:00");
    await calculate(t.db, "2026-11", actor(), kst("2026-12-02T05:00:00"));
    const [period] = await t.db.select().from(schema.settlementPeriods);
    expect(period!.subscriptionSeconds).toBe(600);
  });
});

describe("강사 대시보드 이번 달 예상 정산액 (I-01)", () => {
  it("이번 달 지금까지의 판매로 계산하고 저장하지 않는다", async () => {
    const s = await sale(buyer, courseA, 59_000, "2026-11-03T10:00:00", 1_180);
    const now = kst("2026-11-05T12:00:00");
    const estimate = await estimateThisMonth(t.db, teacherA, now);
    const line = singleSaleLine(s, { singleRateBp: 6000, pgFeeRateBp: 340 });
    expect(estimate).toMatchObject({ month: "2026-11", single: line.amount, gross: line.amount });
    expect(estimate.payout).toBe(
      computeStatement({
        single: line.amount,
        subscription: 0,
        refund: 0,
        adjustment: 0,
        carriedIn: 0,
        taxType: "individual",
      }).payout,
    );
    expect(await t.db.select().from(schema.settlementPeriods)).toHaveLength(0);
    expect((await estimateThisMonth(t.db, teacherB, now)).gross).toBe(0);
  });
});

describe("운영자 조정 · 자동 계산", () => {
  it("조정은 다음에 계산하는 달에 한 번, worker 는 지난달을 계산한다", async () => {
    await adjust(t.db, { instructorId: teacherB.id, amount: -3_000, reason: "수수료 정정", ...actor() });
    const { result } = await calculateMonth(t.db, "2026-11", { now: kst("2026-12-02T05:00:00") });
    expect(result.instructors.find((i) => i.instructorId === teacherB.id)!.statement.adjustment).toBe(-3_000);
  });
});
