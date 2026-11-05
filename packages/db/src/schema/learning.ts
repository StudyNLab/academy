// 수강권 · 학습 기록 (docs/데이터모델.md 3.8). 진도 · 영상 · 체크는 chapters.id 가 아니라 chapter_key 에 묶는다.
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { attachments, courses } from "./content";
import { id } from "./system";

const tz = () => timestamp({ withTimezone: true });
const createdAt = () => tz().notNull().defaultNow();
const updatedAt = () =>
  tz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const ENTITLEMENT_SCOPES = ["course", "subscription_catalog"] as const;
export const ENTITLEMENT_SOURCES = ["purchase", "subscription", "admin_grant", "free", "extension"] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

/** 수강권. 강의를 볼 수 있는지는 이것 하나로 판단한다 (packages/core canAccessCourse) */
export const entitlements = pgTable(
  "entitlements",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    scope: text({ enum: ENTITLEMENT_SCOPES }).notNull(),
    /** scope = course 일 때 */
    courseId: uuid().references(() => courses.id),
    sourceType: text({ enum: ENTITLEMENT_SOURCES }).notNull(),
    /** 주문 항목 · 구독 · 관리자 작업 등 (종류마다 다름) */
    sourceId: text(),
    startsAt: tz().notNull(),
    /** 없으면 무제한 */
    endsAt: tz(),
    /** 첫 재생 · 첫 첨부 받기 ("7일 이내 + 이용 안 함" 전액 환불 판단) */
    firstUsedAt: tz(),
    remindedD30At: tz(),
    remindedD7At: tz(),
    revokedAt: tz(),
    revokeReason: text(),
    grantedBy: uuid().references(() => users.id),
    note: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("entitlements_user_idx").on(t.userId),
    check("entitlements_scope_check", sql`${t.scope} <> 'course' or ${t.courseId} is not null`),
  ],
);

/** 챕터 진도 */
export const chapterProgress = pgTable(
  "chapter_progress",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    chapterKey: text().notNull(),
    lastSectionId: text(),
    /** 0 ~ 1, 가장 많이 내려간 정도 */
    readRatio: real().notNull().default(0),
    /** 이 챕터 교재를 본 시간(초, 학습 신호로 쌓음) — 교재 완료의 최소 시간 판단 */
    textSeconds: integer().notNull().default(0),
    reachedEndAt: tz(),
    textDoneAt: tz(),
    completedAt: tz(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("chapter_progress_key").on(t.userId, t.courseId, t.chapterKey)],
);

/** 영상 시청 (영상 자리 key 마다). 본 구간은 콘텐츠 시간 기준 [시작초, 끝초] 목록 */
export const videoWatch = pgTable(
  "video_watch",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    videoKey: text().notNull(),
    watchedRanges: jsonb().notNull().default([]),
    lastPositionSec: integer().notNull().default(0),
    durationSec: integer(),
    completedAt: tz(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("video_watch_key").on(t.userId, t.courseId, t.videoKey)],
);

/** 실습 스스로 확인. 체크 해제는 행을 지우지 않고 unchecked_at 을 적는다 */
export const selfChecks = pgTable(
  "self_checks",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    chapterKey: text().notNull(),
    sectionId: text().notNull(),
    itemId: text().notNull(),
    checkedAt: tz(),
    uncheckedAt: tz(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("self_checks_key").on(t.userId, t.courseId, t.chapterKey, t.sectionId, t.itemId)],
);

/** 학습 중 신호 (원자료). 보관 90일, 매일 밤 learning_time_daily 로 집계 */
export const learningHeartbeats = pgTable(
  "learning_heartbeats",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    chapterKey: text().notNull(),
    kind: text({ enum: ["video", "text"] }).notNull(),
    at: tz().notNull(),
    /** text: { activeSec } · video: { videoKey, ranges: [[s, e]] } */
    payload: jsonb().notNull(),
    receivedAt: createdAt(),
  },
  (t) => [
    index("learning_heartbeats_at_idx").on(t.at),
    index("learning_heartbeats_user_idx").on(t.userId, t.courseId, t.at),
  ],
);

/** 하루 유효 학습 시간 (정산용, KST 날짜). 탈퇴하면 user_id 를 비운다 (정산 근거는 남긴다) */
export const learningTimeDaily = pgTable(
  "learning_time_daily",
  {
    id: id(),
    userId: uuid().references(() => users.id),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    date: date({ mode: "string" }).notNull(),
    videoSec: integer().notNull(),
    textSec: integer().notNull(),
    /** 상한 · 제외 규칙을 적용한 뒤 */
    effectiveSec: integer().notNull(),
    ruleVersion: text().notNull(),
    /**
     * 그날 무엇으로 봤나 (M9, core learningAccess): subscription 만 구독 배분에 쓴다. course 는 단건 · 발급 수강권 (D3).
     * 집계할 때 남겨 두어 탈퇴해 user_id 가 비어도 정산 근거가 남는다. 비어 있으면(M9 전 집계) 정산할 때 다시 판단한다
     */
    access: text({ enum: ["subscription", "course", "none"] }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("learning_time_daily_key").on(t.userId, t.courseId, t.date),
    index("learning_time_daily_date_idx").on(t.date),
  ],
);

/** 첨부 자료 받은 기록 (환불 계산의 "이용함" 근거) */
export const attachmentDownloads = pgTable(
  "attachment_downloads",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    attachmentId: uuid()
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    at: createdAt(),
  },
  (t) => [index("attachment_downloads_user_idx").on(t.userId)],
);
