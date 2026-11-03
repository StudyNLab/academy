import { describe, expect, it } from "vitest";
import { applyRate, splitVat } from "./money";

describe("splitVat", () => {
  it.each([
    // [총액, 공급가액, 부가세]
    [44_250, 40_227, 4_023], // 화면상세기획 3.1 주문서 예시
    [11_000, 10_000, 1_000],
    [59_000, 53_636, 5_364],
    [1, 1, 0],
    [0, 0, 0],
  ])("총액 %i 원 ➔ 공급가액 %i + 부가세 %i", (total, supply, vat) => {
    const r = splitVat(total);
    expect(r).toEqual({ supply, vat });
    expect(r.supply + r.vat).toBe(total);
  });

  it("소수 · 음수는 거부한다", () => {
    expect(() => splitVat(100.5)).toThrow(RangeError);
    expect(() => splitVat(-1)).toThrow(RangeError);
  });
});

describe("applyRate", () => {
  it("원 단위로 버린다", () => {
    expect(applyRate(39_422, 0.6)).toBe(23_653); // 정산 예시: 23,653.2 ➔ 23,653
    expect(applyRate(100, 0)).toBe(0);
    expect(applyRate(100, 1)).toBe(100);
  });

  it("범위를 벗어난 비율은 거부한다", () => {
    expect(() => applyRate(100, 1.2)).toThrow(RangeError);
    expect(() => applyRate(100, -0.1)).toThrow(RangeError);
  });
});
