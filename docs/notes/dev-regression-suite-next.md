# Dev e2e regression suite: Phase 2 (exhaustive coverage)

Continuation brief for a FRESH session. Phase 1 (harness + 24 verified tests +
workflow scaffold + delivery note) shipped on branch `feat/dev-regression-suite`
(pushed). This file is the plan for the exhaustive sweep the user asked for:
**every feature incl. AI import, edge cases, happy paths, security/threats, rate
limiting, AI cost calculation.** Read this + `docs/notes/dev-regression-suite.md`
+ `src/client/e2e-dev/README.md`; that is enough to start cold.

## The one hard constraint

Headed verification against live dev must run **serially through the main loop**:
Cloudflare needs headed real Chrome, and dev GoTrue rate-limits auth per IP, so
parallel agents cannot run these tests. Use a workflow for **parallel grounded
discovery + design + drafting** (agents READ real component templates/RPCs and
return draft spec code + harness extensions); then the main loop builds the
harness extensions and verifies each batch **headed** with `./e2e-dev/run.sh`.

## Harness recap (so drafts fit)

`src/client/e2e-dev/`: `createScratchWorld({roles})` (pooler-only, no service-role/
JWT secret), fixtures `world`/`pageAs(role)`/`gotoSettled`, exports `openAs`/
`settle`/`apiAs(world,role)` (role-bearer supabase client)/`userFor`,
`test.use({worldRoles:[...]})` (default `['owner']`), `seedBasics(world)`. Routes
`/t/:tenantId/s/:spaceId/...`. No data-testid: selectors come from real aria-label/
role/text in the templates. GoTrue rate-limits per IP -> request only needed roles.

## Recommended first step: run the discovery+draft workflow

Launch a workflow with ~8 parallel READ-ONLY agents (no file writes; return draft
spec code + harness extensions via structured output). One agent per area below.
Prime each agent with the harness recap + "DO NOT write files/run tests/git;
ground every selector in real templates (cite path:line)."

### Areas (one agent each)

1. **ai-import** — features/source-import/** + `commit_source_import` + dedup +
   `ai_config` gating. Find how to enable AI on a scratch tenant via the pooler
   (ai_config table/column or RPC) -> harness `enableAi(world)`. Tests: NCT happy
   path resolve->review->commit->entities+events; dedup re-import; FROM TEXT/URL.
2. **ai-cost** — where AI cost/tokens are computed/stored (`ai_calls` cost columns,
   worker formula, `/super-admin/ai-usage` + its RPC). Assert a call records cost
   and the console aggregates it. Needs super-admin host access (see area 6).
3. **edge-adversarial** — the QA-008 set in `event-model-qa-dev-issues.md`
   (inverted range, empty/6000-char title, far dates, XSS title rendered ESCAPED)
   via `apiAs(...).rpc(...)` and the UI form; assert blocked-with-code or
   accepted-but-safe; XSS must not execute.
4. **security-threats** — cross-space IDOR (two worlds; A's user -> B's space URL
   -> denied), tampered/expired `sb-auth-dev` cookie -> /login, viewer deep-links
   to every owner/editor-only route -> redirect+toast. Note what `integration/`
   already covers at the DB layer (don't duplicate); browser-only gaps here.
5. **rate-limiting** — find any APP-level limits (AI/import quotas, worker
   throttles; grep rate/limit/quota/throttle in src/client + worker/). Assert what's
   assertable; document the GoTrue per-IP auth limit + mitigation. If none, say so.
6. **admin-portals** — agency portal (/admin/*) on the agency host
   `pwreg-ag-<id>.dev.clintapp.com`, super-admin (/super-admin/*) via host or the
   `?wl_kind=super-admin` / `?wl_kind=agency&wl_id=` dev override; audit logs
   (space/tenant/agency, regression guard QA-009 ACTOR "--"). Harness:
   `agencyPageAs`/`superAdminPageAs` helpers + agency_members rows.
7. **entity-writes** — asset + trial CRUD (incl. ct.gov-lock read-only fields,
   Trial Start/End), event merged-form create/edit/re-anchor/re-type (TP-009,
   QA-004). Ground selectors in features/manage/** + the event form dialog.
8. **intelligence-authoring** — author/publish a brief, citation resolves to the
   anchored entity (matrix row 6), drafts/published filters, history. Seed the
   cited event via seedBasics/apiAs.

### Then (main loop, serial)

For each area: build the harness extension -> drop in the draft spec -> run
`./e2e-dev/run.sh e2e-dev/tests/<area>.spec.ts` headed -> fix selectors -> green.
Provision AI-enabled tenants + admin hosts as those extensions land. Keep the
coverage matrix in `dev-regression-suite.md` updated (verified vs scaffold). Sweep
`pwreg-%` stragglers if a run fails mid-flight. Log (don't fix) any product bugs found.
