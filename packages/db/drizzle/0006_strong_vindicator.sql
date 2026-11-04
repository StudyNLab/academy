CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_type" text NOT NULL,
	"course_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"list_price" bigint NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"discount_reason" text,
	"paid_amount" bigint NOT NULL,
	"supply_amount" bigint NOT NULL,
	"vat_amount" bigint NOT NULL,
	"access_days" integer,
	"price_id" uuid,
	"refund_policy_document_id" uuid,
	"entitlement_id" uuid,
	"extension" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_amount_check" CHECK ("order_items"."paid_amount" = "order_items"."list_price" - "order_items"."discount_amount" and "order_items"."supply_amount" + "order_items"."vat_amount" = "order_items"."paid_amount")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_amount" bigint NOT NULL,
	"order_name" text NOT NULL,
	"agreed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"fail_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text DEFAULT 'toss' NOT NULL,
	"event_type" text NOT NULL,
	"payment_key" text,
	"result" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text DEFAULT 'toss' NOT NULL,
	"provider_payment_key" text NOT NULL,
	"method" text,
	"amount" bigint NOT NULL,
	"canceled_amount" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"fee_amount" bigint,
	"receipt_url" text,
	"fail_code" text,
	"fail_message" text,
	"raw" jsonb,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_providerPaymentKey_unique" UNIQUE("provider_payment_key")
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prices_amount_check" CHECK ("prices"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"list_price_weight" bigint
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'on_sale' NOT NULL,
	"access_days" integer,
	"billing_interval" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"calculation" jsonb NOT NULL,
	"decision_calculation" jsonb,
	"requested_amount" bigint NOT NULL,
	"approved_amount" bigint,
	"reason" text NOT NULL,
	"reason_detail" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"provider_cancel_key" text,
	"fail_message" text,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriber_discount_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rate_percent" integer NOT NULL,
	"applies_to" text DEFAULT 'premium' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriber_discount_rate_check" CHECK ("subscriber_discount_policies"."rate_percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_id_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_refund_policy_document_id_policy_documents_id_fk" FOREIGN KEY ("refund_policy_document_id") REFERENCES "public"."policy_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_items" ADD CONSTRAINT "product_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_items" ADD CONSTRAINT "product_items_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_discount_policies" ADD CONSTRAINT "subscriber_discount_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_webhooks_key_idx" ON "payment_webhooks" USING btree ("payment_key");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_done_key" ON "payments" USING btree ("order_id") WHERE "payments"."status" in ('done', 'canceled', 'partially_canceled');--> statement-breakpoint
CREATE INDEX "prices_product_idx" ON "prices" USING btree ("product_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "product_items_key" ON "product_items" USING btree ("product_id","course_id");--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_item_open_key" ON "refunds" USING btree ("order_item_id") WHERE "refunds"."status" in ('requested', 'approved', 'done');--> statement-breakpoint
-- 결제 기록은 지우지 않는다 (전자상거래법 5년 보관, docs/데이터모델.md 4장). 상태는 바뀌므로 UPDATE 는 둔다.
-- DELETE · TRUNCATE 는 보관 기간 정리 작업(set local aionit.retention_purge = 'on')만.
CREATE FUNCTION aionit_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('aionit.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% 는 지울 수 없습니다 (결제 기록 보관)', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders FOR EACH ROW EXECUTE FUNCTION aionit_no_delete();
--> statement-breakpoint
CREATE TRIGGER order_items_no_delete BEFORE DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION aionit_no_delete();
--> statement-breakpoint
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION aionit_no_delete();
--> statement-breakpoint
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION aionit_no_delete();
--> statement-breakpoint
CREATE TRIGGER prices_no_change BEFORE UPDATE OR DELETE ON prices FOR EACH ROW EXECUTE FUNCTION aionit_append_only();
--> statement-breakpoint
CREATE TRIGGER subscriber_discount_policies_no_change BEFORE UPDATE OR DELETE ON subscriber_discount_policies
  FOR EACH ROW EXECUTE FUNCTION aionit_append_only();
--> statement-breakpoint
CREATE TRIGGER orders_no_truncate BEFORE TRUNCATE ON orders FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER order_items_no_truncate BEFORE TRUNCATE ON order_items FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON payments FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER refunds_no_truncate BEFORE TRUNCATE ON refunds FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
CREATE TRIGGER prices_no_truncate BEFORE TRUNCATE ON prices FOR EACH STATEMENT EXECUTE FUNCTION aionit_no_truncate();
--> statement-breakpoint
-- 환불 규정 초안 (주문서 C-01 에서 동의받는 문서, 실오픈 전 법률 검토 후 새 버전, 개발계획 M10)
INSERT INTO policy_documents (kind, version, title, body_md, required, effective_from) VALUES
('refund', '2026-11-04-draft', '환불 정책', $md$
> 초안입니다. 테스트 기간에만 쓰고, 실오픈 전에 법률 검토를 거친 새 버전으로 바꿉니다.

| 언제 | 환불 금액 |
|---|---|
| 결제일부터 7일 이내 + 이용 전 | 전액 |
| 진도율 · 지난 기간 중 높은 쪽이 1/3 미만 | 결제 금액의 2/3 |
| 진도율 · 지난 기간 중 높은 쪽이 1/2 미만 | 결제 금액의 1/2 |
| 그 이후 | 환불 없음 |

1. "이용"은 수강생 전용 영상을 처음 재생하거나 실습 파일을 처음 받은 것을 말합니다. 교재를 읽기만 한 것은 이용으로 보지 않습니다.
2. 진도율은 학습 화면에 보이는 진도율(완료한 챕터 ÷ 전체 챕터)과 같습니다. 지난 기간은 결제일부터 센 날수 ÷ 수강 기간입니다. 수강 기간이 무제한인 상품은 1년으로 셉니다.
3. 연장권은 늘어난 기간이 시작되기 전이면 전액, 시작된 뒤에는 늘어난 기간 중 지난 비율로 위 표를 적용합니다.
4. 환불은 마이페이지 > 결제 내역에서 요청하고, 운영자가 확인한 뒤 원래 결제 수단으로 돌려드립니다. 환불되면 그 강의의 수강권이 끝납니다 (진도 기록은 남습니다).
5. 할인을 받아 산 경우 실제로 낸 금액을 기준으로 계산합니다.
$md$, false, '2026-11-04T00:00:00+09:00');
