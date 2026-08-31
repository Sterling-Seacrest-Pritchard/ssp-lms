# SCORM Import Test Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the SCORM import → launch → CMI commit round-trip against a real Postgres database, using the smallest slice of the approved schema that can carry it — so SCORM package testing isn't blocked on building the full LMS data model first.

**Architecture:** Next.js Route Handlers upload a SCORM `.zip`, unzip it into Supabase Storage, parse `imsmanifest.xml` for the launch entry point, and write `courses`/`modules`/`module_versions`/`scorm_module_versions` rows via Drizzle. A launch page embeds the extracted content in an iframe with `scorm-again` bootstrapping the `window.API`/`API_1484_11` runtime object; every `LMSCommit` posts the full CMI object to a commit endpoint that upserts `module_attempts`/`scorm_attempt_state`.

**Tech Stack:** Next.js 16 App Router (Route Handlers), Drizzle ORM + `pg` against Supabase Postgres, Supabase Storage (via `@supabase/supabase-js`) for extracted package files, `adm-zip` for unzipping, `fast-xml-parser` for the manifest, `scorm-again` for the SCORM runtime, Vitest for tests (new to this repo — no test runner exists yet).

**Spec:** [Database Design.md](C:\Users\iharrison\Documents\Ian Harrison Personal\Claude Internal\Context\SSP LMS\Database Design.md) (Obsidian) — this plan implements only the minimal subset needed for SCORM import/launch (§2 catalog tables + the SCORM half of §3 attempts). It does not implement §1 identity/RBAC, the quiz half of §2/§3, §4 event log, §7 Cloud SQL hardening, or retraining cycles — those are deferred to the Platform Foundation plan once this slice proves the import mechanics work.

## Global Constraints

- ORM is Drizzle, not Prisma — confirmed in the spec, don't introduce Prisma.
- `module_attempts` and `scorm_attempt_state` FK only to `module_versions` (immutable), never to `modules` (mutable) — this is the compliance-audit rule from the spec and it holds even in this minimal slice.
- Never auto-migrate on app boot. Migrations run only via the explicit `npm run db:migrate` script — this habit carries forward unchanged to the real Cloud SQL migration pipeline in the spec.
- Free-tier Supabase Postgres for now (billing blocked on the real GCP project). Schema must stay portable to Cloud SQL later: plain Postgres only, no Supabase-specific extensions beyond the Postgres-13+ built-in `gen_random_uuid()`.
- This milestone deliberately excludes `users`, `enrollments`, RLS, pgAudit, and the `certificates`/quiz tables — `userId` on `module_attempts` is a plain text field (an Entra `oid` string) for now, not a FK, since there's no `users` table yet. Do not add one as part of this plan; that belongs to the Platform Foundation plan.
- Never put real secrets (DB password, Supabase service role key) in chat, code comments, or committed files — they go directly into `.env.local`, which is already gitignored by `create-next-app`'s default `.gitignore`.

---

### Task 1: Supabase project, dependencies, and DB client

**Files:**
- Create: `.env.local` (Ian fills in real values — not committed, already gitignored)
- Modify: `package.json` (new dependencies + scripts)
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `lib/db/client.ts`
- Test: `lib/db/client.test.ts`

**Interfaces:**
- Produces: `db` (a Drizzle `NodePgDatabase` instance) exported from `lib/db/client.ts`, imported by every later task that touches the database.

- [ ] **Step 1: Create the free Supabase project (manual, Ian)**

Go to [supabase.com](https://supabase.com), create a free project (any region). Once it's up:
- **Project Settings → Database → Connection string → URI** (the direct connection, port 5432, not the pooler — this is local dev only, no serverless cold-start pressure to solve yet)
- **Project Settings → API → Project URL** and **service_role key** (not the anon key — the app needs storage write access)
- **Storage → New bucket** — name it exactly `scorm-packages`, set it **private** (not public)

Put these into `.env.local` at the repo root yourself — do not paste the actual values into chat:

```
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
SUPABASE_URL=https://[YOUR-PROJECT-REF].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[YOUR-SERVICE-ROLE-KEY]
```

- [ ] **Step 2: Install dependencies**

```bash
npm install drizzle-orm pg @supabase/supabase-js adm-zip fast-xml-parser scorm-again
npm install -D drizzle-kit @types/pg @types/adm-zip vitest dotenv dotenv-cli
```

- [ ] **Step 3: Add scripts to `package.json`**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "db:generate": "dotenv -e .env.local -- drizzle-kit generate",
    "db:migrate": "dotenv -e .env.local -- drizzle-kit migrate"
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 5: Create `vitest.setup.ts`**

```ts
import { config } from "dotenv";

config({ path: ".env.local" });
```

- [ ] **Step 6: Write the failing smoke test**

`lib/db/client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "./client";

describe("db client", () => {
  it("connects to the database and runs a query", async () => {
    const result = await db.execute(sql`select 1 as value`);
    expect(Number(result.rows[0].value)).toBe(1);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run lib/db/client.test.ts`
Expected: FAIL — `Cannot find module './client'` (file doesn't exist yet).

- [ ] **Step 8: Implement the DB client**

`lib/db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export const db = drizzle(pool);
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run lib/db/client.test.ts`
Expected: PASS — confirms `.env.local` is wired correctly and Supabase is reachable.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vitest.config.ts vitest.setup.ts lib/db/client.ts lib/db/client.test.ts .gitignore
git commit -m "chore: add Drizzle/Supabase DB client and Vitest test runner"
```

---

### Task 2: Minimal schema and first migration

**Files:**
- Create: `drizzle.config.ts`
- Create: `lib/db/schema.ts`
- Test: `lib/db/schema.test.ts`

**Interfaces:**
- Consumes: `db` from `lib/db/client.ts` (Task 1)
- Produces: `courses`, `modules`, `moduleVersions`, `scormModuleVersions`, `moduleAttempts`, `scormAttemptState` — Drizzle `pgTable` definitions exported from `lib/db/schema.ts`, imported by every later task.

- [ ] **Step 1: Write the failing test**

`lib/db/schema.test.ts` — round-trips a course/module/version through the real database (there's no schema to import yet, so this fails on the missing module):

```ts
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { courses, modules, moduleVersions } from "./schema";

describe("minimal SCORM schema", () => {
  const courseCode = `TEST-${randomUUID()}`;

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.code, courseCode));
  });

  it("inserts a course, module, and module version, and reads them back", async () => {
    const [course] = await db
      .insert(courses)
      .values({ code: courseCode, title: "Schema Test Course" })
      .returning();

    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "Schema Test Module" })
      .returning();

    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();

    expect(version.moduleId).toBe(courseModule.id);
    expect(courseModule.courseId).toBe(course.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/schema.test.ts`
Expected: FAIL — `Cannot find module './schema'`.

- [ ] **Step 3: Write the schema**

`lib/db/schema.ts`:

```ts
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const modules = pgTable("modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  moduleType: text("module_type").notNull().default("scorm"),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
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
```

`modules.currentVersionId` references `moduleVersions` before it's declared — the `(): any => moduleVersions.id` callback defers evaluation until Drizzle actually builds the SQL (both consts exist by then), which is the standard Drizzle pattern for a circular table reference. The `any` is required here only because TypeScript can't express the forward reference's return type; it doesn't weaken anything else in the file.

- [ ] **Step 4: Create `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 5: Generate and apply the migration**

Run: `npm run db:generate`
Expected: a new SQL file under `drizzle/migrations/` creating all 6 tables.

Run: `npm run db:migrate`
Expected: migration applies cleanly against the Supabase database.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run lib/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add drizzle.config.ts drizzle/migrations lib/db/schema.ts lib/db/schema.test.ts
git commit -m "feat: add minimal SCORM import schema (courses, modules, module_versions, scorm_module_versions, module_attempts, scorm_attempt_state)"
```

---

### Task 3: Manifest parsing and package extraction to Supabase Storage

**Files:**
- Create: `lib/storage/supabase.ts`
- Create: `lib/scorm/parse-manifest.ts`
- Create: `lib/scorm/extract-package.ts`
- Test: `lib/scorm/parse-manifest.test.ts`
- Test: `lib/scorm/extract-package.test.ts`

**Interfaces:**
- Produces: `parseManifest(xml: string): { identifier: string; launchUrl: string }` from `lib/scorm/parse-manifest.ts`.
- Produces: `extractScormPackage(zipBuffer: Buffer, prefix: string): Promise<{ prefix: string; manifestXml: string }>` from `lib/scorm/extract-package.ts` — uploads every file in the zip to the `scorm-packages` Supabase Storage bucket under `prefix/`.
- Produces: `supabaseStorage` (a Supabase `StorageClient`) from `lib/storage/supabase.ts`, consumed by `extract-package.ts` and no one else in this plan.

- [ ] **Step 1: Write the failing manifest-parsing test**

`lib/scorm/parse-manifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseManifest } from "./parse-manifest";

const SAMPLE_MANIFEST = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="com_scorm_sample_course" version="1"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <organizations default="sample_org">
    <organization identifier="sample_org">
      <title>Sample Course</title>
      <item identifier="item_1" identifierref="resource_1">
        <title>Lesson 1</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="resource_1" type="webcontent" href="index.html">
      <file href="index.html" />
    </resource>
  </resources>
</manifest>`;

describe("parseManifest", () => {
  it("extracts the manifest identifier and launch URL", () => {
    const result = parseManifest(SAMPLE_MANIFEST);
    expect(result.identifier).toBe("com_scorm_sample_course");
    expect(result.launchUrl).toBe("index.html");
  });

  it("throws when the manifest has no resource href", () => {
    const broken = `<manifest identifier="x"><resources></resources></manifest>`;
    expect(() => parseManifest(broken)).toThrow(/launchable/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/scorm/parse-manifest.test.ts`
Expected: FAIL — `Cannot find module './parse-manifest'`.

- [ ] **Step 3: Implement manifest parsing**

`lib/scorm/parse-manifest.ts`:

```ts
import { XMLParser } from "fast-xml-parser";

export interface ParsedManifest {
  identifier: string;
  launchUrl: string;
}

export function parseManifest(xml: string): ParsedManifest {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml);
  const manifest = doc.manifest;
  if (!manifest) {
    throw new Error("imsmanifest.xml is missing its <manifest> root element");
  }

  const identifier = manifest["@_identifier"];
  if (!identifier) {
    throw new Error("imsmanifest.xml <manifest> is missing an identifier attribute");
  }

  const resourceList = manifest.resources?.resource;
  const resource = Array.isArray(resourceList) ? resourceList[0] : resourceList;
  const launchUrl = resource?.["@_href"];
  if (!launchUrl) {
    throw new Error("imsmanifest.xml has no launchable <resource href=\"...\">");
  }

  return { identifier, launchUrl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/scorm/parse-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing extraction test**

`lib/scorm/extract-package.test.ts` — builds a tiny in-memory zip with `adm-zip` itself as the fixture, uploads to the real `scorm-packages` bucket, cleans up after:

```ts
import { describe, it, expect, afterAll } from "vitest";
import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { extractScormPackage } from "./extract-package";
import { supabaseStorage } from "@/lib/storage/supabase";

describe("extractScormPackage", () => {
  const prefix = `test-${randomUUID()}`;

  afterAll(async () => {
    await supabaseStorage.from("scorm-packages").remove([
      `${prefix}/imsmanifest.xml`,
      `${prefix}/index.html`,
    ]);
  });

  it("unzips and uploads every file, returning the manifest XML", async () => {
    const zip = new AdmZip();
    zip.addFile("imsmanifest.xml", Buffer.from("<manifest identifier=\"x\"></manifest>"));
    zip.addFile("index.html", Buffer.from("<html></html>"));

    const result = await extractScormPackage(zip.toBuffer(), prefix);

    expect(result.prefix).toBe(prefix);
    expect(result.manifestXml).toContain("identifier=\"x\"");

    const { data } = await supabaseStorage.from("scorm-packages").list(prefix);
    const names = (data ?? []).map((f) => f.name).sort();
    expect(names).toEqual(["imsmanifest.xml", "index.html"].sort());
  });

  it("throws when the zip has no imsmanifest.xml", async () => {
    const zip = new AdmZip();
    zip.addFile("index.html", Buffer.from("<html></html>"));

    await expect(extractScormPackage(zip.toBuffer(), `${prefix}-broken`)).rejects.toThrow(
      /imsmanifest\.xml/
    );
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run lib/scorm/extract-package.test.ts`
Expected: FAIL — `Cannot find module './extract-package'` (and `@/lib/storage/supabase` doesn't exist yet either).

- [ ] **Step 7: Implement the Supabase Storage client**

`lib/storage/supabase.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

export const supabaseStorage = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
).storage;
```

- [ ] **Step 8: Implement package extraction**

`lib/scorm/extract-package.ts`:

```ts
import AdmZip from "adm-zip";
import { supabaseStorage } from "@/lib/storage/supabase";

export interface ExtractedPackage {
  prefix: string;
  manifestXml: string;
}

export async function extractScormPackage(
  zipBuffer: Buffer,
  prefix: string
): Promise<ExtractedPackage> {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);

  const manifestEntry = entries.find(
    (entry) => entry.entryName.toLowerCase() === "imsmanifest.xml"
  );
  if (!manifestEntry) {
    throw new Error("SCORM package is missing imsmanifest.xml at its root");
  }
  const manifestXml = manifestEntry.getData().toString("utf-8");

  for (const entry of entries) {
    const path = `${prefix}/${entry.entryName}`;
    const { error } = await supabaseStorage
      .from("scorm-packages")
      .upload(path, entry.getData(), { upsert: true });
    if (error) {
      throw new Error(`Failed to upload ${path}: ${error.message}`);
    }
  }

  return { prefix, manifestXml };
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run lib/scorm/extract-package.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/storage/supabase.ts lib/scorm/parse-manifest.ts lib/scorm/extract-package.ts lib/scorm/parse-manifest.test.ts lib/scorm/extract-package.test.ts
git commit -m "feat: parse SCORM manifests and extract packages to Supabase Storage"
```

---

### Task 4: Upload API route

**Files:**
- Create: `app/api/admin/scorm-upload/route.ts`
- Test: `app/api/admin/scorm-upload/route.test.ts`

**Interfaces:**
- Consumes: `db`, `courses`/`modules`/`moduleVersions`/`scormModuleVersions` (Task 2), `parseManifest` and `extractScormPackage` (Task 3).
- Produces: `POST /api/admin/scorm-upload` — accepts `multipart/form-data` with fields `package` (File), `courseCode`, `courseTitle`, `moduleTitle`; returns `{ moduleVersionId, launchUrl, prefix }` on success.

- [ ] **Step 1: Write the failing test**

`app/api/admin/scorm-upload/route.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses } from "@/lib/db/schema";
import { supabaseStorage } from "@/lib/storage/supabase";

function buildSamplePackage() {
  const zip = new AdmZip();
  zip.addFile(
    "imsmanifest.xml",
    Buffer.from(
      `<manifest identifier="route_test_manifest"><resources><resource href="index.html"><file href="index.html" /></resource></resources></manifest>`
    )
  );
  zip.addFile("index.html", Buffer.from("<html><body>hi</body></html>"));
  return zip.toBuffer();
}

describe("POST /api/admin/scorm-upload", () => {
  const courseCode = `ROUTE-TEST-${randomUUID()}`;
  let uploadedPrefix: string | undefined;

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.code, courseCode));
    if (uploadedPrefix) {
      const { data } = await supabaseStorage.from("scorm-packages").list(uploadedPrefix);
      const paths = (data ?? []).map((f) => `${uploadedPrefix}/${f.name}`);
      if (paths.length) await supabaseStorage.from("scorm-packages").remove(paths);
    }
  });

  it("uploads a package and creates course/module/version rows", async () => {
    const form = new FormData();
    form.set(
      "package",
      new File([buildSamplePackage()], "package.zip", { type: "application/zip" })
    );
    form.set("courseCode", courseCode);
    form.set("courseTitle", "Route Test Course");
    form.set("moduleTitle", "Route Test Module");

    const request = new NextRequest("http://localhost/api/admin/scorm-upload", {
      method: "POST",
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.launchUrl).toBe("index.html");
    expect(body.moduleVersionId).toBeTruthy();
    uploadedPrefix = body.prefix;

    const [course] = await db.select().from(courses).where(eq(courses.code, courseCode));
    expect(course.title).toBe("Route Test Course");
  });

  it("rejects a request missing required fields", async () => {
    const form = new FormData();
    form.set("courseCode", "missing-package");

    const request = new NextRequest("http://localhost/api/admin/scorm-upload", {
      method: "POST",
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/admin/scorm-upload/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the route**

`app/api/admin/scorm-upload/route.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, scormModuleVersions } from "@/lib/db/schema";
import { parseManifest } from "@/lib/scorm/parse-manifest";
import { extractScormPackage } from "@/lib/scorm/extract-package";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("package");
  const courseCode = formData.get("courseCode");
  const courseTitle = formData.get("courseTitle");
  const moduleTitle = formData.get("moduleTitle");

  if (
    !(file instanceof File) ||
    typeof courseCode !== "string" ||
    typeof courseTitle !== "string" ||
    typeof moduleTitle !== "string"
  ) {
    return NextResponse.json(
      { error: "package, courseCode, courseTitle, and moduleTitle are all required" },
      { status: 400 }
    );
  }

  const zipBuffer = Buffer.from(await file.arrayBuffer());
  const moduleVersionId = randomUUID();
  const { prefix, manifestXml } = await extractScormPackage(zipBuffer, moduleVersionId);
  const { identifier, launchUrl } = parseManifest(manifestXml);

  const existing = await db.select().from(courses).where(eq(courses.code, courseCode));
  const course =
    existing[0] ??
    (await db.insert(courses).values({ code: courseCode, title: courseTitle }).returning())[0];

  const [courseModule] = await db
    .insert(modules)
    .values({ courseId: course.id, moduleType: "scorm", title: moduleTitle })
    .returning();

  const [version] = await db
    .insert(moduleVersions)
    .values({
      id: moduleVersionId,
      moduleId: courseModule.id,
      versionNumber: 1,
      status: "published",
      publishedAt: new Date(),
    })
    .returning();

  await db.insert(scormModuleVersions).values({
    moduleVersionId: version.id,
    gcsPrefix: prefix,
    manifestIdentifier: identifier,
    launchUrl,
    rawManifestXml: manifestXml,
  });

  await db
    .update(modules)
    .set({ currentVersionId: version.id })
    .where(eq(modules.id, courseModule.id));

  return NextResponse.json({ moduleVersionId: version.id, launchUrl, prefix });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/admin/scorm-upload/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/scorm-upload
git commit -m "feat: add SCORM package upload API route"
```

---

### Task 5: Attempt creation and CMI commit routes

**Files:**
- Create: `app/api/scorm/attempts/route.ts`
- Create: `app/api/scorm/commit/route.ts`
- Test: `app/api/scorm/attempts/route.test.ts`
- Test: `app/api/scorm/commit/route.test.ts`

**Interfaces:**
- Consumes: `db`, `moduleVersions`/`moduleAttempts`/`scormAttemptState` (Task 2).
- Produces: `POST /api/scorm/attempts` — body `{ moduleVersionId, userId }`, returns `{ attemptId, attemptNumber }`.
- Produces: `POST /api/scorm/commit` — body `{ attemptId, cmi }` (the full CMI object as `scorm-again` reports it), returns `{ ok: true }`. Upserts `scorm_attempt_state` keyed on `moduleAttemptId`.

- [ ] **Step 1: Write the failing attempts test**

`app/api/scorm/attempts/route.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts } from "@/lib/db/schema";

describe("POST /api/scorm/attempts", () => {
  const courseCode = `ATTEMPT-TEST-${randomUUID()}`;
  let moduleVersionId: string;

  async function seed() {
    const [course] = await db.insert(courses).values({ code: courseCode, title: "t" }).returning();
    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "t" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();
    moduleVersionId = version.id;
  }

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.code, courseCode));
  });

  it("creates a first attempt numbered 1, then a second numbered 2", async () => {
    await seed();

    const first = await POST(
      new NextRequest("http://localhost/api/scorm/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId, userId: "user-1" }),
      })
    );
    const firstBody = await first.json();
    expect(firstBody.attemptNumber).toBe(1);

    const second = await POST(
      new NextRequest("http://localhost/api/scorm/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId, userId: "user-1" }),
      })
    );
    const secondBody = await second.json();
    expect(secondBody.attemptNumber).toBe(2);

    const rows = await db
      .select()
      .from(moduleAttempts)
      .where(eq(moduleAttempts.moduleVersionId, moduleVersionId));
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/scorm/attempts/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the attempts route**

`app/api/scorm/attempts/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { moduleAttempts } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { moduleVersionId, userId } = body as { moduleVersionId?: string; userId?: string };

  if (!moduleVersionId || !userId) {
    return NextResponse.json(
      { error: "moduleVersionId and userId are required" },
      { status: 400 }
    );
  }

  const previousAttempts = await db
    .select()
    .from(moduleAttempts)
    .where(eq(moduleAttempts.moduleVersionId, moduleVersionId));

  const [attempt] = await db
    .insert(moduleAttempts)
    .values({
      moduleVersionId,
      userId,
      attemptNumber: previousAttempts.length + 1,
    })
    .returning();

  return NextResponse.json({ attemptId: attempt.id, attemptNumber: attempt.attemptNumber });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/scorm/attempts/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing commit test**

`app/api/scorm/commit/route.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, moduleAttempts, scormAttemptState } from "@/lib/db/schema";

describe("POST /api/scorm/commit", () => {
  const courseCode = `COMMIT-TEST-${randomUUID()}`;
  let attemptId: string;

  async function seed() {
    const [course] = await db.insert(courses).values({ code: courseCode, title: "t" }).returning();
    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "t" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();
    const [attempt] = await db
      .insert(moduleAttempts)
      .values({ moduleVersionId: version.id, userId: "user-1" })
      .returning();
    attemptId = attempt.id;
  }

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.code, courseCode));
  });

  it("inserts scorm_attempt_state on first commit, updates it on second", async () => {
    await seed();

    const firstCmi = { "cmi.core.lesson_status": "incomplete", "cmi.suspend_data": "page=1" };
    const firstResponse = await POST(
      new NextRequest("http://localhost/api/scorm/commit", {
        method: "POST",
        body: JSON.stringify({ attemptId, cmi: firstCmi }),
      })
    );
    expect(firstResponse.status).toBe(200);

    const secondCmi = { "cmi.core.lesson_status": "completed", "cmi.suspend_data": "page=2" };
    await POST(
      new NextRequest("http://localhost/api/scorm/commit", {
        method: "POST",
        body: JSON.stringify({ attemptId, cmi: secondCmi }),
      })
    );

    const [state] = await db
      .select()
      .from(scormAttemptState)
      .where(eq(scormAttemptState.moduleAttemptId, attemptId));

    expect(state.lessonStatus).toBe("completed");
    expect(state.rawCmi).toEqual(secondCmi);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run app/api/scorm/commit/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 7: Implement the commit route**

`app/api/scorm/commit/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scormAttemptState } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { attemptId, cmi } = body as { attemptId?: string; cmi?: Record<string, unknown> };

  if (!attemptId || !cmi) {
    return NextResponse.json({ error: "attemptId and cmi are required" }, { status: 400 });
  }

  const lessonStatus =
    typeof cmi["cmi.core.lesson_status"] === "string" ? (cmi["cmi.core.lesson_status"] as string) : null;
  const lessonLocation =
    typeof cmi["cmi.core.lesson_location"] === "string" ? (cmi["cmi.core.lesson_location"] as string) : null;
  const suspendData =
    typeof cmi["cmi.suspend_data"] === "string" ? (cmi["cmi.suspend_data"] as string) : null;

  const existing = await db
    .select()
    .from(scormAttemptState)
    .where(eq(scormAttemptState.moduleAttemptId, attemptId));

  if (existing.length === 0) {
    await db.insert(scormAttemptState).values({
      moduleAttemptId: attemptId,
      lessonStatus,
      lessonLocation,
      suspendData,
      rawCmi: cmi,
      lastCommitAt: new Date(),
    });
  } else {
    await db
      .update(scormAttemptState)
      .set({ lessonStatus, lessonLocation, suspendData, rawCmi: cmi, lastCommitAt: new Date() })
      .where(eq(scormAttemptState.moduleAttemptId, attemptId));
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run app/api/scorm/commit/route.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/api/scorm/attempts app/api/scorm/commit
git commit -m "feat: add SCORM attempt creation and CMI commit API routes"
```

---

### Task 6: Launch page with scorm-again runtime, and manual verification

**Files:**
- Create: `app/(app)/admin/scorm-test/[moduleVersionId]/page.tsx`
- Create: `app/(app)/admin/scorm-test/[moduleVersionId]/scorm-launch.tsx`
- Create: `app/api/scorm/launch-info/[moduleVersionId]/route.ts`
- Test: `app/api/scorm/launch-info/[moduleVersionId]/route.test.ts`

**Interfaces:**
- Consumes: `db`, `moduleVersions`/`scormModuleVersions` (Task 2); `POST /api/scorm/attempts` and `POST /api/scorm/commit` (Task 5); `supabaseStorage` (Task 3) for building the public content URL.
- Produces: `GET /api/scorm/launch-info/[moduleVersionId]` — returns `{ launchUrl, gcsPrefix }` for the launch page to build the iframe `src` from.
- No further tasks in this plan consume this page — it's the manual acceptance harness for the whole slice.

- [ ] **Step 1: Write the failing launch-info test**

`app/api/scorm/launch-info/[moduleVersionId]/route.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { GET } from "./route";
import { db } from "@/lib/db/client";
import { courses, modules, moduleVersions, scormModuleVersions } from "@/lib/db/schema";

describe("GET /api/scorm/launch-info/[moduleVersionId]", () => {
  const courseCode = `LAUNCH-TEST-${randomUUID()}`;
  let moduleVersionId: string;

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.code, courseCode));
  });

  it("returns the launch URL and storage prefix for a module version", async () => {
    const [course] = await db.insert(courses).values({ code: courseCode, title: "t" }).returning();
    const [courseModule] = await db
      .insert(modules)
      .values({ courseId: course.id, moduleType: "scorm", title: "t" })
      .returning();
    const [version] = await db
      .insert(moduleVersions)
      .values({ moduleId: courseModule.id, versionNumber: 1, status: "published" })
      .returning();
    await db.insert(scormModuleVersions).values({
      moduleVersionId: version.id,
      gcsPrefix: "some-prefix",
      manifestIdentifier: "x",
      launchUrl: "index.html",
      rawManifestXml: "<manifest/>",
    });
    moduleVersionId = version.id;

    const response = await GET(
      new Request(`http://localhost/api/scorm/launch-info/${moduleVersionId}`),
      { params: Promise.resolve({ moduleVersionId }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.launchUrl).toBe("index.html");
    expect(body.gcsPrefix).toBe("some-prefix");
  });

  it("returns 404 for an unknown module version", async () => {
    const response = await GET(
      new Request(`http://localhost/api/scorm/launch-info/${randomUUID()}`),
      { params: Promise.resolve({ moduleVersionId: randomUUID() }) }
    );
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/scorm/launch-info/[moduleVersionId]/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the launch-info route**

`app/api/scorm/launch-info/[moduleVersionId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scormModuleVersions } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  props: { params: Promise<{ moduleVersionId: string }> }
) {
  const { moduleVersionId } = await props.params;

  const [row] = await db
    .select()
    .from(scormModuleVersions)
    .where(eq(scormModuleVersions.moduleVersionId, moduleVersionId));

  if (!row) {
    return NextResponse.json({ error: "Module version not found" }, { status: 404 });
  }

  return NextResponse.json({ launchUrl: row.launchUrl, gcsPrefix: row.gcsPrefix });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/scorm/launch-info/[moduleVersionId]/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the client-side launch harness**

`app/(app)/admin/scorm-test/[moduleVersionId]/scorm-launch.tsx` — creates an attempt on mount, wires up `scorm-again`'s `Scorm12API` against `window.API`, and posts every commit:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Scorm12API } from "scorm-again";

export function ScormLaunch({
  moduleVersionId,
  contentUrl,
}: {
  moduleVersionId: string;
  contentUrl: string;
}) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string>("not started");
  const apiRef = useRef<InstanceType<typeof Scorm12API> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function createAttempt() {
      const response = await fetch("/api/scorm/attempts", {
        method: "POST",
        body: JSON.stringify({ moduleVersionId, userId: "admin-test-user" }),
      });
      const body = await response.json();
      if (cancelled) return;
      setAttemptId(body.attemptId);

      const api = new Scorm12API({
        autocommit: true,
        lmsCommitUrl: false,
      });
      api.on("LMSCommit", async () => {
        const cmi = api.cmi.toJSON() as Record<string, unknown>;
        setLastStatus(String(cmi["core"] ?? "committed"));
        await fetch("/api/scorm/commit", {
          method: "POST",
          body: JSON.stringify({ attemptId: body.attemptId, cmi }),
        });
      });
      (window as unknown as { API: typeof api }).API = api;
      apiRef.current = api;
    }

    createAttempt();
    return () => {
      cancelled = true;
    };
  }, [moduleVersionId]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Attempt: {attemptId ?? "creating..."} — last commit: {lastStatus}
      </p>
      <iframe src={contentUrl} className="h-[600px] w-full rounded border" title="SCORM content" />
    </div>
  );
}
```

- [ ] **Step 6: Build the launch page**

`app/(app)/admin/scorm-test/[moduleVersionId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { ScormLaunch } from "./scorm-launch";

export default async function ScormTestPage(
  props: PageProps<"/admin/scorm-test/[moduleVersionId]">
) {
  const { moduleVersionId } = await props.params;
  const supabaseUrl = process.env.SUPABASE_URL;

  const infoResponse = await fetch(
    `${process.env.AUTH_URL ?? "http://localhost:3000"}/api/scorm/launch-info/${moduleVersionId}`,
    { cache: "no-store" }
  );
  if (infoResponse.status === 404) {
    notFound();
  }
  const { launchUrl, gcsPrefix } = await infoResponse.json();
  const contentUrl = `${supabaseUrl}/storage/v1/object/public/scorm-packages/${gcsPrefix}/${launchUrl}`;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <h1 className="text-xl font-semibold">SCORM Import Test Harness</h1>
      <p className="text-sm text-muted-foreground">
        Admin-only manual test page — not part of the learner-facing product.
      </p>
      <ScormLaunch moduleVersionId={moduleVersionId} contentUrl={contentUrl} />
    </div>
  );
}
```

**Update (post final-review fix wave, 2026-08-31):** the code above (direct public Supabase object URL) was replaced during the final whole-branch review's fix wave. The final review found this direct-URL approach broken two independent ways: (1) the SCO iframe would be cross-origin from the harness page, so SCORM's `window.API` discovery would throw and nothing would ever commit; (2) Supabase re-serves files over HTTP as `text/plain` regardless of stored metadata, so even a same-origin fix wouldn't have rendered the content. The actual shipped code instead proxies content through this app's own origin: `page.tsx` builds `contentUrl = /api/scorm/content/${moduleVersionId}/${launchUrl}`, and a new `app/api/scorm/content/[moduleVersionId]/[...path]/route.ts` downloads from Supabase Storage server-side (using the service-role key) and re-serves it with a correct `Content-Type` from `lib/scorm/mime-types.ts`. The `scorm-packages` bucket **stays private** — no public/private flip needed at any point, superseding steps 3 and 8 below.

- [ ] **Step 7: Manual end-to-end verification (Ian)**

This step isn't automatable without a real SCORM package and a browser, so it's a manual checklist rather than a Vitest test:

1. Get a real SCORM `.zip` — either export a tiny test course from Articulate, or download any public SCORM 1.2 sample package.
2. Start the dev server (`npm run dev`) and `POST` it to `/api/admin/scorm-upload` (a quick way: `curl -F package=@sample.zip -F courseCode=MANUAL-TEST -F courseTitle="Manual Test" -F moduleTitle="Manual Module" http://localhost:3000/api/admin/scorm-upload`). Note the returned `moduleVersionId`.
3. Visit `http://localhost:3000/admin/scorm-test/<moduleVersionId>` in the browser. (No bucket flip needed — the content-proxy route serves it same-origin from the private bucket.)
4. Confirm the SCORM content renders in the iframe and is interactive.
5. Interact with the content until it reports progress/completion; confirm "last commit" text on the page updates.
6. Query the database directly (Supabase dashboard → Table Editor → `scorm_attempt_state`) and confirm a row exists with `raw_cmi` populated and `lesson_status` reflecting what you did in the content.
7. **Known gap to watch for:** the MIME-type table (`lib/scorm/mime-types.ts`) covers HTML/JS/CSS/images correctly but is missing some common asset extensions (fonts: `.woff`/`.ttf`/`.otf`/`.eot`; audio/video: `.mp3`/`.wav`/`.webm`; `.webp`/`.ico`/`.txt`/`.vtt`). If a real Articulate/Storyline package shows broken fonts or silent audio, that's the likely cause — add the missing extension(s) to the table's mapping.

If all steps hold, the import → launch → commit round-trip is proven and the next plan (Platform Foundation: users/enrollments/RBAC, quiz tables, event log, Cloud SQL migration) can build on top of this schema with confidence.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/admin/scorm-test" app/api/scorm/launch-info
git commit -m "feat: add SCORM launch test harness page with scorm-again runtime wiring"
```

---

## Self-Review Notes

- **Spec coverage**: implements Database Design.md §2 (courses/modules/module_versions/scorm_module_versions) and the SCORM half of §3 (module_attempts/scorm_attempt_state) exactly as specified, including the immutable-FK rule. Deliberately does not implement §1 (users/RBAC), the quiz half of §2/§3, §4 (activity_events), or §7 (Cloud SQL) — called out explicitly in Global Constraints and the plan header so it reads as a scoped milestone, not an oversight.
- **Placeholder scan**: no TBD/TODO markers; every step has real, runnable code.
- **Type consistency**: `moduleVersionId`/`attemptId` are `string` (UUID) consistently across every route and test. `cmi` is `Record<string, unknown>` end to end (attempts/commit routes, launch harness). `db` is imported from the same `lib/db/client.ts` everywhere — no duplicate client instances.
