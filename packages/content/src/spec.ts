// 교재 업로드 패키지 규격 v0.2 (docs/교재_업로드_패키지_규격.md) 의 형식 · 한도
import { z } from "zod";

export const LIMITS = {
  /** zip 파일 자체 (4장) */
  zipBytes: 200 * 1024 * 1024,
  /** 풀었을 때 전체 (압축 폭탄 방지) */
  unzippedBytes: 300 * 1024 * 1024,
  entries: 5000,
  contentHtmlBytes: 1024 * 1024,
  imageBytes: 5 * 1024 * 1024,
  /** course.json · manifest.json · source.md */
  textFileBytes: 2 * 1024 * 1024,
  /** 그림 한 장의 가로 · 세로 상한 (픽셀 폭탄 방지) */
  imagePixels: 40_000_000,
} as const;

export const COURSE_SCHEMA = "academy-course/0.2";
export const CHAPTER_SCHEMA = "academy-chapter/0.2";

export const COURSE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const CHAPTER_ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;
export const SECTION_ID = /^sec-\d+(-\d+)?$/;
export const VIDEO_KEY = /^[a-z0-9_]{1,64}$/;
export const IMAGE_PATH = /^images\/[A-Za-z0-9가-힣_.-]{1,120}\.(png|jpe?g|webp)$/;

export const courseJsonSchema = z.object({
  schema: z.literal(COURSE_SCHEMA),
  course_id: z.string().regex(COURSE_ID, "course_id 는 영문 소문자 · 숫자 · - 만"),
  title: z.string().min(1).max(200),
  field: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/, "version 은 1.0.0 형식"),
  built_at: z.string().min(1),
  generator: z.string().min(1).max(200),
  chapters: z
    .array(
      z.object({
        chapter_id: z.string().regex(CHAPTER_ID, "chapter_id 형식"),
        dir: z
          .string()
          .min(1)
          .max(200)
          .refine((d) => !/[\\/]|^\.\.?$/.test(d), "dir 에 경로 구분자를 쓸 수 없습니다"),
        title: z.string().min(1).max(300),
      }),
    )
    .min(1)
    .max(200),
});
export type CourseJson = z.infer<typeof courseJsonSchema>;

const tocItem = z.object({
  level: z.number().int().min(1).max(4),
  id: z.string().regex(SECTION_ID, "toc id 는 sec-숫자 형식"),
  title: z.string().min(1).max(300),
  lab: z.boolean().default(false),
});

export const manifestSchema = z.object({
  schema: z.literal(CHAPTER_SCHEMA),
  chapter_id: z.string().regex(CHAPTER_ID),
  label: z.string().max(100).default(""),
  title: z.string().min(1).max(300),
  source: z.string().max(300).optional(),
  source_sha256: z.string().regex(/^[0-9a-f]{64}$/, "source_sha256 은 SHA-256 16진수"),
  toc: z.array(tocItem).max(500),
  images: z
    .array(
      z.object({
        path: z.string().regex(IMAGE_PATH, "그림 경로는 images/이름.png|jpg|webp"),
        alt: z.string().max(500).default(""),
        width: z.number().int().positive().max(20000),
        height: z.number().int().positive().max(20000),
      }),
    )
    .max(500),
  videos: z
    .array(
      z.object({
        key: z.string().regex(VIDEO_KEY, "영상 key 는 영문 소문자 · 숫자 · _"),
        kind: z.enum(["main", "lab", "extra"]),
        title: z.string().min(1).max(300),
        section_id: z.string().regex(SECTION_ID).optional(),
      }),
    )
    .max(100)
    .default([]),
  labs: z
    .array(
      z.object({
        section_id: z.string().regex(SECTION_ID),
        title: z.string().min(1).max(300),
        self_check: z
          .array(z.object({ id: z.string().regex(/^[a-z0-9_-]{1,32}$/), text: z.string().min(1).max(500) }))
          .max(50)
          .default([]),
      }),
    )
    .max(100)
    .default([]),
});
export type ManifestJson = z.infer<typeof manifestSchema>;

/** 3.5 허용 목록 */
export const ALLOWED_TAGS = [
  "section",
  "header",
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "figure",
  "figcaption",
  "img",
  "pre",
  "code",
  "a",
  "strong",
  "b",
  "em",
  "i",
  "br",
  "details",
  "summary",
  "button",
  "blockquote",
  "hr",
  "sup",
  "sub",
  "kbd",
] as const;

export const ALLOWED_CLASSES = [
  // 표지 · 흐름
  "cover",
  "label",
  "goals",
  "flow",
  "flow-title",
  "lab",
  // Section
  "sec",
  "summary",
  "num",
  // 강조 박스
  "box",
  "warn",
  "tip",
  "prac",
  "box-title",
  // 정의 · 코드 읽기
  "def",
  "code-sec",
  "core",
  "basic",
  "print",
  // 코드
  "code",
  "run",
  "term",
  "key",
  "fold",
  "text",
  "plain",
  "code-head",
  "tag",
  "where",
  "lang",
  "copy",
  "open",
  "hl",
  "numbered",
  "line",
  "dim",
  "ln",
  "prompt",
  "cmd",
  // 그림 · 표
  "fig",
  "tbl",
  "tbl-wrap",
  // 영상 자리
  "video-slot",
  "video-title",
] as const;

/** 문법 색 (pygments 짧은 토큰 이름: 영문 1~3자 + 숫자 0~1자). 코드 안 span 에만 */
export const PYGMENTS_CLASS = /^[a-z]{1,3}\d?$/;
