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
  routes:
    - /api/source/extract (POST)
  rpcs:
    - ai_call_open
    - ai_call_preflight
    - ai_call_close
    - get_space_inventory_snapshot
  tables:
    - ai_calls
    - ai_config
  related:
    - source-import-commit
  user_facing: false

- id: source-import-commit
  summary: Atomic RPC that writes a reviewed source import via shared entity-create RPCs. Creates asset_indications for timeline visibility and emits trial_change_events with source=source_import for the activity feed. Post-commit, the review page invalidates all relevant RpcCache tags.
  routes:
    - /t/:tenantId/s/:spaceId/import/:aiCallId/review
  rpcs:
    - commit_source_import
    - create_company
    - create_asset
    - create_trial
    - create_marker
    - create_event
    - get_space_inventory_snapshot
  tables:
    - source_documents
    - companies
    - assets
    - trials
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

- id: nct-resolve-worker
  summary: Cloudflare Worker route that batch-fetches CT.gov studies by NCT ID, applies deterministic phase mapping, calls Claude Sonnet 4.6 to resolve companies/assets from structured data, probes Brandfetch's Logo Link CDN per new company to pick the best non-placeholder asset type, and returns proposals in the same ExtractResponse shape. Co-development detected automatically (duplicate assets under each pharma sponsor). Extracts MOA and ROA from intervention type/description when determinable; leaves empty otherwise. The study record carries CT.gov arm groups (`toStudyRecord` in `nct-study-record.ts`) so the model can resolve fixed-dose combination products: an arm whose intervention list names two or more active drugs is treated as a combination asset named by the arm label (e.g. "CagriSema" = cagrilintide + semaglutide), with union MOA and slash-joined generic name, and the trial's asset maps to that combination when it is the experimental arm. Without the arm layer, combinations were previously imported as a single component (e.g. cagrilintide), since CT.gov lists the molecules separately and the brand name lives only in the arm label.
  routes:
    - /api/source/nct-resolve (POST)
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
    - ctgov-daily-sync
  user_facing: false

- id: ai-health-endpoint
  summary: Lightweight health probe that fetches the Anthropic status page (status.claude.com/api/v2/summary.json), finds the "Claude API" component status, and caches the result for 60s. No auth required.
  routes:
    - /api/ai/health (GET)
  rpcs: []
  tables: []
  related:
    - source-import-page
  user_facing: false

- id: source-import-page
  summary: Full-page import shell with three tabs (NCT list, From URL, From text). Replaces the former dialog. Includes an AI status panel that checks quotas, rate limits, and Anthropic service health on load. Disables submit when AI is unavailable. Reachable from the engagement toolbar, manage section, command palette, and empty-space auto-redirect.
  routes:
    - /t/:tenantId/s/:spaceId/import
  rpcs:
    - ai_import_status
  tables:
    - ai_config
    - ai_calls
  related:
    - source-extract-worker
    - nct-resolve-worker
    - ai-health-endpoint
    - engagement-landing
    - command-palette
  user_facing: true

- id: source-import-dialog
  summary: "[DEPRECATED] Former two-mode dialog (URL/paste text). Replaced by source-import-page. Component file retained but no longer referenced."
  routes: []
  rpcs: []
  tables: []
  related:
    - source-import-page
  user_facing: false

- id: ai-admin-toggle
  summary: Platform-admin RPC to toggle ai_enabled per tenant with required reason. Tier 1 audited.
  routes:
    - /super-admin/ai-usage
  rpcs:
    - platform_admin_set_ai_enabled
    - get_ai_usage_rollup
  tables:
    - ai_config
    - audit_events
  related:
    - super-admin-portal
  user_facing: true
```

## New tables

| Table | Purpose | RLS |
|---|---|---|
| `ai_config` | Tenant-level AI settings (model, caps, rates, enabled flag) | Tenant owner + platform admin |
| `source_documents` | One row per imported source (URL, pasted text, or NCT batch). `source_kind` CHECK allows `'url'`, `'text'`, `'nct'`. | Agency members of space + platform admin SELECT; RPC-only write |
| `ai_calls` | Every LLM call regardless of outcome | Agency SELECT; RPC-only write; platform admin DELETE |

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
| `ai_import_status(p_tenant_id)` | Lightweight pre-check: returns `ai_enabled`, `daily_cap_cents`, `spent_today_cents`, `rate_used_hour`, `rate_limit_hour`. Callable by any authenticated user. STABLE, SECURITY DEFINER. |

## Angular components

| Component | Location | Purpose |
|---|---|---|
| `ImportPageComponent` | `features/source-import/` | Full-page import shell with 3 tabs (NCT, URL, Text) and AI status panel. Route: `/import`. |
| `NctInputComponent` | `features/source-import/nct-input/` | NCT paste area with live parsing, dedup, duplicate detection, progress, error handling. |
| `ImportFromSourceDialogComponent` | `features/source-import/` | [DEPRECATED] Former two-mode dialog. Replaced by `ImportPageComponent`. |
| `ReviewPageComponent` | `features/source-import/` | Review page with NCT-aware defaults: collapsed trial rows, hidden source pane, CT.gov badges for NCT imports. Full two-pane layout for URL/text imports. Shows MOA/ROA pills on assets (violet for MOA, cyan for ROA, amber "No MOA/ROA" when empty with tooltip to add manually). |
| `SourceImportService` | `features/source-import/` | Ephemeral proposal state between import page and review. `source_kind` widened to `'url' | 'text' | 'nct'`. |
| `SuperAdminAiUsageComponent` | `features/super-admin/` | 3-level AI usage drill-down + ai_enabled toggle |

## Guards

| Guard | Type | Purpose |
|---|---|---|
| `importGuard` | CanActivate | Checks editor role + tenant AI enabled for the `/import` route |
| `sourceImportGuard` | CanActivate | Checks proposal exists in service for the route's aiCallId |
| `sourceImportDeactivateGuard` | CanDeactivate | Prompts on unsaved changes |
