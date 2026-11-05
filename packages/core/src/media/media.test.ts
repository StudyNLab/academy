import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  memberTag,
  openHlsKey,
  planRenditions,
  sealHlsKey,
  signMediaToken,
  srtToVtt,
  verifyMediaToken,
} from "./index";

const SECRET = "x".repeat(48);
const now = new Date("2026-11-04T12:00:00Z");
const claims = { userId: "u1", assetId: "a1", expiresAt: new Date(now.getTime() + 300_000) };

describe("재생 토큰", () => {
  it("서명한 토큰은 만료 전까지 통과하고, 만료되면 거부", () => {
    const token = signMediaToken(SECRET, claims);
    expect(verifyMediaToken(SECRET, token, now)).toEqual(claims);
    expect(verifyMediaToken(SECRET, token, new Date(now.getTime() + 300_000))).toBeNull();
  });

  it("다른 비밀값 · 고친 내용 · 형식이 틀린 토큰은 거부", () => {
    const token = signMediaToken(SECRET, claims);
    expect(verifyMediaToken("y".repeat(48), token, now)).toBeNull();
    const [v, , sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "u1", a: "other", e: 9_999_999_999 })).toString(
      "base64url",
    );
    expect(verifyMediaToken(SECRET, `${v}.${forged}.${sig}`, now)).toBeNull();
    expect(verifyMediaToken(SECRET, "garbage", now)).toBeNull();
    expect(verifyMediaToken(SECRET, null, now)).toBeNull();
  });
});

describe("HLS 키 보관", () => {
  it("감싼 키는 같은 비밀값으로만 푼다", () => {
    const key = randomBytes(16);
    const sealed = sealHlsKey(SECRET, key);
    expect(sealed.length).toBe(1 + 12 + 16 + 16);
    expect(openHlsKey(SECRET, sealed).equals(key)).toBe(true);
    expect(() => openHlsKey("z".repeat(48), sealed)).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => openHlsKey(SECRET, tampered)).toThrow();
  });
});

describe("자막 srt ➔ WebVTT", () => {
  it("시간 형식을 바꾸고, BOM · CRLF 를 정리하고, 태그는 글자로", () => {
    const srt =
      String.fromCharCode(0xfeff) +
      "1\r\n00:00:00,350 --> 00:00:05,580\r\n첫 줄 <b>굵게</b>\r\n둘째 줄\r\n\r\n2\r\n0:00:06,5 --> 0:00:08,000\r\n다음\r\n";
    const { vtt, cues } = srtToVtt(srt);
    expect(cues).toBe(2);
    expect(vtt).toBe(
      "WEBVTT\n\n00:00:00.350 --> 00:00:05.580\n첫 줄 &lt;b&gt;굵게&lt;/b&gt;\n둘째 줄\n\n00:00:06.500 --> 00:00:08.000\n다음\n",
    );
  });

  it("자막 줄이 없으면 오류", () => {
    expect(() => srtToVtt("그냥 글")).toThrow("자막 줄");
  });
});

describe("화질 단계", () => {
  it("원본보다 큰 화질은 만들지 않는다", () => {
    expect(planRenditions(1080).map((r) => r.name)).toEqual(["360p", "720p", "1080p"]);
    expect(planRenditions(1440).map((r) => r.name)).toEqual(["360p", "720p", "1080p"]);
    expect(planRenditions(720).map((r) => r.name)).toEqual(["360p", "720p"]);
    expect(planRenditions(240).map((r) => r.name)).toEqual(["240p"]);
  });

  it("1080p 상한은 1.5Mbps (강의 영상 목표 1 ~ 1.5Mbps)", () => {
    expect(planRenditions(1080).at(-1)!.maxrateKbps).toBe(1500);
  });
});

it("회원 번호 일부", () => {
  expect(memberTag("019a4f2c-1b2c-7d3e-8f40-a1b2c3d4e5f6")).toBe("D4E5F6");
});

describe("빌링키 보관", () => {
  const secret = "s".repeat(40);
  it("감싼 값으로 되돌릴 수 있고, 원문이 보이지 않고, 다른 비밀값 · 고친 값은 열리지 않는다", async () => {
    const { sealBillingKey, openBillingKey } = await import("./index");
    const sealed = sealBillingKey(secret, "bk_real_123");
    expect(sealed).not.toContain("bk_real");
    expect(openBillingKey(secret, sealed)).toBe("bk_real_123");
    expect(() => openBillingKey("t".repeat(40), sealed)).toThrow();
    expect(() => openBillingKey(secret, `${sealed.slice(0, -2)}AA`)).toThrow();
  });
});

describe("개인정보 필드 감싸기", () => {
  const secret = "s".repeat(40);
  it("쓰임이 다르면 열리지 않고, 같은 값도 감쌀 때마다 다르다", async () => {
    const { sealPii, openPii } = await import("./index");
    const sealed = sealPii(secret, "bank-account", "110123456789");
    expect(sealed).not.toContain("110123456789");
    expect(sealPii(secret, "bank-account", "110123456789")).not.toBe(sealed);
    expect(openPii(secret, "bank-account", sealed)).toBe("110123456789");
    expect(() => openPii(secret, "rrn", sealed)).toThrow();
    expect(() => openPii("t".repeat(40), "bank-account", sealed)).toThrow();
  });
});
