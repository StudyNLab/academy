// 학습 (L-01 내 강의실 · L-02 학습 화면) 읽기 + 읽은 위치 · 영상 시청 · 실습 체크 · 학습 신호 저장.
// 진도는 chapter_key 에 묶는다: 새 버전이 공개돼도 같은 key 의 진도는 이어지고, 사라진 챕터는 진도율에서 빠진다.
import type { Range } from "@aionit/core";
import {
  courseAccess,
  coursePercent,
  daysLeft,
  isChapterDone,
  isTextDone,
  isVideoDone,
  LEARNING_RULES_V1,
  mergeRanges,
  rangesLength,
} from "@aionit/core";
import type { Db } from "@aionit/db";
import { and, asc, desc, eq, inArray, isNull, or, schema, sql } from "@aionit/db";
import type { LabItem, TocItem } from "./catalog";
import { courseSlots, playableSlot, slotView } from "./catalog";
import { insertSelfCheckSlots, renderVideoSlots, textLength, withMainVideo } from "./content-render";
import type { CourseViewAccess } from "./entitlements";
import { canLearn, markFirstUse, userEntitlements, viewAccess } from "./entitlements";
import type { Viewer } from "./viewer";

type CourseRow = typeof schema.courses.$inferSelect;

async function publishedCourse(db: Db, where: { slug: string } | { id: string }) {
  const [row] = await db
    .select({ course: schema.courses, instructor: schema.instructors.displayName })
    .from(schema.courses)
    .innerJoin(schema.instructors, eq(schema.instructors.id, schema.courses.ownerInstructorId))
    .where(
      and(
        "slug" in where ? eq(schema.courses.slug, where.slug) : eq(schema.courses.id, where.id),
        eq(schema.courses.status, "published"),
      ),
    );
  return row?.course.publishedVersionId ? row : null;
}

async function chapterList(db: Db, versionId: string) {
  const rows = await db
    .select({
      key: schema.chapters.chapterKey,
      label: schema.chapters.label,
      title: schema.chapters.title,
      toc: schema.chapters.toc,
      labs: schema.chapters.labs,
    })
    .from(schema.chapters)
    .where(eq(schema.chapters.courseVersionId, versionId))
    .orderBy(asc(schema.chapters.sortOrder));
  return rows.map((c) => ({ ...c, toc: c.toc as TocItem[], labs: c.labs as LabItem[] }));
}

const checkKey = (chapterKey: string, sectionId: string, itemId: string) =>
  `${chapterKey}/${sectionId}/${itemId}`;

/** 한 과정의 내 학습 기록 전부 */
async function courseRecords(db: Db, userId: string, courseId: string) {
  const mine = (t: typeof schema.chapterProgress | typeof schema.videoWatch | typeof schema.selfChecks) =>
    sql`${t.userId} = ${userId} and ${t.courseId} = ${courseId}`;
  const [progress, videos, checks] = await Promise.all([
    db.select().from(schema.chapterProgress).where(mine(schema.chapterProgress)),
    db.select().from(schema.videoWatch).where(mine(schema.videoWatch)),
    db
      .select()
      .from(schema.selfChecks)
      .where(and(mine(schema.selfChecks), isNull(schema.selfChecks.uncheckedAt))),
  ]);
  return {
    progress: new Map(progress.map((p) => [p.chapterKey, p])),
    videos: new Map(videos.map((v) => [v.videoKey, v])),
    checks: new Set(checks.map((c) => checkKey(c.chapterKey, c.sectionId, c.itemId))),
  };
}

// ---- L-02 학습 화면 ----

export type LearnResult =
  | { kind: "not_found" }
  | {
      kind: "denied";
      course: CourseRow;
      access: CourseViewAccess;
      hasPreview: boolean;
      firstPreviewKey: string | null;
    }
  | ({ kind: "ok" } & LearnChapter);

export type LearnChapter = Awaited<ReturnType<typeof buildChapter>>;

export async function learnChapter(
  db: Db,
  viewer: Viewer | null,
  slug: string,
  chapterKey: string,
  origin: string,
): Promise<LearnResult> {
  const found = await publishedCourse(db, { slug });
  if (!found) return { kind: "not_found" };
  const chapters = await chapterList(db, found.course.publishedVersionId!);
  if (!chapters.some((c) => c.key === chapterKey)) return { kind: "not_found" };
  const access = await viewAccess(db, viewer, found.course);
  if (!viewer || !canLearn(access)) {
    const previews = await db
      .select({ chapterKey: schema.previewRules.chapterKey })
      .from(schema.previewRules)
      .where(eq(schema.previewRules.courseId, found.course.id));
    const previewKeys = new Set(previews.map((p) => p.chapterKey));
    return {
      kind: "denied",
      course: found.course,
      access,
      hasPreview: previewKeys.has(chapterKey),
      firstPreviewKey: chapters.find((c) => previewKeys.has(c.key))?.key ?? null,
    };
  }
  return { kind: "ok", ...(await buildChapter(db, viewer, found, chapters, chapterKey, access, origin)) };
}

async function buildChapter(
  db: Db,
  viewer: Viewer,
  found: NonNullable<Awaited<ReturnType<typeof publishedCourse>>>,
  chapters: Awaited<ReturnType<typeof chapterList>>,
  chapterKey: string,
  access: CourseViewAccess,
  origin: string,
) {
  const { course } = found;
  const index = chapters.findIndex((c) => c.key === chapterKey);
  const chapter = chapters[index]!;
  const [[row], slots, attachments, records] = await Promise.all([
    db
      .select({ html: schema.chapters.contentHtml })
      .from(schema.chapters)
      .where(
        and(
          eq(schema.chapters.courseVersionId, course.publishedVersionId!),
          eq(schema.chapters.chapterKey, chapterKey),
        ),
      ),
    courseSlots(db, course.id),
    db
      .select({ id: schema.attachments.id, title: schema.attachments.title, size: schema.files.size })
      .from(schema.attachments)
      .innerJoin(schema.files, eq(schema.files.id, schema.attachments.fileId))
      .where(
        and(
          eq(schema.attachments.courseId, course.id),
          or(eq(schema.attachments.chapterKey, chapterKey), isNull(schema.attachments.chapterKey)),
        ),
      )
      .orderBy(asc(schema.attachments.sortOrder)),
    courseRecords(db, viewer.userId, course.id),
  ]);
  // 다시 열면 멈춘 곳부터 (다 본 영상 · 끝 10초 안은 처음부터)
  const startAt: Record<string, number> = {};
  for (const [key, watch] of records.videos) {
    const nearEnd = watch.durationSec && watch.lastPositionSec > watch.durationSec - 10;
    if (!watch.completedAt && !nearEnd && watch.lastPositionSec > 5) startAt[key] = watch.lastPositionSec;
  }
  const track = { origin, startAt };
  const views = new Map(slots.map((s) => [s.key, slotView(s)]));
  const main = slots.find((s) => s.chapterKey === chapterKey && s.kind === "main");
  const labs = chapter.labs.filter((l) => l.self_check.length > 0);
  const html = insertSelfCheckSlots(
    withMainVideo(
      renderVideoSlots(row!.html, views, "public", track),
      main ? slotView(main) : undefined,
      "public",
      track,
    ),
    labs.map((l) => l.section_id),
  );
  const videos = slots
    .filter((s) => s.chapterKey === chapterKey && playableSlot(s))
    .map((s) => {
      const watch = records.videos.get(s.key);
      return {
        key: s.key,
        title: s.title,
        kind: s.kind,
        hosted: s.source === "hosted",
        sectionId: s.sectionId,
        lastPositionSec: watch?.lastPositionSec ?? 0,
        done: !!watch?.completedAt,
      };
    });
  const progress = records.progress.get(chapterKey) ?? null;
  const entitlement = access.kind === "learner" && access.access.ok ? access.access.entitlement : null;
  return {
    course: { id: course.id, slug: course.slug, title: course.title },
    instructor: found.instructor,
    staff: access.kind === "staff",
    daysLeft: entitlement ? daysLeft(entitlement.endsAt, new Date()) : null,
    percent: coursePercent(
      chapters.map((c) => c.key),
      [...records.progress.values()].filter((p) => p.completedAt).map((p) => p.chapterKey),
    ),
    chapters: chapters.map((c) => ({
      key: c.key,
      label: c.label,
      title: c.title,
      done: !!records.progress.get(c.key)?.completedAt,
    })),
    chapter: { key: chapter.key, label: chapter.label, title: chapter.title, toc: chapter.toc },
    prev: chapters[index - 1] ? { key: chapters[index - 1]!.key, title: chapters[index - 1]!.title } : null,
    next: chapters[index + 1] ? { key: chapters[index + 1]!.key, title: chapters[index + 1]!.title } : null,
    html,
    videos,
    /** 영상 key ➔ 이어서 볼 위치(초). 자체 서버 영상은 화면이 이 위치에서 시작한다 */
    startAt,
    labs: labs.map((l) => ({
      sectionId: l.section_id,
      title: l.title,
      items: l.self_check.map((i) => ({
        id: i.id,
        text: i.text,
        checked: records.checks.has(checkKey(chapterKey, l.section_id, i.id)),
      })),
    })),
    attachments,
    progress: progress
      ? {
          lastSectionId: progress.lastSectionId,
          textDone: !!progress.textDoneAt,
          completed: !!progress.completedAt,
        }
      : null,
  };
}

/** /learn/{slug} ➔ 이어서 볼 챕터 (마지막으로 본 챕터, 없으면 첫 챕터) */
export async function resumeChapter(db: Db, viewer: Viewer | null, slug: string): Promise<string | null> {
  const found = await publishedCourse(db, { slug });
  if (!found) return null;
  const chapters = await chapterList(db, found.course.publishedVersionId!);
  if (!viewer) return chapters[0]?.key ?? null;
  const recent = await db
    .select({ key: schema.chapterProgress.chapterKey })
    .from(schema.chapterProgress)
    .where(
      and(
        eq(schema.chapterProgress.userId, viewer.userId),
        eq(schema.chapterProgress.courseId, found.course.id),
      ),
    )
    .orderBy(desc(schema.chapterProgress.updatedAt));
  const keys = new Set(chapters.map((c) => c.key));
  return recent.find((r) => keys.has(r.key))?.key ?? chapters[0]?.key ?? null;
}

// ---- L-01 내 강의실 ----

export async function myClassroom(db: Db, userId: string, now = new Date()) {
  const [entitlements, courses] = await Promise.all([
    userEntitlements(db, userId),
    db
      .select({ course: schema.courses, instructor: schema.instructors.displayName })
      .from(schema.courses)
      .innerJoin(schema.instructors, eq(schema.instructors.id, schema.courses.ownerInstructorId))
      .where(eq(schema.courses.status, "published"))
      .orderBy(asc(schema.courses.sortOrder)),
  ]);
  const mine = courses
    .map((c) => ({ ...c, access: courseAccess(entitlements, c.course, now) }))
    .filter((c) => c.course.publishedVersionId && (c.access.ok || c.access.reason === "expired"));
  if (mine.length === 0) return [];
  const versionIds = mine.map((c) => c.course.publishedVersionId!);
  const courseIds = mine.map((c) => c.course.id);
  const [chapterRows, progressRows] = await Promise.all([
    db
      .select({
        versionId: schema.chapters.courseVersionId,
        key: schema.chapters.chapterKey,
        label: schema.chapters.label,
        title: schema.chapters.title,
      })
      .from(schema.chapters)
      .where(inArray(schema.chapters.courseVersionId, versionIds))
      .orderBy(asc(schema.chapters.sortOrder)),
    db
      .select()
      .from(schema.chapterProgress)
      .where(
        and(eq(schema.chapterProgress.userId, userId), inArray(schema.chapterProgress.courseId, courseIds)),
      )
      .orderBy(desc(schema.chapterProgress.updatedAt)),
  ]);
  return mine
    .map(({ course, instructor, access }) => {
      const chapters = chapterRows.filter((c) => c.versionId === course.publishedVersionId);
      const progress = progressRows.filter((p) => p.courseId === course.id);
      const keys = chapters.map((c) => c.key);
      const last = progress.find((p) => keys.includes(p.chapterKey));
      const resume = chapters.find((c) => c.key === last?.chapterKey) ?? chapters[0] ?? null;
      return {
        id: course.id,
        slug: course.slug,
        title: course.title,
        instructor,
        active: access.ok,
        endsAt: access.ok ? access.entitlement.endsAt : (access.lastEndedAt ?? null),
        daysLeft: access.ok ? daysLeft(access.entitlement.endsAt, now) : null,
        percent: coursePercent(
          keys,
          progress.filter((p) => p.completedAt).map((p) => p.chapterKey),
        ),
        chapterCount: chapters.length,
        resume,
        lastStudiedAt: last?.updatedAt ?? null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (b.lastStudiedAt?.getTime() ?? 0) - (a.lastStudiedAt?.getTime() ?? 0),
    );
}

export type ClassroomItem = Awaited<ReturnType<typeof myClassroom>>[number];

// ---- 저장 (API) ----

export class LearningError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** API 공통: 이 과정을 학습할 수 있는 사람인가 + 이 챕터가 지금 공개 버전에 있나 */
export async function learnerContext(db: Db, viewer: Viewer, courseId: string) {
  const found = await publishedCourse(db, { id: courseId });
  if (!found) throw new LearningError(404, "NOT_FOUND", "과정을 찾을 수 없습니다.");
  const access = await viewAccess(db, viewer, found.course);
  if (!canLearn(access)) throw new LearningError(403, "NO_ENTITLEMENT", "수강권이 없거나 끝났습니다.");
  const chapters = await chapterList(db, found.course.publishedVersionId!);
  return { course: found.course, access, chapters };
}

type Context = Awaited<ReturnType<typeof learnerContext>>;

function chapterOf(ctx: Context, chapterKey: string) {
  const chapter = ctx.chapters.find((c) => c.key === chapterKey);
  if (!chapter) throw new LearningError(404, "CHAPTER_NOT_FOUND", "챕터를 찾을 수 없습니다.");
  return chapter;
}

async function ensureProgress(db: Db, userId: string, courseId: string, chapterKey: string) {
  await db.insert(schema.chapterProgress).values({ userId, courseId, chapterKey }).onConflictDoNothing();
}

/** 읽은 위치 (스크롤이 멈추고 5초 뒤 · 화면을 떠날 때) */
export async function saveReadPosition(
  db: Db,
  userId: string,
  ctx: Context,
  input: { chapterKey: string; sectionId: string | null; readRatio: number; reachedEnd: boolean },
  now = new Date(),
): Promise<ChapterStatus> {
  chapterOf(ctx, input.chapterKey);
  await ensureProgress(db, userId, ctx.course.id, input.chapterKey);
  const where = and(
    eq(schema.chapterProgress.userId, userId),
    eq(schema.chapterProgress.courseId, ctx.course.id),
    eq(schema.chapterProgress.chapterKey, input.chapterKey),
  );
  const [row] = await db.select().from(schema.chapterProgress).where(where);
  await db
    .update(schema.chapterProgress)
    .set({
      // 맨 위(Section 앞)로 돌아간 것은 "마지막으로 읽은 곳"을 지우지 않는다
      lastSectionId: input.sectionId ?? row?.lastSectionId ?? null,
      readRatio: Math.max(row?.readRatio ?? 0, Math.min(1, Math.max(0, input.readRatio))),
      reachedEndAt: row?.reachedEndAt ?? (input.reachedEnd ? now : null),
    })
    .where(where);
  return recomputeChapter(db, userId, ctx, input.chapterKey, now);
}

export async function setSelfCheck(
  db: Db,
  userId: string,
  ctx: Context,
  input: { chapterKey: string; sectionId: string; itemId: string; checked: boolean },
  now = new Date(),
): Promise<ChapterStatus> {
  const chapter = chapterOf(ctx, input.chapterKey);
  const lab = chapter.labs.find((l) => l.section_id === input.sectionId);
  if (!lab?.self_check.some((i) => i.id === input.itemId))
    throw new LearningError(404, "CHECK_NOT_FOUND", "확인 항목을 찾을 수 없습니다.");
  const values = input.checked ? { checkedAt: now, uncheckedAt: null } : { uncheckedAt: now };
  await db
    .insert(schema.selfChecks)
    .values({
      userId,
      courseId: ctx.course.id,
      chapterKey: input.chapterKey,
      sectionId: input.sectionId,
      itemId: input.itemId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        schema.selfChecks.userId,
        schema.selfChecks.courseId,
        schema.selfChecks.chapterKey,
        schema.selfChecks.sectionId,
        schema.selfChecks.itemId,
      ],
      set: values,
    });
  await ensureProgress(db, userId, ctx.course.id, input.chapterKey);
  return recomputeChapter(db, userId, ctx, input.chapterKey, now);
}

export type HeartbeatInput =
  | { chapterKey: string; kind: "text"; at: string; activeSec: number }
  | {
      chapterKey: string;
      kind: "video";
      at: string;
      videoKey: string;
      ranges: Range[];
      positionSec: number;
      durationSec: number;
    };

/** 학습 신호 받을 수 있는 시각: 24시간 안, 미래는 1분까지 (기기 시계 차이) */
const MAX_AGE_MS = 24 * 3600_000;
const MAX_SKEW_MS = 60_000;
/** 영상 신호 하나(30초)에 들어갈 수 있는 콘텐츠 시간: 2배속 + 여유 */
const MAX_VIDEO_SEC_PER_BEAT = LEARNING_RULES_V1.bucketSec * 2.5;

export async function recordHeartbeats(
  db: Db,
  userId: string,
  ctx: Context,
  beats: readonly HeartbeatInput[],
  now = new Date(),
): Promise<{ accepted: number; chapters: ChapterStatus[] }> {
  const slots = await courseSlots(db, ctx.course.id);
  const accepted: (typeof schema.learningHeartbeats.$inferInsert)[] = [];
  const textBuckets = new Map<string, Map<number, number>>();
  const videoUpdates = new Map<
    string,
    { chapterKey: string; ranges: Range[]; positionSec: number; durationSec: number }
  >();
  for (const beat of beats) {
    const at = new Date(beat.at);
    if (
      Number.isNaN(at.getTime()) ||
      at.getTime() < now.getTime() - MAX_AGE_MS ||
      at.getTime() > now.getTime() + MAX_SKEW_MS
    )
      continue;
    if (!ctx.chapters.some((c) => c.key === beat.chapterKey)) continue;
    if (beat.kind === "text") {
      const activeSec = Math.min(LEARNING_RULES_V1.bucketSec, Math.max(0, beat.activeSec));
      if (activeSec <= 0) continue;
      accepted.push({
        userId,
        courseId: ctx.course.id,
        chapterKey: beat.chapterKey,
        kind: "text",
        at,
        payload: { activeSec },
      });
      const bucket = Math.floor(at.getTime() / 1000 / LEARNING_RULES_V1.bucketSec);
      const perChapter = textBuckets.get(beat.chapterKey) ?? new Map<number, number>();
      perChapter.set(
        bucket,
        Math.min(LEARNING_RULES_V1.bucketSec, (perChapter.get(bucket) ?? 0) + activeSec),
      );
      textBuckets.set(beat.chapterKey, perChapter);
    } else {
      const slot = slots.find(
        (s) => s.key === beat.videoKey && s.chapterKey === beat.chapterKey && playableSlot(s),
      );
      if (!slot) continue;
      const duration = Math.min(6 * 3600, Math.max(0, beat.durationSec));
      const ranges = mergeRanges(
        beat.ranges.map(([s, e]) => [Math.max(0, s), Math.min(duration || e, e)] as Range),
      );
      if (rangesLength(ranges) > MAX_VIDEO_SEC_PER_BEAT) continue;
      accepted.push({
        userId,
        courseId: ctx.course.id,
        chapterKey: beat.chapterKey,
        kind: "video",
        at,
        payload: { videoKey: beat.videoKey, ranges },
      });
      const update = videoUpdates.get(beat.videoKey) ?? {
        chapterKey: beat.chapterKey,
        ranges: [],
        positionSec: 0,
        durationSec: 0,
      };
      update.ranges.push(...ranges);
      update.positionSec = Math.max(0, Math.round(beat.positionSec));
      update.durationSec = Math.max(update.durationSec, Math.round(duration));
      videoUpdates.set(beat.videoKey, update);
    }
  }
  if (accepted.length === 0) return { accepted: 0, chapters: [] };
  await db.insert(schema.learningHeartbeats).values(accepted);

  const touched = new Set<string>();
  for (const [chapterKey, buckets] of textBuckets) {
    const seconds = [...buckets.values()].reduce((n, s) => n + s, 0);
    await ensureProgress(db, userId, ctx.course.id, chapterKey);
    const where = and(
      eq(schema.chapterProgress.userId, userId),
      eq(schema.chapterProgress.courseId, ctx.course.id),
      eq(schema.chapterProgress.chapterKey, chapterKey),
    );
    const [row] = await db
      .select({ textSeconds: schema.chapterProgress.textSeconds })
      .from(schema.chapterProgress)
      .where(where);
    await db
      .update(schema.chapterProgress)
      .set({ textSeconds: (row?.textSeconds ?? 0) + Math.round(seconds) })
      .where(where);
    touched.add(chapterKey);
  }
  for (const [videoKey, update] of videoUpdates) {
    const where = and(
      eq(schema.videoWatch.userId, userId),
      eq(schema.videoWatch.courseId, ctx.course.id),
      eq(schema.videoWatch.videoKey, videoKey),
    );
    await db
      .insert(schema.videoWatch)
      .values({ userId, courseId: ctx.course.id, videoKey })
      .onConflictDoNothing();
    const [row] = await db.select().from(schema.videoWatch).where(where);
    const ranges = mergeRanges([...((row?.watchedRanges as Range[] | undefined) ?? []), ...update.ranges]);
    const durationSec = update.durationSec || row?.durationSec || null;
    const done = isVideoDone(rangesLength(ranges), durationSec, LEARNING_RULES_V1.videoCompleteRatio);
    await db
      .update(schema.videoWatch)
      .set({
        watchedRanges: ranges,
        lastPositionSec: update.positionSec,
        durationSec,
        completedAt: row?.completedAt ?? (done ? now : null),
      })
      .where(where);
    await ensureProgress(db, userId, ctx.course.id, update.chapterKey);
    touched.add(update.chapterKey);
  }
  // 첫 재생 = 수강권 "이용함" (7일 안 이용하지 않았으면 전액 환불)
  if (videoUpdates.size > 0 && ctx.access.kind === "learner" && ctx.access.access.ok) {
    await markFirstUse(db, ctx.access.access.entitlement.id, now);
  }
  const chapters: ChapterStatus[] = [];
  for (const chapterKey of touched) chapters.push(await recomputeChapter(db, userId, ctx, chapterKey, now));
  return { accepted: accepted.length, chapters };
}

export interface ChapterStatus {
  chapterKey: string;
  textDone: boolean;
  completed: boolean;
  videosDone: string[];
}

/** 교재 완료 · 챕터 완료를 다시 판단한다. 한 번 완료한 것은 되돌리지 않는다 */
export async function recomputeChapter(
  db: Db,
  userId: string,
  ctx: Context,
  chapterKey: string,
  now = new Date(),
): Promise<ChapterStatus> {
  const chapter = chapterOf(ctx, chapterKey);
  const where = and(
    eq(schema.chapterProgress.userId, userId),
    eq(schema.chapterProgress.courseId, ctx.course.id),
    eq(schema.chapterProgress.chapterKey, chapterKey),
  );
  const [[progress], [row], slots, records] = await Promise.all([
    db.select().from(schema.chapterProgress).where(where),
    db
      .select({ html: schema.chapters.contentHtml })
      .from(schema.chapters)
      .where(
        and(
          eq(schema.chapters.courseVersionId, ctx.course.publishedVersionId!),
          eq(schema.chapters.chapterKey, chapterKey),
        ),
      ),
    courseSlots(db, ctx.course.id),
    courseRecords(db, userId, ctx.course.id),
  ]);
  const videos = slots.filter((s) => s.chapterKey === chapterKey && playableSlot(s)).map((s) => s.key);
  const videosDone = videos.filter((k) => records.videos.get(k)?.completedAt);
  if (!progress) return { chapterKey, textDone: false, completed: false, videosDone };
  const textDone =
    !!progress.textDoneAt ||
    isTextDone({
      reachedEnd: !!progress.reachedEndAt,
      textSeconds: progress.textSeconds,
      textChars: textLength(row?.html ?? ""),
    });
  const items = chapter.labs.flatMap((l) =>
    l.self_check.map((i) => checkKey(chapterKey, l.section_id, i.id)),
  );
  const completed =
    !!progress.completedAt ||
    isChapterDone({
      textDone,
      videos,
      videosDone,
      checks: items.length,
      checksDone: items.filter((k) => records.checks.has(k)).length,
    });
  if (textDone !== !!progress.textDoneAt || completed !== !!progress.completedAt) {
    await db
      .update(schema.chapterProgress)
      .set({
        textDoneAt: progress.textDoneAt ?? (textDone ? now : null),
        completedAt: progress.completedAt ?? (completed ? now : null),
      })
      .where(where);
  }
  return { chapterKey, textDone, completed, videosDone };
}

/** 첨부 받기 (L-04): 기록을 남기고, 첫 이용으로 적는다 */
export async function attachmentForLearner(db: Db, viewer: Viewer, attachmentId: string, now = new Date()) {
  const [row] = await db
    .select({
      courseId: schema.attachments.courseId,
      title: schema.attachments.title,
      objectKey: schema.files.objectKey,
      name: schema.files.originalName,
    })
    .from(schema.attachments)
    .innerJoin(schema.files, eq(schema.files.id, schema.attachments.fileId))
    .where(eq(schema.attachments.id, attachmentId));
  if (!row) throw new LearningError(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
  const ctx = await learnerContext(db, viewer, row.courseId);
  await db.insert(schema.attachmentDownloads).values({ userId: viewer.userId, attachmentId, at: now });
  if (ctx.access.kind === "learner" && ctx.access.access.ok)
    await markFirstUse(db, ctx.access.access.entitlement.id, now);
  return row;
}
