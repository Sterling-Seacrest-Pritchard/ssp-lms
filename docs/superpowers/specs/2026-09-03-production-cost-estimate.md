# SSP LMS — Production Cost Estimate

**Date:** 2026-09-03
**Pricing as-of:** 2026-09-03 (cloud pricing changes — re-verify before committing budget if this doc is more than a few months old)
**Author:** Ian Harrison (with Claude research assist)
**Status:** research artifact, answers the open item "Rough GCP cost estimate at target org headcount before committing budget" from the architecture design doc (`2026-08-24-ssp-lms-architecture-design.md`, §5) and README's "Estimated Running Cost (Production)" line.

## 1. Assumptions

Every line item below is sized against these assumptions. Where a usage number doesn't exist yet (no real telemetry — the app's content/video/reporting are still static/mock per README), that's stated explicitly rather than guessed silently.

- **Headcount: 400 users.** Ian's stated target org size for this internal LMS. Not all 400 are active daily — this is total addressable headcount with an account, not concurrent load.
- **Daily active users: ~30% (~120/day).** A reasonable assumption for an internal compliance-training tool that isn't used continuously — people log in to complete assigned modules, not to browse.
- **Request volume:** ~120 active users/day × ~30 requests/session (page loads + API calls for course/quiz/progress data) ≈ 3,600 requests/day ≈ **~110,000 requests/month**. This is an assumption, not measured traffic — stated so the Cloud Run/Vercel free-tier comparison below is legible.
- **Video watch time: 15 minutes/user/month, steady state.** This is an explicit assumption because no real usage data exists yet (video hosting isn't built — see `2026-09-03-video-hosting-mux-design.md`). Reasoning: this is compliance/onboarding training, not entertainment — most months a given employee watches little or nothing; a few months a year (onboarding, annual renewals) they watch more. 15 min/user/month averaged across the year is a light-but-plausible steady-state number. At 400 users that's **~6,000 delivery-minutes/month** — a stress-tested 4x-high case (60 min/user/month) is still only ~24,000 minutes/month, well under Mux's 100K free delivery minutes.
- **Video library size: grows past Mux's 10-free-video cap.** README's own existing cost note (see §6) frames "100-300 user rollout with a heavy (300+ video) library" as the stress case, so this doc uses **up to 300 stored videos, ~15 min average length** as the upper-bound library-size scenario, alongside a more realistic **50-100 videos** near-term scenario.
- **Non-video storage (SCORM packages, quiz banks, course images) in Cloud Storage: 50-100 GB.** No real content yet; this is a reasonable ceiling for a few dozen courses' worth of authored material.
- **Reporting/event pipeline volume:** modest. 400 users generating page-view/quiz-attempt/video-commit events — even generously, tens of thousands of small JSON events/month, not millions.
- Prices below are **list/on-demand pricing, no committed-use discounts**, matching the convention the architecture doc and README already use.

## 2. Current scenario — what it costs today

The app is live today (Cloud Run, `applieddatalakessp`/`us-east4`) on Supabase's free-tier Postgres, no video pipeline built, no Cloud SQL, no BigQuery/Pub/Sub pipeline provisioned.

| Service | Current tier | Monthly cost |
|---|---|---|
| Cloud Run | Light traffic, well under the 2M free requests/month + free CPU/memory allotment | **$0-5** |
| Supabase Postgres | Free tier (500 MB DB, 5 GB egress, pauses after 1 week idle, max 2 active projects) | **$0** |
| Mux | Not yet integrated (video pipeline unbuilt) | **$0** |
| Cloud Build / Artifact Registry | Occasional CI builds, small container images | **$0-2** |
| Entra ID | Free tier, individual App Roles assignment (already live in prod) | **$0** |
| **Total** | | **~$0-10/month** |

The real risk in this scenario isn't cost — it's the Supabase free tier's 500 MB database cap and inactivity-pause behavior, which is why the architecture doc already treats Cloud SQL migration as blocked-not-optional once billing is approved (source: [Supabase Pricing](https://supabase.com/pricing), fetched 2026-09-03).

## 3. Per-service line items (target production, 400 users)

### 3.1 Database — Cloud SQL for PostgreSQL

Cloud SQL prices dedicated-core Enterprise-edition instances per vCPU-hour and per-GB-RAM-hour, plus separate SSD storage and backup storage per GB-month. Google's own pricing page (`cloud.google.com/sql/pricing`) renders its tables client-side and wasn't scrapable directly; the rates below are corroborated across two independent third-party breakdowns that both cite Google's May 2026 published table for `us-central1`, cross-checked against each other and internally consistent:

- **Compute (Enterprise edition, dedicated core):** $0.0413/vCPU-hour, $0.0070/GB-RAM-hour
- **SSD storage (non-HA):** ~$0.22/GB-month
- **Backup storage:** ~$0.11/GB-month
- **Cross-region network egress (N. America):** ~$0.12/GB

Sources: [Google Cloud SQL Pricing 2026 — Usage.ai](https://www.usage.ai/blogs/gcp/cloud-sql/pricing/), [Google Cloud SQL Pricing 2026 — Security Boulevard](https://securityboulevard.com/2026/05/google-cloud-sql-pricing-2026-instance-costs-storage-and-what-the-calculator-hides/), both fetched 2026-09-03, both citing Google's official table. **Recommend Ian re-verify against the live calculator at `cloud.google.com/sql/pricing` before finalizing budget** — this is the one line item in this doc where I could not get first-party numbers directly.

Two sizing options, both no-HA (single instance, no standby replica) — HA roughly doubles compute cost:

| Instance | Compute (730 hrs) | + Storage (~20GB SSD, ~10GB backup) | **Monthly total** |
|---|---|---|---|
| `db-custom-1-3840` (1 vCPU / 3.75GB) | $49.31 | ~$5.50 | **~$55-70** |
| `db-custom-2-8192` (2 vCPU / 8GB) | $101.18 | ~$5.50 | **~$107-125** |
| `db-custom-2-8192` **with HA standby** | ~$202 | ~$11 | **~$215-250** |

This closely tracks (and at the low end slightly undercuts) the original 2026-08-31 estimate in `Database Design.md` ($120-160/mo for `db-custom-2-8192`, $50-70/mo for `db-custom-1-3840`) — see the correction note added to that file (§6 below). **Recommendation unchanged from the original: start with `db-custom-1-3840`, no HA**, and scale up once real usage data exists — an internal 400-user LMS's OLTP load (enrollments, scores, RBAC) is not large.

### 3.2 Hosting — Cloud Run vs. Vercel

The app is Next.js 16, live today on Cloud Run. Ian asked for both priced out since Next.js is Vercel's own framework.

**Cloud Run** (`us-east4` is a Tier 1 region — confirmed via Google Cloud Run locations docs):
- $0.000024/vCPU-second, $0.0000025/GiB-second, $0.40/million requests
- Free tier: 180,000 vCPU-seconds, 360,000 GiB-seconds, 2M requests, 1 GiB free egress (NA) — **per month**
- Source: [Cloud Run pricing](https://cloud.google.com/run/pricing) (direct fetch was truncated by client-side rendering; figures corroborated via [Cloudchipr's 2026 Cloud Run pricing breakdown](https://cloudchipr.com/blog/cloud-run-pricing), fetched 2026-09-03)

At ~110,000 requests/month (assumption above), request volume alone stays **19x under** the 2M free-request allotment.

| Cloud Run mode | Reasoning | Monthly cost |
|---|---|---|
| **Scale-to-zero** (min instances = 0) | Compute only billed during actual request handling; light 400-user traffic likely stays mostly within the free vCPU/GiB-second allotment | **~$5-25** |
| **Always-warm** (min instances = 1, avoids cold-start latency) | 1 vCPU + 1 GiB held 24/7 = 730 hrs: (2,628,000 - 180,000) vCPU-sec × $0.000024 + (2,628,000 - 360,000) GiB-sec × $0.0000025 | **~$55-75** |

**Vercel** (Next.js's own platform):
- Hobby: $0/mo, 1 seat, 100GB bandwidth, 1M function invocations — not viable for an org deployment (single-seat, no team/SSO features)
- **Pro: $20/month per deploying seat** (viewer seats free/unlimited), includes 1TB Fast Data Transfer + 10M Edge Requests/month at no extra charge, then $0.15/GB bandwidth overage, $0.60/1M function invocations + $0.128/active-CPU-hour beyond included credit
- Source: [Vercel Pricing](https://vercel.com/pricing), fetched 2026-09-03

At this app's assumed traffic (110K requests/month, modest bandwidth), a single-seat Pro team (~$20/mo) comfortably covers it — the 1TB/10M-request included allotments are far above a 400-user internal tool's footprint. **Vercel estimate: ~$20-40/month.**

**Comparison:** Vercel Pro (~$20-40/mo) is cost-competitive with or cheaper than an always-warm Cloud Run instance (~$55-75/mo), and roughly comparable to a well-tuned scale-to-zero Cloud Run service (~$5-25/mo). The real trade-off isn't primarily cost at this scale — it's operational: moving off Cloud Run means the app's Postgres connection (Cloud SQL) crosses from Vercel's infrastructure to GCP over the public internet (needs Cloud SQL's public IP + SSL, or a proxy), versus staying same-cloud with Cloud Run. Vercel's function execution-time limits (10s default, extendable) could also matter for any long-running admin operations. **This doc prices both; the platform decision is Ian's call, not something cost alone resolves.**

### 3.3 Video — Mux

Confirmed against Mux's own pricing page (2026-09-03), matching the numbers already logged in the video-hosting design doc:

- **Free tier (permanent, not a trial):** 10 stored videos, 100K free delivery minutes/month, Basic encoding free
- **Encoding (Plus/Premium, not used per this app's design — Basic only):** Plus from $0.025/min (720p), Premium from $0.0384/min (720p) — **not costed into target production**, since the video-hosting design explicitly restricts every upload to Basic encoding as a non-goal-of-changing
- **Storage** (per stored minute/month): 720p $0.0024, 1080p $0.003, 2K $0.0048, 4K $0.0096
- **Delivery** (per minute, beyond the 100K free): 720p $0.0008, 1080p $0.001, 2K $0.0016, 4K $0.0032

Source: [Mux Pricing](https://www.mux.com/pricing), fetched 2026-09-03.

At this doc's assumptions: delivery stays under the free 100K-minute cap even in the 4x-stress case (~24,000 min/month vs. 100,000 free) — **delivery cost: $0**. The real cost driver is exceeding the **10-stored-video cap**, not delivery volume:

| Library size | Storage (720p, monthly) | Monthly cost |
|---|---|---|
| 50 videos × 15 min avg = 750 min | 750 × $0.0024 | **~$1.80** |
| 100 videos × 15 min avg = 1,500 min | 1,500 × $0.0024 | **~$3.60** |
| 300 videos × 15 min avg = 4,500 min (README's stress case) | 4,500 × $0.0024 | **~$10.80** |

**Mux target-production estimate: ~$2-15/month.** This is a materially smaller number than the video pipeline's design constraints (10-video cap, no-payment-method posture) would suggest — the cap is a hard *usability* wall, not primarily a cost one. Once Mux requires a payment method on file (any usage past the free 10 videos / 100K minutes), Mux's own "Starter" plan structure ($10 buys $100 of usage/month, then pay-as-you-go, no platform fee or minimum) applies — so there's no forced jump to a large monthly minimum. Source: [Mux Starter Plan announcement](https://www.mux.com/blog/starter-plan-a-new-way-to-play-and-pay-for-video), corroborated via 2026 search results.

### 3.4 Cloud Storage (non-video assets)

SCORM packages, quiz-bank content, course images — video itself lives on Mux, not GCS, per the video-hosting design.

- Standard storage: ~$0.020/GB-month (US regions; single-region us-east4 pricing wasn't independently confirmable via direct fetch — treat as approximate, ±10%)
- Class A operations (writes/lists): ~$0.05/10,000 ops; Class B (reads): ~$0.004/10,000 ops (standard published GCS rates, not independently re-verified this pass)
- Egress to internet: ~$0.12/GB (matches Cloud SQL's N. America egress rate above)

Source: search-corroborated figures from multiple 2026 GCS pricing summaries; direct fetch of `cloud.google.com/storage/pricing` returned only client-side-rendered content. At the assumed 50-100GB of non-video content: **~$1-2/month storage** + trivial operations/egress at this scale. **Cloud Storage estimate: ~$2-10/month.**

### 3.5 Metrics pipeline — Pub/Sub, BigQuery, and *not* Dataflow

The architecture doc's stack table specifies **App events → Pub/Sub → Dataflow → BigQuery**. This is worth flagging directly: **a naive reading of "Dataflow" here is the single most expensive line item in this whole estimate if built as originally sketched**, and there's a cheaper path that fits this project's actual needs.

- **Pub/Sub:** $40/TiB after the first 10 GiB/month free (throughput pricing); message storage $0.10-0.21/GiB-month after 24hrs free. Source: [Pub/Sub pricing](https://cloud.google.com/pubsub/pricing), corroborated via search 2026-09-03. At this doc's assumed event volume (tens of thousands of small JSON events/month, well under 10 GiB) — **effectively $0/month**.
- **Dataflow**, if stood up as a continuously-running streaming job (required for real-time Pub/Sub→BigQuery with a persistent worker): $0.056-0.069/vCPU-hour, plus memory/shuffle charges. Even a minimal single n1-standard-4 worker running 24/7 is **~$0.20/hour × 730 hours ≈ $146/month** — for a data volume this small, that's compute spent almost entirely on keeping a worker alive, not on doing work. Source: [Dataflow pricing summaries, 2026](https://www.integrate.io/blog/google-dataflow-pricing/), [nOps Dataflow cost guide](https://www.nops.io/blog/google-cloud-dataflow-cost-optimization-guide/).
- **Recommended alternative — Pub/Sub BigQuery subscriptions:** GCP now supports piping a Pub/Sub subscription directly into a BigQuery table with no Dataflow job in between, for use cases (like this one) that don't need windowing/aggregation before landing in BigQuery — exactly the "operational vs. analytical split, reporting queries never hit the operational DB directly" shape the architecture doc already wants. Billed as Pub/Sub subscribe throughput: **$50/TiB, no separate Dataflow compute charge** — at this app's event volume, **effectively $0-1/month**. Source: [BigQuery subscriptions | Pub/Sub docs](https://docs.cloud.google.com/pubsub/docs/bigquery), [Pub/Sub direct-to-BigQuery launch blog](https://cloud.google.com/blog/products/data-analytics/pub-sub-launches-direct-path-to-bigquery-for-streaming-analytics).

**This is a real recommendation, not just a pricing note:** unless the reporting pipeline needs in-flight transformation/aggregation beyond what BigQuery views/scheduled queries can do, skip Dataflow and use a BigQuery subscription. That turns a potential ~$150/month line item into ~$1/month. Worth confirming with whoever owns the metrics-pipeline sub-project design before it gets built the "Dataflow" way by default.

- **BigQuery:** on-demand queries $6.25/TiB scanned (first 1 TiB/month free); storage $0.02/GB-month active (logical bytes, default billing model), $0.01/GB-month long-term (unmodified 90+ days), first 10GB/month free. Source: search-corroborated 2026 figures, [BigQuery pricing](https://cloud.google.com/bigquery/pricing). At 400-user reporting scale (department rollups, completion metrics — not large fact tables), storage and query volume both plausibly stay **within the free tier: $0-5/month**.

**Metrics pipeline estimate (Pub/Sub + BigQuery subscription, no Dataflow): ~$1-10/month.**

### 3.6 Looker Studio

Free tier connects natively to BigQuery with no per-seat cost; Looker Studio **Pro** ($9/user/month, billed per Google Cloud project) only adds team workspaces, folder-level permissions, and SSO/IAM governance — none of which a single embedded admin-reporting dashboard obviously needs at 400 users. Source: 2026 search-corroborated pricing summaries (official pricing page not directly fetchable). **Looker Studio estimate: $0/month**, with Pro ($9/user/mo) as an optional upgrade if multi-team dashboard governance becomes a real need later.

### 3.7 Cloud Build & Artifact Registry (CI/CD)

- **Cloud Build:** 2,500 free build-minutes/month on `e2-standard-2`; `e2-highcpu-8` runs $0.0156/min beyond free tier. Source: search-corroborated 2026 figures, [Cloud Build pricing](https://cloud.google.com/build/pricing). A small team's CI/CD (a handful of deploys/day) comfortably fits the free allotment. **Estimate: $0/month.**
- **Artifact Registry:** first 0.5GB/month free, then $0.10/GB-month; egress billed separately by destination. Source: search-corroborated 2026 figures, [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing). A handful of Next.js container image versions (with a reasonable image-retention/cleanup policy) stays small. **Estimate: $0-2/month.**

### 3.8 Auth — Microsoft Entra ID

Confirmed via Microsoft's own docs (not assumed): **individual user-to-app-role assignment is a Free-tier-compatible feature** — this is already how the app authenticates in production today (README: "sign-in required, access via Entra ID App Roles assignment," live since 2026-08-27), so this is empirically proven at $0 incremental licensing cost, not just a pricing-page claim. **Group-based assignment** (assigning a security group to the app rather than 400 individuals one at a time — the realistic way to manage this at 400-user scale) **requires Microsoft Entra ID P1 or P2** per Microsoft's own docs. Source: [Manage users and groups assignment to an application](https://learn.microsoft.com/entra/identity/enterprise-apps/assign-user-or-group-access-portal), fetched via Microsoft Learn MCP, 2026-09-03.

P1 list price is ~$6/user/month if purchased standalone — at 400 users that would be ~$2,400/month, which would dwarf every other line item in this doc. **But** SSP is "already M365-licensed" per this project's stated context, and Microsoft 365 E3/E5 and Business Premium subscriptions **already bundle Entra ID P1 (E3/Business Premium) or P2 (E5) rights** for licensed users — meaning if SSP's employees are already on one of those M365 SKUs, group-based assignment costs **$0 incremental**, not $2,400/month. **This doc cannot confirm SSP's exact M365 SKU tier** — that's a one-question confirmation with IT (the same team that owns the outstanding Entra app-registration approval per the architecture doc's open questions), not a research gap this doc can close independently. **Recommendation: confirm the M365 SKU before assuming either $0 or $2,400/month here — the two most likely real answers are "already covered" (near-certain if standard business/enterprise M365 tiers are in use) or "small per-user add-on already budgeted elsewhere."**

## 4. Target production — total

| Line item | Low | High |
|---|---|---|
| Cloud SQL (`db-custom-1-3840`, no HA) | $55 | $70 |
| Hosting — Cloud Run scale-to-zero *or* Vercel Pro (pick one; not additive) | $5 | $40 |
| Mux (video, 50-300 stored videos) | $2 | $15 |
| Cloud Storage (non-video assets) | $2 | $10 |
| Pub/Sub + BigQuery (subscription path, not Dataflow) | $1 | $10 |
| Looker Studio | $0 | $0 |
| Cloud Build + Artifact Registry | $0 | $2 |
| Entra ID | $0 | $0* |
| **Total** | **~$65** | **~$150** |

\* Assumes group-based app assignment is covered by SSP's existing M365 licensing tier — confirm with IT. If not, this line item dominates the whole estimate (see §3.8) and needs its own separate approval conversation, not folded into "cloud infra budget."

**Upper-bound stress case** (`db-custom-2-8192` instead of `-1-3840`, always-warm Cloud Run instead of scale-to-zero, 300-video library): **~$180-250/month.**

**Headline range for budget conversations: ~$65-250/month**, with **~$90-150/month** as the realistic center once a specific Cloud SQL size and hosting choice are picked. This is deliberately a range, not a single number — the two biggest swing factors are (1) Cloud SQL instance size/HA, entirely Ian's call based on real load once it exists, and (2) whether the metrics pipeline gets built with or without Dataflow (§3.5), which is a ~$150/month swing on its own.

## 5. What's genuinely hard to pin down

Stated explicitly per this doc's own ground rules, not glossed over:

- **Cloud SQL exact rates for `us-east4` specifically** — Google's pricing page renders client-side and wasn't directly scrapable this pass; the $0.0413/vCPU-hr, $0.0070/GB-hr figures are corroborated `us-central1` numbers from two independent 2026 sources, not a first-party `us-east4` quote. Cloud SQL pricing is generally uniform or very close across mainland-US regions, but this should be re-verified against the live calculator before finalizing budget.
- **Cross-service network egress** (Cloud SQL ↔ Cloud Run/Vercel, Cloud Storage ↔ app, Pub/Sub ↔ BigQuery) — all individually cheap at this app's payload sizes (small JSON/API traffic, not bulk data transfer), but genuinely hard to pin to a single number without real traffic data. Budgeted loosely inside each line item's range above rather than as its own line.
- **GCS exact `us-east4` per-GB rate** — same client-side-rendering issue as Cloud SQL; used a cross-region-consistent ~$0.020/GB-month figure rather than a region-specific quote.
- **Video watch-time assumption (§1)** — genuinely invented, not measured, because no video pipeline exists yet. Flagged as an assumption, not presented as data.

## 6. Reconciliation with existing estimates in this repo/vault

- **README.md's "Estimated Running Cost (Production)"** currently reads "~$120-160/month at a 100-300 user rollout with a heavy (300+ video) library." That number matches almost exactly the *Cloud SQL-only* line item in this doc (§3.1) — it reads like the original Cloud SQL estimate got carried forward as if it were the whole-stack total. This doc's whole-stack range (~$65-250/mo, center ~$90-150/mo) is a materially different (larger, more complete) number. Worth a README update, though that's out of this doc's scope — flagging it here so it doesn't get missed.
- **`Database Design.md` §7 ("Production Cloud SQL hardening")** in Ian's Obsidian vault has a dated correction note added alongside its existing 2026-08-31 estimate — see the vault update accompanying this doc.

## 7. Sources

- [Cloud SQL pricing](https://cloud.google.com/sql/pricing) (official page, not directly scrapable) — corroborated via [Usage.ai Cloud SQL Pricing 2026](https://www.usage.ai/blogs/gcp/cloud-sql/pricing/) and [Security Boulevard Cloud SQL Pricing 2026](https://securityboulevard.com/2026/05/google-cloud-sql-pricing-2026-instance-costs-storage-and-what-the-calculator-hides/), both fetched 2026-09-03
- [Cloud Run pricing](https://cloud.google.com/run/pricing), corroborated via [Cloudchipr Cloud Run Pricing 2026](https://cloudchipr.com/blog/cloud-run-pricing), fetched 2026-09-03
- [Cloud Run locations (Tier 1 region list)](https://docs.cloud.google.com/run/docs/locations), 2026-09-03
- [Vercel Pricing](https://vercel.com/pricing), fetched 2026-09-03
- [Mux Pricing](https://www.mux.com/pricing), fetched 2026-09-03
- [Mux Starter Plan](https://www.mux.com/blog/starter-plan-a-new-way-to-play-and-pay-for-video), 2026
- [Google Cloud Storage pricing](https://cloud.google.com/storage/pricing) (official page, not directly scrapable) — figures search-corroborated, 2026-09-03
- [Pub/Sub pricing](https://cloud.google.com/pubsub/pricing), search-corroborated, 2026-09-03
- [BigQuery subscriptions (Pub/Sub docs)](https://docs.cloud.google.com/pubsub/docs/bigquery), 2026-09-03
- [Pub/Sub direct-to-BigQuery launch](https://cloud.google.com/blog/products/data-analytics/pub-sub-launches-direct-path-to-bigquery-for-streaming-analytics)
- [Dataflow pricing](https://cloud.google.com/dataflow/pricing) — figures search-corroborated via [Integrate.io Dataflow Pricing 2026](https://www.integrate.io/blog/google-dataflow-pricing/) and [nOps Dataflow Cost Guide](https://www.nops.io/blog/google-cloud-dataflow-cost-optimization-guide/), 2026-09-03
- [BigQuery pricing](https://cloud.google.com/bigquery/pricing), search-corroborated, 2026-09-03
- [Cloud Build pricing](https://cloud.google.com/build/pricing), search-corroborated, 2026-09-03
- [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing), search-corroborated, 2026-09-03
- [Supabase Pricing](https://supabase.com/pricing), fetched 2026-09-03
- [Microsoft Entra ID: Manage users and groups assignment to an application](https://learn.microsoft.com/entra/identity/enterprise-apps/assign-user-or-group-access-portal), via Microsoft Learn MCP, 2026-09-03
- [Microsoft Entra licensing](https://learn.microsoft.com/entra/fundamentals/licensing), via Microsoft Learn MCP, 2026-09-03
- This repo: `README.md` (live deployment details, existing cost estimate), `docs/superpowers/specs/2026-08-24-ssp-lms-architecture-design.md` (target stack), `docs/superpowers/specs/2026-09-03-video-hosting-mux-design.md` (Mux integration constraints)
