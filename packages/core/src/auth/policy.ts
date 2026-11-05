// 로그인 · 세션 · 기록 보관 정책 (docs/기술설계.md 3.1, 2026-11-04 운영자 확정)

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LOGIN_LOCKOUT = {
  /** 같은 계정에 이만큼 틀리면 */
  maxFailures: 10,
  /** 이 시간 안에 */
  windowMs: 15 * MINUTE,
  /** 이만큼 잠근다 (마지막 실패부터) */
  lockMs: 15 * MINUTE,
} as const;

/** 같은 IP 의 시도 횟수 제한 (Better Auth rateLimit 규칙으로 건다) */
export const IP_RATE_LIMITS = {
  signIn: { window: 60, max: 10 },
  signUp: { window: 600, max: 5 },
  passwordReset: { window: 600, max: 5 },
  verificationEmail: { window: 600, max: 5 },
  twoFactor: { window: 60, max: 5 },
} as const;

export const SESSION_POLICY = {
  /** 수강생: 30일, 쓰면 연장 */
  memberExpiresInSec: 30 * 24 * 3600,
  /** 하루에 한 번만 만료일을 늘린다 (DB 쓰기를 줄이려고) */
  updateAgeSec: 24 * 3600,
  /** 운영자 · 강사: 로그인부터 12시간, 연장 없음 */
  privilegedMaxAgeMs: 12 * HOUR,
  /**
   * 비밀번호가 없는 회원(구글 · 카카오만)이 민감한 일(탈퇴, 2단계 인증 켜기 · 끄기)을 할 때:
   * 비밀번호 대신 "이 시간 안에 로그인했는가"로 본인을 확인한다
   */
  recentLoginMs: 15 * MINUTE,
} as const;

// 로그인 · 운영자 작업 · 개인정보 조회 기록과 1:1 문의의 기간은 DB 함수 aionit_purge_protected_records()
// (packages/db/drizzle/0012_app_role.sql)에도 있다. 바꾸면 새 마이그레이션으로 함수도 바꾼다 (db-roles.test.ts 가 맞는지 본다)
export const RETENTION = {
  loginLogsMemberMs: 183 * DAY,
  loginLogsPrivilegedMs: 730 * DAY,
  auditLogsMs: 730 * DAY,
  piiAccessLogsMs: 730 * DAY,
  /** 학습 신호 원자료 (하루 집계는 learning_time_daily 에 남는다) */
  learningHeartbeatsMs: 90 * DAY,
  /** 1:1 문의 (소비자 불만 · 분쟁 기록, 전자상거래법 3년). 마지막 글부터 센다 */
  inquiriesMs: 3 * 365 * DAY,
  /** 사이트 알림: 읽은 것은 90일, 읽지 않은 것도 1년 지나면 지운다 */
  notificationsReadMs: 90 * DAY,
  notificationsMs: 365 * DAY,
} as const;

export interface LockoutPolicy {
  maxFailures: number;
  windowMs: number;
  lockMs: number;
}

/**
 * 계정 잠금이 풀리는 시각. 잠겨 있지 않으면 null.
 * `failures` 는 마지막 로그인 성공 이후의 실패 시각들 (순서 무관).
 * 15분 안에 10번 틀린 순간부터 15분 동안 잠근다. 잠긴 동안의 시도는 실패로 세지 않는다 (기록만 `blocked_locked`).
 */
export function lockedUntil(
  failures: readonly Date[],
  now: Date,
  policy: LockoutPolicy = LOGIN_LOCKOUT,
): Date | null {
  const times = failures.map((d) => d.getTime()).sort((a, b) => a - b);
  let until: number | null = null;
  for (let i = policy.maxFailures - 1; i < times.length; i++) {
    const last = times[i] as number;
    const first = times[i - policy.maxFailures + 1] as number;
    if (last - first <= policy.windowMs) until = Math.max(until ?? 0, last + policy.lockMs);
  }
  return until !== null && until > now.getTime() ? new Date(until) : null;
}

/** 운영자 · 강사 세션은 만든 지 12시간이 지나면 끝난다 (활동해도 늘지 않는다) */
export function isPrivilegedSessionExpired(sessionCreatedAt: Date, now: Date): boolean {
  return now.getTime() - sessionCreatedAt.getTime() >= SESSION_POLICY.privilegedMaxAgeMs;
}
