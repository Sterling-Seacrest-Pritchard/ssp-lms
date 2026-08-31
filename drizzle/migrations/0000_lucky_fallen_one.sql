CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "module_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_version_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "module_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"module_type" text DEFAULT 'scorm' NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorm_attempt_state" (
	"module_attempt_id" uuid PRIMARY KEY NOT NULL,
	"lesson_status" text,
	"lesson_location" text,
	"suspend_data" text,
	"raw_cmi" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_commit_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scorm_module_versions" (
	"module_version_id" uuid PRIMARY KEY NOT NULL,
	"gcs_prefix" text NOT NULL,
	"manifest_identifier" text NOT NULL,
	"scorm_version" text DEFAULT '1.2' NOT NULL,
	"launch_url" text NOT NULL,
	"raw_manifest_xml" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "module_attempts" ADD CONSTRAINT "module_attempts_module_version_id_module_versions_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "public"."module_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_versions" ADD CONSTRAINT "module_versions_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_current_version_id_module_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."module_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_attempt_state" ADD CONSTRAINT "scorm_attempt_state_module_attempt_id_module_attempts_id_fk" FOREIGN KEY ("module_attempt_id") REFERENCES "public"."module_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_module_versions" ADD CONSTRAINT "scorm_module_versions_module_version_id_module_versions_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "public"."module_versions"("id") ON DELETE no action ON UPDATE no action;