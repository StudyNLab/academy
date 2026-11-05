// 정산 (M9). docs/사이트구조_화면목록.md 9장 · docs/화면상세기획.md 6장 (I-08).
// DB 를 모르는 순수 함수다. 비율은 만분율 정수(6000 = 60%), 금액은 원 단위 정수, 원 미만은 버린다.
// 세금 처리(원천징수 · 세금계산서)는 기준 설계안이다. 실오픈 전에 세무사 확인을 받는다.
import type { Won } from "../money";
import { assertWon, splitVat } from "../money";
import type { EntitlementLike } from "../learning/entitlement";
import type { LearningRules } from "../learning/learning-time";
import { kstDayRange, LEARNING_RULES_V1 } from "../learning/learning-time";
import { kstMonth } from "../instructor/instructor";

export const BP = 10_000;
/** 최소 지급액. 못 미치면 다음 달로 넘긴다 (9.4) */
export const MIN_PAYOUT: Won = 10_000;
/** 명세 공개 뒤 이의 신청 기간 (일) */
export const OBJECTION_DAYS = 5;
export const STATEMENT_DAY = 10;
export const PAY_DAY = 15;
/** 강사에게 불리한 변경은 이만큼 전에 알린다 (강사 이용약관 3) */
export const UNFAVORABLE_NOTICE_DAYS = 30;

// ---- 달 ----

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonth = (value: string) => MONTH.test(value);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** 그 달의 시작 · 끝 (UTC, KST 1일 0시 ~ 다음 달 1일 0시) */
export function monthRange(month: string): { from: Date; to: Date } {
  return {
    from: new Date(`${month}-01T00:00:00+09:00`),
    to: new Date(`${addMonths(month, 1)}-01T00:00:00+09:00`),
  };
}

const monthIndex = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return y * 12 + (m - 1);
};

const kstDay = (at: Date) => new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

const addDays = (day: string, n: number) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** 마감 · 명세 · 지급 일정 (9.4): 매월 말일 마감, 다음 달 10일 명세, 15일 지급 */
export function settlementSchedule(month: string) {
  const next = addMonths(month, 1);
  return {
    closesOn: addDays(`${next}-01`, -1),
    statementOn: `${next}-${String(STATEMENT_DAY).padStart(2, "0")}`,
    payOn: `${next}-${String(PAY_DAY).padStart(2, "0")}`,
  };
}

/** 이의 신청 마감일 (KST 날짜, 그날 끝까지): 명세 공개일 + 5일 */
export function objectionDeadline(publishedAt: Date): string {
  return addDays(kstDay(publishedAt), OBJECTION_DAYS);
}

export function canObject(publishedAt: Date | null, now: Date): boolean {
  if (!publishedAt) return false;
  return kstDay(now) <= objectionDeadline(publishedAt);
}

// ---- 정산 순서 ----

export type PeriodStatus = "calculated" | "confirmed";

export type CalculateBlock =
  "NOT_CLOSED" | "BEFORE_POLICY" | "CONFIRMED" | "LATER_CONFIRMED" | "OTHER_OPEN" | "NOT_NEXT";

/**
 * 이 달을 계산할 수 있나. 달이 끝났고, 확정한 달의 바로 다음 달이어야 한다 (빠뜨리는 달이 없게).
 * 확정하지 않은 다른 달이 있으면 그 달을 먼저 확정한다 (확정 뒤 환불 · 조정이 어느 달로 갈지 하나로 정해지게).
 * 확정한 달은 다시 계산하지 않는다. 기본 정책이 시행되기 전 달(firstPolicyMonth 앞)은 정산할 매출이 없으므로 계산하지 않는다
 * (실수로 계산해 두면 다음 달 계산이 막힌다).
 */
export function calculateBlock(
  month: string,
  periods: readonly { month: string; status: PeriodStatus }[],
  now: Date,
  firstPolicyMonth: string | null = null,
): CalculateBlock | null {
  if (monthRange(month).to > now) return "NOT_CLOSED";
  if (!firstPolicyMonth || month < firstPolicyMonth) return "BEFORE_POLICY";
  const confirmed = periods
    .filter((p) => p.status === "confirmed")
    .map((p) => p.month)
    .sort();
  if (confirmed.includes(month)) return "CONFIRMED";
  const latest = confirmed.at(-1);
  if (latest && latest > month) return "LATER_CONFIRMED";
  if (periods.some((p) => p.status === "calculated" && p.month !== month)) return "OTHER_OPEN";
  if (latest && addMonths(latest, 1) !== month) return "NOT_NEXT";
  return null;
}

export const CALCULATE_BLOCK_MESSAGE: Record<CalculateBlock, string> = {
  NOT_CLOSED: "아직 끝나지 않은 달은 계산할 수 없습니다 (매월 말일 마감).",
  BEFORE_POLICY: "기본 배분 정책이 시행되기 전 달이라 정산할 매출이 없습니다.",
  CONFIRMED: "확정한 달은 다시 계산할 수 없습니다. 고칠 것은 다음 달 조정으로 넣어 주세요.",
  LATER_CONFIRMED: "그 뒤의 달이 이미 확정되었습니다.",
  OTHER_OPEN: "확정하지 않은 다른 달이 있습니다. 그 달을 먼저 확정해 주세요.",
  NOT_NEXT: "마지막으로 확정한 달의 바로 다음 달부터 계산합니다.",
};

// ---- 배분 정책 버전 (AD-16) ----

export type PolicyScope = "default" | "instructor" | "course";

export interface PolicyVersion {
  id: string;
  scope: PolicyScope;
  scopeId: string | null;
  singleRateBp: number | null;
  subscriptionPoolRateBp: number | null;
  /** 결제에 PG 수수료가 기록되지 않았을 때 쓰는 추정 수수료율 */
  pgFeeRateBp: number | null;
  learningRules: unknown;
  effectiveFrom: Date;
}

export interface ResolvedPolicy {
  singleRateBp: number;
  poolRateBp: number;
  pgFeeRateBp: number;
  learningRules: LearningRules;
  /** 값마다 어느 정책 버전에서 왔나 */
  from: { single: string; pool: string; pgFee: string; learning: string };
}

/** 정책 JSON ➔ 학습 시간 규칙. 모르는 모양이면 기본 규칙 */
export function parseLearningRules(value: unknown): LearningRules {
  if (!value || typeof value !== "object") return LEARNING_RULES_V1;
  const v = value as Partial<LearningRules>;
  const num = (x: unknown, fallback: number) =>
    typeof x === "number" && Number.isFinite(x) && x > 0 ? x : fallback;
  return {
    version: typeof v.version === "string" && v.version ? v.version : LEARNING_RULES_V1.version,
    dailyCapSec: num(v.dailyCapSec, LEARNING_RULES_V1.dailyCapSec),
    bucketSec: num(v.bucketSec, LEARNING_RULES_V1.bucketSec),
    idleStopSec: num(v.idleStopSec, LEARNING_RULES_V1.idleStopSec),
    videoCompleteRatio: num(v.videoCompleteRatio, LEARNING_RULES_V1.videoCompleteRatio),
  };
}

/**
 * 그 시각에 시행 중인 정책. 값마다 가장 좁은 범위(과정 ➔ 강사 ➔ 기본)의 가장 최근 버전을 쓰고,
 * 그 버전에서 비어 있는 값은 넓은 범위로 넘어간다 (과정 예외를 비워 새 버전을 만들면 예외가 풀린다).
 * 시행 중인 기본 정책이 없으면 null (그 매출은 정산할 수 없다).
 */
export function resolvePolicy(
  policies: readonly PolicyVersion[],
  target: { courseId?: string | null; instructorId?: string | null },
  at: Date,
): ResolvedPolicy | null {
  const latest = (scope: PolicyScope, scopeId: string | null) =>
    policies
      .filter((p) => p.scope === scope && p.scopeId === scopeId && p.effectiveFrom <= at)
      .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())
      .at(-1) ?? null;
  const base = latest("default", null);
  if (!base) return null;
  const chain = [
    target.courseId ? latest("course", target.courseId) : null,
    target.instructorId ? latest("instructor", target.instructorId) : null,
    base,
  ].filter((p): p is PolicyVersion => !!p);
  const pick = <K extends "singleRateBp" | "subscriptionPoolRateBp" | "pgFeeRateBp" | "learningRules">(
    key: K,
  ) => chain.find((p) => p[key] !== null && p[key] !== undefined) ?? base;
  const single = pick("singleRateBp");
  const pool = pick("subscriptionPoolRateBp");
  const pgFee = pick("pgFeeRateBp");
  const learning = pick("learningRules");
  return {
    singleRateBp: single.singleRateBp ?? 0,
    poolRateBp: pool.subscriptionPoolRateBp ?? 0,
    pgFeeRateBp: pgFee.pgFeeRateBp ?? 0,
    learningRules: parseLearningRules(learning.learningRules),
    from: { single: single.id, pool: pool.id, pgFee: pgFee.id, learning: learning.id },
  };
}

export type PolicyBlock = "PAST_DATE" | "NEEDS_NOTICE" | "BAD_RATE";

/**
 * 새 정책 버전을 등록할 수 있나. 시행일은 내일(KST 0시) 이후 (이미 생긴 매출에 거꾸로 적용하지 않는다).
 * 강사에게 불리한 변경(비율을 낮추거나 추정 수수료율을 올림)은 30일 뒤부터 시행한다.
 */
export function checkNewPolicy(
  input: {
    effectiveFrom: Date;
    current: { singleRateBp: number; poolRateBp: number; pgFeeRateBp: number } | null;
    next: { singleRateBp?: number | null; poolRateBp?: number | null; pgFeeRateBp?: number | null };
  },
  now: Date,
): { block: PolicyBlock | null; unfavorable: boolean } {
  const rates = [input.next.singleRateBp, input.next.poolRateBp, input.next.pgFeeRateBp];
  if (rates.some((r) => r !== null && r !== undefined && (!Number.isInteger(r) || r < 0 || r > BP)))
    return { block: "BAD_RATE", unfavorable: false };
  const tomorrow = new Date(`${addDays(kstDay(now), 1)}T00:00:00+09:00`);
  if (input.effectiveFrom < tomorrow) return { block: "PAST_DATE", unfavorable: false };
  const c = input.current;
  const n = input.next;
  const set = (x: number | null | undefined): x is number => x !== null && x !== undefined;
  const unfavorable =
    !!c &&
    ((set(n.singleRateBp) && n.singleRateBp < c.singleRateBp) ||
      (set(n.poolRateBp) && n.poolRateBp < c.poolRateBp) ||
      (set(n.pgFeeRateBp) && n.pgFeeRateBp > c.pgFeeRateBp));
  if (unfavorable) {
    const noticeFrom = new Date(`${addDays(kstDay(now), UNFAVORABLE_NOTICE_DAYS)}T00:00:00+09:00`);
    if (input.effectiveFrom < noticeFrom) return { block: "NEEDS_NOTICE", unfavorable };
  }
  return { block: null, unfavorable };
}

// ---- 단건 매출 (9.1) ----

const ratio = (amount: Won, bp: number) => Math.floor((amount * bp) / BP);

/** PG 수수료: 결제에 기록된 값, 없으면 정책의 추정 수수료율 */
export function paymentFee(paid: Won, recordedFee: Won | null, pgFeeRateBp: number) {
  if (recordedFee !== null) return { fee: recordedFee, estimated: false };
  return { fee: ratio(paid, pgFeeRateBp), estimated: true };
}

/** 정산 기준액 = 실제 결제 금액 − 부가세 − 결제 수수료 */
export function settlementBase(paid: Won, vat: Won, fee: Won): Won {
  assertWon(paid);
  assertWon(vat);
  assertWon(fee);
  return Math.max(0, paid - vat - fee);
}

export interface SingleLine {
  paid: Won;
  vat: Won;
  fee: Won;
  feeEstimated: boolean;
  base: Won;
  rateBp: number;
  /** 강사 몫 */
  amount: Won;
}

/** 단건 한 줄: 강사 몫 = 정산 기준액 × 강사 비율 */
export function singleSaleLine(
  sale: { paid: Won; vat: Won; fee: Won | null },
  policy: { singleRateBp: number; pgFeeRateBp: number },
): SingleLine {
  const { fee, estimated } = paymentFee(sale.paid, sale.fee, policy.pgFeeRateBp);
  const base = settlementBase(sale.paid, sale.vat, fee);
  return {
    paid: sale.paid,
    vat: sale.vat,
    fee,
    feeEstimated: estimated,
    base,
    rateBp: policy.singleRateBp,
    amount: ratio(base, policy.singleRateBp),
  };
}

/**
 * 환불 한 줄: 환불액 전체가 아니라 그 환불에 해당하는 **강사 몫**만 뺀다 (I-08).
 * 전액 환불은 판매 줄과 똑같이 계산해 정확히 0 이 되고, 부분 환불은 부가세를 다시 나누고 수수료를 비율로 나눈다.
 * rateBp 는 판매 때의 비율 (판매 시각의 정책).
 */
export function refundLine(sale: SingleLine, refund: Won): SingleLine {
  assertWon(refund);
  if (refund >= sale.paid) return { ...sale, amount: -sale.amount };
  const vat = splitVat(refund).vat;
  const fee = sale.paid > 0 ? Math.floor((sale.fee * refund) / sale.paid) : 0;
  const base = settlementBase(refund, vat, fee);
  return {
    paid: refund,
    vat,
    fee,
    feeEstimated: sale.feeEstimated,
    base,
    rateBp: sale.rateBp,
    amount: -ratio(base, sale.rateBp),
  };
}

/**
 * 금액을 무게(정가) 비율로 나눈다. 원 미만은 버리고 남는 원은 소수점 아래가 큰 순서로 1원씩 (합이 그대로).
 * 패키지(여러 강사 강의 묶음): 각 강의 정가 비율로 결제 금액을 나눈 뒤 단건 계산 (9.1).
 */
export function splitByWeights<K extends string>(
  amount: Won,
  weights: readonly { key: K; weight: number }[],
): { key: K; amount: Won }[] {
  assertWon(amount);
  const total = weights.reduce((n, w) => n + Math.max(0, w.weight), 0);
  if (weights.length === 0) return [];
  if (total <= 0) {
    // 정가가 없으면 똑같이 나눈다
    return splitByWeights(
      amount,
      weights.map((w) => ({ key: w.key, weight: 1 })),
    );
  }
  const raw = weights.map((w, i) => {
    const exact = (BigInt(amount) * BigInt(Math.max(0, w.weight))) / BigInt(total);
    const rem = (BigInt(amount) * BigInt(Math.max(0, w.weight))) % BigInt(total);
    return { i, key: w.key, amount: Number(exact), rem };
  });
  let left = amount - raw.reduce((n, r) => n + r.amount, 0);
  for (const r of [...raw].sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i))) {
    if (left <= 0) break;
    r.amount += 1;
    left -= 1;
  }
  return raw.map((r) => ({ key: r.key, amount: r.amount }));
}

// ---- 구독 매출 (9.2) ----

export interface SubscriptionPayment {
  id: string;
  paidAt: Date;
  paid: Won;
  vat: Won;
  /** 결제에 기록된 PG 수수료 (없으면 추정) */
  fee: Won | null;
  interval: "month" | "year";
  /** 끝난 환불 */
  refunds: readonly { id: string; doneAt: Date; amount: Won }[];
}

export interface SubscriptionPart {
  paymentId: string;
  /** 이 달에 반영하는 구독 기준액 (환불 조정 포함, 마이너스일 수 있다) */
  base: Won;
  /** 그중 환불 조정 */
  refundAdjust: Won;
  rateBp: number;
  policyId: string;
}

/** 연간 구독의 달마다 몫: 12로 나눠 버리고, 남는 원은 마지막 달에 */
function yearlyPortions(base: Won): Won[] {
  const each = Math.floor(base / 12);
  return Array.from({ length: 12 }, (_, i) => (i === 11 ? base - each * 11 : each));
}

/**
 * 한 결제가 이 달 구독 기준액에 더하는 몫.
 *   월 구독: 결제한 달에 전부. 연간 구독: 결제한 달부터 12개월에 나눠 (9.2).
 *   환불: 환불이 끝난 달에 그 환불의 기준액을 뺀다. 연간 구독은 환불한 달 뒤의 몫을 더 반영하지 않고 그 달에 당겨 넣는다
 *   (전체로 보면 결제 기준액 − 환불 기준액이 정확히 반영된다).
 */
export function subscriptionMonthBase(
  payment: SubscriptionPayment,
  month: string,
  pgFeeRateBp: number,
): { base: Won; refundAdjust: Won } {
  const { fee } = paymentFee(payment.paid, payment.fee, pgFeeRateBp);
  const total = settlementBase(payment.paid, payment.vat, fee);
  const start = monthIndex(kstMonth(payment.paidAt));
  const portions = payment.interval === "year" ? yearlyPortions(total) : [total];
  const at = monthIndex(month) - start;
  const refunds = [...payment.refunds].sort((a, b) => a.doneAt.getTime() - b.doneAt.getTime());
  const firstRefund = refunds[0] ? monthIndex(kstMonth(refunds[0].doneAt)) - start : Infinity;

  let base = at >= 0 && at < portions.length && at <= firstRefund ? portions[at]! : 0;
  let refundAdjust = 0;
  if (at === firstRefund) {
    // 아직 반영하지 않은 뒤 달 몫을 이 달에 당겨 넣는다
    refundAdjust += portions.slice(at + 1).reduce((n, p) => n + p, 0);
  }
  for (const refund of refunds) {
    if (kstMonth(refund.doneAt) !== month) continue;
    const r = Math.min(refund.amount, payment.paid);
    const vat = r >= payment.paid ? payment.vat : splitVat(r).vat;
    const rFee = r >= payment.paid ? fee : payment.paid > 0 ? Math.floor((fee * r) / payment.paid) : 0;
    refundAdjust -= settlementBase(r, vat, rFee);
  }
  base += refundAdjust;
  return { base, refundAdjust };
}

/** 0 쪽으로 버림 (마이너스 풀을 강사에게 불리하게 키우지 않게) */
const towardZero = (num: bigint, den: bigint) => Number(num / den);

/**
 * 이 달의 강사 배분 풀 = Σ (각 결제의 이 달 구독 기준액 × 그 결제 시각에 시행 중인 강사 풀 비율) + 지난달에서 넘어온 마이너스.
 * 풀이 0 이하이면 배분하지 않고 그 값을 다음 달 풀로 넘긴다 (구독 환불이 그 달 매출보다 큰 경우).
 */
export function subscriptionPool(
  payments: readonly SubscriptionPayment[],
  month: string,
  policyAt: (at: Date) => ResolvedPolicy | null,
  carryIn: Won = 0,
): { parts: SubscriptionPart[]; base: Won; pool: Won; allocatable: Won; carryOut: Won } {
  const parts: SubscriptionPart[] = [];
  let numerator = 0n;
  for (const payment of payments) {
    const policy = policyAt(payment.paidAt);
    if (!policy) continue;
    const { base, refundAdjust } = subscriptionMonthBase(payment, month, policy.pgFeeRateBp);
    if (base === 0 && refundAdjust === 0) continue;
    parts.push({
      paymentId: payment.id,
      base,
      refundAdjust,
      rateBp: policy.poolRateBp,
      policyId: policy.from.pool,
    });
    numerator += BigInt(base) * BigInt(policy.poolRateBp);
  }
  const base = parts.reduce((n, p) => n + p.base, 0);
  const pool = towardZero(numerator, BigInt(BP));
  const total = pool + carryIn;
  return total > 0
    ? { parts, base, pool, allocatable: total, carryOut: 0 }
    : { parts, base, pool, allocatable: 0, carryOut: total };
}

/**
 * 과정별 배분액 = 강사 배분 풀 × (그 과정의 유효 학습 시간 ÷ 구독 포함 과정 전체의 유효 학습 시간). 원 미만 버림.
 * 아무도 공부하지 않았으면 배분하지 않는다.
 */
export function allocatePool(
  pool: Won,
  seconds: ReadonlyMap<string, number>,
): { courseId: string; seconds: number; shareBp: number; amount: Won }[] {
  const total = [...seconds.values()].reduce((n, s) => n + Math.max(0, s), 0);
  if (pool <= 0 || total <= 0) return [];
  return [...seconds]
    .filter(([, s]) => s > 0)
    .map(([courseId, s]) => ({
      courseId,
      seconds: s,
      shareBp: Math.round((s * BP) / total),
      amount: Number((BigInt(pool) * BigInt(s)) / BigInt(total)),
    }));
}

export type LearningAccess = "subscription" | "course" | "none";

/**
 * 그날(KST) 그 과정을 무엇으로 봤나. 단건 · 발급 · 무료 수강권이 있으면 "course" (D3: 구독 정산 학습 시간에서 뺀다,
 * 강사가 두 번 받지 않게), 아니면 구독 수강권이 있고 구독 포함 과정이면 "subscription".
 */
export function learningAccess(
  entitlements: readonly Pick<EntitlementLike, "scope" | "courseId" | "startsAt" | "endsAt" | "revokedAt">[],
  course: { id: string; inSubscription: boolean },
  day: string,
): LearningAccess {
  const { from, to } = kstDayRange(day);
  const live = entitlements.filter(
    (e) => (!e.revokedAt || e.revokedAt > from) && e.startsAt < to && (!e.endsAt || e.endsAt > from),
  );
  if (live.some((e) => e.scope === "course" && e.courseId === course.id)) return "course";
  if (course.inSubscription && live.some((e) => e.scope === "subscription_catalog")) return "subscription";
  return "none";
}

/** 구독 배분에 쓰는 과정별 유효 학습 시간: 구독으로 본 시간만, 구독 포함 과정만 */
export function subscriptionSeconds(
  rows: readonly { courseId: string; effectiveSec: number; access: LearningAccess }[],
  subscriptionCourses: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.access !== "subscription" || !subscriptionCourses.has(row.courseId)) continue;
    out.set(row.courseId, (out.get(row.courseId) ?? 0) + Math.max(0, row.effectiveSec));
  }
  return out;
}

// ---- 강사 한 명의 한 달 (명세 I-08) ----

export type TaxType = "individual" | "business";

/** 원천징수: 사업소득 3% + 지방소득세(소득세의 10%, 0.3%), 각각 10원 미만 버림 */
export function withholding(gross: Won): { incomeTax: Won; localTax: Won; total: Won } {
  assertWon(gross);
  if (gross <= 0) return { incomeTax: 0, localTax: 0, total: 0 };
  const incomeTax = Math.floor((gross * 3) / 100 / 10) * 10;
  const localTax = Math.floor(incomeTax / 10 / 10) * 10;
  return { incomeTax, localTax, total: incomeTax + localTax };
}

export type HoldReason = "negative" | "below_min" | "no_profile";

export interface StatementInput {
  single: Won;
  subscription: Won;
  /** 환불 차감 (0 이하) */
  refund: Won;
  /** 운영자 조정 (이의 신청 반영 등, 마이너스일 수 있다) */
  adjustment: Won;
  /** 지난달에서 넘어온 금액 (마이너스일 수 있다) */
  carriedIn: Won;
  /** 정산 정보가 없으면 null */
  taxType: TaxType | null;
}

export interface Statement extends StatementInput {
  /** 이번 달 강사 몫 합계 (세전) */
  gross: Won;
  incomeTax: Won;
  localTax: Won;
  withheld: Won;
  /** 사업자: 세금계산서 부가세 (강사 몫의 10%) */
  vat: Won;
  /** 지급 예정액 */
  payout: Won;
  /** 다음 달로 넘기는 금액 (세전) */
  carryOut: Won;
  hold: HoldReason | null;
}

/**
 * 지급 예정액.
 *   합계 = 단건 + 구독 + 환불 차감 + 조정 + 이월
 *   개인: 합계 − 원천징수 3.3% / 사업자: 합계 + 부가세 (강사가 세금계산서 발행)
 *   합계가 0 이하이면 지급하지 않고 그대로 넘긴다 (마이너스 이월). 지급액이 최소 지급액에 못 미치거나
 *   정산 정보가 없으면 세금을 떼지 않고 합계를 넘긴다 (실제로 줄 때 그 달 지급액에서 뗀다).
 */
export function computeStatement(input: StatementInput, minPayout: Won = MIN_PAYOUT): Statement {
  for (const key of ["single", "subscription", "refund", "adjustment", "carriedIn"] as const)
    assertWon(input[key], key);
  const gross = input.single + input.subscription + input.refund + input.adjustment + input.carriedIn;
  const held = (hold: HoldReason): Statement => ({
    ...input,
    gross,
    incomeTax: 0,
    localTax: 0,
    withheld: 0,
    vat: 0,
    payout: 0,
    carryOut: gross,
    hold,
  });
  if (gross <= 0) return { ...held("negative"), hold: gross < 0 ? "negative" : null };
  if (!input.taxType) return held("no_profile");
  const tax = input.taxType === "individual" ? withholding(gross) : { incomeTax: 0, localTax: 0, total: 0 };
  const vat = input.taxType === "business" ? Math.floor(gross / 10) : 0;
  const payout = gross - tax.total + vat;
  if (payout < minPayout) return held("below_min");
  return {
    ...input,
    gross,
    incomeTax: tax.incomeTax,
    localTax: tax.localTax,
    withheld: tax.total,
    vat,
    payout,
    carryOut: 0,
    hold: null,
  };
}

export const HOLD_LABEL: Record<HoldReason, string> = {
  negative: "마이너스 · 다음 달로 넘김",
  below_min: "최소 지급액 미만 · 다음 달로 넘김",
  no_profile: "정산 정보 없음 · 다음 달로 넘김",
};

/** 화면 표시용 비율 13.2% (만분율 ➔ 소수 한 자리) */
export const formatShare = (shareBp: number) => `${(shareBp / 100).toFixed(1)}%`;
