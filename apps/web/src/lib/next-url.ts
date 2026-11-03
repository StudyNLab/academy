/**
 * 로그인 뒤 돌아갈 주소(`?next=`)는 우리 사이트 안의 경로만 받는다 (다른 사이트로 보내는 피싱 방지).
 * "/my" 같은 경로만 통과, "//evil.com" · "https://…" · "/\evil" 은 기본값으로.
 */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // 줄바꿈 등 제어 문자가 섞이면 거부 (헤더 주입 방지)
  if ([...value].some((c) => c.charCodeAt(0) < 0x20)) return fallback;
  return value;
}
