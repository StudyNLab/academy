// 강의를 볼 수 있나? 모든 화면 · API 가 이 규칙 하나만 쓴다 (docs/데이터모델.md 3.8)
//   지금 시각에 유효한 수강권이 있다
//     (scope = course 이고 course_id 가 이 과정) 또는 (scope = subscription_catalog 이고 이 과정이 구독 포함)
//     그리고 starts_at ≤ 지금 < ends_at(없으면 무한) 그리고 revoked_at 없음

export interface EntitlementLike {
  id: string;
  scope: "course" | "subscription_catalog";
  courseId: string | null;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
}

export interface CourseLike {
  id: string;
  inSubscription: boolean;
}

export type Access =
  | { ok: true; entitlement: EntitlementLike }
  | { ok: false; reason: "none" | "expired" | "not_started"; lastEndedAt?: Date };

function covers(e: EntitlementLike, course: CourseLike): boolean {
  return e.scope === "course" ? e.courseId === course.id : course.inSubscription;
}

export function courseAccess(
  entitlements: readonly EntitlementLike[],
  course: CourseLike,
  now: Date,
): Access {
  const relevant = entitlements.filter((e) => !e.revokedAt && covers(e, course));
  const active = relevant
    .filter((e) => e.startsAt <= now && (!e.endsAt || now < e.endsAt))
    // 여러 개면 가장 오래 가는 것 (무제한 > 늦게 끝나는 것)
    .sort((a, b) => (b.endsAt?.getTime() ?? Infinity) - (a.endsAt?.getTime() ?? Infinity));
  if (active[0]) return { ok: true, entitlement: active[0] };
  const ended = relevant
    .filter((e) => e.endsAt && e.endsAt <= now)
    .sort((a, b) => b.endsAt!.getTime() - a.endsAt!.getTime());
  if (ended[0]) return { ok: false, reason: "expired", lastEndedAt: ended[0].endsAt! };
  if (relevant.some((e) => e.startsAt > now)) return { ok: false, reason: "not_started" };
  return { ok: false, reason: "none" };
}

/** 만료까지 남은 날 (30일 안이면 화면에 D-n). 무제한이면 null */
export function daysLeft(endsAt: Date | null, now: Date): number | null {
  if (!endsAt) return null;
  return Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000);
}
