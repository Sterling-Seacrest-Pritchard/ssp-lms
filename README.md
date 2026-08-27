# SSP LMS

Internal, company-wide Learning Management System for SSP. Departments author and push learning modules, quizzes, and videos to employees; the org tracks completion/progress metrics and department-level reporting. Successor in ambition to [AI Licensing Tutor](https://github.com/iharrisonSSP/licensing-tutor-desktop), but web-delivered and multi-department rather than single-purpose desktop.

**Status: visual demo with real Entra ID auth and RBAC (2026-08-27) — everything else still static/mock.** Architecture research is complete; see the full design doc: [`docs/superpowers/specs/2026-08-24-ssp-lms-architecture-design.md`](docs/superpowers/specs/2026-08-24-ssp-lms-architecture-design.md).

## What's Real vs. Mock Right Now

This repo is a **visual demo with one real vertical slice (auth/RBAC)** — a full navigational shell covering all 6 planned sub-projects. Content, video, and reporting are still mock UI; sign-in and roles are real.

- **Real:** Entra ID sign-in (NextAuth/Auth.js v5), real App Roles (`Learner`/`DepartmentAdmin`/`OrgAdmin`) drive the nav when signed in — the Learner/Admin toggle only appears signed-out, as a demo fallback for anyone without Entra access
- No database (all data comes from static TypeScript fixtures in `lib/mock-data/`)
- No video ingest (Mux/Cloudflare Stream not wired up — video cards are placeholder UI)
- Nothing deployed — local dev only

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
| Video | Mux |
| Metrics pipeline | App events → Pub/Sub → Cloud Function → BigQuery |
| Dashboards | Looker Studio, connected to `applieddatalakessp` BigQuery project |

Firebase was evaluated and rejected — see the design doc's reasoning. Cloudflare Stream was evaluated against Mux and lost on cost at this org's video volume (see the cost model artifact from the 2026-08-24 research session).

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
  page.tsx                    # home: active courses, updates feed, quick links
  courses/page.tsx            # course catalog — Active / Finished
  courses/[id]/page.tsx       # course detail, module list, quiz entry points
  admin/page.tsx              # content authoring — course/module table
  admin/videos/page.tsx       # video library (mock)
  admin/reports/page.tsx      # org metrics dashboard (Recharts)
  admin/org/page.tsx          # department/role admin table
  settings/page.tsx           # theme, mock notifications, account/sign-out
  api/auth/[...nextauth]/     # NextAuth route handler
  actions/auth.ts             # sign-in/out server actions
  icon.png                    # favicon (SSP shield mark)
  layout.tsx                  # root layout — ThemeProvider + SessionProvider + AppShell
auth.ts                       # NextAuth config — Entra ID provider, roles claim callbacks
components/
  shell/app-shell.tsx         # sidebar nav, real-role-aware, collapsible, SSP logo
  theme-provider.tsx          # next-themes wrapper
  ui/                         # shadcn/ui components
lib/
  mock-data/                  # static fixtures (courses.ts, reporting.ts, updates.ts)
  utils.ts
public/
  logo-horizontal-{blue,white}.png  # SSP wordmark, theme-swapped in the sidebar
types/
  next-auth.d.ts              # session.user.roles type augmentation
docs/
  superpowers/specs/          # architecture and feature design docs
```

## Auth and RBAC

Real Entra ID sign-in via NextAuth (Auth.js v5). App Roles (`Learner`, `DepartmentAdmin`, `OrgAdmin`) are configured in the Entra app registration and read from the ID token's `roles` claim via `jwt`/`session` callbacks in `auth.ts`. Signed in, the shell derives real nav/role from that — no manual toggle. Signed out, a manual Learner/Admin toggle remains as a demo fallback for anyone without Entra access. See `.env.local` (gitignored) for the required `AUTH_MICROSOFT_ENTRA_ID_*` and `AUTH_SECRET` values.

## Open Items

See the design doc's Section 5 (Open Questions / Next Steps) for the architecture-level list — Mux vs. Cloudflare bake-off, headcount-scaled cost estimate before committing budget.

Demo-specific next steps: no database/video integration yet; the rest of the Platform Foundation sub-project (Cloud Run skeleton, Postgres schema, CI/CD, GCP project) hasn't started — only auth/RBAC is real so far, everything else is still a UI-only preview of the app's shape, not a foundation to build directly on top of.

## Related

- Obsidian context: `Claude Internal/Context/SSP LMS/`
- Prior/reference project: [AI Licensing Tutor](https://github.com/iharrisonSSP/licensing-tutor-desktop) (`licensing-tutor-desktop`) — same author, same GCP org, useful precedent for Cloud Functions + Entra ID patterns
