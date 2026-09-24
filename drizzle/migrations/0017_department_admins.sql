CREATE TABLE "department_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" text,
	CONSTRAINT "department_admins_user_id_department_id_unique" UNIQUE("user_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "department_admins" ADD CONSTRAINT "department_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "department_admins" ADD CONSTRAINT "department_admins_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;
