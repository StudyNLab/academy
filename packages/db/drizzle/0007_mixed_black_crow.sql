CREATE TABLE "subscription_cycles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"cycle_no" integer NOT NULL,
	"billing_date" date NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount" bigint NOT NULL,
	"supply_amount" bigint NOT NULL,
	"vat_amount" bigint NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"order_id" uuid,
	"payment_id" uuid,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_notices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cycle_no" integer NOT NULL,
	"new_amount" bigint,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"agreed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"interval" text NOT NULL,
	"plan_name" text NOT NULL,
	"amount" bigint NOT NULL,
	"anchor_date" date,
	"current_cycle" integer DEFAULT 0 NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"billing_key_sealed" text,
	"customer_key" text NOT NULL,
	"card_label" text,
	"entitlement_id" uuid,
	"auto_renew_agreed_at" timestamp with time zone NOT NULL,
	"terms_agreed_at" timestamp with time zone NOT NULL,
	"agreed_ip" text,
	"refund_policy_document_id" uuid,
	"pending_amount" bigint,
	"pending_from_cycle" integer,
	"pending_needs_consent" boolean,
	"pending_agreed_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancel_reason" text,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "course_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "key_set" text DEFAULT 'widget' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_cycles" ADD CONSTRAINT "subscription_cycles_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_cycles" ADD CONSTRAINT "subscription_cycles_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_cycles" ADD CONSTRAINT "subscription_cycles_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_notices" ADD CONSTRAINT "subscription_notices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_refund_policy_document_id_policy_documents_id_fk" FOREIGN KEY ("refund_policy_document_id") REFERENCES "public"."policy_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_cycles_key" ON "subscription_cycles" USING btree ("subscription_id","cycle_no");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_notices_key" ON "subscription_notices" USING btree ("subscription_id","kind","cycle_no");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_live_key" ON "subscriptions" USING btree ("user_id") WHERE "subscriptions"."status" in ('active', 'past_due', 'cancel_scheduled');--> statement-breakpoint
-- 구독 결제 기록도 지우지 않는다 (0006 과 같은 규칙)
CREATE TRIGGER subscriptions_no_delete BEFORE DELETE ON subscriptions FOR EACH ROW EXECUTE FUNCTION aionit_no_delete();
--> statement-breakpoint
CREATE TRIGGER subscription_cycles_no_delete BEFORE DELETE ON subscription_cycles FOR EACH ROW EXECUTE FUNCTION aionit_no_delete();
--> statement-breakpoint
CREATE TRIGGER subscription_notices_no_delete BEFORE DELETE ON subscription_notices FOR EACH ROW EXECUTE FUNCTION aionit_no_delete();
--> statement-breakpoint
CREATE TRIGGER subscriptions_no_truncate BEFORE TRUNCATE ON subscriptions FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER subscription_cycles_no_truncate BEFORE TRUNCATE ON subscription_cycles FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
-- 환불 정책 초안 2판: 구독 중도 해지 규칙을 더한다 (단건 규칙은 그대로)
INSERT INTO policy_documents (kind, version, title, body_md, required, effective_from) VALUES
('refund', '2026-11-04-draft.2', '환불 정책', $md$
> 초안입니다. 테스트 기간에만 쓰고, 실오픈 전에 법률 검토를 거친 새 버전으로 바꿉니다.

## 강의 (단건 구매)

| 언제 | 환불 금액 |
|---|---|
| 결제일부터 7일 이내 + 이용 전 | 전액 |
| 진도율 · 지난 기간 중 높은 쪽이 1/3 미만 | 결제 금액의 2/3 |
| 진도율 · 지난 기간 중 높은 쪽이 1/2 미만 | 결제 금액의 1/2 |
| 그 이후 | 환불 없음 |

1. "이용"은 수강생 전용 영상을 처음 재생하거나 실습 파일을 처음 받은 것을 말합니다. 교재를 읽기만 한 것은 이용으로 보지 않습니다.
2. 진도율은 학습 화면에 보이는 진도율(완료한 챕터 ÷ 전체 챕터)과 같습니다. 지난 기간은 결제일부터 센 날수 ÷ 수강 기간입니다. 수강 기간이 무제한인 상품은 1년으로 셉니다.
3. 연장권은 늘어난 기간이 시작되기 전이면 전액, 시작된 뒤에는 늘어난 기간 중 지난 비율로 위 표를 적용합니다.
4. 할인을 받아 산 경우 실제로 낸 금액을 기준으로 계산합니다.

## 구독

| 언제 | 환불 금액 |
|---|---|
| 이번 회차 결제일부터 7일 이내 + 이번 회차에 학습하기 전 | 전액 |
| 그 밖에 즉시 해지 | 남은 날 일할 금액 − 위약금(결제 금액의 10%). 0원 아래면 환불 없음 |

1. 해지 예약은 언제든 할 수 있고, 이미 결제한 기간 끝까지 그대로 이용합니다. 그 뒤에는 자동결제가 되지 않습니다.
2. 즉시 해지 · 환불을 요청하면 운영자가 확인한 뒤 원래 결제 수단으로 돌려드리고, 구독 이용은 바로 끝납니다.
3. 가격이 오르면 30일 전에 알리고 동의를 받습니다. 동의하지 않으면 그 회차부터 자동결제가 되지 않고 구독이 끝납니다.

## 공통

환불은 마이페이지 > 결제 내역 · 구독 관리에서 요청합니다. 환불되면 해당 수강권이 끝납니다 (진도 기록은 남습니다).
$md$, false, '2026-11-04T12:00:00+09:00');
