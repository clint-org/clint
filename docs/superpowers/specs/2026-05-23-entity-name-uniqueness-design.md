---
id: spec-2026-entity-name-uniqueness
title: Add uniqueness constraints on entity name columns
slug: entity-name-uniqueness
status: draft
created: 2026-05-23
updated: 2026-05-23
---

# Entity name uniqueness constraints

## Summary

Three space-scoped entity tables (`therapeutic_areas`, `marker_types`, `event_categories`) lack `unique(space_id, name)` constraints. Two related tables (`mechanisms_of_action`, `routes_of_administration`) already have them. This migration adds the missing constraints so that name-based entity resolution is deterministic across RPCs, import flows, and UI typeaheads.

## Motivation

1. **Deterministic name resolution.** The source-ingestion spec (`2026-05-21-source-ingestion-design.md`) resolves LLM-proposed entity names to existing rows by exact match on `(space_id, name)`. Without a uniqueness constraint, a space could have duplicate names, making the resolution ambiguous.
2. **Idempotent upserts.** The `commit_source_import` RPC needs `ON CONFLICT (space_id, name) DO NOTHING` for therapeutic areas, marker types, and event categories. This requires a unique constraint or index.
3. **Consistency.** `mechanisms_of_action` and `routes_of_administration` already enforce `unique(space_id, name)`. The three tables in scope serve the same structural role (space-scoped lookup tables with user-facing names) and should follow the same pattern.
4. **Data quality.** Duplicate names in the same space are user-facing bugs. They cause confusion in dropdowns and multi-selects, and analysts may unknowingly split data across duplicates.

## Current state

| Table | Has `unique(space_id, name)`? | Notes |
|---|---|---|
| `mechanisms_of_action` | Yes | Since `20260411130000` |
| `routes_of_administration` | Yes | Since `20260411130000` |
| `therapeutic_areas` | No | Has `space_id NOT NULL` since `20260315170100` |
| `marker_types` | No | Has `space_id` since `20260412130100` |
| `event_categories` | No | `space_id` nullable (NULL for system categories, non-NULL for space-custom) |

## Migration SQL

```sql
-- therapeutic_areas: straightforward, space_id is NOT NULL
alter table public.therapeutic_areas
  add constraint therapeutic_areas_space_name_unique unique (space_id, name);

-- marker_types: straightforward, space_id is NOT NULL after redesign migration
alter table public.marker_types
  add constraint marker_types_space_name_unique unique (space_id, name);

-- event_categories: space_id is nullable (NULL for system categories).
-- PostgreSQL treats NULLs as distinct in unique constraints, so
-- unique(space_id, name) only enforces uniqueness within a given space.
-- Two system categories with the same name would not be caught.
-- Add a partial unique index for system categories separately.
alter table public.event_categories
  add constraint event_categories_space_name_unique unique (space_id, name);

create unique index idx_event_categories_system_name_unique
  on public.event_categories (name) where space_id is null and is_system = true;
```

## Dedup prerequisite

Before adding the constraints, any existing duplicates must be resolved. The migration should include a dedup step that:

1. For each `(space_id, name)` group with more than one row, keeps the row with the oldest `created_at` and reassigns all FK references from the duplicate rows to the kept row.
2. Deletes the duplicate rows.
3. Then adds the constraint.

If local `supabase db reset` passes cleanly (seed data has no duplicates), the dedup step is a safety net for production data. Wrap it in a DO block:

```sql
do $$
declare
  v_count int;
begin
  -- therapeutic_areas dedup
  with dups as (
    select space_id, name, min(id) as keep_id
    from public.therapeutic_areas
    group by space_id, name
    having count(*) > 1
  )
  update public.trials t
  set therapeutic_area_id = d.keep_id
  from dups d
  join public.therapeutic_areas ta on ta.space_id = d.space_id and ta.name = d.name and ta.id <> d.keep_id
  where t.therapeutic_area_id = ta.id;

  delete from public.therapeutic_areas
  where id not in (
    select min(id) from public.therapeutic_areas group by space_id, name
  );

  -- marker_types dedup (reassign markers.marker_type_id)
  with dups as (
    select space_id, name, min(id) as keep_id
    from public.marker_types
    group by space_id, name
    having count(*) > 1
  )
  update public.markers m
  set marker_type_id = d.keep_id
  from dups d
  join public.marker_types mt on mt.space_id = d.space_id and mt.name = d.name and mt.id <> d.keep_id
  where m.marker_type_id = mt.id;

  delete from public.marker_types
  where id not in (
    select min(id) from public.marker_types group by space_id, name
  );

  -- event_categories dedup (reassign events.category_id)
  with dups as (
    select space_id, name, min(id) as keep_id
    from public.event_categories
    group by space_id, name
    having count(*) > 1
  )
  update public.events e
  set category_id = d.keep_id
  from dups d
  join public.event_categories ec on ec.space_id = d.space_id and ec.name = d.name and ec.id <> d.keep_id
  where e.category_id = ec.id;

  delete from public.event_categories
  where id not in (
    select min(id) from public.event_categories group by space_id, name
  );

  raise notice 'Dedup complete. Adding constraints.';
end$$;
```

## Impact on existing UI

Dropdowns and multi-selects for these three entity types should already prevent duplicates by using "Create new" affordances that check for existence. The constraint makes the enforcement authoritative at the database level. No UI changes are required, but any "Create new" code path that does a bare INSERT should be updated to use `INSERT ... ON CONFLICT (space_id, name) DO NOTHING` and return the existing row if the conflict fires.

## Testing

Vitest integration tests (`test:integration`) against local Supabase:

- Verify that duplicate `(space_id, name)` inserts are rejected on all three tables.
- Verify that `ON CONFLICT (space_id, name) DO NOTHING` returns cleanly.
- Verify that system event categories (space_id IS NULL, is_system = true) are protected by the partial unique index.
- Verify that two space-custom event categories with the same name in different spaces are allowed.
- Verify that the dedup migration runs cleanly on seed data (no duplicates expected, but the block should be idempotent).

## Non-goals

- Adding uniqueness constraints to `mechanisms_of_action` or `routes_of_administration` (they already have them).
- Enforcing uniqueness on entity names at the company / product / trial level (those have different semantics; two companies named "Pfizer" in different spaces is valid).
- Adding composite uniqueness across multiple columns (e.g., `unique(space_id, name, category_id)` on marker_types). The `(space_id, name)` constraint is sufficient for name-based resolution.
