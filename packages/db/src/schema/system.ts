import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** 공통: UUID v7 기본 키 (PostgreSQL 18 내장 uuidv7()) */
export const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);

/** 시스템 설정 · 상태 값 (점검 모드, 배포 버전 등) */
export const appMeta = pgTable("app_meta", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// 아래 기록 테이블들은 덧붙이기만 한다. UPDATE 는 DB 트리거가 막고,
// DELETE 는 보관 기간이 지난 행을 지우는 작업(set aionit.retention_purge = 'on')만 할 수 있다.
// 개인정보(이메일 · 이름)는 넣지 않는다. 사람은 user id 로만 가리킨다.

/** 관리자 · 강사 작업 기록 (docs/데이터모델.md 3.11). 보관 2년 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorId: uuid(),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    before: jsonb(),
    after: jsonb(),
    ip: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_at_idx").on(t.at)],
);

export const LOGIN_RESULTS = [
  "success",
  "two_factor_required",
  "fail_password",
  "fail_unverified",
  "fail_two_factor",
  "fail_suspended",
  "blocked_locked",
  "blocked_rate_limit",
] as const;
export type LoginResult = (typeof LOGIN_RESULTS)[number];

/**
 * 로그인 기록 (성공 · 실패). 보관: 회원 6개월, 운영자 · 강사 2년.
 * 이메일 대신 `identifier_hash` (앱 비밀키로 만든 HMAC) 를 둔다: 계정별 실패 횟수는 셀 수 있고, 이메일은 남지 않는다.
 */
export const loginLogs = pgTable(
  "login_logs",
  {
    id: id(),
    userId: uuid(),
    identifierHash: text(),
    /** `email` · `google` · `kakao` · `two_factor` */
    method: text().notNull(),
    result: text({ enum: LOGIN_RESULTS }).notNull(),
    ip: text(),
    userAgent: text(),
    /** 이 기록을 남길 때 운영자 · 강사였나 (보관 기간이 다르다) */
    privileged: text({ enum: ["yes", "no"] })
      .notNull()
      .default("no"),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("login_logs_identifier_at_idx").on(t.identifierHash, t.at),
    index("login_logs_user_at_idx").on(t.userId, t.at),
    index("login_logs_at_idx").on(t.at),
  ],
);

/** 개인정보 조회 기록 (운영자가 회원 정보를 볼 때). 보관 2년 */
export const piiAccessLogs = pgTable(
  "pii_access_logs",
  {
    id: id(),
    actorId: uuid().notNull(),
    subjectUserId: uuid(),
    /** 무엇을 봤는지 (예: ["email", "login_logs"]) */
    fields: jsonb().notNull(),
    purpose: text().notNull(),
    ip: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pii_access_logs_at_idx").on(t.at)],
);

/** 메일 발송 기록. 받는 주소는 회원 탈퇴 때 지운다. */
export const emailLogs = pgTable(
  "email_logs",
  {
    id: id(),
    toUserId: uuid(),
    toEmail: text(),
    template: text().notNull(),
    status: text({ enum: ["sent", "failed", "skipped"] }).notNull(),
    providerMessageId: text(),
    error: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_logs_to_user_idx").on(t.toUserId)],
);
