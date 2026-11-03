// 올린 교재 패키지 처리 (docs/기술설계.md 4장). web 이 대기열(CONTENT_QUEUE)에 넣은 버전을 검사 · 정리 · 저장한다.
import { createHash } from "node:crypto";
import { processPackage } from "@aionit/content";
import type { Db } from "@aionit/db";
import { and, eq, schema, sql } from "@aionit/db";
import type { FileStore } from "@aionit/storage";

/** 교재 그림 주소. web 의 /api/v1/content/[versionId]/[...path] 가 내준다 */
export function contentImageUrl(versionId: string, path: string): string {
  return `/api/v1/content/${versionId}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function processCourseVersion(
  deps: { db: Db; store: FileStore },
  versionId: string,
): Promise<void> {
  const { db, store } = deps;
  const [version] = await db
    .select({
      id: schema.courseVersions.id,
      courseId: schema.courseVersions.courseId,
      status: schema.courseVersions.status,
      objectKey: schema.files.objectKey,
      slug: schema.courses.slug,
      publishedVersionId: schema.courses.publishedVersionId,
    })
    .from(schema.courseVersions)
    .innerJoin(schema.files, eq(schema.files.id, schema.courseVersions.packageFileId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(eq(schema.courseVersions.id, versionId));
  if (!version) return; // 그 사이 지워졌다
  if (version.status !== "uploaded" && version.status !== "processing") return; // 이미 처리함

  await db
    .update(schema.courseVersions)
    .set({ status: "processing" })
    .where(eq(schema.courseVersions.id, versionId));
  const zip = await store.getBuffer(version.objectKey);
  if (!zip) throw new Error(`패키지 파일이 저장소에 없습니다: ${version.objectKey}`);

  const previous = version.publishedVersionId
    ? await db
        .select({
          key: schema.chapters.chapterKey,
          title: schema.chapters.title,
          contentSha256: schema.chapters.contentSha256,
        })
        .from(schema.chapters)
        .where(eq(schema.chapters.courseVersionId, version.publishedVersionId))
        .orderBy(schema.chapters.sortOrder)
    : undefined;

  const result = await processPackage(zip, {
    expectedCourseId: version.slug,
    imageUrl: (path) => contentImageUrl(versionId, path),
    previous,
  });

  if (!result.report.ok) {
    await db
      .update(schema.courseVersions)
      .set({ status: "invalid", validationReport: result.report })
      .where(eq(schema.courseVersions.id, versionId));
    return;
  }

  // 그림은 DB 트랜잭션 밖에서 먼저 올린다 (내용 해시로 이름을 지어 다시 처리해도 같은 이름)
  const uploaded: {
    path: string;
    alt: string;
    width: number;
    height: number;
    key: string;
    size: number;
    sha: string;
  }[] = [];
  for (const image of result.images) {
    const sha = createHash("sha256").update(image.webp).digest("hex");
    const key = `content/${version.courseId}/${versionId}/${sha}.webp`;
    await store.put(key, image.webp, { contentType: "image/webp", size: image.webp.length });
    uploaded.push({
      path: image.path,
      alt: image.alt,
      width: image.width,
      height: image.height,
      key,
      size: image.webp.length,
      sha,
    });
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.chapters).where(eq(schema.chapters.courseVersionId, versionId));
    await tx.delete(schema.chapterAssets).where(eq(schema.chapterAssets.courseVersionId, versionId));
    await tx.insert(schema.chapters).values(
      result.chapters.map((c) => ({
        courseVersionId: versionId,
        chapterKey: c.key,
        sortOrder: c.sortOrder,
        label: c.label,
        title: c.title,
        contentHtml: c.contentHtml,
        toc: c.toc,
        labs: c.labs,
        sourceSha256: c.sourceSha256,
        contentSha256: c.contentSha256,
      })),
    );
    for (const image of uploaded) {
      const [file] = await tx
        .insert(schema.files)
        .values({ objectKey: image.key, mime: "image/webp", size: image.size, sha256: image.sha })
        .onConflictDoUpdate({ target: schema.files.objectKey, set: { size: image.size } })
        .returning({ id: schema.files.id });
      await tx.insert(schema.chapterAssets).values({
        courseVersionId: versionId,
        path: image.path,
        fileId: file!.id,
        width: image.width,
        height: image.height,
        alt: image.alt,
      });
    }
    // 영상 자리는 과정 단위: 새 key 는 만들고, 있던 key 는 제목 · 위치만 바꾼다 (연결한 영상은 그대로)
    for (const chapter of result.chapters) {
      for (const video of chapter.videos) {
        await tx
          .insert(schema.videoSlots)
          .values({
            courseId: version.courseId,
            key: video.key,
            chapterKey: chapter.key,
            kind: video.kind,
            title: video.title,
            sectionId: video.section_id ?? null,
          })
          .onConflictDoUpdate({
            target: [schema.videoSlots.courseId, schema.videoSlots.key],
            set: {
              chapterKey: chapter.key,
              kind: video.kind,
              title: video.title,
              sectionId: video.section_id ?? null,
            },
          });
      }
    }
    await tx
      .update(schema.courseVersions)
      .set({ status: "ready", validationReport: result.report })
      .where(
        and(eq(schema.courseVersions.id, versionId), sql`${schema.courseVersions.status} = 'processing'`),
      );
  });
}
