CREATE TABLE "instructor_contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"policy_document_id" uuid NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"signed_at" timestamp with time zone,
	"signed_by" uuid,
	"signed_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instructor_contracts_period_check" CHECK ("instructor_contracts"."ends_on" is null or "instructor_contracts"."ends_on" >= "instructor_contracts"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "payout_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"tax_type" text NOT NULL,
	"rrn_sealed" text,
	"business_no" text,
	"bank_name" text NOT NULL,
	"bank_account_sealed" text NOT NULL,
	"bank_account_last4" text NOT NULL,
	"account_holder" text NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_profiles_instructorId_unique" UNIQUE("instructor_id"),
	CONSTRAINT "payout_profiles_tax_check" CHECK (("payout_profiles"."tax_type" = 'individual' and "payout_profiles"."rrn_sealed" is not null) or ("payout_profiles"."tax_type" = 'business' and "payout_profiles"."business_no" is not null))
);
--> statement-breakpoint
CREATE TABLE "revenue_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"single_rate_bp" integer,
	"subscription_pool_rate_bp" integer,
	"learning_rules" jsonb,
	"effective_from" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_policies_scope_from_key" UNIQUE NULLS NOT DISTINCT("scope","scope_id","effective_from"),
	CONSTRAINT "revenue_policies_scope_check" CHECK (("revenue_policies"."scope" = 'default') = ("revenue_policies"."scope_id" is null)),
	CONSTRAINT "revenue_policies_default_check" CHECK ("revenue_policies"."scope" <> 'default' or ("revenue_policies"."single_rate_bp" is not null and "revenue_policies"."subscription_pool_rate_bp" is not null and "revenue_policies"."learning_rules" is not null)),
	CONSTRAINT "revenue_policies_rate_check" CHECK (("revenue_policies"."single_rate_bp" is null or "revenue_policies"."single_rate_bp" between 0 and 10000) and ("revenue_policies"."subscription_pool_rate_bp" is null or "revenue_policies"."subscription_pool_rate_bp" between 0 and 10000))
);
--> statement-breakpoint
ALTER TABLE "course_versions" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_versions" ADD COLUMN "review_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "course_versions" ADD COLUMN "review_request_note" text;--> statement-breakpoint
ALTER TABLE "instructor_contracts" ADD CONSTRAINT "instructor_contracts_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_contracts" ADD CONSTRAINT "instructor_contracts_policy_document_id_policy_documents_id_fk" FOREIGN KEY ("policy_document_id") REFERENCES "public"."policy_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_contracts" ADD CONSTRAINT "instructor_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_contracts" ADD CONSTRAINT "instructor_contracts_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_profiles" ADD CONSTRAINT "payout_profiles_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_profiles" ADD CONSTRAINT "payout_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instructor_contracts_instructor_idx" ON "instructor_contracts" USING btree ("instructor_id","starts_on");--> statement-breakpoint
CREATE INDEX "revenue_policies_scope_idx" ON "revenue_policies" USING btree ("scope","scope_id","effective_from");--> statement-breakpoint
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_review_requested_by_users_id_fk" FOREIGN KEY ("review_requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- 배분 정책은 고치지 않고 새 버전을 덧붙인다 (docs/데이터모델.md 1장 "버전 + 시행일")
CREATE TRIGGER revenue_policies_append_only BEFORE UPDATE OR DELETE ON revenue_policies
  FOR EACH ROW EXECUTE FUNCTION aionit_append_only();
--> statement-breakpoint
CREATE TRIGGER revenue_policies_no_truncate BEFORE TRUNCATE ON revenue_policies
  FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
-- 강사가 동의한 계약은 고치거나 지울 수 없다 (동의 전 계약은 동의 기록 · 지우기만)
CREATE FUNCTION aionit_signed_contract() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_at IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND current_setting('aionit.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '동의한 계약은 바꿀 수 없습니다 (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER instructor_contracts_keep_signed BEFORE UPDATE OR DELETE ON instructor_contracts
  FOR EACH ROW EXECUTE FUNCTION aionit_signed_contract();
--> statement-breakpoint
-- 기본 배분 정책 v1 (사이트구조 9장: 단건 강사 60%, 구독 강사 풀 50%, 유효 학습 시간 규칙 2026-11-v1)
INSERT INTO revenue_policies (scope, single_rate_bp, subscription_pool_rate_bp, learning_rules, effective_from, note) VALUES
('default', 6000, 5000,
 '{"version":"2026-11-v1","dailyCapSec":10800,"bucketSec":30,"idleStopSec":120,"videoCompleteRatio":0.9}',
 '2026-11-01T00:00:00+09:00', '기본 정책 v1');
--> statement-breakpoint
-- 강사 이용약관 초안 (가입 동의가 아니라 강사 계약 때 동의한다. 실오픈 전 법률 검토 후 새 버전, 개발계획 M10)
INSERT INTO policy_documents (kind, version, title, body_md, required, effective_from) VALUES
('instructor_terms', '2026-11-05-draft', '강사 이용약관', $md$
> 초안입니다. 테스트 기간에만 쓰고, 실오픈 전에 법률 · 세무 검토를 거친 새 버전으로 바꿉니다.

1. 강의 콘텐츠의 저작권은 강사에게 있고, 사이트는 계약 기간 동안 강의를 판매 · 제공할 수 있는 이용 허락을 받습니다.
2. 강사가 올린 교재 · 영상은 운영자 검수를 거쳐 공개됩니다. 검수 기준에 맞지 않으면 사유와 함께 반려하거나 게시를 멈출 수 있습니다.
3. 가격은 사이트가 정합니다. 수익은 배분 정책(단건 · 구독)에 따라 매월 정산합니다. 강사에게 불리한 변경은 30일 전에 알립니다.
4. 수강생의 개인정보(이메일 · 이름 · 결제 정보)는 강사에게 제공하지 않습니다. 강사는 통계와 Q&A 의 닉네임만 봅니다.
5. 계약이 끝나도 이미 수강권을 가진 수강생은 수강 기간이 끝날 때까지 계속 볼 수 있습니다.
$md$, false, '2026-11-05T00:00:00+09:00');
