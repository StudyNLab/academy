// 정산 (M9, docs/데이터모델.md 3.10 · 사이트구조 9장). 계산은 packages/core settlement, 읽고 쓰기는 packages/payments settlement.
// 확정(confirmed)한 정산은 바뀌지 않는다: DB 트리거가 정산 월 · 정산 · 근거 줄의 고치기 · 지우기를 막는다 (마이그레이션 0010).
// 확정 뒤의 환불 · 이의 신청 반영은 다음 달 정산의 환불 · 조정 줄로 들어간다.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { orderItems, refunds } from "./commerce";
import { courses, instructors } from "./content";
import { revenuePolicies, TAX_TYPES } from "./instructor";
import { id } from "./system";

const tz = () => timestamp({ withTimezone: true });
const createdAt = () => tz().notNull().defaultNow();
const won = () => bigint({ mode: "number" });

export const SETTLEMENT_PERIOD_STATUSES = ["calculated", "confirmed"] as const;

/**
 * 정산 월. 계산은 몇 번이든 다시 할 수 있고 (calculated), 운영자가 확정하면 (confirmed) 강사에게 명세가 공개되고
 * 그 뒤에는 바뀌지 않는다. 구독 풀은 이 달 기준액 · 풀 · 지난달에서 넘어온 마이너스 · 다음 달로 넘기는 마이너스.
 */
export const settlementPeriods = pgTable("settlement_periods", {
  id: id(),
  /** YYYY-MM (KST) */
  month: text().notNull().unique(),
  status: text({ enum: SETTLEMENT_PERIOD_STATUSES }).notNull().default("calculated"),
  subscriptionBase: won().notNull().default(0),
  subscriptionPool: won().notNull().default(0),
  poolCarryIn: won().notNull().default(0),
  poolCarryOut: won().notNull().default(0),
  /** 구독 포함 과정 전체의 유효 학습 시간 (구독으로 본 시간만) */
  subscriptionSeconds: bigint({ mode: "number" }).notNull().default(0),
  /** 📌 계산에 쓴 정책 버전 id 전부 */
  policyIds: jsonb().$type<string[]>().notNull().default([]),
  calculatedAt: tz().notNull(),
  calculatedBy: uuid().references(() => users.id),
  confirmedAt: tz(),
  confirmedBy: uuid().references(() => users.id),
  createdAt: createdAt(),
});

export const SETTLEMENT_STATUSES = ["calculated", "confirmed", "paid"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const HOLD_REASONS = ["negative", "below_min", "no_profile"] as const;

/** 강사 한 명의 한 달 정산 (명세 I-08). 금액은 core computeStatement 결과 그대로 */
export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    periodId: uuid()
      .notNull()
      .references(() => settlementPeriods.id),
    instructorId: uuid()
      .notNull()
      .references(() => instructors.id),
    status: text({ enum: SETTLEMENT_STATUSES }).notNull().default("calculated"),
    singleAmount: won().notNull(),
    subscriptionAmount: won().notNull(),
    /** 환불 차감 (0 이하) */
    refundAmount: won().notNull(),
    adjustmentAmount: won().notNull(),
    carriedIn: won().notNull(),
    grossAmount: won().notNull(),
    incomeTax: won().notNull(),
    localTax: won().notNull(),
    withheld: won().notNull(),
    /** 사업자: 세금계산서 부가세 */
    vatAmount: won().notNull(),
    payoutAmount: won().notNull(),
    carryOut: won().notNull(),
    holdReason: text({ enum: HOLD_REASONS }),
    /** 📌 계산할 때의 과세 구분 (정산 정보가 없으면 비어 있다) */
    taxType: text({ enum: TAX_TYPES }),
    /** 📌 이 강사 정산에 쓴 정책 버전 id */
    policyIds: jsonb().$type<string[]>().notNull().default([]),
    /** 명세 공개 (확정할 때) · 이의 신청 마감 · 지급 예정일 */
    publishedAt: tz(),
    objectionUntil: date({ mode: "string" }),
    payOn: date({ mode: "string" }),
    paidAt: tz(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("settlements_period_instructor_key").on(t.periodId, t.instructorId),
    index("settlements_instructor_idx").on(t.instructorId),
    check(
      "settlements_sum_check",
      sql`${t.grossAmount} = ${t.singleAmount} + ${t.subscriptionAmount} + ${t.refundAmount} + ${t.adjustmentAmount} + ${t.carriedIn}`,
    ),
    check(
      "settlements_payout_check",
      sql`${t.payoutAmount} = 0 or ${t.payoutAmount} = ${t.grossAmount} - ${t.withheld} + ${t.vatAmount}`,
    ),
  ],
);

export const SETTLEMENT_LINE_KINDS = ["single", "refund", "subscription", "adjustment"] as const;
export type SettlementLineKind = (typeof SETTLEMENT_LINE_KINDS)[number];

/**
 * 정산 근거 한 줄. 판매 · 환불 · 조정은 한 번만 정산된다 (고유 인덱스). 구매자는 남기지 않는다 (주문 항목 id 만, 강사에게는 보이지 않음).
 * detail: 결제액 · 부가세 · 수수료(추정인지) · 과정 이름 📌, 구독은 유효 학습 시간 · 비율.
 */
export const settlementLines = pgTable(
  "settlement_lines",
  {
    id: id(),
    settlementId: uuid()
      .notNull()
      .references(() => settlements.id),
    kind: text({ enum: SETTLEMENT_LINE_KINDS }).notNull(),
    courseId: uuid().references(() => courses.id),
    orderItemId: uuid().references(() => orderItems.id),
    refundId: uuid().references(() => refunds.id),
    adjustmentId: uuid().references(() => settlementAdjustments.id),
    policyId: uuid().references(() => revenuePolicies.id),
    /** 결제 · 환불 · 조정 시각 (구독은 그 달 1일) */
    occurredAt: tz().notNull(),
    baseAmount: won().notNull(),
    rateBp: integer(),
    amount: won().notNull(),
    detail: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("settlement_lines_settlement_idx").on(t.settlementId, t.kind),
    uniqueIndex("settlement_lines_sale_key")
      .on(t.orderItemId, t.courseId)
      .where(sql`${t.kind} = 'single'`),
    uniqueIndex("settlement_lines_refund_key")
      .on(t.refundId, t.courseId)
      .where(sql`${t.refundId} is not null`),
    uniqueIndex("settlement_lines_adjustment_key")
      .on(t.adjustmentId)
      .where(sql`${t.adjustmentId} is not null`),
  ],
);

/** 이의 신청 (명세 공개 뒤 5일). 운영자가 답하고, 고칠 것이 있으면 다음 달 조정으로 넣는다 */
export const settlementObjections = pgTable(
  "settlement_objections",
  {
    id: id(),
    settlementId: uuid()
      .notNull()
      .references(() => settlements.id),
    authorId: uuid()
      .notNull()
      .references(() => users.id),
    body: text().notNull(),
    answer: text(),
    answeredBy: uuid().references(() => users.id),
    answeredAt: tz(),
    createdAt: createdAt(),
  },
  (t) => [index("settlement_objections_settlement_idx").on(t.settlementId)],
);

/** 운영자 조정 (이의 신청 반영 · 수수료 정정 등). 다음에 계산하는 달의 조정 줄로 한 번 들어간다. 덧붙이기만 */
export const settlementAdjustments = pgTable(
  "settlement_adjustments",
  {
    id: id(),
    instructorId: uuid()
      .notNull()
      .references(() => instructors.id),
    amount: won().notNull(),
    reason: text().notNull(),
    objectionId: uuid().references(() => settlementObjections.id),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("settlement_adjustments_instructor_idx").on(t.instructorId),
    check("settlement_adjustments_amount_check", sql`${t.amount} <> 0`),
  ],
);

/** 지급 기록 (처음에는 시스템 밖 계좌이체, 일자 · 금액 · 담당자만). 정산 하나에 하나, 덧붙이기만 */
export const payouts = pgTable(
  "payouts",
  {
    id: id(),
    settlementId: uuid()
      .notNull()
      .unique()
      .references(() => settlements.id),
    paidOn: date({ mode: "string" }).notNull(),
    amount: won().notNull(),
    method: text({ enum: ["bank_transfer"] })
      .notNull()
      .default("bank_transfer"),
    recordedBy: uuid()
      .notNull()
      .references(() => users.id),
    memo: text().notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [check("payouts_amount_check", sql`${t.amount} > 0`)],
);
