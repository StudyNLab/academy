// 수강권: 강의를 볼 수 있는지 판단 + 운영자 수동 발급 · 회수 · 기간 조정 (AD-08). 운영자 작업은 모두 audit_logs 에 남긴다.
import type { Access } from "@aionit/core";
import { courseAccess, kstDate, kstDayRange } from "@aionit/core";
import type { Db } from "@aionit/db";
import { and, desc, eq, isNull, schema } from "@aionit/db";
import { writeAudit } from "./records";
import type { Viewer } from "./viewer";

export class EntitlementError extends Error {
  readonly status: number;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.status = code.endsWith("NOT_FOUND") ? 404 : 400;
  }
}

export async function userEntitlements(db: Db, userId: string) {
  return db.select().from(schema.entitlements).where(eq(schema.entitlements.userId, userId));
}

/**
 * 이 사람이 이 과정을 볼 수 있나.
 *   staff: 운영자 · 그 과정 강사 본인 (수강권 없이 전부 본다, 학습 시간은 정산에서 빠진다)
 *   그 밖: 수강권 규칙 (packages/core courseAccess)
 */
export type CourseViewAccess =
  { kind: "staff" } | { kind: "learner"; access: Access } | { kind: "anonymous" };

export async function viewAccess(
  db: Db,
  viewer: Viewer | null,
  course: { id: string; inSubscription: boolean; ownerInstructorId: string },
  now = new Date(),
): Promise<CourseViewAccess> {
  if (!viewer) return { kind: "anonymous" };
  if (viewer.roles.includes("operator")) return { kind: "staff" };
  if (viewer.roles.includes("instructor")) {
    const [own] = await db
      .select({ id: schema.instructors.id })
      .from(schema.instructors)
      .where(
        and(
          eq(schema.instructors.id, course.ownerInstructorId),
          eq(schema.instructors.userId, viewer.userId),
        ),
      );
    if (own) return { kind: "staff" };
  }
  return { kind: "learner", access: courseAccess(await userEntitlements(db, viewer.userId), course, now) };
}

export function canLearn(access: CourseViewAccess): boolean {
  return access.kind === "staff" || (access.kind === "learner" && access.access.ok);
}

/** 첫 이용 (첫 재생 · 첫 첨부 받기). "7일 안 + 이용 안 함" 환불 판단에 쓰므로 처음 한 번만 적는다 */
export async function markFirstUse(db: Db, entitlementId: string, now = new Date()): Promise<void> {
  await db
    .update(schema.entitlements)
    .set({ firstUsedAt: now })
    .where(and(eq(schema.entitlements.id, entitlementId), isNull(schema.entitlements.firstUsedAt)));
}

// ---- 운영자 작업 (AD-08) ----

export async function entitlementsForAdmin(db: Db, userId: string) {
  return db
    .select({
      entitlement: schema.entitlements,
      courseTitle: schema.courses.title,
      courseSlug: schema.courses.slug,
    })
    .from(schema.entitlements)
    .leftJoin(schema.courses, eq(schema.courses.id, schema.entitlements.courseId))
    .where(eq(schema.entitlements.userId, userId))
    .orderBy(desc(schema.entitlements.createdAt));
}

const DAY = 86_400_000;

export async function grantEntitlement(
  db: Db,
  input: {
    actorId: string;
    userId: string;
    courseId: string;
    /** 없으면 무제한 */
    days: number | null;
    reason: string;
    headers?: Headers | null;
  },
  now = new Date(),
): Promise<string> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId));
    if (!user || user.status === "withdrawn")
      throw new EntitlementError("NOT_FOUND", "회원을 찾을 수 없습니다.");
    const [course] = await tx
      .select({ id: schema.courses.id, status: schema.courses.status })
      .from(schema.courses)
      .where(eq(schema.courses.id, input.courseId));
    if (!course) throw new EntitlementError("COURSE_NOT_FOUND", "과정을 찾을 수 없습니다.");
    // n일 = 오늘부터 n일 뒤 그날 끝(KST)까지
    const endsAt = input.days
      ? new Date(kstDayRange(kstDate(now)).from.getTime() + (input.days + 1) * DAY)
      : null;
    const [row] = await tx
      .insert(schema.entitlements)
      .values({
        userId: input.userId,
        scope: "course",
        courseId: input.courseId,
        sourceType: "admin_grant",
        startsAt: now,
        endsAt,
        grantedBy: input.actorId,
        note: input.reason,
      })
      .returning({ id: schema.entitlements.id });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "entitlement.grant",
      targetType: "entitlement",
      targetId: row!.id,
      after: { userId: input.userId, courseId: input.courseId, endsAt, reason: input.reason },
      headers: input.headers,
    });
    return row!.id;
  });
}

async function loadForChange(tx: Pick<Db, "select">, id: string) {
  const [row] = await tx.select().from(schema.entitlements).where(eq(schema.entitlements.id, id));
  if (!row) throw new EntitlementError("NOT_FOUND", "수강권을 찾을 수 없습니다.");
  if (row.revokedAt) throw new EntitlementError("REVOKED", "이미 회수한 수강권입니다.");
  return row;
}

export async function revokeEntitlement(
  db: Db,
  input: { actorId: string; id: string; reason: string; headers?: Headers | null },
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await loadForChange(tx, input.id);
    await tx
      .update(schema.entitlements)
      .set({ revokedAt: now, revokeReason: input.reason })
      .where(eq(schema.entitlements.id, input.id));
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "entitlement.revoke",
      targetType: "entitlement",
      targetId: input.id,
      before: { endsAt: row.endsAt },
      after: { revokedAt: now, reason: input.reason },
      headers: input.headers,
    });
  });
}

/** 끝나는 날 바꾸기. null 이면 무제한 */
export async function adjustEntitlement(
  db: Db,
  input: { actorId: string; id: string; endsAt: Date | null; reason: string; headers?: Headers | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await loadForChange(tx, input.id);
    if (input.endsAt && input.endsAt <= row.startsAt)
      throw new EntitlementError("INVALID_END", "끝나는 날은 시작보다 뒤여야 합니다.");
    await tx
      .update(schema.entitlements)
      .set({ endsAt: input.endsAt, remindedD30At: null, remindedD7At: null })
      .where(eq(schema.entitlements.id, input.id));
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "entitlement.adjust",
      targetType: "entitlement",
      targetId: input.id,
      before: { endsAt: row.endsAt },
      after: { endsAt: input.endsAt, reason: input.reason },
      headers: input.headers,
    });
  });
}
