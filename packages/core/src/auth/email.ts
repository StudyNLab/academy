// 메일을 보낼 수 없는 자리표시 주소. `.invalid` 는 실제로 쓰이지 않는 최상위 도메인이다 (RFC 2606).
// Better Auth 는 users.email 을 비워 둘 수 없어서, 이메일을 주지 않는 로그인(카카오)과 탈퇴 회원에 쓴다.

export function placeholderEmail(kind: "no-email" | "withdrawn", key: string): string {
  return `${kind}-${key}@${kind}.invalid`;
}

/** 메일을 보낼 수 있는 실제 주소인가 */
export function isDeliverableEmail(email: string | null | undefined): email is string {
  return !!email && !email.toLowerCase().endsWith(".invalid");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
