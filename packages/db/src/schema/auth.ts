// 회원 · 인증 (docs/데이터모델.md 3.1)
// users · sessions · auth_accounts · verifications · two_factors · rate_limits 는 Better Auth 가 읽고 쓴다.
// 그 라이브러리가 기대하는 필드 이름을 지키고, 우리 필드만 덧붙인다 (apps/web/src/server/auth.ts 에서 연결).
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id } from "./system";

const tz = () => timestamp({ withTimezone: true });
const createdAt = () => tz().notNull().defaultNow();
const updatedAt = () =>
  tz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const USER_STATUSES = ["active", "suspended", "withdrawn"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** 회원 한 명. 탈퇴하면 개인정보를 지우고 행은 남긴다 (주문 · 정산 기록이 이 id 를 가리킨다). */
export const users = pgTable(
  "users",
  {
    id: id(),
    /** Better Auth 가 필수로 요구해 비워 둘 수 없다. 이메일을 주지 않는 로그인(카카오)과 탈퇴 회원은 `…@….invalid` 로 둔다. */
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    /** Q&A 에 보이는 이름. 사이트 전체에서 고유(대소문자 무시). 탈퇴하면 비운다. Better Auth 의 `name` 필드다. */
    nickname: text(),
    nicknameChangedAt: tz(),
    image: text(),
    /** 가입 때 "만 14세 이상" 확인한 시각 */
    age14ConfirmedAt: tz(),
    status: text({ enum: USER_STATUSES }).notNull().default("active"),
    withdrawnAt: tz(),
    twoFactorEnabled: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_key").on(sql`lower(${t.email})`),
    uniqueIndex("users_nickname_key").on(sql`lower(${t.nickname})`),
    check("users_status_check", sql`${t.status} in ('active', 'suspended', 'withdrawn')`),
  ],
);

/** 로그인 상태 (DB 세션). 쿠키에는 서명한 토큰만 들어간다. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text().notNull().unique(),
    expiresAt: tz().notNull(),
    ipAddress: text(),
    userAgent: text(),
    /** 이 세션에서 2단계 인증(OTP)을 통과한 시각. 관리자 · 강사 화면은 이 값이 있어야 들어간다. */
    mfaVerifiedAt: tz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** 로그인 방식 연결: email(비밀번호) · google · kakao */
export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 제공자 쪽 계정 id (이메일 방식은 user id) */
    accountId: text().notNull(),
    /** `credential`(이메일 · 비밀번호) · `google` · `kakao` */
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: tz(),
    refreshTokenExpiresAt: tz(),
    scope: text(),
    /** argon2id 해시 (이메일 방식만) */
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("auth_accounts_provider_key").on(t.providerId, t.accountId),
    index("auth_accounts_user_id_idx").on(t.userId),
  ],
);

/** 이메일 인증 · 비밀번호 재설정 · 2단계 인증 진행 중 같은 짧은 토큰. identifier 는 해시로 저장한다. */
export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: tz().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** 2단계 인증(TOTP) 비밀값 · 복구 코드. Better Auth 가 앱 비밀키로 암호화해 저장한다. */
export const twoFactors = pgTable(
  "two_factors",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    verified: boolean().notNull().default(true),
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: tz(),
  },
  (t) => [index("two_factors_user_id_idx").on(t.userId)],
);

/** 요청 횟수 제한 카운터 (IP · 경로별). Better Auth 가 관리한다. */
export const rateLimits = pgTable("rate_limits", {
  id: id(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: "number" }).notNull(),
});

export const ROLES = ["operator", "instructor"] as const;
export type Role = (typeof ROLES)[number];

/** 권한. 강사 · 운영자만 둔다 (수강생 · 구독자는 수강권으로 판단). 회수해도 행은 남긴다. */
export const userRoles = pgTable(
  "user_roles",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: text({ enum: ROLES }).notNull(),
    /** 처음 운영자는 서버 명령으로 만들어 비어 있다 */
    grantedBy: uuid().references(() => users.id),
    grantedAt: createdAt(),
    revokedBy: uuid().references(() => users.id),
    revokedAt: tz(),
    reason: text(),
  },
  (t) => [
    index("user_roles_user_id_idx").on(t.userId),
    // 같은 역할이 동시에 두 번 살아 있지 않게
    uniqueIndex("user_roles_active_key")
      .on(t.userId, t.role)
      .where(sql`${t.revokedAt} is null`),
    check("user_roles_role_check", sql`${t.role} in ('operator', 'instructor')`),
  ],
);

export const POLICY_KINDS = ["terms", "privacy", "marketing", "refund", "instructor_terms"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/** 약관 · 개인정보 수집 · 이용 동의 · 마케팅 수신 동의 등. 고치지 않고 새 버전을 만든다. */
export const policyDocuments = pgTable(
  "policy_documents",
  {
    id: id(),
    kind: text({ enum: POLICY_KINDS }).notNull(),
    version: text().notNull(),
    title: text().notNull(),
    bodyMd: text().notNull(),
    /** 가입 때 꼭 동의해야 하나 */
    required: boolean().notNull(),
    effectiveFrom: tz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("policy_documents_kind_version_key").on(t.kind, t.version)],
);

/** 동의 기록. 동의 · 철회 모두 새 행으로 덧붙인다 (가장 최근 행이 현재 상태). */
export const userConsents = pgTable(
  "user_consents",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    policyDocumentId: uuid()
      .notNull()
      .references(() => policyDocuments.id),
    agreed: boolean().notNull(),
    at: createdAt(),
    ip: text(),
  },
  (t) => [index("user_consents_user_id_idx").on(t.userId)],
);
