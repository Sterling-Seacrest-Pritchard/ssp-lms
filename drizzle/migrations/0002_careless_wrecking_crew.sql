CREATE TABLE "video_attempt_state" (
	"module_attempt_id" uuid PRIMARY KEY NOT NULL,
	"furthest_watched_seconds" integer DEFAULT 0 NOT NULL,
	"last_position_seconds" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"last_commit_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "video_module_versions" ADD COLUMN "mux_upload_id" text;--> statement-breakpoint
ALTER TABLE "video_module_versions" ADD COLUMN "mux_asset_id" text;--> statement-breakpoint
ALTER TABLE "video_module_versions" ADD COLUMN "mux_playback_id" text;--> statement-breakpoint
ALTER TABLE "video_module_versions" ADD COLUMN "status" text DEFAULT 'waiting' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_module_versions" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "video_attempt_state" ADD CONSTRAINT "video_attempt_state_module_attempt_id_module_attempts_id_fk" FOREIGN KEY ("module_attempt_id") REFERENCES "public"."module_attempts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
UPDATE "video_module_versions" SET "status" = 'errored' WHERE "mux_asset_id" IS NULL;