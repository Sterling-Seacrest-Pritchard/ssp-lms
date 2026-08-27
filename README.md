# SSP LMS

Internal, company-wide Learning Management System for SSP. Departments author and push learning modules, quizzes, and videos to employees; the org tracks completion/progress metrics and department-level reporting. Successor in ambition to [AI Licensing Tutor](https://github.com/iharrisonSSP/licensing-tutor-desktop), but web-delivered and multi-department rather than single-purpose desktop.

**Status: architecture research complete, nothing built yet.** See the full design doc:
[`docs/superpowers/specs/2026-08-24-ssp-lms-architecture-design.md`](docs/superpowers/specs/2026-08-24-ssp-lms-architecture-design.md)

## Stack

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

## Platforms This Project Touches

1. **Google Cloud Platform** — primary host. Cloud Run, Cloud SQL, Cloud Storage, Pub/Sub, Cloud Functions, BigQuery, Looker Studio, Cloud Build, Artifact Registry. Heaviest build/config effort lives here.
2. **Microsoft Entra ID (Azure AD)** — SSO. Company already M365-based. Requires IT to approve a new app registration before real sign-in works — same dependency that blocked AI Licensing Tutor's launch; budget lead time for this.
3. **Mux** — video encoding, storage, and streaming. Separate account/billing from GCP, API-integrated, no infra to self-manage.
4. **GitHub** — this repo.
5. **DNS** — an internal subdomain (e.g. under `sspins.com`) needs to be pointed at the Cloud Run service once deployed.

## Estimated Running Cost

~$120-160/month at a 100-300 user rollout with a heavy (300+ video) library — see the design doc's Section 5 and the cost model research from 2026-08-24 for the full per-service breakdown. List pricing, no committed-use discounts applied.

## Repo Structure

```
docs/
  superpowers/
    specs/            # architecture and feature design docs (this project's spec history)
```

No application code yet. Once the Platform Foundation sub-project (auth, Cloud Run skeleton, Postgres schema, CI/CD — see design doc Section 2) is planned and approved, this section will describe the actual app layout, dev commands, and local setup.

## Setup (once implementation starts)

Not yet applicable — no app code exists. This section will be filled in when the Platform Foundation sub-project produces its first working scaffold. Expected prerequisites based on the chosen stack:

- [ ] GCP project provisioned (`applieddatalakessp` or a new project — decide before starting)
- [ ] Entra ID app registration submitted to IT
- [ ] Mux account created
- [ ] Node.js + npm for local Next.js dev
- [ ] `gcloud` CLI authenticated for deploys

## Open Items

See the design doc's Section 5 (Open Questions / Next Steps) for the current list — Mux vs. Cloudflare bake-off, Entra ID timeline, repo/spec structure for the next sub-project, and a headcount-scaled cost estimate before committing budget.

## Related

- Obsidian context: `Claude Internal/Context/SSP LMS/SSP LMS.md`
- Prior/reference project: [AI Licensing Tutor](https://github.com/iharrisonSSP/licensing-tutor-desktop) (`licensing-tutor-desktop`) — same author, same GCP org, useful precedent for Cloud Functions + Entra ID patterns
