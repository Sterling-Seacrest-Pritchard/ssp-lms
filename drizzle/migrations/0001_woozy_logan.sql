CREATE TABLE "video_module_versions" (
	"module_version_id" uuid PRIMARY KEY NOT NULL,
	"duration_minutes" integer
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "thumbnail" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "compliance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "due_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_module_versions" ADD CONSTRAINT "video_module_versions_module_version_id_module_versions_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "public"."module_versions"("id") ON DELETE no action ON UPDATE no action;