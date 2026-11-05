import { describe, expect, it } from "vitest";
import { isDeliverableEmail, placeholderEmail } from "./email";
import { checkNickname, nextNicknameChangeAt, normalizeNickname } from "./nickname";
import { checkPassword } from "./password";
import { checkPasswordStrict } from "./password-server";
import { isPrivilegedSessionExpired, LOGIN_LOCKOUT, lockedUntil } from "./policy";

describe("checkPassword", () => {
  it.each([
    ["짧음", "abc12", "too_short"],
    ["너무 김", "a".repeat(64) + "b".repeat(65), "too_long"],
    ["흔한 비밀번호", "password", "common"],
    ["흔한 비밀번호 + 숫자 · 기호", "Qwerty123!", "common"],
    ["국내 자판 패턴", "1q2w3e4r", "common"],
    ["같은 글자 반복", "zzzzzzzzz", "simple_pattern"],
    ["연속 글자", "lmnopqrs", "simple_pattern"],
    ["거꾸로 연속", "98765432", "simple_pattern"],
  ])("%s ➔ %s", (_label, password, expected) => {
    expect(checkPassword(password)).toBe(expected);
  });

  it("길이는 글자 수로 센다 (한글 8자 통과)", () => {
    expect(checkPassword("가나다라마바사아")).toBeNull();
  });

  it("8자 정확히는 통과, 128자까지 통과", () => {
    expect(checkPassword("tiger#Lake")).toBeNull();
    expect(checkPassword("x7".repeat(64))).toBeNull();
  });

  it("이메일 앞부분 · 닉네임이 들어가면 거부", () => {
    expect(checkPassword("minsu.kim2026!", { email: "minsu.kim@example.com" })).toBe("contains_personal");
    expect(checkPassword("i-am-Cloudcat-77", { nickname: "cloudcat" })).toBe("contains_personal");
  });

  it("짧은 이메일 앞부분(3자 이하)은 우연히 겹칠 수 있어 보지 않는다", () => {
    expect(checkPassword("bobsled-river", { email: "bob@example.com" })).toBeNull();
  });
});

describe("checkPasswordStrict (서버, 큰 목록)", () => {
  it("작은 목록에 없지만 큰 목록에 있는 흔한 비밀번호도 거부 (끝 숫자 · 기호를 떼고도)", () => {
    expect(checkPassword("michelle")).toBeNull();
    expect(checkPasswordStrict("michelle")).toBe("common");
    expect(checkPasswordStrict("Mustang2026!")).toBe("common");
    expect(checkPasswordStrict("Ironman77")).toBe("common");
  });

  it("화면 규칙의 문제는 그대로 먼저 알린다", () => {
    expect(checkPasswordStrict("abc12")).toBe("too_short");
    expect(checkPasswordStrict("minsu.kim2026!", { email: "minsu.kim@example.com" })).toBe(
      "contains_personal",
    );
  });

  it("흔하지 않은 비밀번호는 통과", () => {
    expect(checkPasswordStrict("Blue-Harbor-Tiger-42")).toBeNull();
    expect(checkPasswordStrict("가나다라마바사아")).toBeNull();
    expect(checkPasswordStrict("tiger#Lake")).toBeNull();
  });
});

describe("checkNickname", () => {
  it.each([
    ["클라우드고양이", null],
    ["kim_2026", null],
    ["가", "length"],
    ["a".repeat(17), "length"],
    ["띄어 쓴 이름", "characters"],
    ["<script>", "characters"],
    ["진짜운영자", "reserved"],
    ["AdminKim", "reserved"],
  ])("%s ➔ %s", (nickname, expected) => {
    expect(checkNickname(nickname)).toBe(expected);
  });

  it("앞뒤 공백 · 자모 조합을 맞춘다", () => {
    const decomposed = "한글".normalize("NFD");
    expect(normalizeNickname(`  ${decomposed} `)).toBe("한글");
  });

  it("30일에 한 번 바꿀 수 있다", () => {
    const changed = new Date("2026-11-01T00:00:00Z");
    expect(nextNicknameChangeAt(null, changed)).toBeNull();
    expect(nextNicknameChangeAt(changed, new Date("2026-11-30T23:59:59Z"))).toEqual(
      new Date("2026-12-01T00:00:00Z"),
    );
    expect(nextNicknameChangeAt(changed, new Date("2026-12-01T00:00:00Z"))).toBeNull();
  });
});

describe("lockedUntil (계정 10회 / 15분 ➔ 15분 잠금)", () => {
  const base = new Date("2026-11-04T10:00:00Z").getTime();
  const at = (minutes: number) => new Date(base + minutes * 60_000);
  const failures = (count: number, everyMinutes: number) =>
    Array.from({ length: count }, (_, i) => at(i * everyMinutes));

  it("9번 틀리면 잠기지 않는다", () => {
    expect(lockedUntil(failures(9, 1), at(9))).toBeNull();
  });

  it("15분 안에 10번 틀리면 마지막 실패부터 15분 잠긴다", () => {
    const list = failures(10, 1); // 0 ~ 9분
    expect(lockedUntil(list, at(10))).toEqual(at(24));
    expect(lockedUntil(list, at(23.9))).toEqual(at(24));
    expect(lockedUntil(list, at(24))).toBeNull();
  });

  it("15분보다 넓게 퍼진 10번은 잠그지 않는다", () => {
    expect(lockedUntil(failures(10, 2), at(20))).toBeNull(); // 0 ~ 18분
  });

  it("경계: 첫 실패와 10번째 실패가 정확히 15분 차이면 잠근다", () => {
    const list = [...failures(9, 1), at(15)];
    expect(lockedUntil(list, at(16))).toEqual(at(30));
  });

  it("순서가 섞여 들어와도 같다", () => {
    const list = failures(10, 1).reverse();
    expect(lockedUntil(list, at(10))).toEqual(at(24));
  });

  it("정책 값을 바꿔 쓸 수 있다", () => {
    expect(lockedUntil(failures(3, 1), at(3), { ...LOGIN_LOCKOUT, maxFailures: 3 })).toEqual(at(17));
  });
});

describe("운영자 · 강사 세션 12시간", () => {
  it("만든 지 12시간이 되면 끝난다", () => {
    const created = new Date("2026-11-04T00:00:00Z");
    expect(isPrivilegedSessionExpired(created, new Date("2026-11-04T11:59:59Z"))).toBe(false);
    expect(isPrivilegedSessionExpired(created, new Date("2026-11-04T12:00:00Z"))).toBe(true);
  });
});

describe("자리표시 이메일", () => {
  it("메일을 보내지 않는다", () => {
    const email = placeholderEmail("withdrawn", "0190f0e0");
    expect(email).toBe("withdrawn-0190f0e0@withdrawn.invalid");
    expect(isDeliverableEmail(email)).toBe(false);
    expect(isDeliverableEmail("me@example.com")).toBe(true);
    expect(isDeliverableEmail(null)).toBe(false);
  });
});
