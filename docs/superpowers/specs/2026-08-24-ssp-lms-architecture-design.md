# SSP LMS — Architecture Design

**Status:** draft, research-stage — not yet implemented
**Date:** 2026-08-24
**Author:** Ian Harrison (with Claude research assist)

## 1. Problem

SSP needs an internal, company-wide Learning Management System (LMS): different departments author and push learning modules, quizzes, and videos to employees; the org needs completion/progress metrics and department-level reporting; content (video, quiz banks) needs durable cloud storage. Hosting target is Google Cloud Platform. This is a full-scale enterprise web app — Ian's usual tool, Tauri (desktop-only, single-user-shaped), is not suited to a multi-department, multi-user, web-delivered system at this scale.

This doc covers stack/architecture research only. Feature-level specs (quiz authoring UI, admin dashboard, video upload flow, etc.) are follow-on sub-projects once this foundation is approved.

## 2. Decomposition

LMS is too large for one implementation plan. Independent sub-projects, in rough build order:

1. **Platform foundation** — auth, Cloud Run app skeleton, Postgres schema, CI/CD (this doc's scope)
2. **Content authoring** — course/module/quiz builder UI for department admins
3. **Video pipeline** — upload -> Mux/Cloudflare Stream ingest -> playback
4. **Delivery/player** — learner-facing course/quiz-taking UI
5. **Metrics/reporting** — event pipeline to BigQuery + Looker Studio dashboards
6. **Org admin** — department/role management, company-wide reporting

## 3. Recommended Stack

| Layer | Choice | Rejected alternatives |
|---|---|---|
| Frontend | Next.js (React), on Cloud Run | Nuxt/SvelteKit (thinner admin/dashboard ecosystem), Flutter web (weak for dense admin UI) |
| Backend compute | Cloud Run (containers) | App Engine (legacy), Cloud Functions (wrong shape for cohesive API), GKE (overkill at this scale) |
| Auth | Direct Entra ID/Azure AD OIDC federation | Firebase Auth, Cloud Identity Platform, Workforce Identity Federation (that's for GCP console access, not app auth) |
| Database | Cloud SQL for PostgreSQL | Firestore (no joins, RBAC-in-rules unwieldy, unpredictable per-doc cost), AlloyDB (overkill/pricier at this scale) |
| Video | Mux or Cloudflare Stream (evaluate both, Mux slightly ahead on analytics, Cloudflare on flat pricing) | Raw GCS+signed URLs (no ABR, reinvents a video platform), Cloud CDN+GCS (still no ABR), YouTube unlisted (no real access control, compliance risk) |
| Content/quiz schema | Custom JSON schema, xAPI-shaped events internally | Full SCORM/cmi5 support as v1 (defer as bolt-on module for future 3rd-party compliance content) |
| Metrics pipeline | App events -> Pub/Sub -> Dataflow -> BigQuery (append-only facts); state mirrored via CDC/Datastream | Firestore-native reporting (no aggregate queries), custom analytics DB |
| Dashboards | Looker Studio embedded in admin portal, connected to existing `applieddatalakessp` BigQuery project | Custom-built dashboard (only justified later for real-time alerts Looker Studio can't do) |

**Firebase verdict:** not used anywhere in this stack. Three independent research passes (backend, Firebase-specific, and general GCP) converged on the same conclusion: Firestore's lack of joins/aggregation, RBAC-in-security-rules complexity, and redundancy with an already-Entra-ID-federated org auth model make it a poor fit for LMS-shaped relational/reporting needs.

**Tauri's role:** none for v1. Could resurface later as an offline-capable desktop wrapper around the finished web app — keep the API standard REST/OIDC so that stays possible without rework.

## 4. Key Design Decisions

- **Quiz versioning:** `quiz_attempt` rows must FK to an immutable `quiz_version` snapshot, never a live/mutable quiz row. Required for insurance compliance training audit trails — "what did the employee actually see" must be answerable years later even after content edits.
- **Event shape:** internal events use an xAPI-like actor/verb/object shape from day one, even without a real LRS, to keep future interop (BI tools, cross-system reporting, M&A training data) cheap.
- **SCORM:** not built in v1. Treated as an isolated, addable player module (iframe + API shim) for whenever third-party purchased compliance content (AML, harassment, CE — common in insurance) needs ingestion.
- **Operational vs analytical split:** Cloud SQL is the single source of truth for live app state (enrollments, current scores, RBAC); BigQuery is the sole source of truth for anything historical/cross-user (trends, department rollups). Reporting queries never hit the operational DB directly.

## 5. Open Questions / Next Steps

- [ ] Confirm Mux vs Cloudflare Stream via a small cost/feature bake-off once real video volume estimates exist
- [ ] Confirm Entra ID app registration process/timeline with IT (same dependency that blocked AI Licensing Tutor's real sign-in — plan for this lead time)
- [ ] Decide whether the "Platform foundation" sub-project spec should live in this same repo or a fresh one
- [ ] Estimate rough GCP cost at target org headcount (Cloud Run + Cloud SQL + Pub/Sub/Dataflow + BigQuery + Mux/Cloudflare) before committing budget

## 6. Research Sources

Findings synthesized from 6 parallel research passes (2026-08-24): frontend framework choice, GCP backend/auth architecture, Firebase suitability, video hosting, quiz/content data model and SCORM/xAPI/cmi5 standards, and metrics/BigQuery reporting pattern. Full agent outputs available in this session's transcript; not separately archived.
