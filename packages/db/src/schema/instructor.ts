// 강사 계약 · 정산 정보 · 배분 정책 (docs/데이터모델.md 3.2 · 3.10). 정산(settlements …)은 ./settlement.
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { policyDocuments, users } from "./auth";
import { instructors } from "./content";
import { id } from "./system";

const tz = () => timestamp({ withTimezone: true });
const createdAt = () => tz().notNull().defaultNow();
const updatedAt = () =>
  tz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * 강사 계약 (AD-15). 운영자가 기간 · 강사 이용약관 버전으로 만들고, 강사가 강사 화면에서 동의하면 signed_at.
 * 수익 비율은 여기가 아니라 배분 정책(revenue_policies)에 둔다 (비율만 바꿀 때 계약을 다시 만들지 않게).
 * 동의한 계약은 고치지 않는다 (DB 트리거). 동의 전 계약만 지울 수 있다.
 */
export const instructorContracts = pgTable(
  "instructor_contracts",
  {
    id: id(),
    instructorId: uuid()
      .notNull()
      .references(() => instructors.id),
    startsOn: date({ mode: "string" }).notNull(),
    /** 비어 있으면 끝나는 날 없음 */
    endsOn: date({ mode: "string" }),
    /** 강사 이용약관 버전 (policy_documents kind=instructor_terms) */
    policyDocumentId: uuid()
      .notNull()
      .references(() => policyDocuments.id),
    memo: text().notNull().default(""),
    createdBy: uuid().references(() => users.id),
    signedAt: tz(),
    signedBy: uuid().references(() => users.id),
    signedIp: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("instructor_contracts_instructor_idx").on(t.instructorId, t.startsOn),
    check("instructor_contracts_period_check", sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
  ],
);

export const TAX_TYPES = ["individual", "business"] as const;
export type TaxType = (typeof TAX_TYPES)[number];

/**
 * 정산 정보 (I-09). 주민등록번호 · 계좌번호는 앱에서 AES-256-GCM 으로 감싸 저장하고 (키는 DB 밖),
 * 화면에는 끝 4자리만 보인다. 읽을 때마다 개인정보 조회 기록을 남긴다.
 */
export const payoutProfiles = pgTable(
  "payout_profiles",
  {
    id: id(),
    instructorId: uuid()
      .notNull()
      .unique()
      .references(() => instructors.id),
    taxType: text({ enum: TAX_TYPES }).notNull(),
    /** 개인만. "v1.<iv>.<tag>.<암호문>" */
    rrnSealed: text(),
    /** 사업자만 (공개 정보라 감싸지 않는다) */
    businessNo: text(),
    bankName: text().notNull(),
    bankAccountSealed: text().notNull(),
    /** 화면 표시용 끝 4자리 */
    bankAccountLast4: text().notNull(),
    accountHolder: text().notNull(),
    updatedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "payout_profiles_tax_check",
      sql`(${t.taxType} = 'individual' and ${t.rrnSealed} is not null) or (${t.taxType} = 'business' and ${t.businessNo} is not null)`,
    ),
  ],
);

export const REVENUE_SCOPES = ["default", "instructor", "course"] as const;
export type RevenueScope = (typeof REVENUE_SCOPES)[number];

/**
 * 배분 정책 버전 (사이트구조 9장). 고치지 않고 새 버전을 시행일과 함께 덧붙인다 (DB 트리거).
 * 비율은 만분율 정수 (6000 = 60%). 강사 · 과정 범위에서 비어 있는 값은 기본 정책을 따른다.
 * 정책 고르기(가장 좁은 범위, 매출 시각에 시행 중인 것)는 packages/core resolvePolicy.
 */
export const revenuePolicies = pgTable(
  "revenue_policies",
  {
    id: id(),
    scope: text({ enum: REVENUE_SCOPES }).notNull(),
    /** 강사 id 또는 과정 id (기본 정책은 비어 있다) */
    scopeId: uuid(),
    /** 단건 매출의 강사 비율 */
    singleRateBp: integer(),
    /** 구독 매출의 강사 풀 비율 */
    subscriptionPoolRateBp: integer(),
    /** 결제에 PG 수수료가 기록되지 않았을 때 쓰는 추정 수수료율 (M9) */
    pgFeeRateBp: integer(),
    /** 유효 학습 시간 규칙 (packages/core LEARNING_RULES_V1 형식) */
    learningRules: jsonb(),
    effectiveFrom: tz().notNull(),
    note: text().notNull().default(""),
    /** 만든 운영자 (회원 테이블을 비워도 기본 정책이 남게 FK 는 두지 않는다) */
    createdBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    index("revenue_policies_scope_idx").on(t.scope, t.scopeId, t.effectiveFrom),
    unique("revenue_policies_scope_from_key").on(t.scope, t.scopeId, t.effectiveFrom).nullsNotDistinct(),
    check("revenue_policies_scope_check", sql`(${t.scope} = 'default') = (${t.scopeId} is null)`),
    check(
      "revenue_policies_default_check",
      sql`${t.scope} <> 'default' or (${t.singleRateBp} is not null and ${t.subscriptionPoolRateBp} is not null and ${t.pgFeeRateBp} is not null and ${t.learningRules} is not null)`,
    ),
    check(
      "revenue_policies_rate_check",
      sql`(${t.singleRateBp} is null or ${t.singleRateBp} between 0 and 10000) and (${t.subscriptionPoolRateBp} is null or ${t.subscriptionPoolRateBp} between 0 and 10000) and (${t.pgFeeRateBp} is null or ${t.pgFeeRateBp} between 0 and 10000)`,
    ),
  ],
);
