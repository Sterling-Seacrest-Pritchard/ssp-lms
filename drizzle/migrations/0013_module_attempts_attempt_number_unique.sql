ALTER TABLE "module_attempts" ADD CONSTRAINT "module_attempts_module_version_id_user_id_attempt_number_unique" UNIQUE("module_version_id","user_id","attempt_number");
