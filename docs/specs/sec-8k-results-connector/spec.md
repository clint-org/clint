---
id: spec-2026-010
title: SEC 8-K trial-results connector
slug: sec-8k-results-connector
status: draft
created: 2026-06-07
updated: 2026-06-07
---

# SEC 8-K trial-results connector

## Goal

Discover SEC 8-K filings that report clinical-trial results for the companies tracked in a
space, extract the readout (which asset/trial, phase, indication, endpoint met or missed,
topline summary), match it to an existing trial, and surface it as a data marker
(Topline / Interim / Full Data) on the existing timeline after analyst review. This is the
single biggest signal gap in the graph today: CT.gov tells you a trial **completed**, but
not whether it **worked**. 8-K (via the attached press release) carries the result.

Built as the first instance of a reusable **source-connector framework**, so the next
source (deals, catalysts/PDUFA, openFDA approvals) is a variation, not a rebuild. Context:
`docs/notes/ai-and-data-expansion-thread.md` (this supersedes the earlier openFDA-first
plan; see "8-K vs FDA" in that doc).

## Scope

In v1:
- A daily Cloudflare Worker cron that, per space, discovers candidate 8-Ks for the space's
  tracked companies via EDGAR full-text search scoped to the company's CIK plus clinical
  keywords (to keep LLM spend proportional to likely-results, not all filings).
- Resolve and cache each company's SEC **CIK** (from the public ticker/CIK map); companies
  with no CIK (private, foreign filers) are skipped and reported in the sync run.
- Idempotent filing cache with a per-company watermark so re-runs do not re-extract.
- One **LLM extraction pass per candidate** (reusing the source-extract muscle and the
  `ai_calls` spine: open / preflight / close, cost-capped, rate-limited): detect whether the
  filing reports a trial result and, if so, extract asset, trial/NCT, phase, indication,
  outcome (met / missed / mixed / unclear), readout kind (topline / interim / full), a short
  summary, and a confidence.
- Match to an existing trial. **Primary key: the NCT id** in the press release, matched
  exactly to `trials.identifier`. Fallback: Jaro-Winkler on asset/brand name plus an
  AI-proposed anchor with a rationale.
- An analyst **review step** before anything enters the graph. The cron stages proposals; it
  never auto-commits.
- On confirm: create a data marker via the shared `create_marker` RPC (Topline / Interim /
  Full Data type by readout kind), anchored to the matched trial, with the outcome in the
  marker title/description and `metadata.outcome`, and `source_documents` provenance of a
  new `sec` source kind (url = the SEC filing).

Out of scope (deferred):
- 8-K **deals** (licensing / M&A) and **catalysts** (PDUFA / AdComm dates). High value, next
  connectors on the same framework.
- openFDA approvals (the earlier plan; deprioritized as lagging/low-marginal).
- A dedicated negative-result marker visual (outcome is captured in metadata for now).
- Private / foreign companies (no CIK; out of reach for 8-K by nature).
- Auto-commit (chosen: review-first).

## Architecture

```
Daily cron (wrangler triggers)
  -> worker scheduled() handler (src/client/worker/index.ts)
    -> for each space:
       get_space_sec_targets(space)                 # companies + resolved CIKs + tracked NCTs
       EDGAR full-text search per CIK + keywords    # sec-client.ts  (candidate 8-Ks)
       upsert_sec_filings(...)                       # idempotent cache + watermark
       for each NEW candidate filing:
         ai_call_preflight -> extract result (LLM)   # extractor.ts -> ai_call_open/close
         match to trial (NCT exact -> fuzzy/AI)
         stage_sec_result_proposal(...)              # status='pending'
       record_sec_sync_run(...)                      # audit
  =>  sec_filings (cache) + sec_result_proposals (pending)

Analyst review (frontend)
  get_pending_sec_results(space)                     # list w/ filing link, outcome, anchor, confidence, rationale
  -> confirm / adjust trial anchor / reject
  -> commit_sec_results(...)                         # create_marker (data) + source_documents(kind 'sec')

Timeline
  data markers render automatically via get_dashboard_data (no new timeline work)
```

This connector is LLM-based (unlike a deterministic openFDA pull), so it rides the existing
AI spine for extraction and the CT.gov worker-secret/sync-run shape for the deterministic
discovery + staging. SEC requires a descriptive `User-Agent`; the client respects EDGAR
rate limits (~10 req/s).

## Database

New objects (RLS-scoped to space access; worker RPCs SECURITY DEFINER, gated by reusing
`extract_source_worker_secret` since this is part of the AI-extraction trust domain):

- `companies.sec_cik` text (nullable) and `companies.sec_ticker` text (nullable), resolved
  and cached by the connector.
- `sec_filings` -- cache of discovered filings. Columns: `id`, `space_id`, `company_id`,
  `cik`, `accession_number`, `form_type`, `item_codes` text[], `filed_date`, `primary_url`,
  `title`, `fetch_outcome`, `extract_outcome`, `created_at`. Unique on
  `(space_id, accession_number)` for idempotent re-sync.
- `sec_result_proposals` -- staged readouts for review. Columns: `id`, `space_id`,
  `filing_id` FK, `nct_id` (extracted), `proposed_asset_id`, `proposed_trial_id` (anchor),
  `phase`, `indication`, `outcome` (`met`/`missed`/`mixed`/`unclear`), `readout_kind`
  (`topline`/`interim`/`full`), `summary`, `match_source` (`nct`/`fuzzy`/`ai`), `confidence`
  numeric, `ai_rationale` text, `status` (`pending`/`confirmed`/`rejected`), `source_doc_id`
  (set on commit), `reviewed_by`, `reviewed_at`, `created_at`.
- `sec_sync_runs` -- audit, mirrors `ctgov_sync_runs` (started_at, finished_at, spaces,
  filings_seen, candidates_extracted, proposals_staged, skipped_no_cik, errors jsonb).
- `source_kind` CHECK on `source_documents` extended to include `'sec'`.

New RPCs:
- `get_space_sec_targets(p_secret, p_space_id)` -- companies with cik/ticker + the space's
  tracked NCT identifiers (for match hints). Worker-gated.
- `upsert_sec_filings(p_secret, p_space_id, p_filings jsonb)` -- idempotent cache upsert +
  returns which are new. Worker-gated.
- `stage_sec_result_proposal(p_secret, p_space_id, p_proposal jsonb)` -- insert a pending
  proposal with the matched anchor. Worker-gated.
- `record_sec_sync_run(p_secret, ...)` -- worker-gated audit write.
- `set_company_sec_identity(p_secret, p_company_id, p_cik, p_ticker)` -- cache resolved CIK.
  Worker-gated.
- `get_pending_sec_results(p_space_id)` -- review list (proposal + filing + candidate trials
  + outcome + confidence + rationale). RLS by space access.
- `commit_sec_results(p_space_id, p_confirmations jsonb)` -- for each confirmed proposal:
  insert `source_documents` (kind `sec`, url = filing), call shared `create_marker`
  (data type by readout kind, `projection='actual'`, `p_source_doc_id`, anchored trial),
  set `source_doc_id`, mark `confirmed`. Delegates to `create_marker` (never inline inserts).
  RLS: owner/editor.

End every migration that changes an RPC signature with `notify pgrst, 'reload schema'`.

## Worker

New module `src/client/worker/sec-sync/` (peer of `ctgov-sync/` and `source-extract/`):
- `sec-client.ts` -- EDGAR client: CIK resolution from the public ticker map, full-text
  search (`efts.sec.gov`) by CIK + clinical keywords + `forms=8-K`, filing index + primary
  doc / EX-99.1 exhibit fetch. Required `User-Agent`, rate-limit aware.
- `types.ts` -- filing + extracted-result types.
- `extractor.ts` (+ `extractor.spec.ts`) -- prompt + response validation for the result
  extraction; wrapped in `ai_call_open` / `ai_call_preflight` / `ai_call_close`
  (feature `sec_result_extract`). Reuses `source-extract` prompt/validator patterns.
- `match.ts` (+ `match.spec.ts`) -- NCT-exact match first, then Jaro-Winkler fallback,
  surfacing the AI-proposed anchor.
- `poller.ts` -- per-space orchestration called from `scheduled()`.

Wiring:
- `wrangler.jsonc` -- add a SEC cron (e.g. `0 9 * * *`); dev crons stay disabled.
- `src/client/worker/index.ts` -- branch in `scheduled()` on `event.cron`; add a manual
  `POST /api/sec/sync` endpoint (JWT + space-access gated) for on-demand runs and testing.

## Frontend

- **Pending SEC results review** -- new feature folder
  `src/client/src/app/features/sec-results/`: a review component listing staged readouts with
  the filing link, the extracted outcome (met/missed badge), the matched trial anchor,
  confidence, and AI rationale; analyst can adjust the trial anchor (search trials by NCT or
  name), confirm, or reject. Service wraps `get_pending_sec_results` / `commit_sec_results`.
  Lazy route + guard. Reuses source-import review patterns and the empty/loading/error
  conventions (CLAUDE.md section 13).
- **Entry affordance** -- a count badge/link ("N trial readouts to review") routing into the
  review surface. On confirm, markers render on the existing timeline automatically; no new
  timeline work.

All Angular work follows `src/client/CLAUDE.md` (standalone, OnPush, signals, `inject()`,
native control flow, PrimeNG, `bg-brand-*`, a11y/AXE).

## Routing

- `t/:tenantId/s/:spaceId/sec-results` -> pending SEC results review (lazy, space-access guard).

## Migration plan

### Implementation order

```yaml
tasks:
  - id: T0
    title: "DB: add 'sec' to source_kind CHECK; companies.sec_cik + sec_ticker columns"
    domain: database
    depends_on: []
    files:
      - supabase/migrations/20260607140000_sec_source_kind_and_company_cik.sql (create)
    verification: "supabase db reset && supabase db advisors --local --type all"

  - id: T1
    title: "DB: sec_filings, sec_result_proposals, sec_sync_runs tables + RLS + indexes"
    domain: database
    depends_on: [T0]
    files:
      - supabase/migrations/20260607140100_sec_tables.sql (create)
    verification: "supabase db reset && supabase db advisors --local --type all"

  - id: T2
    title: "DB: worker RPCs get_space_sec_targets, upsert_sec_filings, stage_sec_result_proposal, set_company_sec_identity, record_sec_sync_run"
    domain: database
    depends_on: [T1]
    files:
      - supabase/migrations/20260607140200_sec_worker_rpcs.sql (create)
    verification: "supabase db reset && supabase db advisors --local --type all"

  - id: T3
    title: "DB: review RPCs get_pending_sec_results + commit_sec_results (delegates to create_marker)"
    domain: database
    depends_on: [T2]
    files:
      - supabase/migrations/20260607140300_sec_review_rpcs.sql (create)
    verification: "supabase db reset && supabase db advisors --local --type all"

  - id: T4
    title: "Worker: EDGAR client (CIK resolve, FTS search, filing/exhibit fetch) + types (+ unit spec)"
    domain: worker
    depends_on: []
    files:
      - src/client/worker/sec-sync/sec-client.ts (create)
      - src/client/worker/sec-sync/types.ts (create)
      - src/client/worker/sec-sync/sec-client.spec.ts (create)
    verification: "cd src/client && npx tsc --noEmit && npm run test:units -- worker/sec-sync/sec-client"

  - id: T5
    title: "Worker: result extractor via ai_call_* (prompt + validator) (+ unit spec)"
    domain: worker
    depends_on: [T4]
    files:
      - src/client/worker/sec-sync/extractor.ts (create)
      - src/client/worker/sec-sync/extractor.spec.ts (create)
    verification: "cd src/client && npx tsc --noEmit && npm run test:units -- worker/sec-sync/extractor"

  - id: T6
    title: "Worker: NCT-exact + fuzzy/AI trial matcher (+ unit spec)"
    domain: worker
    depends_on: [T4]
    files:
      - src/client/worker/sec-sync/match.ts (create)
      - src/client/worker/sec-sync/match.spec.ts (create)
    verification: "cd src/client && npx tsc --noEmit && npm run test:units -- worker/sec-sync/match"

  - id: T7
    title: "Worker: per-space poller + scheduled() branch + POST /api/sec/sync + wrangler cron"
    domain: worker
    depends_on: [T2, T5, T6]
    files:
      - src/client/worker/sec-sync/poller.ts (create)
      - src/client/worker/index.ts (modify)
      - src/client/wrangler.jsonc (modify)
    verification: "cd src/client && npx tsc --noEmit"

  - id: T8
    title: "Frontend: pending SEC results review feature (component, service, route, guard) (+ spec)"
    domain: frontend
    depends_on: [T3]
    files:
      - src/client/src/app/features/sec-results/sec-results-review.component.ts (create)
      - src/client/src/app/features/sec-results/sec-results-review.component.html (create)
      - src/client/src/app/features/sec-results/sec-results.service.ts (create)
      - src/client/src/app/features/sec-results/sec-results-review.component.spec.ts (create)
      - src/client/src/app/app.routes.ts (modify)
    verification: "cd src/client && ng lint && ng build"

  - id: T9
    title: "Frontend: 'N trial readouts to review' entry affordance + empty/loading/error states"
    domain: frontend
    depends_on: [T8]
    files:
      - src/client/src/app/features/sec-results/sec-results.service.ts (modify)
      - src/client/src/app/features/sec-results/sec-results-review.component.html (modify)
    verification: "cd src/client && ng lint && ng build"

  - id: T10
    title: "Docs: regen architecture + update the data-expansion thread doc"
    domain: docs
    depends_on: [T3, T8]
    files:
      - docs/notes/ai-and-data-expansion-thread.md (modify)
    verification: "cd src/client && npm run docs:arch"
```

## Test plan

1. **EDGAR client unit (T4):** CIK resolution maps a known ticker/name; FTS query builds the
   correct CIK + keyword + `forms=8-K` URL; exhibit fetch extracts EX-99.1 text from a
   fixture index.
2. **Extractor unit (T5):** a results press-release fixture yields outcome + phase +
   readout kind + NCT; a non-results 8-K (e.g. an officer change) yields "no result"; the
   `ai_calls` row is opened and closed; over-cap preflight short-circuits without an LLM call.
3. **Matcher unit (T6):** an extracted NCT matching `trials.identifier` returns an exact
   anchor (`match_source='nct'`); with no NCT, falls back to fuzzy/AI with a confidence.
4. **Idempotency (integration):** running the poller twice over the same filings caches once
   and stages no duplicate proposals.
5. **Review + commit (integration):** confirming a staged readout creates exactly one data
   marker of the right type anchored to the matched trial, with a `source_documents` row of
   kind `sec` and `metadata.outcome` set; re-confirm is a no-op; reject leaves no marker.
6. **RLS / secret:** a user without space access cannot read pending proposals or commit;
   worker RPCs reject a bad `extract_source_worker_secret`.
7. **Frontend:** review page renders staged readouts with outcome badge, confidence, and
   rationale; confirm commits and removes them; markers appear on the timeline; empty state
   reads correctly; `ng lint && ng build` clean; AXE passes.
8. **Advisors:** `supabase db advisors --local --type all` clean at warn level.

## Branch

`spec/sec-8k-results-connector`. Medium diff: ~4 migrations, one worker module (~8 files),
one frontend feature (~5 files). Smaller frontend than the openFDA plan (no track-record
section; results land on the existing timeline).

## Open questions

- CIK resolution: auto-resolve from the public ticker/CIK map by name/ticker (assumed), with
  a manual override later for ambiguous names. Private/foreign companies have no CIK and are
  skipped (reported in the sync run).
- Candidate discovery via EDGAR full-text search with clinical keywords to bound LLM cost
  (assumed), vs pulling every 8-K and classifying. Keyword list is tunable.
- Reuse `extract_source_worker_secret` for the connector's worker RPCs (assumed, same AI-
  extraction trust domain) vs a dedicated `sec_worker_secret`.
- Separate SEC cron (`0 9 * * *`) vs sharing the CT.gov fire (assumed separate).
- Whether to add a negative-result marker visual now vs capturing outcome in metadata only
  (assumed metadata-only for v1).
