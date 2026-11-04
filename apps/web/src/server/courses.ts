// 과정 관리 (운영자): 과정 등록(AD-02) · 패키지 올리기(AD-03) · 검수 · 공개 · 되돌리기(AD-04) ·
// 영상 연결(AD-05 일부) · 무료 미리보기(AD-06) · 첨부 자료. 모든 작업은 audit_logs 에 남긴다.
import { createHash, randomUUID } from "node:crypto";
import { readCourseJson } from "@aionit/content";
import type { CourseField, Db } from "@aionit/db";
import { and, eq, inArray, ne, schema } from "@aionit/db";
import type { FileStore } from "@aionit/storage";
import { writeAudit } from "./records";

export class CourseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface CourseDeps {
  db: Db;
  store: FileStore;
  enqueueContent: (versionId: string) => Promise<void>;
}

interface Actor {
  actorId: string;
  headers?: Headers | null;
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
export const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

// ---- 강사 · 과정 ----

export async function createInstructor(
  db: Db,
  input: { displayName: string; userId?: string | null } & Actor,
) {
  const [row] = await db
    .insert(schema.instructors)
    .values({ displayName: input.displayName.trim(), userId: input.userId ?? null })
    .returning();
  await writeAudit(db, {
    actorId: input.actorId,
    action: "instructor.create",
    targetType: "instructor",
    targetId: row!.id,
    after: { displayName: row!.displayName },
    headers: input.headers,
  });
  return row!;
}

/** 잘못 만든 강사 지우기. 그 강사로 된 과정이 있으면 과정의 강사를 먼저 바꿔야 한다 */
export async function removeInstructor(db: Db, instructorId: string, actor: Actor) {
  const [row] = await db.select().from(schema.instructors).where(eq(schema.instructors.id, instructorId));
  if (!row) throw new CourseError("NOT_FOUND", "강사를 찾을 수 없습니다.", 404);
  const used = await db
    .select({ id: schema.courses.id })
    .from(schema.courses)
    .where(eq(schema.courses.ownerInstructorId, instructorId));
  if (used.length > 0)
    throw new CourseError(
      "INSTRUCTOR_IN_USE",
      `이 강사로 된 과정이 ${used.length}개 있어 지울 수 없습니다. 과정의 강사를 먼저 바꿔 주세요.`,
      409,
    );
  await db.delete(schema.instructors).where(eq(schema.instructors.id, instructorId));
  await writeAudit(db, {
    actorId: actor.actorId,
    action: "instructor.remove",
    targetType: "instructor",
    targetId: instructorId,
    before: { displayName: row.displayName, userId: row.userId },
    headers: actor.headers,
  });
}

export interface CourseInput {
  slug: string;
  title: string;
  field: CourseField;
  level: string;
  ownerInstructorId: string;
  summary: string;
  descriptionMd: string;
  audienceMd: string;
  requirementsMd: string;
  inSubscription: boolean;
}

export async function createCourse(db: Db, input: CourseInput & Actor) {
  const { actorId, headers, ...values } = input;
  const [exists] = await db
    .select({ id: schema.courses.id })
    .from(schema.courses)
    .where(eq(schema.courses.slug, values.slug));
  if (exists)
    throw new CourseError("SLUG_TAKEN", "이미 있는 과정 ID 입니다 (패키지 course_id 는 과정마다 하나).", 409);
  const [row] = await db.insert(schema.courses).values(values).returning();
  await writeAudit(db, {
    actorId,
    action: "course.create",
    targetType: "course",
    targetId: row!.id,
    after: values,
    headers,
  });
  return row!;
}

/** 과정 정보 고치기. slug(=패키지 course_id)는 바꿀 수 없다 */
export async function updateCourse(db: Db, courseId: string, input: Omit<CourseInput, "slug"> & Actor) {
  const { actorId, headers, ...values } = input;
  const [before] = await db.select().from(schema.courses).where(eq(schema.courses.id, courseId));
  if (!before) throw new CourseError("NOT_FOUND", "과정을 찾을 수 없습니다.", 404);
  await db.update(schema.courses).set(values).where(eq(schema.courses.id, courseId));
  await writeAudit(db, {
    actorId,
    action: "course.update",
    targetType: "course",
    targetId: courseId,
    after: values,
    headers,
  });
}

/** 공개 중인 과정을 목록에서 숨기기 · 다시 보이기 (수강생은 계속 학습한다) */
export async function setCourseHidden(db: Db, courseId: string, hidden: boolean, actor: Actor) {
  const [course] = await db.select().from(schema.courses).where(eq(schema.courses.id, courseId));
  if (!course) throw new CourseError("NOT_FOUND", "과정을 찾을 수 없습니다.", 404);
  const status = hidden ? "hidden" : course.publishedVersionId ? "published" : "draft";
  await db.update(schema.courses).set({ status }).where(eq(schema.courses.id, courseId));
  await writeAudit(db, {
    actorId: actor.actorId,
    action: hidden ? "course.hide" : "course.unhide",
    targetType: "course",
    targetId: courseId,
    before: { status: course.status },
    after: { status },
    headers: actor.headers,
  });
}

// ---- 패키지 올리기 (AD-03) ----

export async function uploadPackage(
  deps: CourseDeps,
  input: { courseId: string; zip: Buffer; fileName: string } & Actor,
) {
  const { db, store } = deps;
  if (input.zip.length > MAX_PACKAGE_BYTES)
    throw new CourseError("TOO_LARGE", "패키지는 200MB 까지 올릴 수 있습니다.", 413);
  if (!input.zip.subarray(0, 4).equals(ZIP_MAGIC)) throw new CourseError("NOT_ZIP", "zip 파일이 아닙니다.");
  const [course] = await db.select().from(schema.courses).where(eq(schema.courses.id, input.courseId));
  if (!course) throw new CourseError("NOT_FOUND", "과정을 찾을 수 없습니다.", 404);

  const head = await readCourseJson(input.zip);
  if (!head.ok) throw new CourseError(head.errors[0]!.code, head.errors.map((e) => e.message).join(" / "));
  if (head.course.course_id !== course.slug) {
    throw new CourseError(
      "COURSE_ID_MISMATCH",
      `이 과정(${course.slug})의 패키지가 아닙니다: course_id=${head.course.course_id}`,
    );
  }
  const version = head.course.version;
  const [same] = await db
    .select()
    .from(schema.courseVersions)
    .where(and(eq(schema.courseVersions.courseId, course.id), eq(schema.courseVersions.version, version)));
  if (same && (same.status === "published" || same.status === "archived")) {
    throw new CourseError(
      "VERSION_PUBLISHED",
      `v${version} 은 이미 공개한 버전입니다. 교재의 version 을 올려서 다시 만들어 주세요.`,
      409,
    );
  }

  const objectKey = `packages/${course.id}/${version}-${randomUUID()}.zip`;
  await store.put(objectKey, input.zip, { contentType: "application/zip", size: input.zip.length });
  const versionRow = await db.transaction(async (tx) => {
    // 공개 전의 같은 버전은 덮어쓴다 (규격 2.1)
    if (same) await tx.delete(schema.courseVersions).where(eq(schema.courseVersions.id, same.id));
    const [file] = await tx
      .insert(schema.files)
      .values({
        objectKey,
        mime: "application/zip",
        size: input.zip.length,
        sha256: sha256(input.zip),
        originalName: input.fileName.slice(0, 200),
        createdBy: input.actorId,
      })
      .returning({ id: schema.files.id });
    const [row] = await tx
      .insert(schema.courseVersions)
      .values({ courseId: course.id, version, packageFileId: file!.id, uploadedBy: input.actorId })
      .returning();
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "content.upload",
      targetType: "course_version",
      targetId: row!.id,
      after: { course: course.slug, version, replaced: same ? same.id : null },
      headers: input.headers,
    });
    return row!;
  });
  await deps.enqueueContent(versionRow.id);
  return versionRow;
}

// ---- 검수 · 공개 · 되돌리기 (AD-04) ----

async function loadVersion(db: Db, versionId: string) {
  const [row] = await db
    .select({ version: schema.courseVersions, course: schema.courses })
    .from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(eq(schema.courseVersions.id, versionId));
  if (!row) throw new CourseError("NOT_FOUND", "버전을 찾을 수 없습니다.", 404);
  return row;
}

/** 승인하고 공개: 이 버전 ➔ published, 지금 공개 중인 버전 ➔ archived */
export async function publishVersion(db: Db, versionId: string, actor: Actor & { note?: string }) {
  const { version, course } = await loadVersion(db, versionId);
  if (version.status !== "ready" && version.status !== "in_review") {
    throw new CourseError("NOT_READY", "검사를 통과한 버전만 공개할 수 있습니다.");
  }
  await switchPublished(db, course, versionId, "content.publish", actor);
}

/** 되돌리기: 예전에 공개했던 버전(archived)을 다시 공개 */
export async function rollbackToVersion(db: Db, versionId: string, actor: Actor) {
  const { version, course } = await loadVersion(db, versionId);
  if (version.status !== "archived")
    throw new CourseError("NOT_ARCHIVED", "예전에 공개했던 버전으로만 되돌릴 수 있습니다.");
  await switchPublished(db, course, versionId, "content.rollback", actor);
}

async function switchPublished(
  db: Db,
  course: typeof schema.courses.$inferSelect,
  versionId: string,
  action: string,
  actor: Actor & { note?: string },
) {
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(schema.courseVersions)
      .set({ status: "archived" })
      .where(
        and(
          eq(schema.courseVersions.courseId, course.id),
          eq(schema.courseVersions.status, "published"),
          ne(schema.courseVersions.id, versionId),
        ),
      );
    await tx
      .update(schema.courseVersions)
      .set({
        status: "published",
        publishedAt: now,
        reviewedBy: actor.actorId,
        reviewedAt: now,
        reviewNote: actor.note ?? null,
      })
      .where(eq(schema.courseVersions.id, versionId));
    await tx
      .update(schema.courses)
      .set({ publishedVersionId: versionId, status: course.status === "hidden" ? "hidden" : "published" })
      .where(eq(schema.courses.id, course.id));
    await writeAudit(tx, {
      actorId: actor.actorId,
      action,
      targetType: "course_version",
      targetId: versionId,
      before: { publishedVersionId: course.publishedVersionId },
      after: { publishedVersionId: versionId, note: actor.note ?? null },
      headers: actor.headers,
    });
  });
}

/** 반려 (사유 필수). 강사에게 알림은 M8 */
export async function rejectVersion(db: Db, versionId: string, actor: Actor & { reason: string }) {
  const { version } = await loadVersion(db, versionId);
  if (!["ready", "in_review", "invalid"].includes(version.status)) {
    throw new CourseError("NOT_REVIEWABLE", "검수할 수 있는 상태가 아닙니다.");
  }
  await db
    .update(schema.courseVersions)
    .set({ status: "rejected", reviewNote: actor.reason, reviewedBy: actor.actorId, reviewedAt: new Date() })
    .where(eq(schema.courseVersions.id, versionId));
  await writeAudit(db, {
    actorId: actor.actorId,
    action: "content.reject",
    targetType: "course_version",
    targetId: versionId,
    after: { reason: actor.reason },
    headers: actor.headers,
  });
}

// ---- 영상 연결 (AD-05: 유튜브. 자체 서버 영상은 videos.ts linkHosted) ----

/** 유튜브 주소 ➔ 영상 id. 받는 형식: youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, /shorts/ID, 또는 id 만 */
export function parseYoutubeId(input: string): string | null {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else id = url.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/)?.[2] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export async function linkYoutube(db: Db, slotId: string, input: { url: string | null } & Actor) {
  const [slot] = await db.select().from(schema.videoSlots).where(eq(schema.videoSlots.id, slotId));
  if (!slot) throw new CourseError("NOT_FOUND", "영상 자리를 찾을 수 없습니다.", 404);
  const youtubeVideoId = input.url ? parseYoutubeId(input.url) : null;
  if (input.url && !youtubeVideoId)
    throw new CourseError("BAD_YOUTUBE_URL", "유튜브 영상 주소를 확인해 주세요.");
  await db
    .update(schema.videoSlots)
    .set({ source: youtubeVideoId ? "youtube" : "none", youtubeVideoId, videoAssetId: null })
    .where(eq(schema.videoSlots.id, slotId));
  await writeAudit(db, {
    actorId: input.actorId,
    action: youtubeVideoId ? "video.link" : "video.unlink",
    targetType: "video_slot",
    targetId: slotId,
    before: { source: slot.source, youtubeVideoId: slot.youtubeVideoId },
    after: { source: youtubeVideoId ? "youtube" : "none", youtubeVideoId },
    headers: input.headers,
  });
}

// ---- 무료 미리보기 (AD-06) ----

export async function setPreviewRule(
  db: Db,
  courseId: string,
  input: { chapterKey: string; scope: "whole" | "sections" | "none"; sectionIds?: string[] } & Actor,
) {
  if (input.scope === "none") {
    await db
      .delete(schema.previewRules)
      .where(
        and(eq(schema.previewRules.courseId, courseId), eq(schema.previewRules.chapterKey, input.chapterKey)),
      );
  } else {
    const sectionIds = input.scope === "sections" ? (input.sectionIds ?? []) : [];
    if (input.scope === "sections" && sectionIds.length === 0) {
      throw new CourseError("NO_SECTIONS", "미리보기로 열 Section 을 하나 이상 고르세요.");
    }
    await db
      .insert(schema.previewRules)
      .values({ courseId, chapterKey: input.chapterKey, scope: input.scope, sectionIds })
      .onConflictDoUpdate({
        target: [schema.previewRules.courseId, schema.previewRules.chapterKey],
        set: { scope: input.scope, sectionIds },
      });
  }
  await writeAudit(db, {
    actorId: input.actorId,
    action: "preview.set",
    targetType: "course",
    targetId: courseId,
    after: { chapterKey: input.chapterKey, scope: input.scope, sectionIds: input.sectionIds ?? [] },
    headers: input.headers,
  });
}

// ---- 첨부 자료 (챕터별 실습 파일 zip) ----

export async function addAttachment(
  deps: Pick<CourseDeps, "db" | "store">,
  input: {
    courseId: string;
    chapterKey: string | null;
    title: string;
    file: Buffer;
    fileName: string;
  } & Actor,
) {
  const { db, store } = deps;
  if (input.file.length > MAX_ATTACHMENT_BYTES)
    throw new CourseError("TOO_LARGE", "첨부 파일은 100MB 까지입니다.", 413);
  if (!input.file.subarray(0, 4).equals(ZIP_MAGIC))
    throw new CourseError("NOT_ZIP", "첨부 자료는 zip 파일로 올려 주세요.");
  const objectKey = `attachments/${input.courseId}/${randomUUID()}.zip`;
  await store.put(objectKey, input.file, { contentType: "application/zip", size: input.file.length });
  return db.transaction(async (tx) => {
    const [file] = await tx
      .insert(schema.files)
      .values({
        objectKey,
        mime: "application/zip",
        size: input.file.length,
        sha256: sha256(input.file),
        originalName: input.fileName.slice(0, 200),
        createdBy: input.actorId,
      })
      .returning({ id: schema.files.id });
    const [row] = await tx
      .insert(schema.attachments)
      .values({
        courseId: input.courseId,
        chapterKey: input.chapterKey,
        title: input.title.trim(),
        fileId: file!.id,
      })
      .returning();
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "attachment.add",
      targetType: "attachment",
      targetId: row!.id,
      after: { courseId: input.courseId, chapterKey: input.chapterKey, title: row!.title },
      headers: input.headers,
    });
    return row!;
  });
}

export async function removeAttachment(db: Db, attachmentId: string, actor: Actor) {
  const [row] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, attachmentId));
  if (!row) throw new CourseError("NOT_FOUND", "첨부 자료를 찾을 수 없습니다.", 404);
  await db.delete(schema.attachments).where(eq(schema.attachments.id, attachmentId));
  await writeAudit(db, {
    actorId: actor.actorId,
    action: "attachment.remove",
    targetType: "attachment",
    targetId: attachmentId,
    before: { title: row.title, chapterKey: row.chapterKey },
    headers: actor.headers,
  });
}

/** 여러 버전의 상태를 한 번에 (목록 화면용) */
export async function versionsOf(db: Db, courseIds: string[]) {
  if (courseIds.length === 0) return [];
  return db.select().from(schema.courseVersions).where(inArray(schema.courseVersions.courseId, courseIds));
}
