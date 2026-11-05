// Q&A · 1:1 문의 · 공지 · 자주 묻는 질문 · 알림 (docs/데이터모델.md 3.9).
// Q&A 는 chapter_key 에 묶는다: 새 버전이 공개돼도 같은 key 의 질문은 이어지고, 사라진 챕터의 질문은 "이전 버전의 질문"으로 남는다.
// 탈퇴한 회원의 글은 남기고 작성자를 "탈퇴한 회원"으로 보여 준다 (users.nickname 이 비어 있다, 결정 D2).
import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { courses } from "./content";
import { id } from "./system";

const tz = () => timestamp({ withTimezone: true });
const createdAt = () => tz().notNull().defaultNow();
const updatedAt = () =>
  tz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const QUESTION_STATUSES = ["open", "resolved"] as const;
export const ANSWER_ROLES = ["instructor", "learner", "operator"] as const;
export type AnswerRole = (typeof ANSWER_ROLES)[number];

/** 강의 질문 (L-06) */
export const questions = pgTable(
  "questions",
  {
    id: id(),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    chapterKey: text().notNull(),
    /** 질문할 때 읽던 Section (자동 연결) */
    sectionId: text(),
    authorId: uuid()
      .notNull()
      .references(() => users.id),
    title: text().notNull(),
    bodyMd: text().notNull(),
    /** 질문자 · 그 과정 강사 · 운영자만 본다 */
    isSecret: boolean().notNull().default(false),
    status: text({ enum: QUESTION_STATUSES }).notNull().default("open"),
    resolvedAt: tz(),
    /** 강사 · 운영자가 맨 위에 고정 (자주 나오는 질문) */
    pinnedAt: tz(),
    /** 운영자 숨김 (AD-17) */
    hiddenAt: tz(),
    hiddenReason: text(),
    hiddenBy: uuid().references(() => users.id),
    /** 작성자가 지움. 내용은 비운다 (API 키를 잘못 올린 경우 등) */
    deletedAt: tz(),
    answerCount: integer().notNull().default(0),
    lastAnsweredAt: tz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("questions_course_chapter_idx").on(t.courseId, t.chapterKey, t.createdAt),
    index("questions_author_idx").on(t.authorId, t.createdAt),
  ],
);

/** 답변 */
export const answers = pgTable(
  "answers",
  {
    id: id(),
    questionId: uuid()
      .notNull()
      .references(() => questions.id),
    authorId: uuid()
      .notNull()
      .references(() => users.id),
    /** 쓸 때의 역할 (스냅샷). 강사 · 운영자 답변은 맨 위에 "강사" · "운영자" 배지 */
    authorRole: text({ enum: ANSWER_ROLES }).notNull(),
    bodyMd: text().notNull(),
    hiddenAt: tz(),
    hiddenReason: text(),
    hiddenBy: uuid().references(() => users.id),
    deletedAt: tz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("answers_question_idx").on(t.questionId, t.createdAt)],
);

export const REPORT_TARGETS = ["question", "answer"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];
export const REPORT_STATUSES = ["open", "hidden", "dismissed"] as const;

/** 신고. 같은 사람은 같은 글을 한 번만 신고한다 */
export const reports = pgTable(
  "reports",
  {
    id: id(),
    targetType: text({ enum: REPORT_TARGETS }).notNull(),
    targetId: uuid().notNull(),
    /** 신고된 글의 과정 (운영자 화면에서 묶어 보기) */
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    reporterId: uuid()
      .notNull()
      .references(() => users.id),
    reason: text().notNull(),
    detail: text(),
    /** open ➔ hidden(글을 숨김) / dismissed(문제없음) */
    status: text({ enum: REPORT_STATUSES }).notNull().default("open"),
    handledBy: uuid().references(() => users.id),
    handledAt: tz(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reports_target_reporter_key").on(t.targetType, t.targetId, t.reporterId),
    index("reports_status_idx").on(t.status, t.createdAt),
  ],
);

export const INQUIRY_STATUSES = ["open", "answered", "closed"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/** 1:1 문의 (M-05 · AD-13). 소비자 불만 · 분쟁 기록이라 3년 보관 (탈퇴해도 남는다) */
export const inquiries = pgTable(
  "inquiries",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    category: text().notNull(),
    title: text().notNull(),
    /** open(답변 기다림) ➔ answered(운영자 답변) ➔ 회원이 더 물으면 다시 open, closed(끝) */
    status: text({ enum: INQUIRY_STATUSES }).notNull().default("open"),
    lastMessageAt: tz().notNull().defaultNow(),
    closedAt: tz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("inquiries_user_idx").on(t.userId, t.createdAt),
    index("inquiries_status_idx").on(t.status, t.lastMessageAt),
  ],
);

/** 문의 글 · 운영자 답변 */
export const inquiryMessages = pgTable(
  "inquiry_messages",
  {
    id: id(),
    inquiryId: uuid()
      .notNull()
      .references(() => inquiries.id),
    authorId: uuid()
      .notNull()
      .references(() => users.id),
    authorRole: text({ enum: ["member", "operator"] }).notNull(),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("inquiry_messages_inquiry_idx").on(t.inquiryId, t.createdAt)],
);

/** 공지 (P-07 · AD-12). published_at 이 비어 있으면 임시 저장 */
export const notices = pgTable(
  "notices",
  {
    id: id(),
    title: text().notNull(),
    bodyMd: text().notNull(),
    /** 목록 맨 위 고정 */
    pinned: boolean().notNull().default(false),
    publishedAt: tz(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("notices_published_idx").on(t.publishedAt)],
);

/** 자주 묻는 질문 (P-08 · AD-12) */
export const faqs = pgTable(
  "faqs",
  {
    id: id(),
    category: text().notNull(),
    question: text().notNull(),
    answerMd: text().notNull(),
    sortOrder: integer().notNull().default(0),
    published: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("faqs_order_idx").on(t.category, t.sortOrder)],
);

export const NOTIFICATION_KINDS = [
  "qna_answer",
  "qna_question",
  "qna_hidden",
  "inquiry_answer",
  "expiry",
  "content_review",
  "instructor_contract",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** 사이트 안 알림 (머리글 알림 · /my/notifications). url 은 우리 사이트 안 주소만 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    kind: text({ enum: NOTIFICATION_KINDS }).notNull(),
    title: text().notNull(),
    body: text(),
    url: text().notNull(),
    /** 같은 대상의 알림을 묶어 보기 (예: 질문 id) */
    targetId: text(),
    readAt: tz(),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    index("notifications_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

/** 메일 알림 설정 (M-01). 행이 없으면 모두 켜짐. 마케팅 메일은 user_consents(kind=marketing) */
export const notificationPrefs = pgTable("notification_prefs", {
  userId: uuid()
    .primaryKey()
    .references(() => users.id),
  /** 내 질문에 답변이 달리면 메일 */
  qnaAnswerEmail: boolean().notNull().default(true),
  /** 수강 기간 만료 알림 메일 (D-30 · D-7) */
  expiryEmail: boolean().notNull().default(true),
  updatedAt: updatedAt(),
});
