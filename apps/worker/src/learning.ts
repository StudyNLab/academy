// 하루 유효 학습 시간 집계 (docs/사이트구조_화면목록.md 9.2). learning_heartbeats(원자료) ➔ learning_time_daily(정산용).
// 같은 날을 다시 돌려도 결과가 같다 (덮어쓴다). 연결이 끊겼던 신호는 24시간 안에 늦게 올 수 있어 이틀 치를 다시 센다.
// 규칙(하루 상한 등)은 그날 시행 중인 배분 정책의 학습 시간 규칙 (M9). 그날 무엇으로 봤는지(구독 · 단건)도 남긴다 (정산의 D3).
import type { Heartbeat, Range } from "@aionit/core";
import {
  dailyLearningTime,
  kstDate,
  kstDayRange,
  LEARNING_RULES_V1,
  learningAccess,
  resolvePolicy,
} from "@aionit/core";
import type { Db } from "@aionit/db";
import { and, eq, gte, inArray, isNotNull, isNull, lt, schema, sql } from "@aionit/db";
import { loadPolicies } from "@aionit/payments";

export async function aggregateLearningDay(db: Db, day: string) {
  const { from, to } = kstDayRange(day);
  const rows = await db
    .select({
      userId: schema.learningHeartbeats.userId,
      courseId: schema.learningHeartbeats.courseId,
      kind: schema.learningHeartbeats.kind,
      at: schema.learningHeartbeats.at,
      payload: schema.learningHeartbeats.payload,
    })
    .from(schema.learningHeartbeats)
    .where(and(gte(schema.learningHeartbeats.at, from), lt(schema.learningHeartbeats.at, to)));
  if (rows.length === 0) return { day, rows: 0 };

  // 빼는 사람: 운영자, 그 과정 강사 본인 (자기 강의를 보는 시간으로 정산이 늘지 않게)
  const operators = new Set(
    (
      await db
        .select({ userId: schema.userRoles.userId })
        .from(schema.userRoles)
        .where(and(eq(schema.userRoles.role, "operator"), isNull(schema.userRoles.revokedAt)))
    ).map((r) => r.userId),
  );
  const owners = new Map(
    (
      await db
        .select({ courseId: schema.courses.id, userId: schema.instructors.userId })
        .from(schema.courses)
        .innerJoin(schema.instructors, eq(schema.instructors.id, schema.courses.ownerInstructorId))
        .where(isNotNull(schema.instructors.userId))
    ).map((r) => [r.courseId, r.userId]),
  );
  const courses = new Map(
    (
      await db
        .select({
          id: schema.courses.id,
          inSubscription: schema.courses.inSubscription,
          ownerInstructorId: schema.courses.ownerInstructorId,
        })
        .from(schema.courses)
    ).map((c) => [c.id, c]),
  );
  const policies = await loadPolicies(db);
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const entitlements = new Map<string, (typeof schema.entitlements.$inferSelect)[]>();
  for (const e of await db
    .select()
    .from(schema.entitlements)
    .where(inArray(schema.entitlements.userId, userIds))) {
    const list = entitlements.get(e.userId) ?? [];
    list.push(e);
    entitlements.set(e.userId, list);
  }

  const groups = new Map<string, { userId: string; courseId: string; beats: Heartbeat[] }>();
  for (const row of rows) {
    const id = `${row.userId}/${row.courseId}`;
    const group = groups.get(id) ?? { userId: row.userId, courseId: row.courseId, beats: [] };
    const payload = row.payload as { activeSec?: number; videoKey?: string; ranges?: Range[] };
    group.beats.push(
      row.kind === "text"
        ? { kind: "text", at: row.at, activeSec: payload.activeSec ?? 0 }
        : { kind: "video", at: row.at, videoKey: payload.videoKey ?? "", ranges: payload.ranges ?? [] },
    );
    groups.set(id, group);
  }

  for (const { userId, courseId, beats } of groups.values()) {
    const excluded = operators.has(userId) || owners.get(courseId) === userId;
    const course = courses.get(courseId);
    const policy = resolvePolicy(
      policies,
      { courseId, instructorId: course?.ownerInstructorId ?? null },
      from,
    );
    const rules = policy?.learningRules ?? LEARNING_RULES_V1;
    const time = dailyLearningTime(beats, { excluded, rules });
    const ruleVersion = rules.version;
    const access = course ? learningAccess(entitlements.get(userId) ?? [], course, day) : "none";
    await db
      .insert(schema.learningTimeDaily)
      .values({ userId, courseId, date: day, ...time, ruleVersion, access })
      .onConflictDoUpdate({
        target: [
          schema.learningTimeDaily.userId,
          schema.learningTimeDaily.courseId,
          schema.learningTimeDaily.date,
        ],
        set: { ...time, ruleVersion, access, createdAt: sql`now()` },
      });
  }
  return { day, rows: groups.size };
}

/** 매일 밤: 어제 · 그제 (KST) */
export async function aggregateRecentDays(db: Db, now = new Date()) {
  const yesterday = kstDate(new Date(now.getTime() - 86_400_000));
  const before = kstDate(new Date(now.getTime() - 2 * 86_400_000));
  return [await aggregateLearningDay(db, before), await aggregateLearningDay(db, yesterday)];
}
