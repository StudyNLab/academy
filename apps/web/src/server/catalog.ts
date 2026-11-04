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
  const slots = await courseSlots(db, course.course.id);
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

/** 과정의 영상 자리 + 자체 서버 영상이 재생할 수 있는 상태인지 (변환 끝남) */
export async function courseSlots(db: Db, courseId: string) {
  const rows = await db
    .select({ slot: schema.videoSlots, assetStatus: schema.videoAssets.status })
    .from(schema.videoSlots)
    .leftJoin(schema.videoAssets, eq(schema.videoAssets.id, schema.videoSlots.videoAssetId))
    .where(eq(schema.videoSlots.courseId, courseId))
    .orderBy(asc(schema.videoSlots.key));
  return rows.map((r) => ({
    ...r.slot,
    hostedReady: r.slot.source === "hosted" && r.assetStatus === "ready",
  }));
}

export type CourseSlot = Awaited<ReturnType<typeof courseSlots>>[number];

/** 지금 재생할 수 있는 영상인가 (진도 · 완료 조건에 드는 영상): 유튜브 연결 또는 변환이 끝난 자체 서버 영상 */
export const playableSlot = (s: CourseSlot) =>
  (s.source === "youtube" && !!s.youtubeVideoId) || s.hostedReady;

export function slotView(s: CourseSlot): SlotView {
  return {
    key: s.key,
    title: s.title,
    source: s.source,
    youtubeVideoId: s.youtubeVideoId,
    hostedReady: s.hostedReady,
  };
}

function slotMap(slots: CourseSlot[]): Map<string, SlotView> {
  return new Map(slots.map((s) => [s.key, slotView(s)]));
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
  const slots = await courseSlots(db, row.course.id);
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

/**
 * 교재 그림 찾기. 내려줄지는 route 에서 정한다 (api/v1/content/[versionId]/[...path]):
 * 공개 중인 버전 ➔ 무료 미리보기에 나오는 그림은 누구나, 나머지는 볼 수 있는 사람(수강권 · 운영자 · 그 과정 강사)만.
 * 공개 전 버전(검수 중 등) ➔ 운영자만.
 */
export async function contentAsset(db: Db, versionId: string, path: string) {
  const [row] = await db
    .select({
      objectKey: schema.files.objectKey,
      course: {
        id: schema.courses.id,
        inSubscription: schema.courses.inSubscription,
        ownerInstructorId: schema.courses.ownerInstructorId,
      },
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

const safeDecode = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/** 무료 미리보기 화면에 나오는 그림 경로. 버전 + 미리보기 범위가 같으면 본문을 다시 훑지 않는다 */
const previewImageCache = new Map<string, Set<string>>();

export async function isPreviewImage(db: Db, courseId: string, versionId: string, path: string) {
  const rules = await db
    .select({
      chapterKey: schema.previewRules.chapterKey,
      scope: schema.previewRules.scope,
      sectionIds: schema.previewRules.sectionIds,
    })
    .from(schema.previewRules)
    .where(eq(schema.previewRules.courseId, courseId))
    .orderBy(asc(schema.previewRules.chapterKey));
  const cacheKey = `${versionId}:${JSON.stringify(rules)}`;
  const cached = previewImageCache.get(cacheKey);
  if (cached) return cached.has(path);
  const chapters =
    rules.length === 0
      ? []
      : await db
          .select({ key: schema.chapters.chapterKey, html: schema.chapters.contentHtml })
          .from(schema.chapters)
          .where(
            and(
              eq(schema.chapters.courseVersionId, versionId),
              inArray(
                schema.chapters.chapterKey,
                rules.map((r) => r.chapterKey),
              ),
            ),
          );
  const paths = new Set<string>();
  const prefix = `/api/v1/content/${versionId}/`;
  for (const chapter of chapters) {
    const rule = rules.find((r) => r.chapterKey === chapter.key)!;
    const html =
      rule.scope === "whole" ? chapter.html : keepSections(chapter.html, rule.sectionIds as string[]);
    let at = html.indexOf(prefix);
    while (at >= 0) {
      const rest = html.slice(at + prefix.length).match(/^[^"'\s)]+/)?.[0] ?? "";
      paths.add(rest.split("/").map(safeDecode).join("/"));
      at = html.indexOf(prefix, at + prefix.length);
    }
  }
  if (previewImageCache.size > 200) previewImageCache.clear();
  previewImageCache.set(cacheKey, paths);
  return paths.has(path);
}
