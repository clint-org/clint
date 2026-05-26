---
surface: Source Document Import (AI-Extracted)
spec: docs/superpowers/specs/2026-05-21-source-ingestion-design.md
---

# Source Document Import

Agency analysts paste a press release URL or text into an engagement. Claude Sonnet 4.6 extracts structured entities (companies, assets, trials, markers, events) with evidence grounding. The analyst reviews proposals on a dedicated two-pane review page, then confirms atomically. Every confirmed row carries `source_doc_id` provenance and every LLM call writes to `ai_calls` regardless of outcome.

## Capabilities

```yaml
- id: source-extract-worker
  summary: Cloudflare Worker route that fetches/cleans a source, calls Claude Sonnet 4.6, validates the response, enriches with CT.gov lookups, and returns structured proposals.
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

- id: source-import-dialog
  summary: Two-mode dialog (URL/paste text) that initiates extraction and navigates to the review page.
  routes: []
  rpcs: []
  tables: []
  related:
    - source-extract-worker
    - engagement-landing
  user_facing: true

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
| `source_documents` | One row per imported source (URL or pasted text) | Agency members of space + platform admin SELECT; RPC-only write |
| `ai_calls` | Every LLM call regardless of outcome | Agency SELECT; RPC-only write; platform admin DELETE |

## Provenance columns

`source_doc_id` (nullable FK to `source_documents`, ON DELETE SET NULL) added to: `companies`, `assets`, `trials`, `markers`, `events`.

## Worker route

`POST /api/source/extract` in the existing Cloudflare Worker. Env bindings: `ANTHROPIC_API_KEY`, `EXTRACT_SOURCE_WORKER_SECRET` (both via `wrangler secret put`). Vault secret mirrors the CT.gov pattern.

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

## Angular components

| Component | Location | Purpose |
|---|---|---|
| `ImportFromSourceDialogComponent` | `features/source-import/` | Two-mode input, calls worker, navigates to review |
| `ReviewPageComponent` | `features/source-import/` | Two-pane review: source text (left) + hierarchical tree of proposals grouped Company > Asset > Trial > Markers/Events (right). Existing entities are clickable links to their manage page. Uses `ng-template` with `NgTemplateOutlet` for reusable entity row rendering. |
| `SourceImportService` | `features/source-import/` | Ephemeral proposal state between dialog and review |
| `SuperAdminAiUsageComponent` | `features/super-admin/` | 3-level AI usage drill-down + ai_enabled toggle |

## Guards

| Guard | Type | Purpose |
|---|---|---|
| `sourceImportGuard` | CanActivate | Checks proposal exists in service for the route's aiCallId |
| `sourceImportDeactivateGuard` | CanDeactivate | Prompts on unsaved changes |
