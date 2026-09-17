CREATE TABLE "text_module_versions" (
	"module_version_id" uuid PRIMARY KEY NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "text_module_versions" ADD CONSTRAINT "text_module_versions_module_version_id_module_versions_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "module_versions"("id") ON DELETE no action ON UPDATE no action;
