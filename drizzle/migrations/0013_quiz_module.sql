CREATE TABLE "quiz_module_versions" (
	"module_version_id" uuid PRIMARY KEY NOT NULL,
	"passing_score_pct" integer NOT NULL,
	"time_limit_seconds" integer,
	"max_attempts" integer,
	"shuffle_questions" boolean DEFAULT false NOT NULL,
	"instructions" text
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz_module_version_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"question_type" text NOT NULL,
	"prompt" text NOT NULL,
	"points" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"choice_text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_attempt_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_choice_ids" uuid[] DEFAULT '{}' NOT NULL,
	"is_correct" boolean NOT NULL,
	CONSTRAINT "quiz_attempt_answers_module_attempt_id_question_id_unique" UNIQUE("module_attempt_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "quiz_module_versions" ADD CONSTRAINT "quiz_module_versions_module_version_id_module_versions_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "module_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_module_version_id_quiz_module_versions_module_version_id_fk" FOREIGN KEY ("quiz_module_version_id") REFERENCES "quiz_module_versions"("module_version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_choices" ADD CONSTRAINT "quiz_choices_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_module_attempt_id_module_attempts_id_fk" FOREIGN KEY ("module_attempt_id") REFERENCES "module_attempts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE no action ON UPDATE no action;
