// 콘텐츠: 강사 · 과정 · 교재 버전 · 챕터 · 그림 · 영상 자리 · 자체 서버 영상 · 무료 미리보기 · 첨부 (docs/데이터모델.md 3.2 ~ 3.4, 3.11)
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { id } from "./system";

const tz = () => timestamp({ withTimezone: true });
const createdAt = () => tz().notNull().defaultNow();
const updatedAt = () =>
  tz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** 저장한 파일 (Garage). 실제 내용은 object_key 에, 여기에는 목록과 검사값만 */
export const files = pgTable("files", {
  id: id(),
  objectKey: text().notNull().unique(),
  mime: text().notNull(),
  size: bigint({ mode: "number" }).notNull(),
  sha256: text().notNull(),
  originalName: text(),
  createdBy: uuid().references(() => users.id),
  createdAt: createdAt(),
});

/** 강사 프로필 (공개 프로필: 이름 · 소개). 계약 · 정산 정보 · 배분 정책은 instructor.ts */
export const instructors = pgTable("instructors", {
  id: id(),
  /** 강사 계정. 아직 가입하지 않은 강사(운영자가 대신 올림)는 비어 있다 */
  userId: uuid()
    .unique()
    .references(() => users.id),
  displayName: text().notNull(),
  bioMd: text().notNull().default(""),
  status: text({ enum: ["active", "suspended", "ended"] })
    .notNull()
    .default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const COURSE_FIELDS = ["infra", "security", "ai"] as const;
export type CourseField = (typeof COURSE_FIELDS)[number];
export const COURSE_STATUSES = ["draft", "published", "hidden"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/** 과정. slug = 패키지 course_id (안 바뀜) */
export const courses = pgTable(
  "courses",
  {
    id: id(),
    slug: text().notNull().unique(),
    ownerInstructorId: uuid()
      .notNull()
      .references(() => instructors.id),
    title: text().notNull(),
    field: text({ enum: COURSE_FIELDS }).notNull(),
    /** 초급 · 중급 같은 수준 표시 */
    level: text().notNull().default(""),
    summary: text().notNull().default(""),
    descriptionMd: text().notNull().default(""),
    /** 이런 분께 */
    audienceMd: text().notNull().default(""),
    /** 실습 준비물 (예: LLM API 키) */
    requirementsMd: text().notNull().default(""),
    thumbnailFileId: uuid().references(() => files.id),
    inSubscription: boolean().notNull().default(true),
    publishedVersionId: uuid(),
    status: text({ enum: COURSE_STATUSES }).notNull().default("draft"),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("courses_slug_check", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)],
);

export const VERSION_STATUSES = [
  "uploaded",
  "processing",
  "invalid",
  "ready",
  "in_review",
  "rejected",
  "published",
  "archived",
] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

/** 교재 패키지 한 번 업로드. 공개된 버전은 고치지 않는다 (새 버전을 올린다) */
export const courseVersions = pgTable(
  "course_versions",
  {
    id: id(),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    version: text().notNull(),
    packageFileId: uuid()
      .notNull()
      .references(() => files.id),
    status: text({ enum: VERSION_STATUSES }).notNull().default("uploaded"),
    /** 검사 결과: 오류 · 경고 · 챕터 요약 · 이전 공개 버전과 비교 */
    validationReport: jsonb(),
    reviewNote: text(),
    uploadedBy: uuid().references(() => users.id),
    /** 강사가 검수를 요청한 때 · 변경 내용 메모 (I-05). 운영자가 올린 버전은 요청 없이 검수한다 */
    reviewRequestedAt: tz(),
    reviewRequestedBy: uuid().references(() => users.id),
    reviewRequestNote: text(),
    reviewedBy: uuid().references(() => users.id),
    reviewedAt: tz(),
    publishedAt: tz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("course_versions_course_idx").on(t.courseId, t.createdAt)],
);

/** 버전 안의 챕터. 진도 · Q&A · 영상은 id 가 아니라 chapter_key 에 묶는다 */
export const chapters = pgTable(
  "chapters",
  {
    id: id(),
    courseVersionId: uuid()
      .notNull()
      .references(() => courseVersions.id, { onDelete: "cascade" }),
    chapterKey: text().notNull(),
    sortOrder: integer().notNull(),
    label: text().notNull().default(""),
    title: text().notNull(),
    /** 허용 목록으로 정리하고 그림 주소를 바꾼 본문 */
    contentHtml: text().notNull(),
    toc: jsonb().notNull(),
    labs: jsonb().notNull(),
    sourceSha256: text().notNull(),
    /** 정리한 본문의 SHA-256 (버전 비교용) */
    contentSha256: text().notNull(),
  },
  (t) => [uniqueIndex("chapters_version_key").on(t.courseVersionId, t.chapterKey)],
);

/** 교재 그림 (WebP 로 바꾼 것). path 는 패키지 안 경로 */
export const chapterAssets = pgTable(
  "chapter_assets",
  {
    id: id(),
    courseVersionId: uuid()
      .notNull()
      .references(() => courseVersions.id, { onDelete: "cascade" }),
    path: text().notNull(),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    width: integer().notNull(),
    height: integer().notNull(),
    alt: text().notNull().default(""),
  },
  (t) => [uniqueIndex("chapter_assets_version_path").on(t.courseVersionId, t.path)],
);

export const VIDEO_KINDS = ["main", "lab", "extra"] as const;
export const VIDEO_SOURCES = ["none", "youtube", "hosted"] as const;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** 암호화 HLS 키 (영상마다 하나). 키는 앱 비밀값에서 뽑은 키로 감싸 둔다 (packages/core/media sealHlsKey) */
export const hlsKeys = pgTable("hls_keys", {
  id: id(),
  keySealed: bytea().notNull(),
  keyVersion: integer().notNull(),
  createdAt: createdAt(),
});

export const VIDEO_ASSET_STATUSES = ["uploading", "uploaded", "transcoding", "ready", "failed"] as const;
export type VideoAssetStatus = (typeof VIDEO_ASSET_STATUSES)[number];

export interface VideoRendition {
  name: string;
  width: number;
  height: number;
  /** 실제 평균 (영상 + 소리, kbps) */
  avgKbps: number;
  maxrateKbps: number;
}

/**
 * 자체 서버 영상 (M4, docs/기술설계.md 5.2). 원본은 파일 저장소(S3_BUCKET)의 original_key,
 * 변환한 HLS 는 영상 전용 버킷(S3_MEDIA_BUCKET)의 hls_prefix 아래. 과정마다 올린다.
 */
export const videoAssets = pgTable(
  "video_assets",
  {
    id: id(),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    title: text().notNull(),
    status: text({ enum: VIDEO_ASSET_STATUSES }).notNull().default("uploading"),
    originalName: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    originalKey: text().notNull().unique(),
    /** 나눠 올리는 중일 때만 (S3 multipart upload id) */
    uploadId: text(),
    originalFileId: uuid().references(() => files.id),
    /** 변환 진행 (0 ~ 100) */
    progress: integer().notNull().default(0),
    error: text(),
    durationSec: integer(),
    width: integer(),
    height: integer(),
    renditions: jsonb().$type<VideoRendition[]>().notNull().default([]),
    hlsPrefix: text(),
    keyId: uuid().references(() => hlsKeys.id),
    createdBy: uuid().references(() => users.id),
    transcodeStartedAt: tz(),
    readyAt: tz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("video_assets_course_idx").on(t.courseId, t.createdAt)],
);

/** 자막 (srt 를 올리면 WebVTT 로 바꿔 영상 폴더에 둔다) */
export const videoSubtitles = pgTable(
  "video_subtitles",
  {
    id: id(),
    videoAssetId: uuid()
      .notNull()
      .references(() => videoAssets.id, { onDelete: "cascade" }),
    lang: text().notNull().default("ko"),
    label: text().notNull().default("한국어"),
    /** 올린 srt 원본 */
    sourceFileId: uuid()
      .notNull()
      .references(() => files.id),
    /** 영상 버킷 안 WebVTT 경로 */
    vttPath: text().notNull(),
    cues: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("video_subtitles_asset_lang").on(t.videoAssetId, t.lang)],
);

/** 영상 자리 (패키지 manifest 의 videos). 과정 단위라 새 버전이 같은 key 를 쓰면 연결이 그대로 이어진다 */
export const videoSlots = pgTable(
  "video_slots",
  {
    id: id(),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    key: text().notNull(),
    chapterKey: text().notNull(),
    kind: text({ enum: VIDEO_KINDS }).notNull(),
    title: text().notNull(),
    sectionId: text(),
    source: text({ enum: VIDEO_SOURCES }).notNull().default("none"),
    youtubeVideoId: text(),
    /** 자체 서버 영상 (M4). 같은 과정의 영상만 */
    videoAssetId: uuid().references(() => videoAssets.id),
    durationSec: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("video_slots_course_key").on(t.courseId, t.key),
    check("video_slots_youtube_check", sql`${t.source} <> 'youtube' or ${t.youtubeVideoId} is not null`),
    check("video_slots_hosted_check", sql`${t.source} <> 'hosted' or ${t.videoAssetId} is not null`),
  ],
);

/** 무료 미리보기 (AD-06). 버전이 아니라 과정에 묶여 새 버전을 올려도 유지된다 */
export const previewRules = pgTable(
  "preview_rules",
  {
    id: id(),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    chapterKey: text().notNull(),
    scope: text({ enum: ["whole", "sections"] }).notNull(),
    sectionIds: jsonb().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("preview_rules_course_chapter").on(t.courseId, t.chapterKey)],
);

/** 첨부 자료 (챕터별 실습 파일). 받기는 수강권이 있어야 한다 (M3) */
export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    /** 비어 있으면 과정 전체 */
    chapterKey: text(),
    title: text().notNull(),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_course_idx").on(t.courseId)],
);
