// 수강 만료 알림 메일 D-30 · D-7 (docs/기술설계.md 2.3). 매일 09:00 KST.
// 보낼 메일을 대기열에 넣고 그 자리에서 reminded_* 를 적는다 (다시 돌려도 두 번 보내지 않는다).
// 사이트 알림은 언제나 남기고, 메일은 알림 설정(notification_prefs.expiry_email)을 끈 사람에게는 보내지 않는다 (M7).
import type { EntitlementLike } from "@aionit/core";
import { courseAccess, expiryReminderDue, isDeliverableEmail } from "@aionit/core";
import type { Db } from "@aionit/db";
import { and, eq, gt, inArray, isNotNull, isNull, lte, schema } from "@aionit/db";
import type { MailJob } from "@aionit/mail";

const DAY = 86_400_000;

export async function sendExpiryReminders(
  db: Db,
  deps: { enqueueMail: (job: MailJob) => Promise<void>; baseUrl: string },
  now = new Date(),
): Promise<{ d30: number; d7: number; skipped: number }> {
  const result = { d30: 0, d7: 0, skipped: 0 };
  // 30일(+하루 여유) 안에 끝나는 과정 수강권
  const rows = await db
    .select({ entitlement: schema.entitlements, course: schema.courses, user: schema.users })
    .from(schema.entitlements)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.entitlements.courseId))
    .innerJoin(schema.users, eq(schema.users.id, schema.entitlements.userId))
    .where(
      and(
        eq(schema.entitlements.scope, "course"),
        isNull(schema.entitlements.revokedAt),
        isNotNull(schema.entitlements.endsAt),
        gt(schema.entitlements.endsAt, now),
        lte(schema.entitlements.endsAt, new Date(now.getTime() + 31 * DAY)),
        eq(schema.users.status, "active"),
      ),
    );
  if (rows.length === 0) return result;
  const userIds = [...new Set(rows.map((r) => r.user.id))];
  const all = await db.select().from(schema.entitlements).where(inArray(schema.entitlements.userId, userIds));
  const mailOff = new Set(
    (
      await db
        .select({ userId: schema.notificationPrefs.userId })
        .from(schema.notificationPrefs)
        .where(
          and(
            inArray(schema.notificationPrefs.userId, userIds),
            eq(schema.notificationPrefs.expiryEmail, false),
          ),
        )
    ).map((r) => r.userId),
  );

  for (const { entitlement: e, course, user } of rows) {
    const due = expiryReminderDue(e, now);
    if (!due) continue;
    // 같은 과정을 더 오래 볼 수 있는 다른 수강권(다시 구매 · 구독)이 있으면 알리지 않는다
    const mine: EntitlementLike[] = all.filter((x) => x.userId === user.id);
    const best = courseAccess(mine, course, now);
    const longer =
      best.ok &&
      best.entitlement.id !== e.id &&
      (!best.entitlement.endsAt || best.entitlement.endsAt > e.endsAt!);
    const column =
      due === "d7" ? { remindedD7At: now, remindedD30At: e.remindedD30At ?? now } : { remindedD30At: now };
    // 먼저 적어서 자리를 잡는다: 동시에 두 번 돌아도 한 번만 보낸다
    const [claimed] = await db
      .update(schema.entitlements)
      .set(column)
      .where(
        and(
          eq(schema.entitlements.id, e.id),
          due === "d7" ? isNull(schema.entitlements.remindedD7At) : isNull(schema.entitlements.remindedD30At),
        ),
      )
      .returning({ id: schema.entitlements.id });
    if (!claimed) continue;
    if (longer) {
      result.skipped += 1;
      continue;
    }
    const daysLeft = Math.ceil((e.endsAt!.getTime() - now.getTime()) / DAY);
    await db.insert(schema.notifications).values({
      userId: user.id,
      kind: "expiry",
      title: `수강 기간이 ${daysLeft}일 남았습니다: ${course.title}`,
      url: `/courses/${course.slug}`,
      targetId: e.id,
    });
    if (mailOff.has(user.id) || !isDeliverableEmail(user.email)) {
      result.skipped += 1;
      continue;
    }
    try {
      await deps.enqueueMail({
        template: "expiry-reminder",
        to: user.email,
        userId: user.id,
        courseTitle: course.title,
        daysLeft,
        endsAt: e.endsAt!.toISOString(),
        courseUrl: `${deps.baseUrl}/courses/${course.slug}`,
      });
    } catch (error) {
      // 대기열에 넣지 못했으면 다음 날 다시 보낼 수 있게 되돌린다
      await db
        .update(schema.entitlements)
        .set({ remindedD30At: e.remindedD30At, remindedD7At: e.remindedD7At })
        .where(eq(schema.entitlements.id, e.id));
      throw error;
    }
    result[due] += 1;
  }
  return result;
}
