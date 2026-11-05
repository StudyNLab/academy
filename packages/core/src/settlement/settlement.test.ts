// 정산 정책 (docs/사이트구조_화면목록.md 9장) 의 예시와 규칙을 하나씩 테스트로 옮긴다.
// 화면 예시 숫자는 docs/화면상세기획.md 6장 (I-08).
import { describe, expect, it } from "vitest";
import { splitVat } from "../money";
import { LEARNING_RULES_V1 } from "../learning/learning-time";
import type { PolicyVersion, SubscriptionPayment } from "./settlement";
import {
  addMonths,
  allocatePool,
  calculateBlock,
  canObject,
  checkNewPolicy,
  computeStatement,
  formatShare,
  learningAccess,
  MIN_PAYOUT,
  monthRange,
  objectionDeadline,
  parseLearningRules,
  refundLine,
  resolvePolicy,
  settlementSchedule,
  singleSaleLine,
  splitByWeights,
  subscriptionMonthBase,
  subscriptionPool,
  subscriptionSeconds,
  withholding,
} from "./settlement";

const kst = (s: string) => new Date(`${s}+09:00`);

const v1: PolicyVersion = {
  id: "p-default-v1",
  scope: "default",
  scopeId: null,
  singleRateBp: 6000,
  subscriptionPoolRateBp: 5000,
  pgFeeRateBp: 340,
  learningRules: LEARNING_RULES_V1,
  effectiveFrom: kst("2026-11-01T00:00:00"),
};

describe("9장 머리말: 정책 버전 · 시행일", () => {
  const v2: PolicyVersion = {
    ...v1,
    id: "p-default-v2",
    singleRateBp: 6500,
    effectiveFrom: kst("2027-01-01T00:00:00"),
  };

  it("시행일 이후 매출만 새 정책을 따른다 (시행일 0시 경계)", () => {
    const policies = [v1, v2];
    expect(resolvePolicy(policies, {}, kst("2026-12-31T23:59:59"))!.singleRateBp).toBe(6000);
    expect(resolvePolicy(policies, {}, kst("2027-01-01T00:00:00"))!.singleRateBp).toBe(6500);
  });

  it("어떤 정책 버전에서 왔는지 값마다 남긴다", () => {
    const r = resolvePolicy([v1, v2], {}, kst("2027-02-01T00:00:00"))!;
    expect(r.from).toEqual({
      single: "p-default-v2",
      pool: "p-default-v2",
      pgFee: "p-default-v2",
      learning: "p-default-v2",
    });
  });

  it("시행 중인 기본 정책이 없는 매출은 정산할 수 없다 (null)", () => {
    expect(resolvePolicy([v1], {}, kst("2026-10-31T23:59:59"))).toBeNull();
  });

  it("새 버전 등록: 시행일은 내일 0시 이후만", () => {
    const now = kst("2026-11-05T15:00:00");
    const current = { singleRateBp: 6000, poolRateBp: 5000, pgFeeRateBp: 340 };
    expect(
      checkNewPolicy(
        { effectiveFrom: kst("2026-11-05T23:00:00"), current, next: { singleRateBp: 7000 } },
        now,
      ).block,
    ).toBe("PAST_DATE");
    expect(
      checkNewPolicy(
        { effectiveFrom: kst("2026-11-06T00:00:00"), current, next: { singleRateBp: 7000 } },
        now,
      ),
    ).toEqual({
      block: null,
      unfavorable: false,
    });
  });

  it("강사에게 불리한 변경(비율 내림 · 수수료율 올림)은 30일 전에 알린다", () => {
    const now = kst("2026-11-05T15:00:00");
    const current = { singleRateBp: 6000, poolRateBp: 5000, pgFeeRateBp: 340 };
    const lower = { singleRateBp: 5500 };
    expect(checkNewPolicy({ effectiveFrom: kst("2026-12-04T00:00:00"), current, next: lower }, now)).toEqual({
      block: "NEEDS_NOTICE",
      unfavorable: true,
    });
    expect(checkNewPolicy({ effectiveFrom: kst("2026-12-05T00:00:00"), current, next: lower }, now)).toEqual({
      block: null,
      unfavorable: true,
    });
    expect(
      checkNewPolicy({ effectiveFrom: kst("2026-11-10T00:00:00"), current, next: { pgFeeRateBp: 400 } }, now)
        .block,
    ).toBe("NEEDS_NOTICE");
    expect(
      checkNewPolicy({ effectiveFrom: kst("2026-11-10T00:00:00"), current, next: { poolRateBp: 4000 } }, now)
        .block,
    ).toBe("NEEDS_NOTICE");
    expect(
      checkNewPolicy(
        { effectiveFrom: kst("2026-11-10T00:00:00"), current, next: { singleRateBp: 10001 } },
        now,
      ).block,
    ).toBe("BAD_RATE");
  });

  it("학습 시간 규칙도 정책 버전 (모르는 값은 기본 규칙)", () => {
    expect(
      parseLearningRules({ ...LEARNING_RULES_V1, version: "2027-01-v2", dailyCapSec: 7200 }).dailyCapSec,
    ).toBe(7200);
    expect(parseLearningRules(null)).toEqual(LEARNING_RULES_V1);
    expect(parseLearningRules({ dailyCapSec: -1 }).dailyCapSec).toBe(LEARNING_RULES_V1.dailyCapSec);
  });
});

describe("9.1 단건 매출", () => {
  it("I-08 예시: 결제 44,250원 ➔ 정산 기준액 39,422원 ➔ 60% ➔ 강사 몫 23,653원", () => {
    const { vat } = splitVat(44_250);
    expect(vat).toBe(4_023);
    const line = singleSaleLine({ paid: 44_250, vat, fee: 805 }, { singleRateBp: 6000, pgFeeRateBp: 340 });
    expect(line).toEqual({
      paid: 44_250,
      vat: 4_023,
      fee: 805,
      feeEstimated: false,
      base: 39_422,
      rateBp: 6000,
      amount: 23_653,
    });
  });

  it("정산 기준액 = 결제 − 부가세 − PG 수수료. 수수료가 기록되지 않았으면 정책의 추정 수수료율", () => {
    const line = singleSaleLine(
      { paid: 59_000, vat: 5_364, fee: null },
      { singleRateBp: 6000, pgFeeRateBp: 340 },
    );
    expect(line.fee).toBe(2_006); // 59,000 × 3.4% = 2,006
    expect(line.feeEstimated).toBe(true);
    expect(line.base).toBe(59_000 - 5_364 - 2_006);
    expect(line.amount).toBe(Math.floor(line.base * 0.6));
  });

  it("강사 비율: 기본 60% ➔ 강사별 계약 ➔ 과정별 예외 (가장 좁은 범위)", () => {
    const teacher: PolicyVersion = {
      ...v1,
      id: "p-teacher",
      scope: "instructor",
      scopeId: "i1",
      singleRateBp: 7000,
      subscriptionPoolRateBp: null,
      pgFeeRateBp: null,
      learningRules: null,
      effectiveFrom: kst("2026-11-10T00:00:00"),
    };
    const course: PolicyVersion = {
      ...teacher,
      id: "p-course",
      scope: "course",
      scopeId: "c1",
      singleRateBp: 8000,
    };
    const at = kst("2026-12-01T00:00:00");
    const policies = [v1, teacher, course];
    expect(resolvePolicy(policies, { instructorId: "i2", courseId: "c9" }, at)!.singleRateBp).toBe(6000);
    expect(resolvePolicy(policies, { instructorId: "i1", courseId: "c2" }, at)!.singleRateBp).toBe(7000);
    const own = resolvePolicy(policies, { instructorId: "i1", courseId: "c1" }, at)!;
    expect(own.singleRateBp).toBe(8000);
    // 비어 있는 값(풀 비율 · 수수료율)은 기본 정책을 따른다
    expect(own.from).toEqual({
      single: "p-course",
      pool: "p-default-v1",
      pgFee: "p-default-v1",
      learning: "p-default-v1",
    });
  });

  it("과정 예외를 비운 새 버전을 만들면 예외가 풀린다", () => {
    const course: PolicyVersion = {
      ...v1,
      id: "p-course",
      scope: "course",
      scopeId: "c1",
      singleRateBp: 8000,
      subscriptionPoolRateBp: null,
      pgFeeRateBp: null,
      learningRules: null,
      effectiveFrom: kst("2026-11-10T00:00:00"),
    };
    const lifted: PolicyVersion = {
      ...course,
      id: "p-course-off",
      singleRateBp: null,
      effectiveFrom: kst("2027-01-01T00:00:00"),
    };
    expect(
      resolvePolicy([v1, course, lifted], { courseId: "c1" }, kst("2027-01-02T00:00:00"))!.singleRateBp,
    ).toBe(6000);
  });

  it("구독자 할인으로 판 경우: 실제 결제 금액 기준 (할인은 플랫폼과 강사가 같은 비율로 부담)", () => {
    const list = singleSaleLine(
      { paid: 59_000, vat: splitVat(59_000).vat, fee: 0 },
      { singleRateBp: 6000, pgFeeRateBp: 0 },
    );
    const discounted = singleSaleLine(
      { paid: 44_250, vat: splitVat(44_250).vat, fee: 0 },
      { singleRateBp: 6000, pgFeeRateBp: 0 },
    );
    // 강사 몫과 플랫폼 몫이 똑같이 25% 줄어든다
    expect(discounted.amount / list.amount).toBeCloseTo(0.75, 3);
    expect((discounted.base - discounted.amount) / (list.base - list.amount)).toBeCloseTo(0.75, 3);
  });

  it("패키지: 각 강의 정가 비율로 나눈다 (원 미만 버림, 남는 원은 큰 나머지부터, 합은 그대로)", () => {
    const parts = splitByWeights(100_000, [
      { key: "c1", weight: 59_000 },
      { key: "c2", weight: 39_000 },
      { key: "c3", weight: 29_000 },
    ]);
    expect(parts.map((p) => p.amount)).toEqual([46_457, 30_709, 22_834]);
    expect(parts.reduce((n, p) => n + p.amount, 0)).toBe(100_000);
    expect(
      splitByWeights(10, [
        { key: "a", weight: 0 },
        { key: "b", weight: 0 },
      ]).map((p) => p.amount),
    ).toEqual([5, 5]);
  });
});

describe("9.2 구독 매출", () => {
  const monthly = (
    id: string,
    paidAt: string,
    paid: number,
    refunds: SubscriptionPayment["refunds"] = [],
  ): SubscriptionPayment => ({
    id,
    paidAt: kst(paidAt),
    paid,
    vat: splitVat(paid).vat,
    fee: 0,
    interval: "month",
    refunds,
  });

  it("구독 기준액 = 구독 매출 − 부가세 − 결제 수수료 − 환불, 강사 배분 풀 = 기준액 × 50%", () => {
    const payments = [
      monthly("a", "2026-12-03T10:00:00", 17_700),
      monthly("b", "2026-12-20T10:00:00", 17_700, [
        { id: "r", doneAt: kst("2026-12-22T10:00:00"), amount: 17_700 },
      ]),
      { ...monthly("c", "2026-11-30T23:00:00", 17_700) },
    ];
    const pool = subscriptionPool(payments, "2026-12", (at) => resolvePolicy([v1], {}, at));
    const base = 17_700 - splitVat(17_700).vat; // b 는 같은 달 전액 환불로 0, c 는 11월 매출
    expect(pool.base).toBe(base);
    expect(pool.pool).toBe(Math.floor(base / 2));
    expect(pool.parts.map((p) => p.policyId)).toEqual(["p-default-v1", "p-default-v1"]);
  });

  it("연간 구독은 결제 금액을 12개월로 나눠 달마다 반영 (남는 원은 마지막 달)", () => {
    const yearly: SubscriptionPayment = { ...monthly("y", "2026-11-15T10:00:00", 177_000), interval: "year" };
    const base = 177_000 - splitVat(177_000).vat; // 160,909
    const months = Array.from(
      { length: 13 },
      (_, i) => subscriptionMonthBase(yearly, addMonths("2026-11", i), 0).base,
    );
    expect(months.slice(0, 11)).toEqual(Array(11).fill(13_409));
    expect(months[11]).toBe(base - 13_409 * 11);
    expect(months[12]).toBe(0);
    expect(months.reduce((n, m) => n + m, 0)).toBe(base);
  });

  it("연간 구독을 중간에 환불하면: 그 달에 남은 몫을 당겨 넣고 환불 기준액을 뺀다 (전체 = 결제 − 환불)", () => {
    const refund = 120_000;
    const yearly: SubscriptionPayment = {
      ...monthly("y", "2026-11-15T10:00:00", 177_000),
      interval: "year",
      refunds: [{ id: "r", doneAt: kst("2027-02-10T10:00:00"), amount: refund }],
    };
    const months = Array.from(
      { length: 14 },
      (_, i) => subscriptionMonthBase(yearly, addMonths("2026-11", i), 0).base,
    );
    expect(months.slice(0, 3)).toEqual([13_409, 13_409, 13_409]);
    expect(months.slice(4)).toEqual(Array(10).fill(0));
    const total = months.reduce((n, m) => n + m, 0);
    expect(total).toBe(177_000 - splitVat(177_000).vat - (refund - splitVat(refund).vat));
  });

  it("월 구독을 다음 달에 환불하면 그 달 풀에서 뺀다. 풀이 마이너스면 배분하지 않고 다음 달 풀로 넘긴다", () => {
    const payments = [
      monthly("a", "2026-11-20T10:00:00", 17_700, [
        { id: "r", doneAt: kst("2026-12-02T10:00:00"), amount: 17_700 },
      ]),
    ];
    const dec = subscriptionPool(payments, "2026-12", (at) => resolvePolicy([v1], {}, at));
    expect(dec.base).toBe(-(17_700 - splitVat(17_700).vat));
    expect(dec.allocatable).toBe(0);
    expect(dec.carryOut).toBe(-8_045); // −16,091 × 50%, 0 쪽으로 버림
    const jan = subscriptionPool(
      [monthly("b", "2027-01-05T10:00:00", 59_000)],
      "2027-01",
      (at) => resolvePolicy([v1], {}, at),
      dec.carryOut,
    );
    expect(jan.allocatable).toBe(jan.pool - 8_045);
  });

  it("결제 시각에 시행 중인 풀 비율을 쓴다 (시행일 뒤 결제만 새 비율)", () => {
    const v2: PolicyVersion = {
      ...v1,
      id: "p2",
      subscriptionPoolRateBp: 6000,
      effectiveFrom: kst("2026-12-15T00:00:00"),
    };
    const pool = subscriptionPool(
      [monthly("a", "2026-12-14T23:59:00", 11_000), monthly("b", "2026-12-15T00:00:00", 11_000)],
      "2026-12",
      (at) => resolvePolicy([v1, v2], {}, at),
    );
    expect(pool.parts.map((p) => [p.rateBp, p.policyId])).toEqual([
      [5000, "p-default-v1"],
      [6000, "p2"],
    ]);
    expect(pool.pool).toBe(5_000 + 6_000);
  });

  it("I-08 예시: 강사 배분 풀 3,120,000원 중 유효 학습 시간 13.2% ➔ 411,840원", () => {
    const seconds = new Map([
      ["ai-agent", 1_320 * 3600],
      ["others", 8_680 * 3600],
    ]);
    const [first] = allocatePool(3_120_000, seconds);
    expect(first).toEqual({ courseId: "ai-agent", seconds: 1_320 * 3600, shareBp: 1320, amount: 411_840 });
    expect(formatShare(first!.shareBp)).toBe("13.2%");
  });

  it("과정별 배분액은 원 미만 버림 (합은 풀을 넘지 않는다), 아무도 공부하지 않았으면 배분하지 않는다", () => {
    const parts = allocatePool(
      100,
      new Map([
        ["a", 1],
        ["b", 1],
        ["c", 1],
      ]),
    );
    expect(parts.map((p) => p.amount)).toEqual([33, 33, 33]);
    expect(allocatePool(100, new Map())).toEqual([]);
    expect(allocatePool(0, new Map([["a", 10]]))).toEqual([]);
  });

  it("대상: 구독 포함 과정의, 구독으로 본 시간만 (프리미엄 단건 전용 과정 · 단건으로 가진 과정은 뺀다, D3)", () => {
    const rows = [
      { courseId: "sub", effectiveSec: 3600, access: "subscription" as const },
      { courseId: "sub", effectiveSec: 1800, access: "course" as const },
      { courseId: "premium", effectiveSec: 3600, access: "subscription" as const },
      { courseId: "sub", effectiveSec: 600, access: "none" as const },
    ];
    expect(subscriptionSeconds(rows, new Set(["sub"]))).toEqual(new Map([["sub", 3600]]));
  });

  it("그날 무엇으로 봤나: 단건 · 발급 수강권이 있으면 course, 구독만 있으면 subscription", () => {
    const course = { id: "c1", inSubscription: true };
    const sub = {
      scope: "subscription_catalog" as const,
      courseId: null,
      startsAt: kst("2026-12-01T00:00:00"),
      endsAt: kst("2027-01-01T00:00:00"),
      revokedAt: null,
    };
    const single = {
      scope: "course" as const,
      courseId: "c1",
      startsAt: kst("2026-12-10T12:00:00"),
      endsAt: null,
      revokedAt: null,
    };
    expect(learningAccess([sub], course, "2026-12-05")).toBe("subscription");
    expect(learningAccess([sub, single], course, "2026-12-10")).toBe("course");
    expect(learningAccess([sub], { ...course, inSubscription: false }, "2026-12-05")).toBe("none");
    expect(learningAccess([sub], course, "2027-01-01")).toBe("none");
    expect(learningAccess([{ ...sub, revokedAt: kst("2026-12-03T00:00:00") }], course, "2026-12-05")).toBe(
      "none",
    );
  });
});

describe("9.3 환불", () => {
  const sale = singleSaleLine(
    { paid: 59_000, vat: splitVat(59_000).vat, fee: 1_180 },
    { singleRateBp: 6000, pgFeeRateBp: 340 },
  );

  it("환불 차감은 환불액 전체가 아니라 그 환불에 해당하는 강사 몫만 (전액 환불이면 판매 몫과 정확히 같다)", () => {
    expect(refundLine(sale, 59_000).amount).toBe(-sale.amount);
  });

  it("부분 환불: 부가세를 다시 나누고 수수료를 비율로 나눈 뒤, 판매 때의 비율로", () => {
    const part = refundLine(sale, 29_500);
    expect(part.vat).toBe(splitVat(29_500).vat);
    expect(part.fee).toBe(590);
    expect(part.base).toBe(29_500 - splitVat(29_500).vat - 590);
    expect(part.amount).toBe(-Math.floor(part.base * 0.6));
    expect(part.rateBp).toBe(6000);
  });

  it("확정 후 환불을 다음 달에 뺀 결과가 마이너스이면 지급하지 않고 그다음 달로 넘긴다", () => {
    const dec = computeStatement({
      single: 10_000,
      subscription: 0,
      refund: -30_000,
      adjustment: 0,
      carriedIn: 0,
      taxType: "individual",
    });
    expect(dec).toMatchObject({
      gross: -20_000,
      payout: 0,
      withheld: 0,
      carryOut: -20_000,
      hold: "negative",
    });
    const jan = computeStatement({
      single: 50_000,
      subscription: 0,
      refund: 0,
      adjustment: 0,
      carriedIn: dec.carryOut,
      taxType: "individual",
    });
    expect(jan).toMatchObject({ gross: 30_000, withheld: 990, payout: 29_010, carryOut: 0, hold: null });
  });
});

describe("9.4 주기 · 지급", () => {
  it("I-08 예시: 단건 852,000 + 구독 411,840 − 환불 12,068 − 원천징수 41,300 = 지급 예정 1,210,472원", () => {
    const s = computeStatement({
      single: 852_000,
      subscription: 411_840,
      refund: -12_068,
      adjustment: 0,
      carriedIn: 0,
      taxType: "individual",
    });
    expect(s).toMatchObject({
      gross: 1_251_772,
      incomeTax: 37_550,
      localTax: 3_750,
      withheld: 41_300,
      payout: 1_210_472,
      hold: null,
    });
  });

  it("개인 강사: 사업소득 3% + 지방소득세 0.3% (각각 10원 미만 버림)", () => {
    expect(withholding(1_251_772)).toEqual({ incomeTax: 37_550, localTax: 3_750, total: 41_300 });
    expect(withholding(10_339)).toEqual({ incomeTax: 310, localTax: 30, total: 340 });
    expect(withholding(0)).toEqual({ incomeTax: 0, localTax: 0, total: 0 });
  });

  it("사업자 강사: 원천징수 없이 강사 몫 + 부가세 (강사가 세금계산서 발행)", () => {
    const s = computeStatement({
      single: 100_000,
      subscription: 5_005,
      refund: 0,
      adjustment: 0,
      carriedIn: 0,
      taxType: "business",
    });
    expect(s).toMatchObject({ gross: 105_005, withheld: 0, vat: 10_500, payout: 115_505 });
  });

  it("최소 지급액 10,000원에 못 미치면 세금을 떼지 않고 다음 달로 넘긴다", () => {
    expect(MIN_PAYOUT).toBe(10_000);
    const nov = computeStatement({
      single: 8_000,
      subscription: 1_500,
      refund: 0,
      adjustment: 0,
      carriedIn: 0,
      taxType: "individual",
    });
    expect(nov).toMatchObject({ gross: 9_500, payout: 0, withheld: 0, carryOut: 9_500, hold: "below_min" });
    const dec = computeStatement({
      single: 1_000,
      subscription: 0,
      refund: 0,
      adjustment: 0,
      carriedIn: nov.carryOut,
      taxType: "individual",
    });
    // 10,500 − 340 = 10,160 ≥ 10,000 ➔ 지급
    expect(dec).toMatchObject({ gross: 10_500, withheld: 340, payout: 10_160, carryOut: 0, hold: null });
    // 원천징수 뒤 10,000원 미만이면 넘긴다
    expect(
      computeStatement({
        single: 10_200,
        subscription: 0,
        refund: 0,
        adjustment: 0,
        carriedIn: 0,
        taxType: "individual",
      }).hold,
    ).toBe("below_min");
  });

  it("정산 정보가 없으면 지급하지 않고 넘긴다, 운영자 조정(이의 신청 반영)도 합계에 들어간다", () => {
    expect(
      computeStatement({
        single: 50_000,
        subscription: 0,
        refund: 0,
        adjustment: 0,
        carriedIn: 0,
        taxType: null,
      }),
    ).toMatchObject({
      payout: 0,
      carryOut: 50_000,
      hold: "no_profile",
    });
    expect(
      computeStatement({
        single: 50_000,
        subscription: 0,
        refund: 0,
        adjustment: -5_000,
        carriedIn: 0,
        taxType: "business",
      }).payout,
    ).toBe(49_500);
  });

  it("마감은 말일, 명세는 다음 달 10일, 지급은 15일 (연말 · 2월 포함)", () => {
    expect(settlementSchedule("2026-12")).toEqual({
      closesOn: "2026-12-31",
      statementOn: "2027-01-10",
      payOn: "2027-01-15",
    });
    expect(settlementSchedule("2027-02").closesOn).toBe("2027-02-28");
    expect(monthRange("2026-12")).toEqual({
      from: kst("2026-12-01T00:00:00"),
      to: kst("2027-01-01T00:00:00"),
    });
  });

  it("이의 신청: 명세 공개 뒤 5일 동안 (그날 끝까지, KST)", () => {
    const published = kst("2027-01-10T09:00:00");
    expect(objectionDeadline(published)).toBe("2027-01-15");
    expect(canObject(published, kst("2027-01-15T23:59:59"))).toBe(true);
    expect(canObject(published, kst("2027-01-16T00:00:00"))).toBe(false);
    expect(canObject(null, kst("2027-01-11T00:00:00"))).toBe(false);
  });

  it("계산 순서: 끝난 달만, 확정한 달의 바로 다음 달, 확정하지 않은 다른 달이 있으면 그 달 먼저, 확정한 달은 다시 계산하지 않는다", () => {
    const now = kst("2027-01-02T04:00:00");
    expect(calculateBlock("2027-01", [], now)).toBe("NOT_CLOSED");
    expect(calculateBlock("2026-12", [], now)).toBeNull();
    expect(calculateBlock("2026-12", [{ month: "2026-11", status: "confirmed" }], now)).toBeNull();
    expect(calculateBlock("2026-12", [{ month: "2026-12", status: "calculated" }], now)).toBeNull();
    expect(calculateBlock("2026-12", [{ month: "2026-12", status: "confirmed" }], now)).toBe("CONFIRMED");
    expect(calculateBlock("2026-11", [{ month: "2026-12", status: "confirmed" }], now)).toBe(
      "LATER_CONFIRMED",
    );
    expect(calculateBlock("2026-12", [{ month: "2026-11", status: "calculated" }], now)).toBe("OTHER_OPEN");
    expect(calculateBlock("2026-12", [{ month: "2026-10", status: "confirmed" }], now)).toBe("NOT_NEXT");
  });
});
