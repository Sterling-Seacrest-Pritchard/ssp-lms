ALTER TABLE "module_attempts" DROP CONSTRAINT "module_attempts_user_id_new_users_id_fk";
--> statement-breakpoint
ALTER TABLE "module_attempts" DROP COLUMN "user_id";
--> statement-breakpoint
ALTER TABLE "module_attempts" RENAME COLUMN "user_id_new" TO "user_id";
--> statement-breakpoint
ALTER TABLE "module_attempts" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "module_attempts" ADD CONSTRAINT "module_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
