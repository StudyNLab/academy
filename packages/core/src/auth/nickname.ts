// 닉네임 규칙 (docs/데이터모델.md 결정 D1): 가입 때 필수, 사이트 전체에서 고유, 30일에 한 번 변경

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;
export const NICKNAME_CHANGE_INTERVAL_DAYS = 30;

const ALLOWED = /^[가-힣a-zA-Z0-9_]+$/u;

/** 운영자 · 강사 · 사이트로 오해할 수 있는 이름 (포함만 해도 거부) */
const RESERVED = [
  "운영자",
  "관리자",
  "운영팀",
  "강사",
  "아이오닛",
  "탈퇴한회원",
  "admin",
  "operator",
  "aionit",
  "system",
];

export type NicknameProblem = "length" | "characters" | "reserved";

export const NICKNAME_MESSAGES: Record<NicknameProblem | "taken" | "too_soon", string> = {
  length: `닉네임은 ${NICKNAME_MIN_LENGTH} ~ ${NICKNAME_MAX_LENGTH}자로 정해 주세요.`,
  characters: "닉네임에는 한글 · 영문 · 숫자 · 밑줄(_)만 쓸 수 있습니다.",
  reserved: "운영자나 사이트로 오해할 수 있는 닉네임은 쓸 수 없습니다.",
  taken: "이미 쓰고 있는 닉네임입니다.",
  too_soon: `닉네임은 ${NICKNAME_CHANGE_INTERVAL_DAYS}일에 한 번 바꿀 수 있습니다.`,
};

/** 저장 전에 같은 모양으로 맞춘다 (앞뒤 공백 제거, 한글 자모 조합 통일) */
export function normalizeNickname(value: string): string {
  return value.normalize("NFC").trim();
}

export function checkNickname(value: string): NicknameProblem | null {
  const nickname = normalizeNickname(value);
  const length = [...nickname].length;
  if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) return "length";
  if (!ALLOWED.test(nickname)) return "characters";
  const lower = nickname.toLowerCase();
  if (RESERVED.some((word) => lower.includes(word))) return "reserved";
  return null;
}

/** 다음에 바꿀 수 있는 시각. 지금 바꿀 수 있으면 null */
export function nextNicknameChangeAt(lastChangedAt: Date | null, now: Date): Date | null {
  if (!lastChangedAt) return null;
  const next = new Date(lastChangedAt.getTime() + NICKNAME_CHANGE_INTERVAL_DAYS * 86_400_000);
  return next > now ? next : null;
}
