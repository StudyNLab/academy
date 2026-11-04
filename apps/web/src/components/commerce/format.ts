// 금액 · 날짜 표시 (화면 공통). 시간은 UTC 저장 · KST 표시

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const longDay = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" });
const shortDay = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });
const dayTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});

/** 끝나는 시각(다음 날 0시 KST) ➔ 마지막 이용일 "2027년 11월 3일" */
export const lastDay = (endsAt: Date) => longDay.format(new Date(endsAt.getTime() - 1));
export const formatDay = (at: Date) => shortDay.format(at);
export const formatDayTime = (at: Date) => dayTime.format(at);

/** "1년" · "90일" · "무제한" */
export function periodLabel(days: number | null): string {
  if (!days) return "무제한";
  if (days % 365 === 0) return `${days / 365}년`;
  return `${days}일`;
}
