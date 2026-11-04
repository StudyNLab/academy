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
} as const;

export const RETENTION = {
  loginLogsMemberMs: 183 * DAY,
  loginLogsPrivilegedMs: 730 * DAY,
  auditLogsMs: 730 * DAY,
  piiAccessLogsMs: 730 * DAY,
  /** 학습 신호 원자료 (하루 집계는 learning_time_daily 에 남는다) */
  learningHeartbeatsMs: 90 * DAY,
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
