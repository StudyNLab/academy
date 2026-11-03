// 금액은 모두 원 단위 정수다 (docs/데이터모델.md 1장).

/** 원 단위 금액. 소수가 들어오면 계산 실수이므로 바로 멈춘다. */
export type Won = number;

export function assertWon(value: number, label = "금액"): asserts value is Won {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label}은(는) 원 단위 정수여야 합니다: ${value}`);
  }
}

export interface VatSplit {
  /** 공급가액 */
  supply: Won;
  /** 부가세 */
  vat: Won;
}

/**
 * 부가세 포함 금액을 공급가액과 부가세로 나눈다 (세율 10%).
 * 공급가액 = round(총액 / 1.1), 부가세 = 총액 − 공급가액.
 * 합이 항상 총액과 같도록 부가세를 나머지로 계산한다.
 */
export function splitVat(total: Won): VatSplit {
  assertWon(total, "총액");
  if (total < 0) {
    throw new RangeError(`총액은 0 이상이어야 합니다: ${total}`);
  }
  // 정수 연산으로 반올림: round(total * 10 / 11)
  const supply = Math.floor((total * 10 + 5) / 11);
  return { supply, vat: total - supply };
}

/** 금액에 비율을 곱하고 원 미만은 버린다 (정산 · 환불 계산 공통 규칙). */
export function applyRate(amount: Won, rate: number): Won {
  assertWon(amount);
  if (!(rate >= 0 && rate <= 1)) {
    throw new RangeError(`비율은 0 ~ 1 사이여야 합니다: ${rate}`);
  }
  return Math.floor(amount * rate);
}
