// 관리자 화면에서 쓰는 표시 이름
export const ROLE_LABEL = { operator: "운영자", instructor: "강사" } as const;

export const STATUS_LABEL = { active: "이용 중", suspended: "정지", withdrawn: "탈퇴" } as const;
export const STATUS_TONE = { active: "done", suspended: "danger", withdrawn: "muted" } as const;

export const LOGIN_RESULT_LABEL: Record<string, string> = {
  success: "성공",
  two_factor_required: "비밀번호 맞음 · OTP 대기",
  fail_password: "실패 · 비밀번호",
  fail_unverified: "실패 · 메일 미인증",
  fail_two_factor: "실패 · OTP",
  fail_suspended: "실패 · 정지 계정",
  blocked_locked: "막음 · 계정 잠금",
  blocked_rate_limit: "막음 · 횟수 제한",
};

export const ACTION_LABEL: Record<string, string> = {
  "role.grant": "역할 줌",
  "role.revoke": "역할 거둠",
  "user.suspend": "이용 정지",
  "user.unsuspend": "정지 풀기",
  "user.withdraw": "회원 탈퇴",
};
