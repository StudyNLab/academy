CREATE TABLE "attachment_downloads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_progress" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"chapter_key" text NOT NULL,
	"last_section_id" text,
	"read_ratio" real DEFAULT 0 NOT NULL,
	"text_seconds" integer DEFAULT 0 NOT NULL,
	"reached_end_at" timestamp with time zone,
	"text_done_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"course_id" uuid,
	"source_type" text NOT NULL,
	"source_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"first_used_at" timestamp with time zone,
	"reminded_d_30_at" timestamp with time zone,
	"reminded_d_7_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"granted_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_scope_check" CHECK ("entitlements"."scope" <> 'course' or "entitlements"."course_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "learning_heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"chapter_key" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_time_daily" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"course_id" uuid NOT NULL,
	"date" date NOT NULL,
	"video_sec" integer NOT NULL,
	"text_sec" integer NOT NULL,
	"effective_sec" integer NOT NULL,
	"rule_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "self_checks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"chapter_key" text NOT NULL,
	"section_id" text NOT NULL,
	"item_id" text NOT NULL,
	"checked_at" timestamp with time zone,
	"unchecked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_watch" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"video_key" text NOT NULL,
	"watched_ranges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_position_sec" integer DEFAULT 0 NOT NULL,
	"duration_sec" integer,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment_downloads" ADD CONSTRAINT "attachment_downloads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_downloads" ADD CONSTRAINT "attachment_downloads_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_progress" ADD CONSTRAINT "chapter_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_progress" ADD CONSTRAINT "chapter_progress_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_heartbeats" ADD CONSTRAINT "learning_heartbeats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_heartbeats" ADD CONSTRAINT "learning_heartbeats_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_time_daily" ADD CONSTRAINT "learning_time_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_time_daily" ADD CONSTRAINT "learning_time_daily_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_checks" ADD CONSTRAINT "self_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_checks" ADD CONSTRAINT "self_checks_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_watch" ADD CONSTRAINT "video_watch_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_watch" ADD CONSTRAINT "video_watch_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_downloads_user_idx" ON "attachment_downloads" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_progress_key" ON "chapter_progress" USING btree ("user_id","course_id","chapter_key");--> statement-breakpoint
CREATE INDEX "entitlements_user_idx" ON "entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "learning_heartbeats_at_idx" ON "learning_heartbeats" USING btree ("at");--> statement-breakpoint
CREATE INDEX "learning_heartbeats_user_idx" ON "learning_heartbeats" USING btree ("user_id","course_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_time_daily_key" ON "learning_time_daily" USING btree ("user_id","course_id","date");--> statement-breakpoint
CREATE INDEX "learning_time_daily_date_idx" ON "learning_time_daily" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "self_checks_key" ON "self_checks" USING btree ("user_id","course_id","chapter_key","section_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_watch_key" ON "video_watch" USING btree ("user_id","course_id","video_key");