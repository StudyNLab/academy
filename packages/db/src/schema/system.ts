import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

/** 관리자 · 강사 작업 기록 — 덧붙이기만 한다 (docs/데이터모델.md 3.11) */
export const auditLogs = pgTable("audit_logs", {
  id: id(),
  actorId: uuid(),
  action: text().notNull(),
  targetType: text(),
  targetId: text(),
  before: jsonb(),
  after: jsonb(),
  ip: text(),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
