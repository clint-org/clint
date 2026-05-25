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
  summary: Atomic RPC that writes a reviewed source import. Dependency-ordered inserts for companies, assets, trials, markers, events with provenance.
  routes:
    - /t/:tenantId/s/:spaceId/import/:aiCallId/review
  rpcs:
    - commit_source_import
    - get_space_inventory_snapshot
  tables:
    - source_documents
    - companies
    - assets
    - trials
    - trial_conditions
    - markers
    - marker_assignments
    - events
    - mechanisms_of_action
    - routes_of_administration
    - indications
    - conditions
    - condition_indication_map
    - ai_calls
  related:
    - source-extract-worker
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

## Angular components

| Component | Location | Purpose |
|---|---|---|
| `ImportFromSourceDialogComponent` | `features/source-import/` | Two-mode input, calls worker, navigates to review |
| `ReviewPageComponent` | `features/source-import/` | Two-pane review: source text + proposals |
| `SourceImportService` | `features/source-import/` | Ephemeral proposal state between dialog and review |
| `SuperAdminAiUsageComponent` | `features/super-admin/` | 3-level AI usage drill-down + ai_enabled toggle |

## Guards

| Guard | Type | Purpose |
|---|---|---|
| `sourceImportGuard` | CanActivate | Checks proposal exists in service for the route's aiCallId |
| `sourceImportDeactivateGuard` | CanDeactivate | Prompts on unsaved changes |
