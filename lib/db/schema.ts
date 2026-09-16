import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  entraGroupId: text("entra_group_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable: a user synced in from Entra (see lib/entra/graph-client.ts)
  // before ever signing in has no Entra Object ID confirmed by a real OIDC
  // token yet - Graph's appRoleAssignedTo gives one, but the row still gets
  // "claimed" (this column set for real) on that person's actual first
  // sign-in, matched by email. See lib/db/users.ts upsertUser.
  entraObjectId: text("entra_object_id").unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  // The Entra app role (e.g. "Org Admin", "Learner") last seen for this
  // person on the Enterprise App, captured by lib/entra/graph-client.ts
  // during a sync - not the LMS's own admin/learner distinction.
  entraRole: text("entra_role"),
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const courseAssignments = pgTable(
  "course_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id").notNull().references(() => courses.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    // The assigning admin's email, or 'entra-sync' if this is ever
    // auto-assigned by a future department/role rule - always a plain string,
    // never a users.id FK, so an assignment record outlives the assigner's
    // own user row being renamed/removed.
    assignedBy: text("assigned_by"),
  },
  (table) => [unique().on(table.courseId, table.userId)]
);

export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    courseId: uuid("course_id").notNull().references(() => courses.id),
    // Plain text, app-validated - not not_started/in_progress/completed/failed/expired
    // and self/assigned/auto enforced by the DB. See Global Constraints.
    status: text("status").notNull().default("not_started"),
    source: text("source").notNull().default("assigned"),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    // Copied from courses.dueDate at enrollment time, not a live reference -
    // a later change to the course's due date shouldn't retroactively move
    // an already-enrolled learner's deadline.
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Reserved for v2 auto-reenroll; unused this pass (see spec Decisions).
    cycleMonths: integer("cycle_months"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
  },
  (table) => [unique().on(table.userId, table.courseId)]
);

export const moduleProgress = pgTable(
  "module_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enrollmentId: uuid("enrollment_id").notNull().references(() => enrollments.id),
    moduleId: uuid("module_id").notNull().references(() => modules.id),
    // not_attempted/incomplete/completed/passed/failed - see Global Constraints.
    status: text("status").notNull().default("not_attempted"),
    bestScore: integer("best_score"),
    latestAttemptId: uuid("latest_attempt_id").references(() => moduleAttempts.id),
  },
  (table) => [unique().on(table.enrollmentId, table.moduleId)]
);

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

// A video is a standalone, reusable Mux asset - many `video_module_versions`
// rows (across different modules, even different courses) can point at the
// same `video_assets` row. Deleting a module never deletes the underlying
// asset here, only its own link row; the asset only goes away via an
// explicit Video Library delete (and only once nothing references it).
export const videoAssets = pgTable("video_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  muxUploadId: text("mux_upload_id"),
  muxAssetId: text("mux_asset_id").unique(),
  muxPlaybackId: text("mux_playback_id"),
  title: text("title").notNull().default("Untitled Video"),
  status: text("status").notNull().default("waiting"),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videoModuleVersions = pgTable("video_module_versions", {
  moduleVersionId: uuid("module_version_id")
    .primaryKey()
    .references(() => moduleVersions.id),
  videoAssetId: uuid("video_asset_id").references(() => videoAssets.id),
});

export const moduleAttempts = pgTable("module_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleVersionId: uuid("module_version_id")
    .notNull()
    .references(() => moduleVersions.id),
  userId: text("user_id").notNull(),
  // Backfilled from users.email in migration 0011; becomes the real user_id
  // (renamed, NOT NULL, FK-constrained) in migration 0012 once verified.
  userIdNew: uuid("user_id_new").references(() => users.id),
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
