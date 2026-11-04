import { describe, expect, it } from "vitest";
import { endOfKstDayAfter, expiryReminderDue, extendedEnd, kstDaysBetween, revertedEnd } from "./period";
import { discountAt, priceAt, quote, subscriberDiscountApplies } from "./pricing";
import type { CourseRefundInput } from "./refund";
import { calculateRefund } from "./refund";

const DAY = 86_400_000;
/** KST 시각 */
const kst = (s: string) => new Date(`${s}+09:00`);

describe("가격 버전 · 구독자 할인 (AD-07)", () => {
  const prices = [
    { id: "p1", amount: 59_000, effectiveFrom: kst("2026-11-01T00:00:00") },
    { id: "p2", amount: 69_000, effectiveFrom: kst("2026-12-01T00:00:00") },
  ];

  it("시행일이 지난 것 중 가장 늦은 가격", () => {
    expect(priceAt(prices, kst("2026-11-15T12:00:00"))?.id).toBe("p1");
    expect(priceAt(prices, kst("2026-12-01T00:00:00"))?.id).toBe("p2");
    expect(priceAt(prices, kst("2026-10-31T23:59:59"))).toBeNull();
  });

  it("할인 정책도 시행일로 고른다", () => {
    const policies = [
      { ratePercent: 25, effectiveFrom: kst("2026-11-01T00:00:00") },
      { ratePercent: 30, effectiveFrom: kst("2027-01-01T00:00:00") },
    ];
    expect(discountAt(policies, kst("2026-12-31T23:00:00"))?.ratePercent).toBe(25);
    expect(discountAt(policies, kst("2027-01-01T00:00:00"))?.ratePercent).toBe(30);
  });

  it("주문서 예시: 59,000원 · 구독자 25% ➔ 44,250원 (공급가액 40,227 · 부가세 4,023)", () => {
    expect(quote(59_000, { ratePercent: 25, reason: "구독자 할인 25%" })).toEqual({
      listPrice: 59_000,
      discountAmount: 14_750,
      discountReason: "구독자 할인 25%",
      paidAmount: 44_250,
      supplyAmount: 40_227,
      vatAmount: 4_023,
    });
  });

  it("할인 없음 · 원 미만 버림 · 잘못된 값", () => {
    expect(quote(59_000, null)).toMatchObject({
      discountAmount: 0,
      discountReason: null,
      paidAmount: 59_000,
    });
    expect(quote(10_001, { ratePercent: 25, reason: "x" })).toMatchObject({
      discountAmount: 2_500,
      paidAmount: 7_501,
    });
    expect(() => quote(1000.5, null)).toThrow(RangeError);
    expect(() => quote(1000, { ratePercent: 101, reason: "x" })).toThrow(RangeError);
  });

  it("구독자 할인은 구독자가 프리미엄 강의를 살 때만 (연장권 제외)", () => {
    expect(subscriberDiscountApplies({ productType: "course", premium: true, subscriber: true })).toBe(true);
    expect(subscriberDiscountApplies({ productType: "course", premium: false, subscriber: true })).toBe(
      false,
    );
    expect(subscriberDiscountApplies({ productType: "course", premium: true, subscriber: false })).toBe(
      false,
    );
    expect(subscriberDiscountApplies({ productType: "extension", premium: true, subscriber: true })).toBe(
      false,
    );
  });
});

describe("수강 기간 · 연장권", () => {
  it("결제일부터 1년: 2026-11-03 ➔ 2027-11-03 까지 (2027-11-04 0시 KST)", () => {
    expect(endOfKstDayAfter(kst("2026-11-03T15:20:00"), 365)).toEqual(kst("2027-11-04T00:00:00"));
    expect(endOfKstDayAfter(kst("2026-11-03T23:59:59"), 1)).toEqual(kst("2026-11-05T00:00:00"));
  });

  it("KST 날짜 차이", () => {
    expect(kstDaysBetween(kst("2026-11-03T23:59:00"), kst("2026-11-04T00:01:00"))).toBe(1);
    expect(kstDaysBetween(kst("2026-11-03T00:00:00"), kst("2026-11-03T23:59:00"))).toBe(0);
  });

  it("이용 중이면 끝나는 날에 이어 붙인다", () => {
    const end = kst("2026-12-01T00:00:00");
    expect(extendedEnd(end, kst("2026-11-04T10:00:00"), 90)).toEqual(new Date(end.getTime() + 90 * DAY));
  });

  it("이미 끝났으면 오늘부터", () => {
    expect(extendedEnd(kst("2026-10-01T00:00:00"), kst("2026-11-04T10:00:00"), 90)).toEqual(
      endOfKstDayAfter(kst("2026-11-04T10:00:00"), 90),
    );
  });

  it("무제한은 연장할 수 없다", () => {
    expect(() => extendedEnd(null, new Date(), 90)).toThrow(RangeError);
  });

  it("연장권 환불은 늘린 날을 거두고, 이미 지났으면 지금 끝난다", () => {
    const now = kst("2026-11-04T10:00:00");
    const end = kst("2027-03-01T00:00:00");
    expect(revertedEnd(end, 90, now)).toEqual(new Date(end.getTime() - 90 * DAY));
    expect(revertedEnd(kst("2026-12-01T00:00:00"), 90, now)).toEqual(now);
  });
});

describe("만료 알림 D-30 · D-7", () => {
  const now = kst("2026-11-04T09:00:00");
  const e = (endsAt: Date | null, sent: { d30?: boolean; d7?: boolean } = {}) => ({
    endsAt,
    remindedD30At: sent.d30 ? now : null,
    remindedD7At: sent.d7 ? now : null,
    revokedAt: null,
  });

  it.each([
    ["31일 남음", 31, {}, null],
    ["30일 남음", 30, {}, "d30"],
    ["30일 남음 · 이미 보냄", 30, { d30: true }, null],
    ["8일 남음", 8, {}, "d30"],
    ["7일 남음", 7, { d30: true }, "d7"],
    ["7일 남음 · D-30 을 못 보냈어도 D-7 만", 7, {}, "d7"],
    ["1일 남음 · 이미 D-7 보냄", 1, { d30: true, d7: true }, null],
  ] as const)("%s", (_, days, sent, expected) => {
    expect(expiryReminderDue(e(new Date(now.getTime() + days * DAY), sent), now)).toBe(expected);
  });

  it("무제한 · 끝남 · 회수는 보내지 않는다", () => {
    expect(expiryReminderDue(e(null), now)).toBeNull();
    expect(expiryReminderDue(e(new Date(now.getTime() - 1)), now)).toBeNull();
    expect(expiryReminderDue({ ...e(new Date(now.getTime() + 5 * DAY)), revokedAt: now }, now)).toBeNull();
  });
});

// 환불 규정 (화면상세기획 3.1 주문서 · 5장 환불 요청): 표의 모든 경우
describe("환불 계산 (규정 표 전부)", () => {
  const paidAt = kst("2026-11-03T14:00:00");
  const course = (over: Partial<CourseRefundInput> = {}): CourseRefundInput => ({
    kind: "course",
    paidAmount: 44_250,
    paidAt,
    accessDays: 365,
    firstUsedAt: null,
    chaptersDone: 0,
    chaptersTotal: 6,
    ...over,
  });
  const at = (days: number, time = "10:00:00") => new Date(kst(`2026-11-03T${time}`).getTime() + days * DAY);

  it("7일 이내 + 이용 전 ➔ 전액 (결제 당일 · 7일째 마지막 시각)", () => {
    for (const now of [at(0, "15:00:00"), at(7, "23:59:59")]) {
      const r = calculateRefund(course(), now);
      expect(r).toMatchObject({ tier: "full", amount: 44_250, basis: "cooling_off", coolingOff: true });
    }
  });

  it("8일째부터는 이용 전이라도 기간 기준 (8/365 ➔ 2/3)", () => {
    const r = calculateRefund(course(), at(8));
    expect(r).toMatchObject({ coolingOff: false, used: false, tier: "two_thirds", amount: 29_500 });
    expect(r.basis).toBe("elapsed");
  });

  it("7일 이내라도 이용했으면 (첫 재생 · 첫 실습 파일) 단계 계산", () => {
    const r = calculateRefund(course({ firstUsedAt: at(1) }), at(2));
    expect(r).toMatchObject({ coolingOff: true, used: true, tier: "two_thirds", amount: 29_500 });
  });

  it("진도 1/3 미만 ➔ 2/3", () => {
    const r = calculateRefund(course({ firstUsedAt: at(1), chaptersDone: 1 }), at(10));
    expect(r).toMatchObject({ tier: "two_thirds", amount: 29_500, basis: "progress", progressPercent: 16 });
  });

  it("진도 정확히 1/3 (2/6) ➔ 1/2 (1/3 미만이 아니다)", () => {
    const r = calculateRefund(course({ firstUsedAt: at(1), chaptersDone: 2 }), at(10));
    expect(r).toMatchObject({ tier: "half", amount: 22_125, basis: "progress" });
  });

  it("화면 예시: 41일 지남 (11%) · 진도 38% ➔ 높은 쪽 진도 ➔ 1/2 = 22,125원", () => {
    const r = calculateRefund(
      course({ firstUsedAt: at(1), chaptersDone: 3, chaptersTotal: 8 }), // 37.5%
      at(41),
    );
    expect(r).toMatchObject({
      elapsedDays: 41,
      elapsedPercent: 11,
      progressPercent: 37,
      basis: "progress",
      tier: "half",
      amount: 22_125,
    });
  });

  it("진도 1/2 이상 ➔ 환불 없음 (정확히 1/2 포함)", () => {
    expect(calculateRefund(course({ firstUsedAt: at(1), chaptersDone: 3 }), at(10))).toMatchObject({
      tier: "none",
      amount: 0,
    });
    expect(calculateRefund(course({ firstUsedAt: at(1), chaptersDone: 6 }), at(10)).tier).toBe("none");
  });

  it("기간이 진도보다 높으면 기간 기준: 1/3 미만 · 1/2 미만 · 1/2 이상", () => {
    const used = { firstUsedAt: at(1) };
    // 365일의 1/3 = 121.67일, 1/2 = 182.5일
    expect(calculateRefund(course(used), at(121))).toMatchObject({ basis: "elapsed", tier: "two_thirds" });
    expect(calculateRefund(course(used), at(122))).toMatchObject({ basis: "elapsed", tier: "half" });
    expect(calculateRefund(course(used), at(182))).toMatchObject({ tier: "half", amount: 22_125 });
    expect(calculateRefund(course(used), at(183))).toMatchObject({ tier: "none", amount: 0 });
  });

  it("짧은 기간 상품 (90일): 30일째 = 정확히 1/3 ➔ 1/2", () => {
    const r = calculateRefund(course({ accessDays: 90, firstUsedAt: at(1) }), at(30));
    expect(r).toMatchObject({ elapsedDays: 30, periodDays: 90, tier: "half" });
    expect(calculateRefund(course({ accessDays: 90, firstUsedAt: at(1) }), at(29)).tier).toBe("two_thirds");
  });

  it("무제한 상품은 기간 기준을 1년으로 본다", () => {
    const r = calculateRefund(course({ accessDays: null, firstUsedAt: at(1) }), at(200));
    expect(r).toMatchObject({ periodDays: 365, tier: "none" });
  });

  it("홀수 금액은 원 미만 버림 (2/3 · 1/2)", () => {
    expect(calculateRefund(course({ paidAmount: 59_001, firstUsedAt: at(1) }), at(10)).amount).toBe(39_334);
    expect(
      calculateRefund(course({ paidAmount: 59_001, firstUsedAt: at(1), chaptersDone: 2 }), at(10)).amount,
    ).toBe(29_500);
  });

  it("계산 근거를 저장할 수 있게 모두 담는다", () => {
    const r = calculateRefund(course({ firstUsedAt: at(1), chaptersDone: 1 }), at(10));
    expect(r.ruleVersion).toBe("2026-11-v1");
    expect(r.explanation).toContain("2/3");
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  describe("연장권", () => {
    const ext = (periodStart: Date) =>
      ({ kind: "extension", paidAmount: 17_700, paidAt, accessDays: 90, periodStart }) as const;

    it("늘어난 기간이 아직 시작 전 ➔ 전액 (7일이 지났어도)", () => {
      expect(calculateRefund(ext(at(60)), at(20))).toMatchObject({
        tier: "full",
        amount: 17_700,
        basis: "not_started",
      });
    });

    it("늘어난 기간이 시작됨 ➔ 지난 비율 단계", () => {
      expect(calculateRefund(ext(at(0)), at(29))).toMatchObject({
        basis: "elapsed",
        tier: "two_thirds",
        amount: 11_800,
      });
      expect(calculateRefund(ext(at(0)), at(30))).toMatchObject({ tier: "half", amount: 8_850 });
      expect(calculateRefund(ext(at(0)), at(45))).toMatchObject({ tier: "none", amount: 0 });
    });
  });
});
