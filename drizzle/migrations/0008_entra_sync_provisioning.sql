-- User pre-provisioning via Entra sync: a user can now exist in `users`
-- before their first real sign-in (synced in from the Entra Enterprise
-- App's assignment list), so entra_object_id can no longer be NOT NULL -
-- it's only confirmed once that person's real sign-in claims the row.

ALTER TABLE "users" ALTER COLUMN "entra_object_id" DROP NOT NULL;
--> statement-breakpoint
CREATE TABLE "course_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" text,
	CONSTRAINT "course_assignments_course_id_user_id_unique" UNIQUE("course_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
