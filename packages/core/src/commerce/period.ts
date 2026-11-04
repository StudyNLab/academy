// 수강 기간 · 연장 · 만료 알림. 기간은 KST 날짜로 센다: "n일" = 오늘부터 n일 뒤 그날 끝(다음 날 0시 KST)까지.
import { daysLeft } from "../learning/entitlement";
import { kstDate, kstDayRange } from "../learning/learning-time";

const DAY = 86_400_000;

/** 오늘(KST)부터 n일 뒤 그날 끝. 2026-11-03 에 1년(365일) ➔ 2027-11-04 0시 KST (= 2027-11-03 까지) */
export function endOfKstDayAfter(now: Date, days: number): Date {
  if (!(Number.isInteger(days) && days >= 1))
    throw new RangeError(`기간은 1일 이상 정수여야 합니다: ${days}`);
  return new Date(kstDayRange(kstDate(now)).from.getTime() + (days + 1) * DAY);
}

/** 두 시각 사이의 KST 날짜 차이 (같은 날 0, 다음 날 1) */
export function kstDaysBetween(from: Date, to: Date): number {
  return Math.round(
    (kstDayRange(kstDate(to)).from.getTime() - kstDayRange(kstDate(from)).from.getTime()) / DAY,
  );
}

/**
 * 연장권: 기존 수강권의 끝나는 날을 늘린다.
 *   아직 이용 중 ➔ 지금 끝나는 날 + n일 (빈 날 없이 이어진다)
 *   이미 끝남   ➔ 오늘부터 n일 (끝난 기간을 메우지 않는다)
 */
export function extendedEnd(currentEnd: Date | null, now: Date, days: number): Date {
  if (!currentEnd) throw new RangeError("무제한 수강권은 연장할 수 없습니다");
  if (!(Number.isInteger(days) && days >= 1))
    throw new RangeError(`연장 기간은 1일 이상 정수여야 합니다: ${days}`);
  return currentEnd > now ? new Date(currentEnd.getTime() + days * DAY) : endOfKstDayAfter(now, days);
}

/** 연장권 환불: 늘린 n일을 거둔다. 그 결과가 이미 지난 시각이면 지금 끝난다 */
export function revertedEnd(currentEnd: Date, days: number, now: Date): Date {
  const back = new Date(currentEnd.getTime() - days * DAY);
  return back > now ? back : now;
}

/** 만료 알림 메일 (D-30 · D-7). 이미 보낸 것은 다시 보내지 않고, D-7 이 지나 처음 보는 경우 D-30 은 건너뛴다 */
export function expiryReminderDue(
  e: { endsAt: Date | null; remindedD30At: Date | null; remindedD7At: Date | null; revokedAt: Date | null },
  now: Date,
): "d30" | "d7" | null {
  if (!e.endsAt || e.revokedAt || e.endsAt <= now) return null;
  const left = daysLeft(e.endsAt, now)!;
  if (left <= 7) return e.remindedD7At ? null : "d7";
  if (left <= 30) return e.remindedD30At ? null : "d30";
  return null;
}
