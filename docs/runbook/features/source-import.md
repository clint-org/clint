---
surface: Source Document Import (AI-Extracted)
spec: docs/superpowers/specs/2026-05-21-source-ingestion-design.md
---

# Source Document Import

Agency analysts import data into an engagement via three modes: paste NCT IDs (CT.gov is the primary data source, AI resolves companies/assets), paste a press release URL, or paste raw text. All three modes live on a full-page import route (`/t/:tenantId/s/:spaceId/import`) with tabbed navigation. Claude Sonnet 4.6 handles entity extraction (URL/text) or entity resolution (NCT). The analyst reviews proposals on a dedicated review page, then confirms atomically. Every confirmed row carries `source_doc_id` provenance and every LLM call writes to `ai_calls` regardless of outcome. New empty spaces auto-redirect editors to the import page.

## Capabilities

```yaml
- id: source-extract-worker
  summary: Cloudflare Worker route that fetches/cleans a source, calls Claude Sonnet 4.6, validates the response, enriches with CT.gov lookups, probes Brandfetch's Logo Link CDN with a 1-byte Range GET per new company to pick the best non-placeholder asset type (symbol > icon > logo by ETag), and returns structured proposals.
  routes: []
  rpcs:
    - ai_call_open
    - ai_call_preflight
    - ai_call_close
    - ai_resolve_model
    - ai_estimate_cost_cents
    - get_space_inventory_snapshot
    - _verify_extract_source_worker_secret
  tables:
    - ai_calls
    - ai_config
    - ai_model_pricing
  related:
    - source-import-commit
  user_facing: false
  role: agency
  status: active

- id: source-import-commit
  summary: Atomic RPC that writes a reviewed source import via shared entity-create RPCs. Records each trial's full asset set in trial_assets (a trial can test multiple assets, e.g. a master-protocol NCT) by calling set_trial_assets when a proposal carries more than one asset ref, back-compatible with the legacy scalar asset_ref. Creates asset_indications for timeline visibility and emits trial_change_events with source=source_import for the activity feed. Post-commit, the review page invalidates all relevant RpcCache tags.
  routes:
    - /t/:tenantId/s/:spaceId/import/:aiCallId/review
  rpcs:
    - commit_source_import
    - create_company
    - create_asset
    - create_trial
    - set_trial_assets
    - create_marker
    - create_event
    - get_space_inventory_snapshot
  tables:
    - source_documents
    - companies
    - assets
    - trials
    - trial_assets
    - trial_conditions
    - condition_indication_map
    - asset_indications
    - markers
    - marker_assignments
    - marker_changes
    - trial_change_events
    - events
    - mechanisms_of_action
    - routes_of_administration
    - indications
    - conditions
    - ai_calls
  related:
    - source-extract-worker
    - trial-change-feed-pipeline
  user_facing: true
  role: agency
  status: active

- id: nct-resolve-worker
  summary: Cloudflare Worker route that batch-fetches CT.gov studies by NCT ID, applies deterministic phase mapping, calls Claude Sonnet 4.6 to resolve companies/assets from structured data, probes Brandfetch's Logo Link CDN per new company to pick the best non-placeholder asset type, and returns proposals in the same ExtractResponse shape. Co-development detected automatically (duplicate assets under each pharma sponsor). Extracts MOA and ROA from intervention type/description when determinable; leaves empty otherwise. The study record carries CT.gov arm groups (`toStudyRecord` in `nct-study-record.ts`) so the model can resolve fixed-dose combination products, where an arm whose intervention list names two or more active drugs is treated as a combination asset named by the arm label (e.g. "CagriSema" = cagrilintide + semaglutide), with union MOA and slash-joined generic name, and the trial's asset maps to that combination when it is the experimental arm. Without the arm layer, combinations were previously imported as a single component (e.g. cagrilintide), since CT.gov lists the molecules separately and the brand name lives only in the arm label.
  routes: []
  rpcs:
    - ai_call_open
    - ai_call_preflight
    - ai_call_close
    - get_space_inventory_snapshot
  tables:
    - ai_calls
    - ai_config
  related:
    - source-extract-worker
    - source-import-commit
    - ctgov-worker-cron
  user_facing: false
  role: agency
  status: active

- id: ai-health-endpoint
  summary: Lightweight health probe that fetches the Anthropic status page (status.claude.com/api/v2/summary.json), finds the "Claude API" component status, and caches the result for 60s. No auth required.
  routes: []
  rpcs: []
  tables: []
  related:
    - source-import-page
  user_facing: false
  role: viewer
  status: active

- id: source-import-page
  summary: Full-page import shell with three tabs (NCT list, From URL, From text). Replaces the former dialog. Includes an AI status panel that checks the tenant's daily token-budget usage and Anthropic service health on load (via get_tenant_ai_status; owners see a usage percentage, non-owners only the enabled flag). Disables submit when AI is unavailable. Reachable from the engagement toolbar, manage section, command palette, and empty-space auto-redirect.
  routes:
    - /t/:tenantId/s/:spaceId/import
  rpcs:
    - get_tenant_ai_status
  tables:
    - ai_config
    - ai_calls
  related:
    - source-extract-worker
    - nct-resolve-worker
    - ai-health-endpoint
    - engagement-landing-import-button
    - palette-activation-targets
  user_facing: true
  role: editor
  status: active

- id: source-import-dialog
  summary: "[DEPRECATED] Former two-mode dialog (URL/paste text). Replaced by source-import-page. Component file retained but no longer referenced."
  routes: []
  rpcs: []
  tables: []
  related:
    - source-import-page
  user_facing: false
  role: editor
  status: deprecated

- id: ai-admin-toggle
  summary: Platform-admin controls on /super-admin/ai-usage. Toggle ai_enabled per tenant, set the model, token cap, and per-user rate limits (platform_admin_update_ai_config), edit the per-model price catalog (platform_admin_upsert_ai_model_pricing), and read the usage rollup with failure log (get_ai_usage_rollup). All mutations are Tier 1 audited with a required reason.
  routes:
    - /super-admin/ai-usage
  rpcs:
    - platform_admin_set_ai_enabled
    - platform_admin_update_ai_config
    - platform_admin_upsert_ai_model_pricing
    - get_ai_usage_rollup
    - get_ai_call_detail
  tables:
    - ai_config
    - ai_model_pricing
    - audit_events
  related:
    - super-admin-shell
  user_facing: true
  role: super-admin
  status: active

- id: ai-tenant-config
  summary: Tenant-owner on/off switch for their own tenant's AI (tenant_owner_update_ai_config, enabled-only). Model, token cap, and rate limits are platform-admin controlled and not editable by owners; the settings page shows owners a read-only usage percentage via get_tenant_ai_status.
  routes:
    - /t/:tenantId/settings
  rpcs:
    - tenant_owner_update_ai_config
  tables:
    - ai_config
  related:
    - ai-admin-toggle
  user_facing: true
  role: owner
  status: active

- id: import-provenance-visibility
  summary: Read-only provenance drill for space curators. get_source_document returns the source_documents row an AI-imported entity landed from (raw ingested text, title, URL, fetch outcome), plus the importer email (joined from auth.users in the definer context) and the linked ai_call model/outcome. Gated to space owners and editors via has_space_access; viewers and non-members get 42501; platform admin keeps the support read bypass. Surfaced as a quiet "IMPORTED FROM ..." line on the trial/asset/company detail pages and the marker/event detail panels, which opens a read-only source drawer. Keeps source_documents itself agency-only; this RPC is the single tenant-side read path. get_catalyst_detail and get_event_detail also return source_doc_id so the line can render on those surfaces.
  routes: []
  rpcs:
    - get_source_document
  tables:
    - source_documents
    - ai_calls
  related:
    - source-import-commit
  user_facing: true
  role: editor
  status: active
```

## New tables

| Table | Purpose | RLS |
|---|---|---|
| `ai_config` | Tenant-level AI settings (model, `daily_token_cap`, per-user rate limits, enabled flag) | Platform admin only (direct table); owners reach it through SECURITY DEFINER RPCs |
| `ai_model_pricing` | Per-model price catalog (`input_cents_per_mtok`, `output_cents_per_mtok`, family, status, `superseded_by`). Source of truth for the model chooser and server-side cost estimation. | Any authenticated user SELECT; platform admin INSERT/UPDATE/DELETE |
| `source_documents` | One row per imported source (URL, pasted text, or NCT batch). `source_kind` CHECK allows `'url'`, `'text'`, `'nct'`. | Agency members of space + platform admin SELECT; RPC-only write |
| `ai_calls` | Every LLM call regardless of outcome | Agency SELECT; RPC-only write; platform admin DELETE |
| `trial_assets` | Many-to-many between trials and assets; source of truth for the set of assets a trial tests. `is_primary` marks the headline member, mirrored into `trials.asset_id` by a sync trigger. Written via `set_trial_assets` (RPC) and the trial-insert bootstrap trigger. | Agency members of space via parent trial; RPC-only write |

## Provenance columns

`source_doc_id` (nullable FK to `source_documents`, ON DELETE SET NULL) added to: `companies`, `assets`, `trials`, `markers`, `events`.

## Worker routes

| Route | Method | Purpose |
|---|---|---|
| `/api/source/extract` | POST | Document extraction (URL or text). Calls Claude for full entity extraction. |
| `/api/source/nct-resolve` | POST | NCT batch import. Fetches CT.gov studies, applies deterministic phase mapping, calls Claude for entity resolution (companies, assets). |
| `/api/ai/health` | GET | Anthropic status page proxy. Returns Claude API component health, cached 60s. No auth. |

Env bindings: `ANTHROPIC_API_KEY`, `EXTRACT_SOURCE_WORKER_SECRET` (both via `wrangler secret put`). Vault secret mirrors the CT.gov pattern.

## Shared entity-create RPCs

`commit_source_import` and the Angular CRUD services both call these RPCs instead of doing direct table inserts. This ensures identical database state and side effects regardless of entry path.

| RPC | Key side effects |
|---|---|
| `create_company(p_space_id, p_name, p_logo_url, p_source_doc_id)` | INSERT into companies |
| `create_asset(p_space_id, p_company_id, p_name, p_generic_name, p_moa_names, p_roa_names, p_source_doc_id)` | INSERT into assets + MOA/ROA join tables |
| `create_trial(p_space_id, p_asset_id, p_name, ..., p_indication_name, p_source_doc_id)` | INSERT into trials + trial_conditions + condition_indication_map + **asset_indications** (ON CONFLICT DO NOTHING) + recomputes development_status |
| `create_marker(p_space_id, ..., p_trial_ids, p_source_doc_id, p_change_source)` | INSERT into markers + marker_assignments, then re-emits `_emit_events_from_marker_change` to produce `trial_change_events` with the correct source |
| `create_event(p_space_id, p_category_id, p_title, ..., p_source_doc_id)` | INSERT into events |

`create_trial` is the fix for empty timelines on imported assets: it explicitly creates `asset_indications` rows when an indication is provided. The `trg_auto_derive_asset_indication` trigger only recomputes `development_status` on existing rows; it never creates new ones.

`create_marker` is the fix for empty activity feeds: it inserts assignments before re-emitting the marker audit fan-out, so `trial_change_events` rows are produced. The `p_change_source` parameter (default `'analyst'`) is passed as `'source_import'` by `commit_source_import`.

## RPCs

| RPC | Purpose |
|---|---|
| `get_tenant_ai_status(p_tenant_id)` | Owner-safe status read for the import page and tenant settings. Returns `ai_enabled` to anyone with tenant access; owners/platform admins also get `daily_usage_pct` (rolling-24h token usage as a percentage) plus per-user rate limits. Never returns the token cap or any dollar amount. STABLE, SECURITY DEFINER. Replaces the removed cents-based `ai_import_status`. |
| `ai_resolve_model(p_requested)` / `ai_estimate_cost_cents(p_model, p_prompt_tokens, p_completion_tokens)` | Server-side helpers. `ai_resolve_model` validates a requested model against the active catalog and falls back to sonnet/newest-active; `ai_estimate_cost_cents` prices token counts against `ai_model_pricing` (per million tokens). Used by `ai_call_open`/`ai_call_close` so cost is snapshotted authoritatively per call. |
| `platform_admin_update_ai_config(p_tenant_id, p_reason, ...)` | Platform-admin patch of model, `daily_token_cap`, and rate limits. Validates the model against the active catalog. Tier 1 audited. |
| `platform_admin_upsert_ai_model_pricing(p_model_id, p_reason, ...)` | Platform-admin insert/update of a catalog price. Price changes affect future calls only; historical `ai_calls.cost_estimate_cents` stays snapshotted. Tier 1 audited. |

## Angular components

| Component | Location | Purpose |
|---|---|---|
| `ImportPageComponent` | `features/source-import/` | Full-page import shell with 3 tabs (NCT, URL, Text) and AI status panel. Route: `/import`. |
| `NctInputComponent` | `features/source-import/nct-input/` | NCT paste area with live parsing, dedup, duplicate detection, progress, error handling. |
| `ImportFromSourceDialogComponent` | `features/source-import/` | [DEPRECATED] Former two-mode dialog. Replaced by `ImportPageComponent`. |
| `ReviewPageComponent` | `features/source-import/` | Review page as a grouped grid (PrimeNG TreeTable): company > asset > trial nesting with column-aligned scanning, plus markers and events nested as leaf rows under the entity they describe (a marker under its trial; an event under its trial/asset/company anchor). Leaf rows carry their identity in the entity cell (title with a muted category + date meta line), leave the trial-shaped columns blank, and are not editable. Markers render the real `app-marker-icon` glyph their `marker_type` resolves to (via `pickMarkerType`, mirroring the commit's exact -> case-insensitive -> system-default name match against the space's marker types), so the review preview matches the timeline/legend; events use the canonical events icon. Surfacing these rows means a linked marker/event is visible and deselectable rather than committed invisibly, and it is what makes the filter-tab count (which walks the grid tree) match the footer/Confirm total. Calm-by-default rows (new carries no badge; `existing` gets a quiet slate tag); amber flag chips only on rows needing review per the taxonomy below. Per-row chevron expands an inline detail panel (CT.gov candidate picker, fuzzy-match override, missing-asset blocker, inline field edits incl. indication). The per-entity edit dialog (`ReviewEditDialogComponent`) locks identity fields when the Match control links the entity to an existing record, because `commit_source_import` links existing matches by id and discards their proposal fields: assets disable name/generic-name/company (MOA/ROA stay editable since the commit merges those into the matched asset), companies disable name/website, trials disable every field, and an inline note explains the link. Toolbar filter (All / Needs review / New) collapses to flagged rows keeping parent context. Trials whose `asset_ref` does not resolve to an asset (e.g. a master-protocol NCT testing two drugs, which cannot pick a single asset) cannot nest in the company > asset > trial tree, so they render in a separate "Unlinked trials" section rather than silently disappearing while still counting toward the "(N trials)" header. Footer shows a readable selection summary and an amber blocking message; Confirm is gated on blocking flags (a new trial with no asset is blocking, so it cannot reach the NOT NULL `trials.asset_id` insert). Full two-pane layout (source text) retained for URL/text imports. Pure review-decision logic lives in `review-grid.logic.ts` (unit-tested). |
| `review-grid.logic.ts` | `features/source-import/` | Pure, DOM-free review-decision module (vitest `npm run test:units`). Exports `entityState`, `deriveTrialFlags`/`deriveAssetFlags`, `duplicateTrialIndexes`, `deriveCtgovFlag`/`deriveFuzzyFlag`, `readableSummary`, `blockingReason`, `trialMissingAsset` (shared by the grid flag and the commit gate so they cannot diverge), `resolveTrialAssetIndex`/`orphanTrialIndexes` (the single predicate the tree builder uses to nest trials under assets and to surface the unlinked remainder, so nesting and orphan-detection cannot disagree), and `markerLeafDisplay`/`eventLeafDisplay` (the category + date a marker/event leaf row renders). Flag taxonomy: blocking = no-asset, within-batch duplicate; attention = no-indication, observational (by `study_type`), no-MOA/ROA, missing phase/status, CT.gov pick, fuzzy; info = CT.gov lookup failed. |
| `SourceImportService` | `features/source-import/` | Ephemeral proposal state between import page and review. `source_kind` widened to `'url' | 'text' | 'nct'`. |
| `SuperAdminAiUsageComponent` | `features/super-admin/` | 3-level AI usage drill-down + ai_enabled toggle |

## Guards

| Guard | Type | Purpose |
|---|---|---|
| `importGuard` | CanActivate | Checks editor-or-owner space role + tenant AI enabled for the `/import` route. Awaits `SpaceRoleService.ensureRole()` rather than reading the role signal synchronously, which raced the fetch and bounced owners on direct loads |
| `sourceImportGuard` | CanActivate | Checks proposal exists in service for the route's aiCallId |
| `sourceImportDeactivateGuard` | CanDeactivate | Prompts on unsaved changes |
