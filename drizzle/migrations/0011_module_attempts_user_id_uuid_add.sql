ALTER TABLE "module_attempts" ADD COLUMN "user_id_new" uuid;
--> statement-breakpoint
ALTER TABLE "module_attempts" ADD CONSTRAINT "module_attempts_user_id_new_users_id_fk" FOREIGN KEY ("user_id_new") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
UPDATE "module_attempts" ma
SET "user_id_new" = u.id
FROM "users" u
WHERE u.email = ma.user_id
  AND ma.user_id_new IS NULL;
