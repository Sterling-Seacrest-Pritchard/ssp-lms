import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  entraGroupId: text("entra_group_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  entraObjectId: text("entra_object_id").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
  thumbnail: text("thumbnail"),
  compliance: boolean("compliance").notNull().default(false),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const modules = pgTable("modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  moduleType: text("module_type").notNull().default("scorm"),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- circular reference to moduleVersions (declared below); TypeScript can't express the forward reference's return type
  currentVersionId: uuid("current_version_id").references((): any => moduleVersions.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const moduleVersions = pgTable("module_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleId: uuid("module_id").notNull().references(() => modules.id),
  versionNumber: integer("version_number").notNull(),
  status: text("status").notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scormModuleVersions = pgTable("scorm_module_versions", {
  moduleVersionId: uuid("module_version_id")
    .primaryKey()
    .references(() => moduleVersions.id),
  gcsPrefix: text("gcs_prefix").notNull(),
  manifestIdentifier: text("manifest_identifier").notNull(),
  scormVersion: text("scorm_version").notNull().default("1.2"),
  launchUrl: text("launch_url").notNull(),
  rawManifestXml: text("raw_manifest_xml").notNull(),
});

export const videoModuleVersions = pgTable("video_module_versions", {
  moduleVersionId: uuid("module_version_id")
    .primaryKey()
    .references(() => moduleVersions.id),
  muxUploadId: text("mux_upload_id"),
  muxAssetId: text("mux_asset_id"),
  muxPlaybackId: text("mux_playback_id"),
  status: text("status").notNull().default("waiting"),
  durationSeconds: integer("duration_seconds"),
});

export const moduleAttempts = pgTable("module_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleVersionId: uuid("module_version_id")
    .notNull()
    .references(() => moduleVersions.id),
  userId: text("user_id").notNull(),
  attemptNumber: integer("attempt_number").notNull().default(1),
  status: text("status").notNull().default("in_progress"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const scormAttemptState = pgTable("scorm_attempt_state", {
  moduleAttemptId: uuid("module_attempt_id")
    .primaryKey()
    .references(() => moduleAttempts.id),
  lessonStatus: text("lesson_status"),
  lessonLocation: text("lesson_location"),
  suspendData: text("suspend_data"),
  rawCmi: jsonb("raw_cmi").notNull().default({}),
  lastCommitAt: timestamp("last_commit_at", { withTimezone: true }),
});

export const videoAttemptState = pgTable("video_attempt_state", {
  moduleAttemptId: uuid("module_attempt_id")
    .primaryKey()
    .references(() => moduleAttempts.id),
  furthestWatchedSeconds: integer("furthest_watched_seconds").notNull().default(0),
  lastPositionSeconds: integer("last_position_seconds").notNull().default(0),
  status: text("status").notNull().default("in_progress"),
  lastCommitAt: timestamp("last_commit_at", { withTimezone: true }),
});
