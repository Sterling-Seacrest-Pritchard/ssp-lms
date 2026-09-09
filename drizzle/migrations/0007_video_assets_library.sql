-- Reusable Video Library: a video becomes a standalone `video_assets` row
-- instead of living entirely inside `video_module_versions`, so the same
-- Mux asset can be attached to many modules across many courses.

CREATE TABLE "video_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mux_upload_id" text,
	"mux_asset_id" text,
	"mux_playback_id" text,
	"title" text DEFAULT 'Untitled Video' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_assets_mux_asset_id_unique" UNIQUE("mux_asset_id")
);
--> statement-breakpoint
ALTER TABLE "video_module_versions" ADD COLUMN "video_asset_id" uuid;
--> statement-breakpoint
-- Backfill: one video_assets row per existing video_module_versions row,
-- carrying over its Mux identifiers/status, using the parent module's title
-- as a starting display name (renamable afterward in the Library). A
-- PL/pgSQL loop, not a plain INSERT...SELECT, because RETURNING can't hand
-- back an arbitrary source-side correlation key to drive the follow-up
-- UPDATE - and mux_asset_id/mux_upload_id can both be NULL on more than one
-- row (an unfinished "waiting" upload), so matching on either afterward
-- would be wrong.
DO $$
DECLARE
  r RECORD;
  new_asset_id uuid;
BEGIN
  FOR r IN
    SELECT vmv.module_version_id, vmv.mux_upload_id, vmv.mux_asset_id, vmv.mux_playback_id,
           vmv.status, vmv.duration_seconds, COALESCE(m.title, 'Untitled Video') AS title
    FROM "video_module_versions" vmv
    JOIN "module_versions" mv ON mv.id = vmv.module_version_id
    JOIN "modules" m ON m.id = mv.module_id
  LOOP
    INSERT INTO "video_assets" (mux_upload_id, mux_asset_id, mux_playback_id, title, status, duration_seconds)
    VALUES (r.mux_upload_id, r.mux_asset_id, r.mux_playback_id, r.title, r.status, r.duration_seconds)
    RETURNING id INTO new_asset_id;

    UPDATE "video_module_versions" SET video_asset_id = new_asset_id WHERE module_version_id = r.module_version_id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "video_module_versions" DROP COLUMN "mux_upload_id";
--> statement-breakpoint
ALTER TABLE "video_module_versions" DROP COLUMN "mux_asset_id";
--> statement-breakpoint
ALTER TABLE "video_module_versions" DROP COLUMN "mux_playback_id";
--> statement-breakpoint
ALTER TABLE "video_module_versions" DROP COLUMN "status";
--> statement-breakpoint
ALTER TABLE "video_module_versions" DROP COLUMN "duration_seconds";
--> statement-breakpoint
ALTER TABLE "video_module_versions" ADD CONSTRAINT "video_module_versions_video_asset_id_video_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "video_assets"("id") ON DELETE no action ON UPDATE no action;
