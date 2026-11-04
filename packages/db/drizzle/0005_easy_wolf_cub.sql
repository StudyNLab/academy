CREATE TABLE "hls_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key_sealed" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"original_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"original_key" text NOT NULL,
	"upload_id" text,
	"original_file_id" uuid,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" text,
	"duration_sec" integer,
	"width" integer,
	"height" integer,
	"renditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hls_prefix" text,
	"key_id" uuid,
	"created_by" uuid,
	"transcode_started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_assets_originalKey_unique" UNIQUE("original_key")
);
--> statement-breakpoint
CREATE TABLE "video_subtitles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"video_asset_id" uuid NOT NULL,
	"lang" text DEFAULT 'ko' NOT NULL,
	"label" text DEFAULT '한국어' NOT NULL,
	"source_file_id" uuid NOT NULL,
	"vtt_path" text NOT NULL,
	"cues" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_original_file_id_files_id_fk" FOREIGN KEY ("original_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_key_id_hls_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."hls_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_subtitles" ADD CONSTRAINT "video_subtitles_video_asset_id_video_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."video_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_subtitles" ADD CONSTRAINT "video_subtitles_source_file_id_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_assets_course_idx" ON "video_assets" USING btree ("course_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "video_subtitles_asset_lang" ON "video_subtitles" USING btree ("video_asset_id","lang");--> statement-breakpoint
ALTER TABLE "video_slots" ADD CONSTRAINT "video_slots_video_asset_id_video_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."video_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_slots" ADD CONSTRAINT "video_slots_hosted_check" CHECK ("video_slots"."source" <> 'hosted' or "video_slots"."video_asset_id" is not null);