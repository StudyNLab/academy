import { describe, expect, it } from "vitest";
import {
  canRequestReview,
  chapterFunnel,
  contractState,
  formatRate,
  instructorCourseState,
  isWaitingReview,
  monthlySales,
  normalizeBankAccount,
  normalizeBusinessNo,
  normalizeRrn,
  parseRatePercent,
  progressDistribution,
  recentMonths,
} from "./instructor";

describe("검수 요청 · 대기", () => {
  it("검사를 통과한 버전과 반려된 버전만 강사가 요청할 수 있다", () => {
    expect(canRequestReview({ status: "ready", validationOk: true })).toBe(true);
    expect(canRequestReview({ status: "rejected", validationOk: true })).toBe(true);
    expect(canRequestReview({ status: "rejected", validationOk: false })).toBe(false);
    expect(canRequestReview({ status: "in_review", validationOk: true })).toBe(false);
    expect(canRequestReview({ status: "published", validationOk: true })).toBe(false);
    expect(canRequestReview({ status: "invalid", validationOk: false })).toBe(false);
  });

  it("강사가 올리고 요청하지 않은 버전은 운영자 검수 대기에 없다", () => {
    const owner = "u-owner";
    expect(isWaitingReview({ status: "ready", uploadedBy: owner, ownerUserId: owner })).toBe(false);
    expect(isWaitingReview({ status: "in_review", uploadedBy: owner, ownerUserId: owner })).toBe(true);
    expect(isWaitingReview({ status: "ready", uploadedBy: "u-op", ownerUserId: owner })).toBe(true);
    // 아직 가입하지 않은 강사의 과정은 운영자가 올린다
    expect(isWaitingReview({ status: "ready", uploadedBy: "u-op", ownerUserId: null })).toBe(true);
    expect(isWaitingReview({ status: "rejected", uploadedBy: "u-op", ownerUserId: owner })).toBe(false);
  });

  it("과정 상태: 작성 중 · 검수 대기 · 공개 · 반려", () => {
    expect(instructorCourseState({ courseStatus: "draft", latestVersionStatus: null })).toBe("draft");
    expect(instructorCourseState({ courseStatus: "draft", latestVersionStatus: "in_review" })).toBe(
      "in_review",
    );
    expect(instructorCourseState({ courseStatus: "published", latestVersionStatus: "in_review" })).toBe(
      "in_review",
    );
    expect(instructorCourseState({ courseStatus: "draft", latestVersionStatus: "rejected" })).toBe(
      "rejected",
    );
    // 공개 중인 과정의 새 버전이 반려돼도 과정은 공개 중
    expect(instructorCourseState({ courseStatus: "published", latestVersionStatus: "rejected" })).toBe(
      "published",
    );
  });
});

describe("계약 상태", () => {
  const signed = new Date("2026-11-01T00:00:00Z");
  it("동의 전 · 시작 전 · 계약 중 · 끝남 (KST 날짜)", () => {
    const c = { startsOn: "2026-11-10", endsOn: "2027-11-09", signedAt: signed };
    expect(contractState({ ...c, signedAt: null }, "2026-11-20")).toBe("unsigned");
    expect(contractState(c, "2026-11-09")).toBe("upcoming");
    expect(contractState(c, "2026-11-10")).toBe("active");
    expect(contractState(c, "2027-11-09")).toBe("active");
    expect(contractState(c, "2027-11-10")).toBe("ended");
    expect(contractState({ ...c, endsOn: null }, "2030-01-01")).toBe("active");
  });
});

describe("비율", () => {
  it("만분율 ⇄ %", () => {
    expect(formatRate(6000)).toBe("60%");
    expect(formatRate(6250)).toBe("62.5%");
    expect(formatRate(0)).toBe("0%");
    expect(parseRatePercent("60")).toBe(6000);
    expect(parseRatePercent("62.5%")).toBe(6250);
    expect(parseRatePercent("100")).toBe(10000);
    expect(parseRatePercent("100.5")).toBeNull();
    expect(parseRatePercent("-1")).toBeNull();
    expect(parseRatePercent("abc")).toBeNull();
  });
});

describe("정산 정보 형식", () => {
  it("계좌번호는 숫자만 남긴다", () => {
    expect(normalizeBankAccount("123-456-789012")).toBe("123456789012");
    expect(normalizeBankAccount("12 34")).toBeNull();
    expect(normalizeBankAccount("12345a7890")).toBeNull();
  });

  it("주민등록번호: 13자리 · 날짜 · 성별 자리", () => {
    expect(normalizeRrn("900101-1000000")).toBe("9001011000000");
    expect(normalizeRrn("901301-1000000")).toBeNull(); // 13월
    expect(normalizeRrn("900101-9000000")).toBeNull();
    expect(normalizeRrn("9001011")).toBeNull();
  });

  it("사업자등록번호: 검증 숫자", () => {
    // 검증 숫자를 직접 계산해 맞는 번호를 만든다
    const body = "123456789";
    const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
    const d = [...body].map(Number);
    const sum = weights.reduce((a, w, i) => a + w * d[i]!, 0) + Math.floor((5 * d[8]!) / 10);
    const valid = `${body}${(10 - (sum % 10)) % 10}`;
    expect(normalizeBusinessNo(`${valid.slice(0, 3)}-${valid.slice(3, 5)}-${valid.slice(5)}`)).toBe(valid);
    const wrong = `${body}${(((10 - (sum % 10)) % 10) + 1) % 10}`;
    expect(normalizeBusinessNo(wrong)).toBeNull();
  });
});

describe("판매 · 수강 현황 집계", () => {
  it("진도 구간별 인원", () => {
    expect(progressDistribution([0, 0, 10, 50, 99, 100])).toEqual([
      { label: "0%", count: 2 },
      { label: "1 ~ 24%", count: 1 },
      { label: "25 ~ 49%", count: 0 },
      { label: "50 ~ 74%", count: 1 },
      { label: "75 ~ 99%", count: 1 },
      { label: "100%", count: 1 },
    ]);
  });

  it("챕터별 시작 · 완료와 이탈 구간 (앞 챕터를 끝내고 다음을 안 연 사람이 가장 많은 곳)", () => {
    const s = (...keys: string[]) => new Set(keys);
    const result = chapterFunnel(
      ["ch01", "ch02", "ch03"],
      [
        { started: s("ch01", "ch02", "ch03"), completed: s("ch01", "ch02") },
        { started: s("ch01", "ch02"), completed: s("ch01", "ch02") },
        { started: s("ch01", "ch02"), completed: s("ch01", "ch02") },
        { started: s("ch01"), completed: s("ch01") },
      ],
    );
    expect(result.rows).toEqual([
      { key: "ch01", started: 4, completed: 4 },
      { key: "ch02", started: 3, completed: 3 },
      { key: "ch03", started: 1, completed: 0 },
    ]);
    expect(result).toMatchObject({ dropAfter: "ch02", dropCount: 2 });
    expect(chapterFunnel(["ch01"], []).dropAfter).toBeNull();
  });

  it("월별 매출: 결제는 결제한 달, 환불은 끝난 달 (KST)", () => {
    const months = recentMonths(new Date("2026-12-05T00:00:00+09:00"), 3);
    expect(months).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(recentMonths(new Date("2026-01-15T00:00:00+09:00"), 2)).toEqual(["2025-12", "2026-01"]);
    const rows = monthlySales(
      months,
      [
        { paidAt: new Date("2026-11-30T15:30:00Z"), amount: 59000 }, // KST 12월 1일
        { paidAt: new Date("2026-11-10T00:00:00Z"), amount: 44250 },
      ],
      [{ doneAt: new Date("2026-12-02T00:00:00Z"), amount: 44250 }],
    );
    expect(rows).toEqual([
      { month: "2026-10", sales: 0, gross: 0, refunded: 0, net: 0 },
      { month: "2026-11", sales: 1, gross: 44250, refunded: 0, net: 44250 },
      { month: "2026-12", sales: 1, gross: 59000, refunded: 44250, net: 14750 },
    ]);
  });
});
