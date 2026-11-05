CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount" bigint NOT NULL,
	"method" text DEFAULT 'bank_transfer' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_settlementId_unique" UNIQUE("settlement_id"),
	CONSTRAINT "payouts_amount_check" CHECK ("payouts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"objection_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_adjustments_amount_check" CHECK ("settlement_adjustments"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"course_id" uuid,
	"order_item_id" uuid,
	"refund_id" uuid,
	"adjustment_id" uuid,
	"policy_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"base_amount" bigint NOT NULL,
	"rate_bp" integer,
	"amount" bigint NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_objections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"answer" text,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_periods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'calculated' NOT NULL,
	"subscription_base" bigint DEFAULT 0 NOT NULL,
	"subscription_pool" bigint DEFAULT 0 NOT NULL,
	"pool_carry_in" bigint DEFAULT 0 NOT NULL,
	"pool_carry_out" bigint DEFAULT 0 NOT NULL,
	"subscription_seconds" bigint DEFAULT 0 NOT NULL,
	"policy_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	"calculated_by" uuid,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_periods_month_unique" UNIQUE("month")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"period_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"status" text DEFAULT 'calculated' NOT NULL,
	"single_amount" bigint NOT NULL,
	"subscription_amount" bigint NOT NULL,
	"refund_amount" bigint NOT NULL,
	"adjustment_amount" bigint NOT NULL,
	"carried_in" bigint NOT NULL,
	"gross_amount" bigint NOT NULL,
	"income_tax" bigint NOT NULL,
	"local_tax" bigint NOT NULL,
	"withheld" bigint NOT NULL,
	"vat_amount" bigint NOT NULL,
	"payout_amount" bigint NOT NULL,
	"carry_out" bigint NOT NULL,
	"hold_reason" text,
	"tax_type" text,
	"policy_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"objection_until" date,
	"pay_on" date,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_period_instructor_key" UNIQUE("period_id","instructor_id"),
	CONSTRAINT "settlements_sum_check" CHECK ("settlements"."gross_amount" = "settlements"."single_amount" + "settlements"."subscription_amount" + "settlements"."refund_amount" + "settlements"."adjustment_amount" + "settlements"."carried_in"),
	CONSTRAINT "settlements_payout_check" CHECK ("settlements"."payout_amount" = 0 or "settlements"."payout_amount" = "settlements"."gross_amount" - "settlements"."withheld" + "settlements"."vat_amount")
);
--> statement-breakpoint
ALTER TABLE "revenue_policies" DROP CONSTRAINT "revenue_policies_default_check";--> statement-breakpoint
ALTER TABLE "revenue_policies" DROP CONSTRAINT "revenue_policies_rate_check";--> statement-breakpoint
ALTER TABLE "learning_time_daily" ADD COLUMN "access" text;--> statement-breakpoint
ALTER TABLE "revenue_policies" ADD COLUMN "pg_fee_rate_bp" integer;--> statement-breakpoint
-- 기본 정책 v1 에 추정 PG 수수료율 3.4% 를 넣는다 (결제에 실제 수수료가 기록되지 않았을 때만 쓴다).
-- 배분 정책은 덧붙이기만 하지만 (트리거), 아직 정산에 쓰인 적이 없는 v1 에 새 칸을 채우는 것만 이 마이그레이션에서 한 번 한다
ALTER TABLE "revenue_policies" DISABLE TRIGGER revenue_policies_append_only;--> statement-breakpoint
UPDATE "revenue_policies" SET "pg_fee_rate_bp" = 340 WHERE "scope" = 'default' AND "pg_fee_rate_bp" IS NULL;--> statement-breakpoint
ALTER TABLE "revenue_policies" ENABLE TRIGGER revenue_policies_append_only;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_objection_id_settlement_objections_id_fk" FOREIGN KEY ("objection_id") REFERENCES "public"."settlement_objections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_adjustment_id_settlement_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."settlement_adjustments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_policy_id_revenue_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."revenue_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_objections" ADD CONSTRAINT "settlement_objections_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_objections" ADD CONSTRAINT "settlement_objections_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_objections" ADD CONSTRAINT "settlement_objections_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_periods" ADD CONSTRAINT "settlement_periods_calculated_by_users_id_fk" FOREIGN KEY ("calculated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_periods" ADD CONSTRAINT "settlement_periods_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_period_id_settlement_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."settlement_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlement_adjustments_instructor_idx" ON "settlement_adjustments" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "settlement_lines_settlement_idx" ON "settlement_lines" USING btree ("settlement_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_lines_sale_key" ON "settlement_lines" USING btree ("order_item_id","course_id") WHERE "settlement_lines"."kind" = 'single';--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_lines_refund_key" ON "settlement_lines" USING btree ("refund_id","course_id") WHERE "settlement_lines"."refund_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_lines_adjustment_key" ON "settlement_lines" USING btree ("adjustment_id") WHERE "settlement_lines"."adjustment_id" is not null;--> statement-breakpoint
CREATE INDEX "settlement_objections_settlement_idx" ON "settlement_objections" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "settlements_instructor_idx" ON "settlements" USING btree ("instructor_id");--> statement-breakpoint
ALTER TABLE "revenue_policies" ADD CONSTRAINT "revenue_policies_default_check" CHECK ("revenue_policies"."scope" <> 'default' or ("revenue_policies"."single_rate_bp" is not null and "revenue_policies"."subscription_pool_rate_bp" is not null and "revenue_policies"."pg_fee_rate_bp" is not null and "revenue_policies"."learning_rules" is not null));--> statement-breakpoint
ALTER TABLE "revenue_policies" ADD CONSTRAINT "revenue_policies_rate_check" CHECK (("revenue_policies"."single_rate_bp" is null or "revenue_policies"."single_rate_bp" between 0 and 10000) and ("revenue_policies"."subscription_pool_rate_bp" is null or "revenue_policies"."subscription_pool_rate_bp" between 0 and 10000) and ("revenue_policies"."pg_fee_rate_bp" is null or "revenue_policies"."pg_fee_rate_bp" between 0 and 10000));--> statement-breakpoint
-- 확정한 정산은 바뀌지 않는다 (개발계획 M9 "확정 후 불변"). 계산 중(calculated)인 것만 다시 계산 · 지울 수 있다.
-- 정산 월: 확정한 달은 고치거나 지울 수 없다
CREATE FUNCTION aionit_settlement_period_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('aionit.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF OLD.status = 'calculated' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '확정한 정산 월은 바꿀 수 없습니다 (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_periods_lock BEFORE UPDATE OR DELETE ON settlement_periods
  FOR EACH ROW EXECUTE FUNCTION aionit_settlement_period_lock();
--> statement-breakpoint
-- 강사 정산: 확정한 달에 새로 넣을 수 없고, 확정한 정산은 "지급함"(status · paid_at) 말고는 바꿀 수 없다
CREATE FUNCTION aionit_settlement_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  period_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO period_status FROM settlement_periods WHERE id = NEW.period_id;
    IF period_status IS DISTINCT FROM 'calculated' OR NEW.status <> 'calculated' THEN
      RAISE EXCEPTION '확정한 정산 월에는 정산을 넣을 수 없습니다' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'calculated' OR current_setting('aionit.retention_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '확정한 정산은 지울 수 없습니다' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'calculated' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'confirmed' AND NEW.status = 'paid'
     AND (to_jsonb(NEW) - 'status' - 'paid_at') = (to_jsonb(OLD) - 'status' - 'paid_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '확정한 정산은 바꿀 수 없습니다' USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlements_lock BEFORE INSERT OR UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION aionit_settlement_lock();
--> statement-breakpoint
-- 정산 근거 줄: 계산 중인 정산의 줄만 넣고 · 고치고 · 지울 수 있다
CREATE FUNCTION aionit_settlement_line_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  settlement_status text;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('aionit.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.settlement_id <> OLD.settlement_id THEN
    RAISE EXCEPTION '정산 근거 줄을 다른 정산으로 옮길 수 없습니다' USING ERRCODE = 'insufficient_privilege';
  END IF;
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.settlement_id ELSE NEW.settlement_id END;
  SELECT status INTO settlement_status FROM settlements WHERE id = target;
  IF settlement_status IS DISTINCT FROM 'calculated' THEN
    RAISE EXCEPTION '확정한 정산의 근거 줄은 바꿀 수 없습니다 (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_lines_lock BEFORE INSERT OR UPDATE OR DELETE ON settlement_lines
  FOR EACH ROW EXECUTE FUNCTION aionit_settlement_line_lock();
--> statement-breakpoint
-- 이의 신청: 지울 수 없고, 운영자 답변을 한 번 다는 것만 (신청 내용은 그대로)
CREATE FUNCTION aionit_settlement_objection_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('aionit.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.answered_at IS NULL AND NEW.answered_at IS NOT NULL
     AND NEW.settlement_id = OLD.settlement_id AND NEW.author_id = OLD.author_id
     AND NEW.body = OLD.body AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '이의 신청은 답변을 한 번 다는 것 말고 바꿀 수 없습니다 (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_objections_lock BEFORE UPDATE OR DELETE ON settlement_objections
  FOR EACH ROW EXECUTE FUNCTION aionit_settlement_objection_lock();
--> statement-breakpoint
-- 조정 · 지급 기록은 덧붙이기만
CREATE TRIGGER settlement_adjustments_append_only BEFORE UPDATE OR DELETE ON settlement_adjustments
  FOR EACH ROW EXECUTE FUNCTION aionit_append_only();
--> statement-breakpoint
CREATE TRIGGER payouts_append_only BEFORE UPDATE OR DELETE ON payouts
  FOR EACH ROW EXECUTE FUNCTION aionit_append_only();
--> statement-breakpoint
CREATE TRIGGER settlement_periods_no_truncate BEFORE TRUNCATE ON settlement_periods
  FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER settlements_no_truncate BEFORE TRUNCATE ON settlements
  FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER settlement_lines_no_truncate BEFORE TRUNCATE ON settlement_lines
  FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER settlement_objections_no_truncate BEFORE TRUNCATE ON settlement_objections
  FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER settlement_adjustments_no_truncate BEFORE TRUNCATE ON settlement_adjustments
  FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER payouts_no_truncate BEFORE TRUNCATE ON payouts
  FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
