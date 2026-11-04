// 강의 목록 · 상세 · 무료 미리보기 읽기 (P-01 ~ P-04) + 운영자 화면 읽기
import type { CourseField, Db } from "@aionit/db";
import { and, asc, desc, eq, inArray, schema, sql } from "@aionit/db";
import type { SlotView } from "./content-render";
import { keepSections, renderVideoSlots, withMainVideo } from "./content-render";

export const FIELD_LABEL: Record<CourseField, string> = { infra: "인프라", security: "보안", ai: "AI" };

export interface TocItem {
  level: number;
  id: string;
  title: string;
  lab: boolean;
}

export interface LabItem {
  section_id: string;
  title: string;
  self_check: { id: string; text: string }[];
}

/** 공개 목록: 공개(published) 과정만. 숨김 · 작성 중은 안 보인다 */
export async function listCatalog(db: Db, filter: { field?: CourseField } = {}) {
  const rows = await db
    .select({
      id: schema.courses.id,
      slug: schema.courses.slug,
      title: schema.courses.title,
      field: schema.courses.field,
      level: schema.courses.level,
      summary: schema.courses.summary,
      inSubscription: schema.courses.inSubscription,
      instructor: schema.instructors.displayName,
      chapters: sql<number>`(select count(*)::int from chapters c where c.course_version_id = courses.published_version_id)`,
      freeVideos: sql<number>`(select count(*)::int from video_slots v where v.course_id = courses.id and v.source = 'youtube')`,
      labs: sql<number>`(select coalesce(sum(jsonb_array_length(c.labs)), 0)::int from chapters c where c.course_version_id = courses.published_version_id)`,
    })
    .from(schema.courses)
    .innerJoin(schema.instructors, eq(schema.instructors.id, schema.courses.ownerInstructorId))
    .where(
      and(
        eq(schema.courses.status, "published"),
        filter.field ? eq(schema.courses.field, filter.field) : undefined,
      ),
    )
    .orderBy(asc(schema.courses.sortOrder), desc(schema.courses.createdAt));
  return rows;
}

export type CatalogItem = Awaited<ReturnType<typeof listCatalog>>[number];

/** 강의 상세. 공개 중이 아니면 null (운영자 미리보기는 allowUnpublished) */
export async function courseDetail(db: Db, slug: string, options: { allowUnpublished?: boolean } = {}) {
  const [course] = await db
    .select({ course: schema.courses, instructor: schema.instructors })
    .from(schema.courses)
    .innerJoin(schema.instructors, eq(schema.instructors.id, schema.courses.ownerInstructorId))
    .where(eq(schema.courses.slug, slug));
  if (!course) return null;
  if (!options.allowUnpublished && course.course.status !== "published") return null;
  const versionId = course.course.publishedVersionId;
  const chapterRows = versionId
    ? await db
        .select({
          key: schema.chapters.chapterKey,
          label: schema.chapters.label,
          title: schema.chapters.title,
          toc: schema.chapters.toc,
          labs: schema.chapters.labs,
        })
        .from(schema.chapters)
        .where(eq(schema.chapters.courseVersionId, versionId))
        .orderBy(asc(schema.chapters.sortOrder))
    : [];
  const slots = await db
    .select()
    .from(schema.videoSlots)
    .where(eq(schema.videoSlots.courseId, course.course.id))
    .orderBy(asc(schema.videoSlots.key));
  const previews = await db
    .select()
    .from(schema.previewRules)
    .where(eq(schema.previewRules.courseId, course.course.id));
  const attachmentCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.attachments)
    .where(eq(schema.attachments.courseId, course.course.id));
  const previewByChapter = new Map(previews.map((p) => [p.chapterKey, p]));
  return {
    ...course,
    chapters: chapterRows.map((c) => ({
      ...c,
      toc: c.toc as TocItem[],
      labs: c.labs as LabItem[],
      videos: slots.filter((s) => s.chapterKey === c.key),
      preview: previewByChapter.get(c.key) ?? null,
    })),
    attachments: attachmentCount[0]?.n ?? 0,
  };
}

export type CourseDetail = NonNullable<Awaited<ReturnType<typeof courseDetail>>>;

function slotMap(slots: (typeof schema.videoSlots.$inferSelect)[]): Map<string, SlotView> {
  return new Map(
    slots.map((s) => [
      s.key,
      { key: s.key, title: s.title, source: s.source, youtubeVideoId: s.youtubeVideoId },
    ]),
  );
}

/** 무료 미리보기 (P-04): 공개 중인 버전에서 운영자가 정한 범위만 */
export async function previewChapter(db: Db, slug: string, chapterKey: string) {
  const detail = await courseDetail(db, slug);
  if (!detail?.course.publishedVersionId) return null;
  const chapter = detail.chapters.find((c) => c.key === chapterKey);
  if (!chapter?.preview) return null;
  const [row] = await db
    .select({ html: schema.chapters.contentHtml })
    .from(schema.chapters)
    .where(
      and(
        eq(schema.chapters.courseVersionId, detail.course.publishedVersionId),
        eq(schema.chapters.chapterKey, chapterKey),
      ),
    );
  if (!row) return null;
  const sectionIds = chapter.preview.sectionIds as string[];
  const scoped = chapter.preview.scope === "whole" ? row.html : keepSections(row.html, sectionIds);
  return {
    detail,
    chapter,
    html: withMainVideo(
      renderVideoSlots(scoped, slotMap(chapter.videos), "public"),
      slotMap(chapter.videos.filter((v) => v.kind === "main"))
        .values()
        .next().value,
      "public",
    ),
    partial: chapter.preview.scope === "sections",
    toc:
      chapter.preview.scope === "whole"
        ? chapter.toc
        : chapter.toc.filter((t) => sectionIds.includes(t.id.split("-").slice(0, 2).join("-"))),
  };
}

/** 운영자 미리보기: 어떤 버전이든 전체 본문 (연결 안 된 영상 자리도 보인다) */
export async function adminChapter(db: Db, versionId: string, chapterKey: string) {
  const [row] = await db
    .select({ chapter: schema.chapters, version: schema.courseVersions, course: schema.courses })
    .from(schema.chapters)
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.chapters.courseVersionId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(and(eq(schema.chapters.courseVersionId, versionId), eq(schema.chapters.chapterKey, chapterKey)));
  if (!row) return null;
  const slots = await db
    .select()
    .from(schema.videoSlots)
    .where(eq(schema.videoSlots.courseId, row.course.id));
  const main = slots.find((s) => s.kind === "main" && s.chapterKey === chapterKey);
  return {
    ...row,
    html: withMainVideo(
      renderVideoSlots(row.chapter.contentHtml, slotMap(slots), "admin"),
      main ? slotMap([main]).get(main.key) : undefined,
      "admin",
    ),
  };
}

// ---- 운영자 화면 ----

export async function adminCourseList(db: Db) {
  return db
    .select({
      id: schema.courses.id,
      slug: schema.courses.slug,
      title: schema.courses.title,
      field: schema.courses.field,
      status: schema.courses.status,
      instructor: schema.instructors.displayName,
      publishedVersion: sql<
        string | null
      >`(select v.version from course_versions v where v.id = courses.published_version_id)`,
      waiting: sql<number>`(select count(*)::int from course_versions v where v.course_id = courses.id and v.status in ('ready', 'in_review'))`,
    })
    .from(schema.courses)
    .innerJoin(schema.instructors, eq(schema.instructors.id, schema.courses.ownerInstructorId))
    .orderBy(asc(schema.courses.sortOrder), desc(schema.courses.createdAt));
}

export async function adminCourse(db: Db, courseId: string) {
  const [course] = await db
    .select({ course: schema.courses, instructor: schema.instructors })
    .from(schema.courses)
    .innerJoin(schema.instructors, eq(schema.instructors.id, schema.courses.ownerInstructorId))
    .where(eq(schema.courses.id, courseId));
  if (!course) return null;
  const versions = await db
    .select()
    .from(schema.courseVersions)
    .where(eq(schema.courseVersions.courseId, courseId))
    .orderBy(desc(schema.courseVersions.createdAt));
  const slots = await db
    .select()
    .from(schema.videoSlots)
    .where(eq(schema.videoSlots.courseId, courseId))
    .orderBy(asc(schema.videoSlots.chapterKey), asc(schema.videoSlots.key));
  const previews = await db
    .select()
    .from(schema.previewRules)
    .where(eq(schema.previewRules.courseId, courseId));
  const attachments = await db
    .select({ attachment: schema.attachments, file: schema.files })
    .from(schema.attachments)
    .innerJoin(schema.files, eq(schema.files.id, schema.attachments.fileId))
    .where(eq(schema.attachments.courseId, courseId))
    .orderBy(asc(schema.attachments.chapterKey), asc(schema.attachments.sortOrder));
  const publishedChapters = course.course.publishedVersionId
    ? await db
        .select({ key: schema.chapters.chapterKey, title: schema.chapters.title, toc: schema.chapters.toc })
        .from(schema.chapters)
        .where(eq(schema.chapters.courseVersionId, course.course.publishedVersionId))
        .orderBy(asc(schema.chapters.sortOrder))
    : [];
  return { ...course, versions, slots, previews, attachments, publishedChapters };
}

export async function adminVersion(db: Db, versionId: string) {
  const [row] = await db
    .select({ version: schema.courseVersions, course: schema.courses })
    .from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(eq(schema.courseVersions.id, versionId));
  if (!row) return null;
  const chapterRows = await db
    .select({
      key: schema.chapters.chapterKey,
      label: schema.chapters.label,
      title: schema.chapters.title,
      toc: schema.chapters.toc,
    })
    .from(schema.chapters)
    .where(eq(schema.chapters.courseVersionId, versionId))
    .orderBy(asc(schema.chapters.sortOrder));
  const chapterKeys = chapterRows.map((c) => c.key);
  const unlinked = chapterKeys.length
    ? await db
        .select({ key: schema.videoSlots.key, title: schema.videoSlots.title })
        .from(schema.videoSlots)
        .where(
          and(
            eq(schema.videoSlots.courseId, row.course.id),
            eq(schema.videoSlots.source, "none"),
            inArray(schema.videoSlots.chapterKey, chapterKeys),
          ),
        )
    : [];
  return { ...row, chapters: chapterRows, unlinked };
}

/** 교재 그림 내려주기 권한: 공개 중인 버전의 그림은 누구나, 그 밖(검수 전 등)은 운영자만 */
export async function contentAsset(db: Db, versionId: string, path: string) {
  const [row] = await db
    .select({
      objectKey: schema.files.objectKey,
      versionStatus: schema.courseVersions.status,
      isPublished: sql<boolean>`${schema.courses.publishedVersionId} = ${schema.courseVersions.id} and ${schema.courses.status} = 'published'`,
    })
    .from(schema.chapterAssets)
    .innerJoin(schema.files, eq(schema.files.id, schema.chapterAssets.fileId))
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.chapterAssets.courseVersionId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(and(eq(schema.chapterAssets.courseVersionId, versionId), eq(schema.chapterAssets.path, path)));
  return row ?? null;
}
