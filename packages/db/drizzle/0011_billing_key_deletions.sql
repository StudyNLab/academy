-- 지울 빌링키 (M10): 구독이 끝나거나 카드를 바꾸면 옮겨 두고, worker 가 토스 빌링키 삭제 API 를 부른 뒤 비운다
CREATE TABLE "billing_key_deletions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"key_sealed" text,
	"reason" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_key_deletions" ADD CONSTRAINT "billing_key_deletions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_key_deletions_pending_idx" ON "billing_key_deletions" USING btree ("deleted_at");