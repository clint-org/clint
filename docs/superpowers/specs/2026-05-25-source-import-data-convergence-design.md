---
id: spec-2026-source-import-data-convergence
title: Source-import data convergence (shared entity-create RPCs)
slug: source-import-data-convergence
status: draft
created: 2026-05-25
parent: 2026-05-21-source-ingestion-design.md
---

# Source-import data convergence

## Problem

`commit_source_import` and the analyst-facing Angular services both create entities (companies, assets, trials, markers, events) via direct table inserts. The two paths diverge in insert ordering and downstream side effects, producing three user-visible bugs:

1. **Activity feed empty for source-imported markers.** The `_log_marker_change()` BEFORE trigger fires when `commit_source_import` inserts a marker, but `marker_assignments` have not been inserted yet. The trigger fans out via `marker_assignments`, finds zero rows, writes zero `trial_change_events`. The same ordering bug exists in `MarkerService.create()`.

2. **Timeline empty for source-imported assets.** The dashboard RPC `get_dashboard_data()` joins through `asset_indications -> indications -> condition_indication_map -> trial_conditions -> trials -> markers`. `commit_source_import` creates `trial_conditions` and `condition_indication_map` rows but never creates `asset_indications` rows. The spec's claim that `trg_auto_derive_asset_indication` auto-creates these rows is incorrect: that trigger recomputes `development_status` on existing `asset_indications` rows but does not create new ones. Without the `asset_indications` link, the dashboard RPC returns zero indications for the asset, zero trials, and zero markers. This is why the amycretin product page timeline is empty.

3. **No cache invalidation from source import.** The Angular services invalidate `RpcCache` tags on mutation (e.g., `space:${spaceId}:activity`, `space:${spaceId}:dashboard`). `commit_source_import` runs server-side and returns a JSON summary, but the client does not invalidate the right cache tags after commit, so stale dashboard/activity data may persist until manual refresh.

### Root cause

Both paths use direct table inserts but there is no shared server-side function that defines "what it means to create a marker" (or trial, or event). The triggers handle some side effects but depend on insert ordering that neither caller gets right.

### Incorrect spec assumption

The parent spec (2026-05-21-source-ingestion-design, line 354) states:

> "The `asset_indications` row (asset + indication with development status) is auto-derived by the existing `trg_auto_derive_asset_indication` trigger when the trial is inserted."

This is wrong. `trg_auto_derive_asset_indication` calls `_recompute_asset_indication_status(asset_id)`, which loops over existing `asset_indications` rows for that asset and recomputes their `development_status`. It does not INSERT new `asset_indications` rows. If no `asset_indications` row exists for the (asset, indication) pair, the trigger does nothing.

## Goals

1. Every entity-creation path (manual UI, source import, future bulk import, future API) produces identical database state and side effects.
2. The activity feed shows source-imported markers as `marker_added` events with `source = 'source_import'`.
3. Source-imported trials appear in the timeline immediately (no manual asset_indications wiring required).
4. Cache invalidation is consistent across all creation paths.

## Non-goals

- Migrating existing UPDATE/DELETE paths to shared RPCs. This spec covers CREATE only.
- Adding activity feed entries for the `events` entity (those are a separate data model from `trial_change_events`).
- Changing the `get_activity_feed` RPC or the activity page UI beyond supporting a new `source` value.
- Retroactive backfill of `asset_indications` for entities created before this migration.

## Design

### Shared entity-create RPCs

Extract five server-side RPCs that own the full create lifecycle for each entity type. Each RPC handles all inserts, join-table writes, and trigger-coordination in the correct order within a single call.

All five RPCs are SECURITY DEFINER, user-callable (granted to `authenticated`), and enforce `has_space_access`. All return the created entity's `id` (or the full row as JSONB where the caller needs it).

#### 1. `create_company`

```sql
create or replace function public.create_company(
  p_space_id     uuid,
  p_name         text,
  p_logo_url     text     default null,
  p_source_doc_id uuid    default null
) returns uuid
```

**Operations (in order):**
1. `has_space_access(p_space_id)` check.
2. INSERT into `companies` (space_id, name, logo_url, source_doc_id, created_by = auth.uid()).
3. Return the new company id.

**Triggers that fire:** `_set_created_by`, `_set_updated_audit`.

No additional side effects. Companies are passive entities.

#### 2. `create_asset`

```sql
create or replace function public.create_asset(
  p_space_id      uuid,
  p_company_id    uuid,
  p_name          text,
  p_generic_name  text     default null,
  p_moa_names     text[]   default null,
  p_roa_names     text[]   default null,
  p_source_doc_id uuid     default null
) returns uuid
```

**Operations (in order):**
1. `has_space_access(p_space_id)` check.
2. INSERT into `assets`.
3. For each MOA name: resolve to `mechanisms_of_action.id` by `(space_id, name)`, INSERT into `asset_mechanisms_of_action`.
4. For each ROA name: resolve to `routes_of_administration.id` by `(space_id, name)`, INSERT into `asset_routes_of_administration`.
5. Return the new asset id.

#### 3. `create_trial`

```sql
create or replace function public.create_trial(
  p_space_id        uuid,
  p_asset_id        uuid,
  p_name            text,
  p_identifier      text     default null,
  p_status          text     default null,
  p_phase_type      text     default null,
  p_phase_start_date date    default null,
  p_phase_end_date   date    default null,
  p_indication_name text     default null,
  p_source_doc_id   uuid     default null
) returns uuid
```

**Operations (in order):**
1. `has_space_access(p_space_id)` check.
2. INSERT into `trials`. Triggers fire: `_set_created_by`, `_set_updated_audit`, `trg_auto_derive_asset_indication` (recomputes status on existing asset_indications for this asset -- no-op if none exist yet).
3. If `p_indication_name` is provided:
   a. Find or create `indications` row by `(space_id, name)` using ON CONFLICT DO NOTHING, then SELECT id.
   b. Find or create `conditions` row by `(space_id, name)` with `source = 'analyst'`, same pattern.
   c. INSERT into `condition_indication_map` (condition_id, indication_id) ON CONFLICT DO NOTHING.
   d. INSERT into `trial_conditions` (trial_id, condition_id, source = 'analyst') ON CONFLICT DO NOTHING.
   e. **INSERT into `asset_indications`** (asset_id, indication_id, space_id, development_status_source = 'auto', created_by) ON CONFLICT (asset_id, indication_id) DO NOTHING. This is the missing step that the parent spec assumed triggers would handle.
   f. Call `_recompute_asset_indication_status(p_asset_id)` to derive the development_status from trial phase data now that the asset_indications row exists.
4. Return the new trial id.

Step 3e is the critical fix for the empty timeline. By creating the `asset_indications` row here, the `get_dashboard_data()` join chain is complete: `asset_indications -> indications -> condition_indication_map -> trial_conditions -> trials`.

#### 4. `create_marker`

```sql
create or replace function public.create_marker(
  p_space_id       uuid,
  p_marker_type_id uuid,
  p_title          text,
  p_projection     text,
  p_event_date     date,
  p_end_date       date      default null,
  p_description    text      default null,
  p_source_url     text      default null,
  p_trial_ids      uuid[]    default null,
  p_source_doc_id  uuid      default null,
  p_change_source  text      default 'analyst'
) returns uuid
```

**Operations (in order):**
1. `has_space_access(p_space_id)` check.
2. INSERT into `markers`. The `_log_marker_change()` BEFORE trigger fires:
   - Creates a `marker_changes` row with `change_type = 'created'`.
   - Calls `_emit_events_from_marker_change()`, which loops over `marker_assignments` and finds zero rows (assignments not inserted yet), producing zero `trial_change_events`. This is expected.
3. INSERT into `marker_assignments` for each trial_id in `p_trial_ids`.
4. **Re-emit the marker audit fan-out.** Find the `marker_changes` row created in step 2 (`marker_id = new_id AND change_type = 'created'`), and call `_emit_events_from_marker_change()` again. This time it finds the assignments from step 3 and produces one `trial_change_events` row per assignment.
5. **Override the `source` value.** The `_emit_events_from_marker_change()` function hardcodes `source = 'analyst'` (line 302 of the trigger migration). The re-emitted rows need the correct source. Two options:

   **Option A: Update after re-emit.** After step 4, UPDATE the just-created `trial_change_events` rows to set `source = p_change_source` where `derived_from_marker_change_id = v_audit_id`.

   **Option B: Add a source parameter to `_emit_events_from_marker_change`.** Modify the function signature to accept an optional `p_source` parameter (default `'analyst'`), and use it in the INSERT. The trigger caller passes nothing (gets `'analyst'`); the RPC passes `p_change_source`.

   **Decision: Option B.** Cleaner, avoids a redundant UPDATE, and is backwards-compatible (default parameter).

6. Return the new marker id.

This fixes the activity feed gap. Source-imported markers produce `trial_change_events` with `source = 'source_import'`; manually-created markers produce them with `source = 'analyst'`.

#### 5. `create_event`

```sql
create or replace function public.create_event(
  p_space_id      uuid,
  p_category_id   uuid,
  p_title         text,
  p_event_date    date,
  p_description   text      default null,
  p_priority      text      default 'low',
  p_tags          text[]    default null,
  p_company_id    uuid      default null,
  p_asset_id      uuid      default null,
  p_trial_id      uuid      default null,
  p_source_doc_id uuid      default null
) returns uuid
```

**Operations (in order):**
1. `has_space_access(p_space_id)` check.
2. Validate single-anchor constraint: at most one of `p_company_id`, `p_asset_id`, `p_trial_id` is non-null. Raise if violated.
3. INSERT into `events`.
4. Return the new event id.

The `events` entity has no trigger-based side effects today. `event_sources` and `event_links` are not part of the create path for source import and remain direct-insert operations on the Angular service for now.

### Modifications to `_emit_events_from_marker_change`

Add an optional `p_source` parameter:

```sql
create or replace function public._emit_events_from_marker_change(
  p_marker_change_id uuid,
  p_source           varchar(20) default 'analyst'
) returns void
```

In the INSERT into `trial_change_events` (current line 288-308), replace the hardcoded `'analyst'` on line 302 with `p_source`.

All existing callers pass no second argument and get `'analyst'` (backwards-compatible):
- `_log_marker_change()` trigger: calls `perform public._emit_events_from_marker_change(v_audit_id);` -- unchanged.
- `backfill_marker_history()`: calls `perform public._emit_events_from_marker_change(v_audit_id);` -- unchanged.

The new `create_marker` RPC calls it with the explicit source:
```sql
perform public._emit_events_from_marker_change(v_audit_id, p_change_source);
```

### Modifications to `get_activity_feed`

Add `'source_import'` to the valid `sources` filter values. No schema change needed since the `p_filters` parameter is JSONB and the source column is `varchar(20)`. The activity page's source filter chips need a third option: `SOURCE IMPORT` alongside `CT.GOV` and `ANALYST`.

### Rewrite of `commit_source_import`

Replace all direct INSERT statements with calls to the shared RPCs. The RPC remains a single transaction, preserves the dependency-ordered resolution (company_ref -> asset_ref -> trial_ref), and continues to handle the source_document + ai_calls bookkeeping.

**Before (current):**
```
commit_source_import:
  INSERT INTO companies ...
  INSERT INTO assets ...
  INSERT INTO trials ...
  INSERT INTO trial_conditions ...
  INSERT INTO markers ...
  INSERT INTO marker_assignments ...
  INSERT INTO events ...
```

**After:**
```
commit_source_import:
  -- bookkeeping (unchanged)
  INSERT INTO source_documents ...
  inventory drift check ...
  upsert lookup tables (MOA, ROA, indications, conditions, condition_indication_map) ...

  -- entity creation via shared RPCs
  FOR each company:
    v_id := create_company(p_space_id, name, logo_url, v_source_doc_id);

  FOR each asset:
    v_id := create_asset(p_space_id, company_id, name, generic_name,
                         moa_names, roa_names, v_source_doc_id);

  FOR each trial:
    v_id := create_trial(p_space_id, asset_id, name, identifier, status,
                         phase_type, phase_start_date, phase_end_date,
                         indication_name, v_source_doc_id);

  FOR each marker:
    v_id := create_marker(p_space_id, marker_type_id, title, projection,
                          event_date, end_date, description, source_url,
                          trial_ids, v_source_doc_id, 'source_import');

  FOR each event:
    v_id := create_event(p_space_id, category_id, title, event_date,
                         description, priority, tags,
                         company_id, asset_id, trial_id, v_source_doc_id);

  -- bookkeeping (unchanged)
  UPDATE ai_calls SET source_doc_id = v_source_doc_id ...
  RETURN summary ...
```

The ref-index resolution logic (company_ref -> real id, asset_ref -> real id, trial_ref -> real id) stays in `commit_source_import`. The shared RPCs take resolved UUIDs.

### Angular service migration

Update each Angular service's `create()` method to call the corresponding RPC instead of direct table inserts.

**MarkerService.create() -- before:**
```typescript
const { data } = await this.supabase.client
  .from('markers').insert({ ...marker, space_id: spaceId }).select().single();
const assignments = trialIds.map(tid => ({ marker_id: data.id, trial_id: tid }));
await this.supabase.client.from('marker_assignments').insert(assignments);
```

**MarkerService.create() -- after:**
```typescript
const { data } = await this.supabase.client.rpc('create_marker', {
  p_space_id: spaceId,
  p_marker_type_id: marker.marker_type_id,
  p_title: marker.title,
  p_projection: marker.projection,
  p_event_date: marker.event_date,
  p_end_date: marker.end_date ?? null,
  p_description: marker.description ?? null,
  p_source_url: marker.source_url ?? null,
  p_trial_ids: trialIds,
  p_change_source: 'analyst',
});
```

Same pattern for `CompanyService.create()`, `AssetService.create()`, `TrialService.create()`, `EventService.create()`.

Each service continues to invalidate the same `RpcCache` tags after the RPC call. Cache invalidation remains client-side.

### Post-commit cache invalidation (source import)

After `commit_source_import` returns, the Angular `ReviewPageComponent` must invalidate the same cache tags that the individual services would. Based on the created entity counts in the response:

```typescript
const tags: string[] = [
  `space:${spaceId}:dashboard`,
  `space:${spaceId}:landing-stats`,
];
if (result.created.companies.length)  tags.push(`space:${spaceId}:companies`);
if (result.created.assets.length)     tags.push(`space:${spaceId}:products`);
if (result.created.trials.length)     tags.push(`space:${spaceId}:trials`);
if (result.created.markers.length)    tags.push(`space:${spaceId}:activity`);
if (result.created.events.length)     tags.push(`space:${spaceId}:events`, `space:${spaceId}:tags`);
this.rpcCache.invalidate(tags);
```

## Migration plan

One migration file: `20260525HHMMSS_shared_entity_create_rpcs.sql`.

**Contents (in order):**

1. Modify `_emit_events_from_marker_change` to accept optional `p_source` parameter.
2. CREATE `create_company`, `create_asset`, `create_trial`, `create_marker`, `create_event` RPCs.
3. DROP and re-CREATE `commit_source_import` to call the shared RPCs instead of direct inserts.
4. Smoke tests: call each shared RPC, verify table state and side effects.
5. Integration test: call `commit_source_import`, verify `trial_change_events` exist with `source = 'source_import'`, verify `asset_indications` exist, verify timeline data is complete.

**Backwards compatibility:**
- All existing triggers remain unchanged (they still fire on the table inserts inside the RPCs).
- `_emit_events_from_marker_change` default parameter means existing callers are unaffected.
- `get_activity_feed` already accepts any `source` string in its filter; `'source_import'` needs no schema change.

## Side-effect matrix (after this change)

| Side effect | create_company | create_asset | create_trial | create_marker | create_event |
|---|---|---|---|---|---|
| Row in entity table | yes | yes | yes | yes | yes |
| source_doc_id set | if provided | if provided | if provided | if provided | if provided |
| Join-table rows (MOA/ROA/assignments/conditions) | n/a | yes | yes (trial_conditions) | yes (marker_assignments) | n/a |
| asset_indications row | n/a | n/a | yes (if indication provided) | n/a | n/a |
| condition_indication_map row | n/a | n/a | yes (if indication provided) | n/a | n/a |
| marker_changes audit row | n/a | n/a | n/a | yes (via trigger) | n/a |
| trial_change_events row(s) | n/a | n/a | n/a | yes (re-emit after assignments) | n/a |
| development_status recompute | n/a | n/a | yes (_recompute call) | n/a | n/a |

## Implementation tasks

### T1: Modify `_emit_events_from_marker_change` signature

Add optional `p_source varchar(20) default 'analyst'` parameter. Replace hardcoded `'analyst'` in the INSERT. Verify existing smoke tests still pass unchanged.

### T2: Create shared RPCs (create_company, create_asset, create_trial, create_marker, create_event)

One migration. Each RPC includes its smoke test inline. `create_trial` must verify that `asset_indications` is created. `create_marker` must verify that `trial_change_events` are created with the correct source.

### T3: Rewrite `commit_source_import` to call shared RPCs

Replace direct inserts with RPC calls. Preserve ref-index resolution, source_document bookkeeping, inventory drift check, and return shape. Smoke test: full proposal with companies, assets, trials, markers, events. Verify `trial_change_events` and `asset_indications` exist post-commit.

### T4: Update Angular services to call shared RPCs

Migrate `MarkerService.create()`, `CompanyService.create()`, `AssetService.create()`, `TrialService.create()`, `EventService.create()` to call the new RPCs. Cache invalidation stays client-side, unchanged.

### T5: Add `SOURCE IMPORT` filter to the activity page

Add third chip alongside `CT.GOV` and `ANALYST`. Map to `source = 'source_import'` in the filter payload.

### T6: Post-commit cache invalidation in ReviewPageComponent

After `commit_source_import` returns, invalidate the appropriate `RpcCache` tags based on what was created.

## Testing

| Task | Test | Assertion |
|---|---|---|
| T1 | Existing marker trigger smoke tests | Pass unchanged (default parameter) |
| T2 | `create_trial` smoke | `asset_indications` row exists after call with indication |
| T2 | `create_marker` smoke | `trial_change_events` rows exist with correct source |
| T2 | `create_marker` smoke | Marker with zero trial_ids produces zero `trial_change_events` |
| T3 | `commit_source_import` integration | `trial_change_events` with `source = 'source_import'` exist |
| T3 | `commit_source_import` integration | `asset_indications` exist for all trial-indication pairs |
| T3 | `commit_source_import` integration | Dashboard RPC returns trials under indication for imported asset |
| T4 | Manual marker creation via UI | `trial_change_events` with `source = 'analyst'` exist |
| T5 | Activity page filter | `SOURCE IMPORT` chip filters correctly |

## References

- Parent: `2026-05-21-source-ingestion-design.md`
- Marker trigger: `20260502120700_marker_changes_trigger.sql`
- Asset indication auto-derive: `20260524120400_asset_indication_auto_derive.sql`
- Indication tables: `20260524120000_create_indication_condition_tables.sql`
- Dashboard RPC: `20260524120500_rpcs_dashboard_entity_crud.sql`
- Activity feed RPC: `20260510120300_change_feed_company_logo_url.sql`
- Current commit RPC: `20260525100800_rpc_commit_source_import.sql`
