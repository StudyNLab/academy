// 1:1 문의 상태 표시 (M-05 · AD-13 공통)
export const INQUIRY_STATUS = {
  open: ["답변 기다림", "warn"],
  answered: ["답변 완료", "done"],
  closed: ["끝남", "muted"],
} as const;
