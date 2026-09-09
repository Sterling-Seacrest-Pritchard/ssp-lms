CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"entra_group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entra_object_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"department_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_entra_object_id_unique" UNIQUE("entra_object_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "departments" ("name")
SELECT DISTINCT btrim("department") FROM "courses"
WHERE "department" IS NOT NULL AND btrim("department") <> ''
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
INSERT INTO "departments" ("name") VALUES
	('Compliance'),
	('HR'),
	('Underwriting'),
	('Claims'),
	('IT'),
	('Engineering')
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
UPDATE "courses" SET "department_id" = "departments"."id"
FROM "departments"
WHERE lower(btrim("courses"."department")) = lower(btrim("departments"."name"))
	AND "courses"."department_id" IS NULL;