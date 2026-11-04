// 구독 (docs/기술설계.md 6.2, 데이터모델 3.7): 회차 기간 · 결제일 · 실패 재시도 · 갱신 · 가격 변경 알림 · 중도 해지 환불.
// 날짜는 KST 로 센다. 가입한 날(KST)이 기준일이고, 회차 n 은 기준일 + (n-1) 달(년)에 결제한다.
//   회차 n 의 이용 기간 = [회차 시작, 다음 결제일 그날 끝)  ➔ 다음 결제를 그날 안에 하므로 끊기지 않는다
import type { Won } from "../money";
import { assertWon } from "../money";
import { kstDayRange } from "../learning/learning-time";
import { kstDaysBetween } from "./period";

export type BillingInterval = "month" | "year";

export const INTERVAL_LABEL: Record<BillingInterval, string> = { month: "월간", year: "연간" };

/** KST 날짜(YYYY-MM-DD)에 n 달 · 년을 더한다. 그달에 그날이 없으면 그달 마지막 날 (1월 31일 + 1달 = 2월 28 · 29일) */
export function addInterval(day: string, interval: BillingInterval, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const months = (interval === "year" ? 12 : 1) * n;
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day2 = Math.min(d, last);
  return `${year}-${String(month).padStart(2, "0")}-${String(day2).padStart(2, "0")}`;
}

/** 회차 n 의 결제일 (KST 날짜). 1회차 = 가입한 날 */
export const billingDateOf = (anchor: string, interval: BillingInterval, cycleNo: number) =>
  addInterval(anchor, interval, cycleNo - 1);

/** 회차 n 이 끝나는 시각 = 다음 결제일 그날 끝 (다음 날 0시 KST) */
export const periodEndOf = (anchor: string, interval: BillingInterval, cycleNo: number) =>
  kstDayRange(billingDateOf(anchor, interval, cycleNo + 1)).to;

/** 결제 실패 뒤 다시 시도하는 날: 결제일 + 1 · 3 · 7일. 마지막까지 실패하면 구독이 끝난다 */
export const RETRY_OFFSETS = [1, 3, 7] as const;

/** 다음 재시도 시각 (그날 0시 KST, worker 가 그날 처음 돌 때 시도). 다 썼으면 null */
export function nextRetryAt(billingDate: string, retriesDone: number): Date | null {
  const offset = RETRY_OFFSETS[retriesDone];
  if (offset === undefined) return null;
  return kstDayRange(addDays(billingDate, offset)).from;
}

/** 결제 실패 중에도 볼 수 있는 기한: 마지막 재시도 날 끝까지 */
export const graceEndOf = (billingDate: string) =>
  kstDayRange(addDays(billingDate, RETRY_OFFSETS[RETRY_OFFSETS.length - 1]!)).to;

function addDays(day: string, n: number): string {
  return new Date(kstDayRange(day).from.getTime() + n * 86_400_000 + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 갱신 안내 메일: 연간은 30일 전, 월간은 7일 전 */
export const RENEWAL_NOTICE_DAYS: Record<BillingInterval, number> = { year: 30, month: 7 };
/** 가격을 올릴 때는 결제일 30일 전까지 알리고 동의를 받아야 그 회차부터 새 가격 (화면상세기획 C-04) */
export const PRICE_INCREASE_NOTICE_DAYS = 30;

/**
 * 가격이 바뀌었을 때 새 가격을 적용할 첫 회차.
 *   내림 ➔ 다음 회차부터 (알림만)
 *   올림 ➔ 결제일이 지금부터 30일 이상 남은 첫 회차부터, 수강생이 동의해야 적용 (동의가 없으면 그 회차에 구독이 끝난다)
 */
export function priceChangeCycle(input: {
  anchor: string;
  interval: BillingInterval;
  currentCycle: number;
  oldAmount: Won;
  newAmount: Won;
  now: Date;
}): { cycle: number; needsConsent: boolean } | null {
  if (input.newAmount === input.oldAmount) return null;
  const next = input.currentCycle + 1;
  if (input.newAmount < input.oldAmount) return { cycle: next, needsConsent: false };
  let cycle = next;
  while (
    kstDayRange(billingDateOf(input.anchor, input.interval, cycle)).from.getTime() - input.now.getTime() <
    PRICE_INCREASE_NOTICE_DAYS * 86_400_000
  )
    cycle += 1;
  return { cycle, needsConsent: true };
}

// ---- 중도 해지 환불 ----
//   이번 회차 결제일부터 7일 이내 + 이번 회차에 이용 전 ➔ 전액
//   그 밖 ➔ 남은 날 일할 − 위약금(결제 금액의 10%), 0 아래면 0
//   (콘텐츠이용자보호지침의 계속거래 중도 해지 기준. 실오픈 전 법률 검토, 개발계획 M10)

export const SUBSCRIPTION_REFUND_RULE_VERSION = "2026-11-sub-v1";
export const SUBSCRIPTION_PENALTY_PERCENT = 10;

export interface SubscriptionRefundCalculation {
  ruleVersion: string;
  kind: "subscription";
  paidAmount: Won;
  paidAt: string;
  calculatedAt: string;
  daysSincePayment: number;
  coolingOff: boolean;
  used: boolean;
  periodDays: number;
  usedDays: number;
  remainingDays: number;
  penalty: Won;
  basis: "cooling_off" | "pro_rata";
  tier: "full" | "pro_rata" | "none";
  amount: Won;
  explanation: string;
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export function calculateSubscriptionRefund(
  input: {
    paidAmount: Won;
    paidAt: Date;
    periodStart: Date;
    periodEnd: Date;
    /** 이번 회차 기간에 학습(영상 · 교재 · 첨부)을 했나 */
    usedInCycle: boolean;
  },
  now: Date,
): SubscriptionRefundCalculation {
  assertWon(input.paidAmount, "결제 금액");
  const daysSincePayment = Math.max(0, kstDaysBetween(input.paidAt, now));
  const coolingOff = daysSincePayment <= 7;
  const periodDays = Math.max(1, kstDaysBetween(input.periodStart, input.periodEnd));
  // 오늘까지 쓴 것으로 센다
  const usedDays = Math.min(periodDays, Math.max(0, kstDaysBetween(input.periodStart, now) + 1));
  const remainingDays = periodDays - usedDays;
  const base = {
    ruleVersion: SUBSCRIPTION_REFUND_RULE_VERSION,
    kind: "subscription" as const,
    paidAmount: input.paidAmount,
    paidAt: input.paidAt.toISOString(),
    calculatedAt: now.toISOString(),
    daysSincePayment,
    coolingOff,
    used: input.usedInCycle,
    periodDays,
    usedDays,
    remainingDays,
  };
  if (coolingOff && !input.usedInCycle)
    return {
      ...base,
      penalty: 0,
      basis: "cooling_off",
      tier: "full",
      amount: input.paidAmount,
      explanation: `결제일부터 ${daysSincePayment}일 (7일 이내) · 이번 회차 이용 전 ➔ 전액 = ${won(input.paidAmount)}`,
    };
  const prorated = Math.floor((input.paidAmount * remainingDays) / periodDays);
  const penalty = Math.floor((input.paidAmount * SUBSCRIPTION_PENALTY_PERCENT) / 100);
  const amount = Math.max(0, prorated - penalty);
  return {
    ...base,
    penalty,
    basis: "pro_rata",
    tier: amount > 0 ? "pro_rata" : "none",
    amount,
    explanation:
      `남은 ${remainingDays}일 / ${periodDays}일 일할 ${won(prorated)} − 위약금 ${SUBSCRIPTION_PENALTY_PERCENT}% ${won(penalty)}` +
      ` = ${won(amount)}`,
  };
}
