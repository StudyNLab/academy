// 사이트 안 알림 (머리글 · /my/notifications) + 메일 알림 설정 (M-01). 알림 주소는 우리 사이트 안 경로만 넣는다.
import { isInternalPath } from "@aionit/core";
import type { Db, NotificationKind } from "@aionit/db";
import { and, count, desc, eq, isNull, schema } from "@aionit/db";
import type { Inserter } from "./records";
import { SupportError } from "./support-error";

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  url: string;
  targetId?: string | null;
}

export async function notify(db: Inserter, input: NotifyInput): Promise<void> {
  if (!isInternalPath(input.url)) throw new Error(`알림 주소는 사이트 안 경로만: ${input.url}`);
  await db.insert(schema.notifications).values({
    userId: input.userId,
    kind: input.kind,
    title: input.title.slice(0, 200),
    body: input.body?.slice(0, 300) ?? null,
    url: input.url,
    targetId: input.targetId ?? null,
  });
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return row?.n ?? 0;
}

export async function myNotifications(db: Db, userId: string, limit = 50) {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);
}

/** 알림을 열면 읽음으로 하고 그 주소를 돌려준다 (남의 알림은 없는 것처럼) */
export async function openNotification(
  db: Db,
  userId: string,
  id: string,
  now = new Date(),
): Promise<string> {
  const [row] = await db
    .select({ url: schema.notifications.url, readAt: schema.notifications.readAt })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)));
  if (!row) throw new SupportError(404, "NOT_FOUND", "알림을 찾을 수 없습니다.");
  if (!row.readAt)
    await db.update(schema.notifications).set({ readAt: now }).where(eq(schema.notifications.id, id));
  return isInternalPath(row.url) ? row.url : "/my/notifications";
}

export async function markAllRead(db: Db, userId: string, now = new Date()): Promise<void> {
  await db
    .update(schema.notifications)
    .set({ readAt: now })
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
}

/** 같은 대상(질문 등)의 알림을 아직 읽지 않았나: 읽지 않은 알림이 있으면 메일을 또 보내지 않는다 */
export async function hasUnread(db: Db, userId: string, kind: NotificationKind, targetId: string) {
  const [row] = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.kind, kind),
        eq(schema.notifications.targetId, targetId),
        isNull(schema.notifications.readAt),
      ),
    )
    .limit(1);
  return !!row;
}

// ---- 메일 알림 설정 ----

export interface NotificationPrefs {
  qnaAnswerEmail: boolean;
  expiryEmail: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = { qnaAnswerEmail: true, expiryEmail: true };

export async function notificationPrefs(db: Db, userId: string): Promise<NotificationPrefs> {
  const [row] = await db
    .select({
      qnaAnswerEmail: schema.notificationPrefs.qnaAnswerEmail,
      expiryEmail: schema.notificationPrefs.expiryEmail,
    })
    .from(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, userId));
  return row ?? DEFAULT_PREFS;
}

export async function setNotificationPrefs(
  db: Db,
  userId: string,
  change: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  const next = { ...(await notificationPrefs(db, userId)), ...change };
  await db
    .insert(schema.notificationPrefs)
    .values({ userId, ...next })
    .onConflictDoUpdate({ target: schema.notificationPrefs.userId, set: { ...next, updatedAt: new Date() } });
  return next;
}
