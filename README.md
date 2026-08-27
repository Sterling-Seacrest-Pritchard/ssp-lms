# SSP LMS

Internal, company-wide Learning Management System for SSP. Departments author and push learning modules, quizzes, and videos to employees; the org tracks completion/progress metrics and department-level reporting. Successor in ambition to [AI Licensing Tutor](https://github.com/iharrisonSSP/licensing-tutor-desktop), but web-delivered and multi-department rather than single-purpose desktop.

**Status: live demo with real Entra ID auth and RBAC, deployed to Cloud Run (2026-08-27) — content/video/reporting still static/mock.** Architecture research is complete; see the full design doc: [`docs/superpowers/specs/2026-08-24-ssp-lms-architecture-design.md`](docs/superpowers/specs/2026-08-24-ssp-lms-architecture-design.md).

**Live at:** `https://ssp-lms-563565514703.us-east4.run.app` (Google Cloud Run, `applieddatalakessp` project, `us-east4`) — sign-in required, access via Entra ID App Roles assignment.

## What's Real vs. Mock Right Now

This repo is a **live demo with one real vertical slice (auth/RBAC)** — a full navigational shell covering all 6 planned sub-projects. Content, video, and reporting are still mock UI; sign-in and roles are real, and the whole app requires signing in to view at all (see Auth and RBAC below).

- **Real:** Entra ID sign-in (NextAuth/Auth.js v5), real App Roles (`Learner`/`DepartmentAdmin`/`OrgAdmin`) drive the nav and are enforced server-side for `/admin/*` — the Learner/Admin toggle only appears signed-out, as a demo fallback for anyone without Entra access. Deployed to Cloud Run with a dedicated service account.
- No database (all data comes from static TypeScript fixtures in `lib/mock-data/`)
- No video ingest (Mux/Cloudflare Stream not wired up — video cards are placeholder UI)
- No content upload yet — see SCORM Content Strategy below for the planned approach

## Setup

Prerequisites: Node.js 20.9+ and npm (this project uses Next.js 16, which requires Node 20.9+; Node 18 is not supported).

```bash
git clone https://github.com/Sterling-Seacrest-Pritchard/ssp-lms.git
cd ssp-lms
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

If you're driving this through Claude Code's Browser pane instead of a normal terminal, there's an `ssp-lms` entry in the shared `.claude/launch.json` that runs the dev server on port 3001 (3000 is reserved there for an unrelated project) — use that name with the preview tool rather than starting a second server on 3000 by hand.

## Stack (Demo)

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript, Turbopack) |
| Styling | Tailwind CSS, SSP Dark Blue (`#304D7D`) as the primary/accent color per brand guidelines |
| UI components | shadcn/ui (`base-nova` style — built on [Base UI](https://base-ui.com), **not** Radix; components use a `render` prop instead of `asChild` for custom child elements) |
| Theme | `next-themes` — Light/Dark/System, toggle in Settings |
| Auth | NextAuth (Auth.js v5) — real Entra ID OIDC sign-in + App Roles (see Auth section below) |
| Charts | Recharts (`app/admin/reports`) |
| Icons | lucide-react |
| Data | Static fixtures in `lib/mock-data/` — no API routes, no database |

## Stack (Target Production Architecture)

| Layer | Choice |
|---|---|
| Frontend | Next.js (React), on Cloud Run |
| Backend compute | Cloud Run (containers) |
| Auth | Entra ID / Azure AD, direct OIDC federation |
| Database | Cloud SQL for PostgreSQL |
| Content upload | **SCORM packages** — primary path for department admins, not a from-scratch course builder (revised 2026-08-27, see SCORM Content Strategy below) |
| Video | Mux |
| Metrics pipeline | App events → Pub/Sub → Cloud Function → BigQuery |
| Dashboards | Looker Studio, connected to `applieddatalakessp` BigQuery project |

Firebase was evaluated and rejected — see the design doc's reasoning. Cloudflare Stream was evaluated against Mux and lost on cost at this org's video volume (see the cost model artifact from the 2026-08-24 research session).

## SCORM Content Strategy

Department admins upload SCORM packages (`.zip` files exported from tools like Articulate Storyline, Adobe Captivate, or iSpring) rather than authoring courses from scratch in a custom builder UI. This was originally scoped as a deferred bolt-on for third-party purchased content only; revised 2026-08-27 to be the primary content-authoring path.

- **Package format:** a `.zip` containing `imsmanifest.xml` (course structure, sequencing, entry-point HTML) plus the packaged HTML/JS/media content.
- **Version support:** SCORM 1.2 vs 2004 (3rd/4th edition) — not yet decided whether to support both or pick one.
- **Storage:** unzipped and hosted as static content (GCS + signed URLs or Cloud CDN) — not the Mux pipeline, since SCORM packages typically bundle their own media.
- **Runtime:** SCORM content expects the LMS to expose a JS API object (`window.API` for 1.2, `window.API_1484_11` for 2004) that the packaged content calls into to report completion/score/progress. Recommended implementation: [`scorm-again`](https://github.com/jcputney/scorm-again) rather than hand-rolling the Run-Time Environment spec.
- **Reporting integration:** SCORM runtime calls get translated into the already-decided xAPI-shaped internal events, so BigQuery/reporting has one event shape regardless of content source.
- **Open questions:** SCORM 1.2 vs 2004 vs both; whether a custom course/quiz builder UI still exists for lightweight org-authored quizzes, or SCORM upload becomes the only path; virus/content scanning on uploaded zips before hosting.

Full detail: `Claude Internal/Context/SSP LMS/Architecture.md` (SCORM Content Authoring section).

## Platforms This Project Will Touch (Production)

1. **Google Cloud Platform** — primary host. Cloud Run, Cloud SQL, Cloud Storage, Pub/Sub, Cloud Functions, BigQuery, Looker Studio, Cloud Build, Artifact Registry. Heaviest build/config effort lives here. Not provisioned yet.
2. **Microsoft Entra ID (Azure AD)** — SSO. Company already M365-based. Requires IT to approve a new app registration before real sign-in works — same dependency that blocked AI Licensing Tutor's launch; budget lead time for this.
3. **Mux** — video encoding, storage, and streaming. Separate account/billing from GCP, API-integrated, no infra to self-manage.
4. **GitHub** — this repo.
5. **DNS** — an internal subdomain (e.g. under `sspins.com`) needs to be pointed at the Cloud Run service once deployed.

## Estimated Running Cost (Production)

~$120-160/month at a 100-300 user rollout with a heavy (300+ video) library — see the design doc's Section 5 and the cost model research from 2026-08-24 for the full per-service breakdown. List pricing, no committed-use discounts applied.

## Repo Structure

```
app/
  (app)/                      # route group: pages behind the sign-in gate, share AppShell layout
    page.tsx                  # home: active courses, updates feed, quick links
    courses/page.tsx          # course catalog — Active / Finished
    courses/[id]/page.tsx     # course detail, module list, quiz entry points
    courses/[id]/quiz/[moduleId]/page.tsx  # interactive quiz-taking mock
    admin/page.tsx            # content authoring — course/module table
    admin/videos/page.tsx     # video library (mock)
    admin/reports/page.tsx    # org metrics dashboard (Recharts)
    admin/org/page.tsx        # department/role admin table
    settings/page.tsx         # theme, mock notifications, account/sign-out
    layout.tsx                # wraps children in AppShell
  sign-in/page.tsx            # standalone branded sign-in screen, outside the (app) group
  api/auth/[...nextauth]/     # NextAuth route handler
  actions/auth.ts             # sign-in/out server actions
  icon.png                    # favicon (SSP shield mark)
  layout.tsx                  # root layout — ThemeProvider + SessionProvider (no AppShell here)
auth.ts                       # NextAuth config — Entra ID provider, roles claim callbacks, trustHost
proxy.ts                      # Next.js 16's middleware — auth gate + /admin role enforcement
Dockerfile / .dockerignore    # Cloud Run deploy (multi-stage, Next.js standalone output)
components/
  shell/app-shell.tsx         # sidebar nav, real-role-aware, collapsible, SSP logo
  quiz/quiz-runner.tsx        # quiz-taking UI (score, pass/fail, retake)
  theme-provider.tsx          # next-themes wrapper
  ui/                         # shadcn/ui components
lib/
  mock-data/                  # static fixtures (courses.ts, reporting.ts, updates.ts, quizzes.ts)
  roles.ts                    # shared role-claim logic (used by proxy.ts and the shell)
  utils.ts
public/
  logo-horizontal-{blue,white}.png, logo-shield-{blue,white}.png  # SSP marks, theme-swapped
types/
  next-auth.d.ts              # session.user.roles type augmentation
docs/
  superpowers/specs/          # architecture and feature design docs
```

## Auth and RBAC

Real Entra ID sign-in via NextAuth (Auth.js v5) — the whole app requires signing in, enforced by `proxy.ts` (Next.js 16's renamed `middleware.ts`), which redirects unauthenticated requests to the branded `/sign-in` screen. App Roles (`Learner`, `DepartmentAdmin`, `OrgAdmin`) are configured in the Entra app registration and read from the ID token's `roles` claim via `jwt`/`session` callbacks in `auth.ts`. Signed in, the shell derives real nav/role from that, and `proxy.ts` also enforces the role server-side for `/admin/*` (not just hidden client-side nav). Signed out, a manual Learner/Admin toggle remains as a demo fallback for anyone without Entra access. See `.env.local` (gitignored) for the required `AUTH_MICROSOFT_ENTRA_ID_*`, `AUTH_SECRET`, and `AUTH_URL` values — `AUTH_URL` and `trustHost: true` are required for any non-Vercel host, Cloud Run included.

## Open Items

See the design doc's Section 5 (Open Questions / Next Steps) for the architecture-level list — Mux vs. Cloudflare bake-off, headcount-scaled cost estimate before committing budget, SCORM 1.2 vs 2004 support.

Demo-specific next steps: no database/video/content-upload integration yet; the rest of the Platform Foundation sub-project (Cloud Run app skeleton beyond this demo, Postgres schema, CI/CD, GCP project) hasn't started — only auth/RBAC and hosting are real so far, everything else is still a UI-only preview of the app's shape, not a foundation to build directly on top of.

## Related

- Obsidian context: `Claude Internal/Context/SSP LMS/`
- Prior/reference project: [AI Licensing Tutor](https://github.com/iharrisonSSP/licensing-tutor-desktop) (`licensing-tutor-desktop`) — same author, same GCP org, useful precedent for Cloud Functions + Entra ID patterns
