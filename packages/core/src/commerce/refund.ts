// 환불 계산 (화면상세기획 3.1 · 5장 환불 규정). 수강생 화면(M-04)과 운영자 화면(AD-10)이 이 함수 하나를 쓴다.
// 결과는 그대로 refunds.calculation 에 저장한다 (분쟁 때 근거).
//
//   강의 (단건 · 패키지)
//     결제일부터 7일 이내 + 이용 전          ➔ 전액
//     그 밖: 진도율과 지난 기간 중 높은 쪽이
//       1/3 미만                          ➔ 결제 금액의 2/3
//       1/2 미만                          ➔ 결제 금액의 1/2
//       1/2 이상                          ➔ 환불 없음
//     "이용" = 첫 영상 재생 또는 첫 실습 파일 받기 (entitlements.first_used_at)
//   연장권
//     늘어난 기간이 아직 시작 전            ➔ 전액
//     그 밖: 늘어난 기간 중 지난 비율로 위와 같은 단계 (진도율은 원래 기간에 쌓인 것이라 보지 않는다)
import type { Won } from "../money";
import { assertWon } from "../money";
import { kstDaysBetween } from "./period";

export const REFUND_RULE_VERSION = "2026-11-v1";
/** 결제일부터 이 날수까지(그날 끝까지)는 청약 철회 기간 */
export const COOLING_OFF_DAYS = 7;
/** 무제한 상품은 기간 기준을 1년으로 본다 */
export const UNLIMITED_BASIS_DAYS = 365;

export type RefundTier = "full" | "two_thirds" | "half" | "none";

export const REFUND_TIER_LABEL: Record<RefundTier, string> = {
  full: "전액",
  two_thirds: "결제 금액의 2/3",
  half: "결제 금액의 1/2",
  none: "환불 없음",
};

export interface CourseRefundInput {
  kind: "course";
  paidAmount: Won;
  paidAt: Date;
  /** 수강 기간 (일). 없으면 무제한 */
  accessDays: number | null;
  firstUsedAt: Date | null;
  /** 완료한 챕터 · 전체 챕터 (학습 화면의 진도율과 같은 기준) */
  chaptersDone: number;
  chaptersTotal: number;
}

export interface ExtensionRefundInput {
  kind: "extension";
  paidAmount: Won;
  paidAt: Date;
  /** 늘린 날수 */
  accessDays: number;
  /** 늘어난 기간이 시작하는 시각 (연장 전 끝나는 날, 이미 끝났었다면 결제 시각) */
  periodStart: Date;
}

export type RefundInput = CourseRefundInput | ExtensionRefundInput;

export interface RefundCalculation {
  ruleVersion: string;
  kind: "course" | "extension";
  paidAmount: Won;
  paidAt: string;
  calculatedAt: string;
  /** 결제일부터 지난 날 (KST 날짜) */
  daysSincePayment: number;
  coolingOff: boolean;
  used: boolean;
  /** 기간 기준: 지난 날 / 전체 날 */
  elapsedDays: number;
  periodDays: number;
  elapsedPercent: number;
  /** 진도율 (강의만) */
  progressPercent: number | null;
  /** 어느 기준으로 정했나 */
  basis: "cooling_off" | "not_started" | "progress" | "elapsed";
  basisPercent: number;
  tier: RefundTier;
  amount: Won;
  /** 사람이 읽는 계산식 */
  explanation: string;
}

interface Ratio {
  n: number;
  d: number;
}

const percent = (r: Ratio) => (r.d === 0 ? 0 : Math.floor((r.n * 100) / r.d));
/** a < b (분수끼리 정확히 비교: 2/6 은 1/3 과 같다) */
const lessThan = (a: Ratio, b: Ratio) => a.n * b.d < b.n * a.d;

function tierOf(basis: Ratio): RefundTier {
  if (lessThan(basis, { n: 1, d: 3 })) return "two_thirds";
  if (lessThan(basis, { n: 1, d: 2 })) return "half";
  return "none";
}

function amountOf(paid: Won, tier: RefundTier): Won {
  switch (tier) {
    case "full":
      return paid;
    case "two_thirds":
      return Math.floor((paid * 2) / 3);
    case "half":
      return Math.floor(paid / 2);
    case "none":
      return 0;
  }
}

export const REFUND_BAND_LABEL: Record<RefundTier, string> = {
  full: "",
  two_thirds: "1/3 미만",
  half: "1/3 이상 1/2 미만",
  none: "1/2 이상",
};

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export function calculateRefund(input: RefundInput, now: Date): RefundCalculation {
  assertWon(input.paidAmount, "결제 금액");
  const daysSincePayment = Math.max(0, kstDaysBetween(input.paidAt, now));
  const coolingOff = daysSincePayment <= COOLING_OFF_DAYS;
  const base = {
    ruleVersion: REFUND_RULE_VERSION,
    kind: input.kind,
    paidAmount: input.paidAmount,
    paidAt: input.paidAt.toISOString(),
    calculatedAt: now.toISOString(),
    daysSincePayment,
    coolingOff,
  };

  if (input.kind === "extension") {
    const periodDays = input.accessDays;
    const started = input.periodStart <= now;
    const elapsedDays = started ? Math.min(periodDays, kstDaysBetween(input.periodStart, now)) : 0;
    const elapsed = { n: elapsedDays, d: periodDays };
    const tier: RefundTier = started ? tierOf(elapsed) : "full";
    const amount = amountOf(input.paidAmount, tier);
    return {
      ...base,
      used: started,
      elapsedDays,
      periodDays,
      elapsedPercent: percent(elapsed),
      progressPercent: null,
      basis: started ? "elapsed" : "not_started",
      basisPercent: percent(elapsed),
      tier,
      amount,
      explanation: started
        ? `늘어난 기간 ${elapsedDays}일 / ${periodDays}일 (${percent(elapsed)}%, ${REFUND_BAND_LABEL[tier]}) 지남 ➔ ${REFUND_TIER_LABEL[tier]} = ${won(amount)}`
        : `늘어난 기간이 아직 시작되지 않음 ➔ 전액 = ${won(amount)}`,
    };
  }

  const used = input.firstUsedAt !== null && input.firstUsedAt <= now;
  const periodDays = input.accessDays ?? UNLIMITED_BASIS_DAYS;
  const elapsedDays = Math.min(periodDays, daysSincePayment);
  const elapsed = { n: elapsedDays, d: periodDays };
  const progress = {
    n: Math.min(input.chaptersDone, input.chaptersTotal),
    d: Math.max(input.chaptersTotal, 1),
  };
  const common = {
    ...base,
    used,
    elapsedDays,
    periodDays,
    elapsedPercent: percent(elapsed),
    progressPercent: percent(progress),
  };

  if (coolingOff && !used) {
    return {
      ...common,
      basis: "cooling_off",
      basisPercent: 0,
      tier: "full",
      amount: input.paidAmount,
      explanation: `결제일부터 ${daysSincePayment}일 (7일 이내) · 이용 전 ➔ 전액 = ${won(input.paidAmount)}`,
    };
  }

  const byProgress = !lessThan(progress, elapsed); // 같으면 진도율로 적는다
  const basisRatio = byProgress ? progress : elapsed;
  const tier = tierOf(basisRatio);
  const amount = amountOf(input.paidAmount, tier);
  const why = coolingOff ? "7일 이내지만 이용함" : `결제일부터 ${daysSincePayment}일 (7일 지남)`;
  return {
    ...common,
    basis: byProgress ? "progress" : "elapsed",
    basisPercent: percent(basisRatio),
    tier,
    amount,
    explanation:
      `${why} ➔ 진도율 ${percent(progress)}% 와 지난 기간 ${elapsedDays}/${periodDays}일 (${percent(elapsed)}%) 중 높은 쪽 ` +
      `${percent(basisRatio)}% (${REFUND_BAND_LABEL[tier]}) ➔ ${REFUND_TIER_LABEL[tier]} = ${won(amount)}`,
  };
}
