// 가격 · 구독자 할인 (docs/데이터모델.md 3.5). 가격은 고치지 않고 새 버전을 만든다 ➔ 주문은 그때 값을 스냅샷한다.
import type { Won } from "../money";
import { assertWon, splitVat } from "../money";

export interface PriceVersionLike {
  amount: Won;
  effectiveFrom: Date;
}

/** 시행일이 지금 이전인 것 중 가장 늦은 것 (가격 · 할인 정책 공통) */
export function effectiveAt<T extends { effectiveFrom: Date }>(versions: readonly T[], now: Date): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > now) continue;
    if (!best || v.effectiveFrom > best.effectiveFrom) best = v;
  }
  return best;
}

/** 지금 시행 중인 가격. 없으면 판매할 수 없다 */
export const priceAt = <T extends PriceVersionLike>(prices: readonly T[], now: Date): T | null =>
  effectiveAt(prices, now);

export interface DiscountPolicyLike {
  /** 0 ~ 100 (%) */
  ratePercent: number;
  effectiveFrom: Date;
}

export const discountAt = <T extends DiscountPolicyLike>(policies: readonly T[], now: Date): T | null =>
  effectiveAt(policies, now);

/**
 * 구독자 할인을 받나: 구독 중인 사람이 **프리미엄 강의**(구독에 포함되지 않은 과정)를 단건으로 살 때만.
 * 구독 포함 강의는 구독으로 보면 되고, 연장권은 할인하지 않는다 (사이트구조 P-05 · 데이터모델 3.5).
 */
export function subscriberDiscountApplies(input: {
  productType: "course" | "bundle" | "extension";
  premium: boolean;
  subscriber: boolean;
}): boolean {
  return input.subscriber && input.premium && input.productType !== "extension";
}

export interface Quote {
  listPrice: Won;
  discountAmount: Won;
  discountReason: string | null;
  paidAmount: Won;
  supplyAmount: Won;
  vatAmount: Won;
}

/** 주문서 금액. 할인액은 원 미만 버림 (59,000원 25% ➔ 14,750원 할인 ➔ 44,250원) */
export function quote(listPrice: Won, discount: { ratePercent: number; reason: string } | null): Quote {
  assertWon(listPrice, "정가");
  if (listPrice < 0) throw new RangeError(`정가는 0 이상이어야 합니다: ${listPrice}`);
  const rate = discount?.ratePercent ?? 0;
  if (!(Number.isInteger(rate) && rate >= 0 && rate <= 100))
    throw new RangeError(`할인율은 0 ~ 100 사이 정수여야 합니다: ${rate}`);
  const discountAmount = Math.floor((listPrice * rate) / 100);
  const paidAmount = listPrice - discountAmount;
  const { supply, vat } = splitVat(paidAmount);
  return {
    listPrice,
    discountAmount,
    discountReason: discountAmount > 0 ? discount!.reason : null,
    paidAmount,
    supplyAmount: supply,
    vatAmount: vat,
  };
}
