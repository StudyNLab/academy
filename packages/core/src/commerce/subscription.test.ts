import { describe, expect, it } from "vitest";
import {
  addInterval,
  billingDateOf,
  calculateSubscriptionRefund,
  graceEndOf,
  nextRetryAt,
  periodEndOf,
  priceChangeCycle,
} from "./subscription";

const kst = (s: string) => new Date(`${s}+09:00`);
const DAY = 86_400_000;

describe("구독 회차 · 결제일", () => {
  it("달 · 년 더하기 (없는 날은 그달 마지막 날)", () => {
    expect(addInterval("2026-11-04", "month", 1)).toBe("2026-12-04");
    expect(addInterval("2026-11-04", "month", 2)).toBe("2027-01-04");
    expect(addInterval("2027-01-31", "month", 1)).toBe("2027-02-28");
    expect(addInterval("2028-01-31", "month", 1)).toBe("2028-02-29");
    expect(addInterval("2027-01-31", "month", 2)).toBe("2027-03-31"); // 기준일을 지킨다
    expect(addInterval("2028-02-29", "year", 1)).toBe("2029-02-28");
  });

  it("회차 결제일과 끝나는 시각: 다음 결제일 그날 끝까지 이용", () => {
    expect(billingDateOf("2026-11-03", "year", 1)).toBe("2026-11-03");
    expect(billingDateOf("2026-11-03", "year", 2)).toBe("2027-11-03"); // 화면상세기획 C-04 예시
    expect(periodEndOf("2026-11-03", "year", 1)).toEqual(kst("2027-11-04T00:00:00"));
    expect(periodEndOf("2026-11-04", "month", 1)).toEqual(kst("2026-12-05T00:00:00"));
  });

  it("실패 재시도: 결제일 + 1 · 3 · 7일, 그 뒤 없음. 그동안 볼 수 있는 기한은 7일째 끝", () => {
    expect(nextRetryAt("2026-12-04", 0)).toEqual(kst("2026-12-05T00:00:00"));
    expect(nextRetryAt("2026-12-04", 1)).toEqual(kst("2026-12-07T00:00:00"));
    expect(nextRetryAt("2026-12-04", 2)).toEqual(kst("2026-12-11T00:00:00"));
    expect(nextRetryAt("2026-12-04", 3)).toBeNull();
    expect(graceEndOf("2026-12-04")).toEqual(kst("2026-12-12T00:00:00"));
  });
});

describe("가격 변경", () => {
  const base = { anchor: "2026-11-04", interval: "month" as const, currentCycle: 1, oldAmount: 19_900 };

  it("내리면 다음 회차부터, 동의 필요 없음", () => {
    expect(priceChangeCycle({ ...base, newAmount: 15_900, now: kst("2026-11-20T10:00:00") })).toEqual({
      cycle: 2,
      needsConsent: false,
    });
  });

  it("올리면 30일 이상 남은 첫 회차부터, 동의 필요", () => {
    // 2회차 결제일 12-04 는 14일 남음 ➔ 3회차(2027-01-04, 45일 남음)부터
    expect(priceChangeCycle({ ...base, newAmount: 24_900, now: kst("2026-11-20T10:00:00") })).toEqual({
      cycle: 3,
      needsConsent: true,
    });
    // 가입 직후면 2회차(30일 뒤)부터
    expect(priceChangeCycle({ ...base, newAmount: 24_900, now: kst("2026-11-04T00:00:00") })).toEqual({
      cycle: 2,
      needsConsent: true,
    });
  });

  it("같으면 없음", () => {
    expect(priceChangeCycle({ ...base, newAmount: 19_900, now: new Date() })).toBeNull();
  });
});

describe("구독 중도 해지 환불", () => {
  const paidAt = kst("2026-11-04T10:00:00");
  const year = { paidAmount: 199_000, paidAt, periodStart: paidAt, periodEnd: kst("2027-11-05T00:00:00") };

  it("결제일부터 7일 이내 + 이번 회차 이용 전 ➔ 전액", () => {
    const r = calculateSubscriptionRefund(
      { ...year, usedInCycle: false },
      new Date(paidAt.getTime() + 7 * DAY),
    );
    expect(r).toMatchObject({ tier: "full", amount: 199_000, basis: "cooling_off" });
  });

  it("7일 이내라도 이용했으면 일할 − 위약금 10%", () => {
    const r = calculateSubscriptionRefund(
      { ...year, usedInCycle: true },
      new Date(paidAt.getTime() + 2 * DAY),
    );
    // 기간 366일(11-04 ~ 다음 해 11-04 끝), 쓴 날 3일, 남은 363일
    expect(r).toMatchObject({ periodDays: 366, usedDays: 3, remainingDays: 363, penalty: 19_900 });
    expect(r.amount).toBe(Math.floor((199_000 * 363) / 366) - 19_900);
  });

  it("8일째부터는 이용 전이어도 일할", () => {
    const r = calculateSubscriptionRefund(
      { ...year, usedInCycle: false },
      new Date(paidAt.getTime() + 8 * DAY),
    );
    expect(r.basis).toBe("pro_rata");
  });

  it("월간 끝 무렵: 일할이 위약금보다 적으면 0 (환불 없음)", () => {
    const month = { paidAmount: 19_900, paidAt, periodStart: paidAt, periodEnd: kst("2026-12-05T00:00:00") };
    const r = calculateSubscriptionRefund({ ...month, usedInCycle: true }, kst("2026-12-03T10:00:00"));
    expect(r).toMatchObject({ remainingDays: 1, tier: "none", amount: 0 });
  });
});
