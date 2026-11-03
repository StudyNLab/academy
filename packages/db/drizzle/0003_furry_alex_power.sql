CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"course_id" uuid NOT NULL,
	"chapter_key" text,
	"title" text NOT NULL,
	"file_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"course_version_id" uuid NOT NULL,
	"path" text NOT NULL,
	"file_id" uuid NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"alt" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"course_version_id" uuid NOT NULL,
	"chapter_key" text NOT NULL,
	"sort_order" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"content_html" text NOT NULL,
	"toc" jsonb NOT NULL,
	"labs" jsonb NOT NULL,
	"source_sha256" text NOT NULL,
	"content_sha256" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"course_id" uuid NOT NULL,
	"version" text NOT NULL,
	"package_file_id" uuid NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"validation_report" jsonb,
	"review_note" text,
	"uploaded_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"owner_instructor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"field" text NOT NULL,
	"level" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description_md" text DEFAULT '' NOT NULL,
	"audience_md" text DEFAULT '' NOT NULL,
	"requirements_md" text DEFAULT '' NOT NULL,
	"thumbnail_file_id" uuid,
	"in_subscription" boolean DEFAULT true NOT NULL,
	"published_version_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_slug_unique" UNIQUE("slug"),
	CONSTRAINT "courses_slug_check" CHECK ("courses"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"original_name" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_objectKey_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "instructors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"bio_md" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instructors_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "preview_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"course_id" uuid NOT NULL,
	"chapter_key" text NOT NULL,
	"scope" text NOT NULL,
	"section_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_slots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"course_id" uuid NOT NULL,
	"key" text NOT NULL,
	"chapter_key" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"section_id" text,
	"source" text DEFAULT 'none' NOT NULL,
	"youtube_video_id" text,
	"video_asset_id" uuid,
	"duration_sec" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_slots_youtube_check" CHECK ("video_slots"."source" <> 'youtube' or "video_slots"."youtube_video_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_assets" ADD CONSTRAINT "chapter_assets_course_version_id_course_versions_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_assets" ADD CONSTRAINT "chapter_assets_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_course_version_id_course_versions_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_package_file_id_files_id_fk" FOREIGN KEY ("package_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_owner_instructor_id_instructors_id_fk" FOREIGN KEY ("owner_instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_thumbnail_file_id_files_id_fk" FOREIGN KEY ("thumbnail_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_rules" ADD CONSTRAINT "preview_rules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_slots" ADD CONSTRAINT "video_slots_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_course_idx" ON "attachments" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_assets_version_path" ON "chapter_assets" USING btree ("course_version_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_version_key" ON "chapters" USING btree ("course_version_id","chapter_key");--> statement-breakpoint
CREATE INDEX "course_versions_course_idx" ON "course_versions" USING btree ("course_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_rules_course_chapter" ON "preview_rules" USING btree ("course_id","chapter_key");--> statement-breakpoint
CREATE UNIQUE INDEX "video_slots_course_key" ON "video_slots" USING btree ("course_id","key");