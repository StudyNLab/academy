// 서버 쪽 비밀번호 검사: 화면과 같은 규칙(password.ts) + 큰 흔한 비밀번호 목록 (약 4만 9천 개).
// 큰 목록은 화면 코드에 넣지 않으려고 따로 둔다 (`@aionit/core/password-server`, 서버에서만 불러온다).
import { LARGE_COMMON_PASSWORDS_TEXT } from "./common-passwords-large";
import type { PasswordContext, PasswordProblem } from "./password";
import { checkPassword, inPasswordList } from "./password";

let large: ReadonlySet<string> | undefined;

function largeList(): ReadonlySet<string> {
  large ??= new Set(LARGE_COMMON_PASSWORDS_TEXT.split("\n"));
  return large;
}

/** 문제가 없으면 null. 화면 검사를 통과해도 큰 목록에 있으면 "common" */
export function checkPasswordStrict(password: string, context: PasswordContext = {}): PasswordProblem | null {
  const problem = checkPassword(password, context);
  if (problem) return problem;
  return inPasswordList(largeList(), password) ? "common" : null;
}
