# Atomic Join-Table Replacement RPCs (events, assets)

**Date:** 2026-05-28
**Status:** Approved (implemented 2026-05-28)
**Author:** Aaditya Madala (with Claude)

## Summary

Replace four client-side DELETE-then-INSERT patterns against join tables with single SECURITY DEFINER RPCs that do insert-first, prune-stale, in one transaction. Model: `update_marker_assignments` (commit c491d87, migration 20260528100000). One PR ships all four RPCs, their integration specs, and the client switchover. Also fixes a latent persistence bug where edits to an event's "linked events" silently dropped.

## Background

Commit c491d87 fixed a data-loss bug in `MarkerService.updateAssignments`: the client issued `DELETE FROM marker_assignments` followed by `INSERT INTO marker_assignments` as two separate PostgREST transactions. An AFTER DELETE trigger (`_cleanup_orphan_marker`) dropped the parent marker the moment its last assignment row was removed, the subsequent INSERT failed RLS WITH CHECK, and the marker was lost. The fix was a single SECURITY DEFINER RPC that inserts new assignments first, then prunes stale ones in one transaction.

A code audit identified four analogous patterns in the codebase, none of which currently faces an active orphan-cleanup trigger but all of which are vulnerable to the same class of bug, plus other failure modes:

| Site | Pattern | Round-trips |
|---|---|---|
| `event.service.ts:157` `updateSources` | DELETE -> INSERT | 2 |
| `event.service.ts:176` `updateLinks` | DELETE source-side -> DELETE target-side -> INSERT | 3 |
| `asset.service.ts:158` `setMechanisms` | DELETE -> INSERT | 2 |
| `asset.service.ts:188` `setRoutes` | DELETE -> INSERT | 2 |

Reasons to fix even without an active trigger:

1. **Regression-proofing.** Any future AFTER DELETE trigger on these tables (`event_sources`, `event_links`, `asset_mechanisms_of_action`, `asset_routes_of_administration`) would silently strand these client paths, exactly the failure mode that took two debugging sessions to find in markers.
2. **Crash resilience.** A dropped network or browser crash between the DELETE and the INSERT loses all the user's edits with no recovery path.
3. **Concurrent-reader integrity.** During the zero-row window, another viewer's dashboard load returns the empty intermediate state.
4. **`updateLinks` is 3 round-trips** for a single logical save.

A second-pass audit found one additional issue tied to `updateLinks`: the function has **zero callers**. The edit form (`event-form.component.ts`) populates the `linkedEventIds` signal from the loaded event detail but the save path only calls `update` and `updateSources`, never `updateLinks`. Any user changes to an event's linked-events list silently disappear on save. We fix this as part of the same change: build the RPC and wire it into the edit save path.

## Goals

- Four SECURITY DEFINER RPCs that atomically replace join-table contents, modeled exactly on `update_marker_assignments`.
- Integration specs that lock in the regression contract: each RPC keeps the parent stable through edits, and the OLD client pattern would still fail if applied directly.
- Switch the four client call sites to delegate to the RPCs.
- Wire `update_event_links` into the event edit save path, fixing the latent persistence bug.

## Non-goals

- Refactoring the `update_marker_assignments` reference pattern.
- Adding orphan-cleanup triggers to event or asset join tables. Independent decision.
- Combining MOA and ROA into a single RPC. They stay as two RPCs called concurrently from `asset-form` via `Promise.all`.
- Touching the four read-only `.from()` calls in feature components (all `.select()`, not mutations).
- Refactoring the bidirectional semantics of `event_links`. The RPC manages only source-side links from the editing event, matching existing RLS (only the source-side editor can insert/delete). Back-links from other events stay out of this RPC's scope; if event B has a link `B -> A`, editing A does not touch it.

## Design

### Shared template

All four RPCs follow the exact shape of `update_marker_assignments`:

```sql
create or replace function public.update_<scope>(
  p_parent_id uuid,
  p_<children> <type>[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_child <type>;
begin
  -- resolve parent space and authorize
  select space_id into v_space_id from public.<parent> where id = p_parent_id;
  if v_space_id is null then
    raise exception '<parent> not found' using errcode = 'P0002';
  end if;
  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- insert-first (idempotent), then prune stale
  foreach v_child in array coalesce(p_<children>, array[]::<type>[])
  loop
    insert into public.<join_table> (<parent>_id, <child>_id, ...)
      values (p_parent_id, v_child, ...)
      on conflict (<parent>_id, <child>_id) do nothing;
  end loop;

  delete from public.<join_table>
   where <parent>_id = p_parent_id
     and <child>_id <> all(coalesce(p_<children>, array[]::<type>[]));
end;
$$;

revoke execute on function public.update_<scope>(...) from public;
grant  execute on function public.update_<scope>(...) to authenticated;
```

Key differences from `update_marker_assignments`:

- **Empty input is allowed** for all four RPCs (clear all sources / links / mechanisms / routes). The marker RPC rejects empty because the orphan-cleanup trigger would drop the parent marker; these four parents have no such trigger today and clearing-all is a valid user operation. The `coalesce(..., array[]::<type>[])` pattern lets the prune step handle empty as "delete every row for this parent."
- **Not @audit:tier1.** Per `2026-05-10-audit-log-design.md`, editorial data mutations stay in entity-specific change feeds, not `audit_events`. These four are content edits, not governance.
- **`update_event_sources` carries label as a second column** (not just an id). The signature takes `p_sources jsonb[]` or a `text[]` + `text[]` pair. Decision: use two arrays (`p_urls text[]`, `p_labels text[]`) so the prune side keys on URL and the insert side carries both columns. Reject mismatched array lengths with `22023`. Matches the existing `EventService.updateSources(eventId, sources: {url, label}[])` signature minus the wrapping.

### Per-RPC details

#### 1. `update_event_sources(p_event_id uuid, p_urls text[], p_labels text[]) returns void`

- Authorize on `events.space_id` via `has_space_access(..., array['owner','editor'])`.
- Reject mismatched `array_length(p_urls)` vs `array_length(p_labels)` with `22023`.
- Insert each `(p_event_id, url, label)` row, `on conflict do nothing` against a uniqueness key. **Note:** `event_sources` has no current unique constraint on `(event_id, url)`. Add one in the same migration (or rely on prune step to dedup). Decision: add a unique partial index `create unique index event_sources_event_url_uniq on public.event_sources (event_id, url)` to make idempotency real and to defend against double-submits regardless of the RPC path.
- Prune: `delete from event_sources where event_id = p_event_id and url <> all(p_urls)`.
- Empty arrays clear all sources for the event.

#### 2. `update_event_links(p_event_id uuid, p_linked_event_ids uuid[]) returns void`

- Authorize on the editing event's space via `has_space_access(events.space_id, array['owner','editor'])`.
- **Source-side only.** Manage rows where `source_event_id = p_event_id`. Do not touch rows where `target_event_id = p_event_id`. This matches the existing RLS (insert policy checks source-side space access) and avoids losing back-links that other events maintain.
- Validate: every `p_linked_event_ids[i]` must satisfy `id <> p_event_id` (RLS would reject the self-link via the existing `event_links_no_self` check constraint, but we surface a clean error from the RPC first). Validate each target id is visible via `has_space_access(target.space_id)` (read-side). Cross-space links not currently a documented feature; reject with `22023`.
- Insert each `(p_event_id, target_id)` row, `on conflict (source_event_id, target_event_id) do nothing` (the existing `event_links_unique` constraint).
- Prune: `delete from event_links where source_event_id = p_event_id and target_event_id <> all(p_linked_event_ids)`.
- Empty array clears all source-side links from this event.

#### 3. `update_asset_mechanisms(p_asset_id uuid, p_moa_ids uuid[]) returns void`

- Authorize on `assets.space_id` via `has_space_access(..., array['owner','editor'])`.
- Insert each `(p_asset_id, moa_id)` row, `on conflict (asset_id, moa_id) do nothing`. The existing schema has the unique constraint as the primary key.
- Prune: `delete from asset_mechanisms_of_action where asset_id = p_asset_id and moa_id <> all(p_moa_ids)`.
- Empty array clears all MOA assignments.

#### 4. `update_asset_routes(p_asset_id uuid, p_roa_ids uuid[]) returns void`

- Same shape as `update_asset_mechanisms`, against `asset_routes_of_administration` keyed on `(asset_id, roa_id)`.

### Client switchover

| File | Change |
|---|---|
| `src/client/src/app/core/services/event.service.ts` | `updateSources` becomes `supabase.client.rpc('update_event_sources', { p_event_id, p_urls, p_labels })`. `updateLinks` becomes `supabase.client.rpc('update_event_links', { p_event_id, p_linked_event_ids })`. |
| `src/client/src/app/features/events/event-form.component.ts` | Edit save path (the `if (id) { ... }` branch around line 451) calls `eventService.updateLinks(id, this.linkedEventIds())` alongside `updateSources`. This is the new wiring that fixes the persistence bug. |
| `src/client/src/app/core/services/asset.service.ts` | `setMechanisms` becomes `supabase.client.rpc('update_asset_mechanisms', { p_asset_id, p_moa_ids })`. `setRoutes` becomes `supabase.client.rpc('update_asset_routes', { p_asset_id, p_roa_ids })`. `asset-form.component.ts:150-151` keeps the `Promise.all([setMechanisms(), setRoutes()])` shape; both are independently atomic. |
| `event.service.spec.ts`, `product.service.spec.ts` | Update the unit specs to assert against the new RPC signatures. |

### Regression contract: simulate the trigger

The whole reason these RPCs exist is preemptive defense against an orphan-cleanup trigger that does not exist yet. A test that simply runs the old DELETE-then-INSERT pattern against today's schema proves nothing — no trigger fires, the test passes, the RPC's necessity is undocumented in any executable form.

Instead, each migration's inline `do $$` smoke block includes a **simulated-trigger** case that proves the RPC's value under a future world where the trigger exists:

```sql
-- inside the migration's inline do $$ smoke
-- case E: simulate the future. install a transient orphan-cleanup trigger,
-- prove the OLD client pattern would lose the parent, prove the RPC survives.
declare
  -- ... fixture setup ...
begin
  -- fixture: parent with one child row
  insert into public.<parent> ...;
  insert into public.<join_table> ...;

  -- install a transient orphan-cleanup trigger modeled exactly on
  -- _cleanup_orphan_marker (migration 20260521120300). Names are
  -- test-scoped so a leak is obvious.
  create or replace function pg_temp._smoke_orphan_<parent>()
    returns trigger language plpgsql as $fn$
    begin
      delete from public.<parent>
       where id = OLD.<parent>_id
         and not exists (
           select 1 from public.<join_table>
            where <parent>_id = OLD.<parent>_id
         );
      return null;
    end $fn$;

  create trigger _smoke_orphan_<parent>_trigger
    after delete on public.<join_table>
    for each row execute function pg_temp._smoke_orphan_<parent>();

  -- prove the OLD pattern would have lost the parent
  begin
    delete from public.<join_table> where <parent>_id = v_parent;
    insert into public.<join_table> (<parent>_id, <child>_id)
      values (v_parent, v_child_b);
    raise exception 'smoke FAIL case E: OLD pattern should have failed under simulated trigger';
  exception when others then
    if sqlstate not in ('42501', '23503') then
      raise exception 'smoke FAIL case E: expected RLS or FK failure, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- ... cleanup parent + fixture ...

  -- new fixture: prove the RPC succeeds under the same simulated trigger
  insert into public.<parent> ...;
  insert into public.<join_table> ...;

  perform public.update_<scope>(v_parent, array[v_child_b]);

  -- parent still alive
  if not exists (select 1 from public.<parent> where id = v_parent) then
    raise exception 'smoke FAIL case E: parent dropped despite RPC';
  end if;

  -- drop the trigger before the do $$ block ends, so the migration never
  -- leaves it behind.
  drop trigger _smoke_orphan_<parent>_trigger on public.<join_table>;
end;
```

This is a real fence. If a future change weakens the RPC (e.g., reorders insert/delete back to delete-first), case E fails because the simulated trigger drops the parent during the zero-row window. If a future migration adds a real orphan-cleanup trigger to the table, the RPC already defends against it on day one.

The `pg_temp` schema scopes the trigger function to the migration's session, so even if the `drop trigger` were skipped (it isn't), the function would not persist. The `create trigger` itself is on the public table and must be dropped explicitly — covered by the explicit `drop trigger` at the end of the block.

### Vitest integration specs

One spec per RPC under `src/client/integration/tests/`, matching the shape of `marker-edit-flow.spec.ts` minus the trigger-regression block (which lives in the migration's SQL smoke now):

- **Happy path:** swap, add/remove diff, idempotency.
- **Empty:** verifies clear-all works (not a rejection, unlike the marker spec).
- **Auth:** viewer rejected with `42501`, parent untouched.
- **Cross-space rejection** (event_links only): linking a target event in a space the caller cannot read fails with `22023`.

### Inline SQL smoke

Each migration ships an inline `do $$` block at the bottom matching the structure of `20260528100000_update_marker_assignments_rpc.sql`, plus one extra case for the simulated-trigger regression contract:

- Case A: parent with one row, swap it.
- Case B: mixed add/remove diff.
- Case C: empty input clears all (note: marker case C asserts rejection; here we assert clear-all succeeds and the parent is untouched).
- Case D: viewer rejected with `42501`, parent untouched.
- Case E: simulated orphan-cleanup trigger proves the OLD pattern fails and the RPC survives. See "Regression contract" above.

Hermetic fixtures per case, impersonation via `set_config('request.jwt.claims', ...)`, teardown under `clint.member_guard_cascade = 'on'`. Same template as the marker smoke.

## Implementation Plan

One PR, sequenced inside:

1. **Migration: `update_event_sources`** + inline smoke + unique index on `(event_id, url)`.
2. **Migration: `update_event_links`** + inline smoke.
3. **Migration: `update_asset_mechanisms`** + inline smoke.
4. **Migration: `update_asset_routes`** + inline smoke.
5. **Integration spec:** `event-sources-edit-flow.spec.ts`.
6. **Integration spec:** `event-links-edit-flow.spec.ts`.
7. **Integration spec:** `asset-mechanisms-edit-flow.spec.ts`.
8. **Integration spec:** `asset-routes-edit-flow.spec.ts`.
9. **Client:** `event.service.ts` switchover + spec update.
10. **Client:** `event-form.component.ts` save-path wiring for linked events.
11. **Client:** `asset.service.ts` switchover + spec update.
12. **Docs regen:** `npm run docs:arch` after migrations apply, commit regenerated runbook in the same PR.

Migration filenames use timestamps after `20260528100000` (the marker RPC migration). Actual filenames as shipped: `20260528130001_update_event_sources_rpc.sql`, `20260528130100_update_event_links_rpc.sql`, `20260528130200_update_asset_mechanisms_rpc.sql`, `20260528130300_update_asset_routes_rpc.sql`. (`130001` rather than `130000` to sequence after a parallel-terminal `dashboard_rpcs_emit_trial_acronym` migration that took the `130000` slot first.)

## Verification

- `cd src/client && ng lint && ng build` passes.
- `supabase db reset` re-applies all migrations cleanly; inline smokes emit their `PASS` notices.
- `supabase db advisors --local --type all` returns no new findings.
- Vitest integration specs pass against local Supabase.
- Manual smoke in dev: edit an existing event, change its sources and linked events, save, reload, verify both persist. Edit an existing asset, change MOAs and ROAs, save, reload, verify both persist.

## Open questions

Resolved during clarify:

1. **`updateLinks` fate:** Build the RPC AND wire it into the event-form save path. Fixes the latent persistence bug as part of this work.
2. **Empty input semantics:** Allow empty for all four RPCs. No orphan-cleanup triggers exist on the affected tables, and clear-all is a valid user operation.
3. **PR shape:** One combined PR for all RPCs, specs, and client switchover.
4. **Asset client switchover:** Keep `Promise.all([setMechanisms(), setRoutes()])`. Each RPC is independently atomic; no need for a combined RPC.

## References

- Commit c491d87 (the marker fix that established the pattern)
- `supabase/migrations/20260528100000_update_marker_assignments_rpc.sql`
- `src/client/integration/tests/marker-edit-flow.spec.ts`
- `supabase/migrations/20260521120300_orphan_marker_cleanup.sql` (the trigger that originally bit us)
- `docs/superpowers/specs/2026-05-10-audit-log-design.md` (audit-tier rubric)
- Memory: `feedback_atomic_mutation_across_triggers.md`
- Memory: `feedback_shared_entity_rpcs_no_inline_inserts.md`
