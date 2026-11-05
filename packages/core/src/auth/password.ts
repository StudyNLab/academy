// 비밀번호 규칙 (docs/기술설계.md 3.1, 2026-11-04 운영자 확정)
// 길이 8 ~ 128, 흔한 비밀번호 거부, 이메일 · 닉네임이 들어간 비밀번호 거부. 글자 종류 조합은 강제하지 않는다.
import { COMMON_PASSWORDS } from "./common-passwords";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = "too_short" | "too_long" | "common" | "contains_personal" | "simple_pattern";

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`,
  too_long: `비밀번호는 ${PASSWORD_MAX_LENGTH}자까지 쓸 수 있습니다.`,
  common: "너무 흔한 비밀번호입니다. 다른 사람이 맞히기 어려운 비밀번호를 써 주세요.",
  contains_personal: "이메일이나 닉네임이 들어간 비밀번호는 쓸 수 없습니다.",
  simple_pattern: "같은 글자나 연속된 글자만으로 된 비밀번호는 쓸 수 없습니다.",
};

export interface PasswordContext {
  email?: string | null;
  nickname?: string | null;
}

/** 문제가 없으면 null, 있으면 첫 번째 문제를 돌려준다. */
export function checkPassword(password: string, context: PasswordContext = {}): PasswordProblem | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return "too_short";
  if (length > PASSWORD_MAX_LENGTH) return "too_long";

  const lower = password.toLowerCase();
  if (inPasswordList(COMMON_PASSWORDS, password)) return "common";

  if (isSimplePattern(lower)) return "simple_pattern";

  const local = context.email?.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && lower.includes(local)) return "contains_personal";
  const nickname = context.nickname?.toLowerCase() ?? "";
  if (nickname.length >= 3 && lower.includes(nickname)) return "contains_personal";

  return null;
}

/** 목록에 있나. 끝에 붙인 숫자 · 기호를 떼어도 흔한 비밀번호면 있는 것으로 본다 ("qwerty123!" ➔ "qwerty") */
export function inPasswordList(list: ReadonlySet<string>, password: string): boolean {
  const lower = password.toLowerCase();
  const stem = lower.replace(/[\d\W_]+$/u, "");
  return list.has(lower) || (stem.length > 0 && list.has(stem));
}

/** 한 글자 반복(aaaaaaaa) 또는 한 방향으로 1씩 늘거나 줄어드는 글자(12345678, abcdefgh, 87654321) */
function isSimplePattern(value: string): boolean {
  const codes = [...value].map((c) => c.codePointAt(0) ?? 0);
  const first = codes[0];
  if (codes.every((c) => c === first)) return true;
  const step = (codes[1] ?? 0) - (first ?? 0);
  if (step !== 1 && step !== -1) return false;
  return codes.every((c, i) => i === 0 || c - (codes[i - 1] ?? 0) === step);
}
