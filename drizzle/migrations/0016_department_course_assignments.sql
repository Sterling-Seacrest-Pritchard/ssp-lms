CREATE TABLE "department_course_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" text,
	CONSTRAINT "department_course_assignments_department_id_course_id_unique" UNIQUE("department_id","course_id")
);
--> statement-breakpoint
ALTER TABLE "department_course_assignments" ADD CONSTRAINT "department_course_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "department_course_assignments" ADD CONSTRAINT "department_course_assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE no action ON UPDATE no action;
