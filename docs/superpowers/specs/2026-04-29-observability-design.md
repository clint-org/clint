# Observability Design (DRAFT — BRAINSTORM IN PROGRESS)

**Status:** Incomplete. This document captures decisions reached so far in the brainstorming session of 2026-04-29 and the questions that still need answers before this becomes a buildable spec.

**Do not implement from this document.** It is a checkpoint, not a finished design.

---

## Goal

Establish observability for Clint (logs, crash reports, errors, infrastructure visibility) ahead of onboarding paying pharma customers. Build it right, on a generous free-tier footing, with a clear upgrade path when usage justifies paid tiers.

## Scope (current pass)

In scope:
- Frontend uncaught exceptions, RxJS errors, performance traces, release tracking
- Edge function (`send-invite-email`) errors and structured logs
- Structured app logs from frontend (auth flow, RPC failures, tenant context, business events)
- Visibility into Supabase backend (Postgres, Auth, RLS denials) via native UI initially
- Visibility into Cloudflare static asset delivery via native UI initially

Out of scope (deliberately deferred):
- Product analytics / funnels / feature flags (PostHog or similar) — postponed to a later spec
- Session replay (PostHog replay or Microsoft Clarity) — explicitly skipped for now
- Heatmaps and rage/dead-click telemetry — explicitly skipped for now
- Self-hosted observability stack (Grafana / Loki / Tempo) — not a fit at current scale
- Native OpenTelemetry wire format — left as a future migration, not day-one requirement

## Decisions locked in

| Decision | Choice | Reasoning |
|---|---|---|
| **Forcing function** | Preparing for paying pharma customers (no active fire) | User answered B + C; build-it-right pace, weeks of work budget |
| **Cost posture** | Free-tier first; paid upgrade only when usage justifies it | User flagged Microsoft Clarity and PostHog free tiers; gut is minimum-spend |
| **Behavioral capture** | None for now (no replay, no heatmaps) | User narrowed scope after seeing the tool overlap matrix |
| **OTel posture** | Compatible later, not native today; use vendor SDKs now | User answered B; OTel migration is a future move when an enterprise customer asks |
| **EU data residency** | Not required day one, but vendor must support EU region migration later | Pharma procurement will eventually ask |
| **Microsoft Clarity** | Excluded from the stack | Microsoft trains models on session data by default — incompatible with pharma data posture |

## Recommended stack (proposed, not yet approved)

**Sentry** for errors and performance + **Axiom** for structured app logs. Native UIs for Supabase and Cloudflare infra logs until volume justifies a logs drain.

| Signal | Destination | How |
|---|---|---|
| Frontend uncaught exceptions, RxJS errors, perf traces, releases | Sentry | `@sentry/angular` SDK + global `ErrorHandler` |
| Edge function errors (`send-invite-email`) | Sentry | `@sentry/deno` |
| Structured app logs (auth, RPC failures, tenant context, business events) | Axiom | thin `LoggerService` on frontend, parallel logger in edge functions; both POST JSON via Axiom HTTP API |
| Supabase Postgres / Auth / RLS denials | Supabase Logs UI initially; Logs Drain → Axiom when on Team plan | native dashboard for now |
| Cloudflare static asset 4xx/5xx | Cloudflare native logs UI initially; Logpush → Axiom later | native for now |

**Cost at start:** $0. Sentry free tier = 5K errors/mo. Axiom free tier = 500MB/day ingest + 30-day retention.

**Why not the alternatives considered:**
- *Sentry-only* (use `Sentry.captureMessage` for everything): Sentry is not a log aggregator. Structured logs would consume the error quota and search poorly past ~50/day.
- *Sentry + Better Stack*: bundles uptime + status page on free tier, but only 3-day log retention. 30 days beats 3 in any compliance conversation.

## Open questions (still to resolve)

These must be answered before the design is buildable. They are in roughly the order they should be tackled.

1. **Approval of Sentry + Axiom as the chosen stack** — user has not yet confirmed.
2. **Tenant attribution model.** Which fields are attached to every event/log? Candidate set: `tenant_id`, `space_id`, `user_id`, `agency_id`, `brand_kind`, `host`, `release_sha`. How are these surfaced from `BrandContextService` and Supabase auth into the logging context?
3. **PII redaction policy.** What is allowed in error/log payloads given pharma sensitivity? Specifically: user emails, tenant names, drug/asset names, internal pipeline data, free-text notes. Where does redaction happen (client-side `beforeSend` hook vs explicit logger contract)?
4. **LoggerService API shape.** Frontend logger surface: `log.info()`, `log.warn()`, `log.error()`, `log.event()` for business events? How does it interact with Sentry breadcrumbs vs Axiom events? How does it behave in dev (console only?) vs prod?
5. **Frontend `ErrorHandler` integration.** Replace Angular's default `ErrorHandler` with Sentry's? How are RxJS errors captured (global handler? per-stream `catchError`?). Behavior of unhandled promise rejections.
6. **Source map upload.** How and when do source maps get uploaded to Sentry on Cloudflare deploy? CI step, build hook, or manual?
7. **Edge function instrumentation.** Sentry Deno SDK setup in `supabase/functions/send-invite-email`. Pattern that scales when more functions are added.
8. **Alerting.** Where do alerts go (Slack? email? PagerDuty?). What thresholds (new issue, regression, error spike, performance regression). On-call posture today vs once paying customers exist.
9. **Sampling and rate limits.** Free-tier ceilings (Sentry 5K/mo errors, Axiom 500MB/day). Drop strategy if a runaway loop blows the budget overnight.
10. **Log retention and compliance.** 30 days enough? Do we mirror to S3/R2 for longer-term archive? What's required for SOC 2 / HIPAA discussions later?
11. **Logging conventions.** Standard event names, field naming convention (snake_case vs camelCase), severity levels, structured event taxonomy for business signals.
12. **Cleanup of existing `console.error/warn` calls.** Codebase already has scattered `console.*` usage. Is this a sweep that happens as part of this work, or a follow-up?
13. **Performance budget.** SDK weight on initial bundle. Sentry Angular SDK is non-trivial; is lazy initialization acceptable?
14. **Local dev story.** Should logs ship from `supabase start` / `ng serve`, or only from staging/prod?
15. **Staging vs production environments.** Separate Sentry projects? Separate Axiom datasets? Tagging strategy?

## Conversation history (decisions and why)

- **Q1 — driver?** User chose B + C: preparing for pharma customers, with product analytics as a future need. Errors and crashes are real but no active fire.
- **Q2 — vendor/cost posture?** User flagged Microsoft Clarity (free, unlimited) and PostHog's generous free tier as options to consider. Established the stack should lean free-tier-first.
- **Tool overlap clarification.** Walked through what each tool actually does (Sentry = errors, PostHog = product events, Clarity = qualitative replay/heatmaps, Cloudflare/Supabase = infra). Surfaced the Clarity-vs-PostHog-replay overlap and the Microsoft-trains-on-data caveat.
- **Q3 — behavioral capture?** User narrowed scope: skip session replay; focus on errors + logs + infra.
- **Q4 — OTel posture?** User chose B: OTel-compatible later, vendor SDKs now.
- Recommended Sentry + Axiom; alternatives Sentry-only and Sentry + Better Stack also presented. User has not yet approved.

## Next steps to resume the brainstorm

1. Confirm or revise the recommended stack (Sentry + Axiom).
2. Work through the open-questions list above, one or two at a time, in the order listed.
3. Once all questions are resolved, finalize this document, run the spec self-review, and hand to writing-plans for the implementation plan.
