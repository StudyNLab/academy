// 교재 패키지 처리: 풀기 ➔ 형식 검사 ➔ 본문 정리 ➔ 목차 · 그림 · 영상 자리 대조 ➔ 그림 변환 ➔ 이전 버전과 비교
// DB · 저장소를 모른다 (worker 가 결과를 저장한다). 그래서 단위 테스트로 공격 패키지를 확인할 수 있다.
import { createHash } from "node:crypto";
import { sniffImage, toWebp } from "./images";
import { sanitizeChapterHtml } from "./sanitize";
import type { CourseJson, ManifestJson } from "./spec";
import { courseJsonSchema, LIMITS, manifestSchema } from "./spec";
import { PackageError, readZip } from "./zip";

export interface Issue {
  code: string;
  message: string;
  /** 어디서 (챕터 · 파일) */
  where?: string;
}

export interface ChapterSummary {
  key: string;
  title: string;
  sections: number;
  images: number;
  videos: number;
  labs: number;
}

export interface ChapterDiff {
  key: string;
  title: string;
  change: "added" | "removed" | "changed" | "same";
}

export interface PackageReport {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  course: { id: string; title: string; version: string } | null;
  chapters: ChapterSummary[];
  /** 규격 밖이라 무시한 파일 */
  skipped: string[];
  diff: ChapterDiff[] | null;
}

export interface ProcessedChapter {
  key: string;
  sortOrder: number;
  label: string;
  title: string;
  contentHtml: string;
  toc: ManifestJson["toc"];
  labs: ManifestJson["labs"];
  videos: ManifestJson["videos"];
  sourceSha256: string;
  contentSha256: string;
}

export interface ProcessedImage {
  path: string;
  alt: string;
  width: number;
  height: number;
  webp: Buffer;
}

export interface ProcessedPackage {
  report: PackageReport;
  course: CourseJson | null;
  chapters: ProcessedChapter[];
  images: ProcessedImage[];
}

export interface ProcessOptions {
  /** 이 과정에 올리는 것이면 course_id 가 같아야 한다 */
  expectedCourseId?: string;
  /** 그림 경로(images/...) ➔ 화면에서 쓸 주소 */
  imageUrl: (path: string) => string;
  /** 지금 공개된 버전 (바뀐 챕터 비교용) */
  previous?: { key: string; title: string; contentSha256: string }[];
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

function limitFor(path: string): number | null {
  if (path === "course.json") return LIMITS.textFileBytes;
  if (/^images\/[^/]+$/.test(path)) return LIMITS.imageBytes;
  if (/^chapters\/[^/]+\/content\.html$/.test(path)) return LIMITS.contentHtmlBytes;
  if (/^chapters\/[^/]+\/(manifest\.json|source\.md)$/.test(path)) return LIMITS.textFileBytes;
  return null; // 규격 밖 파일은 무시한다 (2장)
}

function parseJson(bytes: Buffer | undefined): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(bytes.toString("utf8").replace(/^﻿/, ""));
  } catch {
    return Symbol.for("invalid-json");
  }
}

export async function processPackage(zip: Buffer, options: ProcessOptions): Promise<ProcessedPackage> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const empty = (skipped: string[] = []): ProcessedPackage => ({
    report: { ok: false, errors, warnings, course: null, chapters: [], skipped, diff: null },
    course: null,
    chapters: [],
    images: [],
  });

  let files: Map<string, Buffer>;
  let skipped: string[];
  try {
    ({ files, skipped } = await readZip(zip, limitFor));
  } catch (error) {
    if (error instanceof PackageError) {
      errors.push({ code: error.code, message: error.message });
      return empty();
    }
    throw error;
  }

  // 1. course.json
  const courseRaw = parseJson(files.get("course.json"));
  if (courseRaw === undefined) {
    errors.push({ code: "COURSE_JSON_MISSING", message: "course.json 이 없습니다" });
    return empty(skipped);
  }
  const courseParsed = courseJsonSchema.safeParse(courseRaw);
  if (!courseParsed.success) {
    for (const issue of courseParsed.error.issues.slice(0, 20)) {
      errors.push({
        code: "COURSE_JSON_INVALID",
        message: `${issue.path.join(".") || "(전체)"}: ${issue.message}`,
        where: "course.json",
      });
    }
    return empty(skipped);
  }
  const course = courseParsed.data;
  if (options.expectedCourseId && course.course_id !== options.expectedCourseId) {
    errors.push({
      code: "COURSE_ID_MISMATCH",
      message: `이 과정(${options.expectedCourseId})의 패키지가 아닙니다: course_id=${course.course_id}`,
      where: "course.json",
    });
    return empty(skipped);
  }
  const seenChapter = new Set<string>();
  for (const ch of course.chapters) {
    if (seenChapter.has(ch.chapter_id)) {
      errors.push({
        code: "CHAPTER_ID_DUPLICATE",
        message: `chapter_id 가 겹칩니다: ${ch.chapter_id}`,
        where: "course.json",
      });
    }
    seenChapter.add(ch.chapter_id);
  }

  // 2. 챕터마다
  const chapters: ProcessedChapter[] = [];
  const summaries: ChapterSummary[] = [];
  const imageMeta = new Map<string, { alt: string; width: number; height: number }>();
  const videoKeys = new Set<string>();
  const imageUrl = (path: string) => (/^images\/[^/]+$/.test(path) ? options.imageUrl(path) : null);

  for (const [index, entry] of course.chapters.entries()) {
    const where = `${entry.chapter_id} (${entry.dir})`;
    const dir = `chapters/${entry.dir.normalize("NFC")}`;
    const htmlBytes = files.get(`${dir}/content.html`);
    const manifestRaw = parseJson(files.get(`${dir}/manifest.json`));
    if (!htmlBytes) {
      errors.push({ code: "CONTENT_MISSING", message: "content.html 이 없습니다", where });
      continue;
    }
    if (manifestRaw === undefined) {
      errors.push({ code: "MANIFEST_MISSING", message: "manifest.json 이 없습니다", where });
      continue;
    }
    const parsed = manifestSchema.safeParse(manifestRaw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 10)) {
        errors.push({
          code: "MANIFEST_INVALID",
          message: `${issue.path.join(".") || "(전체)"}: ${issue.message}`,
          where,
        });
      }
      continue;
    }
    const manifest = parsed.data;
    if (manifest.chapter_id !== entry.chapter_id) {
      errors.push({
        code: "CHAPTER_ID_MISMATCH",
        message: `manifest 의 chapter_id(${manifest.chapter_id})가 course.json 과 다릅니다`,
        where,
      });
    }

    const source = files.get(`${dir}/source.md`);
    if (source && sha256(source) !== manifest.source_sha256) {
      warnings.push({
        code: "SOURCE_SHA_MISMATCH",
        message: "source.md 의 SHA-256 이 manifest 와 다릅니다",
        where,
      });
    }

    const sanitized = sanitizeChapterHtml(htmlBytes.toString("utf8"), imageUrl);
    for (const item of sanitized.removed) {
      warnings.push({ code: "HTML_REMOVED", message: `허용 목록 밖이라 지움: ${item}`, where });
    }

    // 목차 id 는 본문에 있어야 한다 (읽은 위치 · 목차가 여기에 묶인다)
    for (const item of manifest.toc) {
      if (!sanitized.sectionIds.has(item.id)) {
        errors.push({
          code: "TOC_ID_NOT_IN_HTML",
          message: `목차 ${item.id} 「${item.title}」가 본문에 없습니다`,
          where,
        });
      }
    }
    const tocIds = new Set(manifest.toc.map((t) => t.id));
    for (const lab of manifest.labs) {
      if (!tocIds.has(lab.section_id)) {
        warnings.push({
          code: "LAB_SECTION_UNKNOWN",
          message: `실습 ${lab.section_id} 가 목차에 없습니다`,
          where,
        });
      }
    }

    // 그림: 본문이 쓰는 그림은 manifest 에 있어야 하고, manifest 의 그림은 zip 에 있어야 한다
    const listed = new Map(manifest.images.map((img) => [img.path, img]));
    for (const path of sanitized.imagePaths) {
      if (!listed.has(path)) {
        errors.push({
          code: "IMAGE_NOT_IN_MANIFEST",
          message: `본문의 그림 ${path} 가 manifest 에 없습니다`,
          where,
        });
      }
    }
    for (const img of manifest.images) {
      if (!files.has(img.path)) {
        errors.push({ code: "IMAGE_MISSING", message: `그림 파일 ${img.path} 가 없습니다`, where });
        continue;
      }
      if (!sanitized.imagePaths.has(img.path)) {
        warnings.push({
          code: "IMAGE_UNUSED",
          message: `manifest 의 그림 ${img.path} 를 본문이 쓰지 않습니다`,
          where,
        });
      }
      imageMeta.set(img.path, { alt: img.alt, width: img.width, height: img.height });
    }

    // 영상 자리: 챕터 영상(main)은 manifest 에만, 나머지는 본문 자리와 1:1
    const mains = manifest.videos.filter((v) => v.kind === "main");
    if (mains.length > 1)
      errors.push({ code: "VIDEO_MAIN_MULTIPLE", message: "챕터 영상(main)이 2개 이상입니다", where });
    const inHtml = new Map(sanitized.videoSlots.map((v) => [v.key, v.kind]));
    for (const video of manifest.videos) {
      if (videoKeys.has(video.key)) {
        errors.push({
          code: "VIDEO_KEY_DUPLICATE",
          message: `영상 key 가 과정 안에서 겹칩니다: ${video.key}`,
          where,
        });
      }
      videoKeys.add(video.key);
      if (video.kind !== "main" && inHtml.get(video.key) !== video.kind) {
        errors.push({
          code: "VIDEO_SLOT_NOT_IN_HTML",
          message: `영상 자리 ${video.key}(${video.kind})가 본문에 없습니다`,
          where,
        });
      }
    }
    const manifestKeys = new Set(manifest.videos.map((v) => v.key));
    for (const slot of sanitized.videoSlots) {
      if (!manifestKeys.has(slot.key)) {
        errors.push({
          code: "VIDEO_SLOT_NOT_IN_MANIFEST",
          message: `본문의 영상 자리 ${slot.key} 가 manifest 에 없습니다`,
          where,
        });
      }
    }

    chapters.push({
      key: entry.chapter_id,
      sortOrder: index,
      label: manifest.label,
      title: manifest.title,
      contentHtml: sanitized.html,
      toc: manifest.toc,
      labs: manifest.labs,
      videos: manifest.videos,
      sourceSha256: manifest.source_sha256,
      // 그림 주소는 버전마다 달라서, 패키지 경로로 되돌린 본문으로 비교값을 만든다
      contentSha256: sha256(stableHtml(sanitized.html, sanitized.imagePaths, options.imageUrl)),
    });
    summaries.push({
      key: entry.chapter_id,
      title: manifest.title,
      sections: manifest.toc.length,
      images: manifest.images.length,
      videos: manifest.videos.length,
      labs: manifest.labs.length,
    });
  }

  // 3. 그림: 앞 바이트로 형식 확인 ➔ WebP (오류가 이미 있으면 변환하지 않는다)
  const images: ProcessedImage[] = [];
  if (errors.length === 0) {
    for (const [path, meta] of imageMeta) {
      const bytes = files.get(path)!;
      const format = sniffImage(bytes);
      if (!format) {
        errors.push({
          code: "IMAGE_BAD_FORMAT",
          message: `${path} 는 PNG · JPEG · WebP 가 아닙니다 (SVG 는 받지 않습니다)`,
        });
        continue;
      }
      if (bytes.length > LIMITS.imageBytes * 0.9) {
        warnings.push({
          code: "IMAGE_NEAR_LIMIT",
          message: `${path} 가 ${(bytes.length / 1048576).toFixed(1)}MB 로 기준(5MB)에 가깝습니다`,
        });
      }
      try {
        const converted = await toWebp(bytes);
        images.push({
          path,
          alt: meta.alt,
          width: converted.width,
          height: converted.height,
          webp: converted.webp,
        });
      } catch (error) {
        errors.push({
          code: "IMAGE_DECODE_FAILED",
          message: `${path} 를 읽을 수 없습니다: ${(error as Error).message}`,
        });
      }
    }
  }

  const diff = options.previous ? diffChapters(options.previous, chapters) : null;
  const ok = errors.length === 0;
  return {
    report: {
      ok,
      errors,
      warnings,
      course: { id: course.course_id, title: course.title, version: course.version },
      chapters: summaries,
      skipped,
      diff,
    },
    course,
    chapters: ok ? chapters : [],
    images: ok ? images : [],
  };
}

function stableHtml(html: string, paths: Set<string>, imageUrl: (path: string) => string): string {
  let out = html;
  for (const path of paths) out = out.replaceAll(imageUrl(path), path);
  return out;
}

export function diffChapters(
  previous: { key: string; title: string; contentSha256: string }[],
  next: { key: string; title: string; contentSha256: string }[],
): ChapterDiff[] {
  const before = new Map(previous.map((c) => [c.key, c]));
  const result: ChapterDiff[] = next.map((c) => {
    const old = before.get(c.key);
    return {
      key: c.key,
      title: c.title,
      change: !old ? "added" : old.contentSha256 === c.contentSha256 ? "same" : "changed",
    };
  });
  const nextKeys = new Set(next.map((c) => c.key));
  for (const old of previous) {
    if (!nextKeys.has(old.key)) result.push({ key: old.key, title: old.title, change: "removed" });
  }
  return result;
}

/** 올릴 때 미리 course.json 만 읽는다 (과정 · 버전 확인용). 나머지 검사는 worker 가 한다 */
export async function readCourseJson(
  zip: Buffer,
): Promise<{ ok: true; course: CourseJson } | { ok: false; errors: Issue[] }> {
  try {
    const { files } = await readZip(zip, (path) => (path === "course.json" ? LIMITS.textFileBytes : null));
    const raw = parseJson(files.get("course.json"));
    if (raw === undefined)
      return { ok: false, errors: [{ code: "COURSE_JSON_MISSING", message: "course.json 이 없습니다" }] };
    const parsed = courseJsonSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.slice(0, 10).map((issue) => ({
          code: "COURSE_JSON_INVALID",
          message: `${issue.path.join(".") || "(전체)"}: ${issue.message}`,
          where: "course.json",
        })),
      };
    }
    return { ok: true, course: parsed.data };
  } catch (error) {
    if (error instanceof PackageError)
      return { ok: false, errors: [{ code: error.code, message: error.message }] };
    throw error;
  }
}
