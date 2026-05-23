-- migration: 20260523120000_entity_name_uniqueness
-- purpose: add unique(space_id, name) constraints to therapeutic_areas,
--          marker_types, and event_categories. mechanisms_of_action and
--          routes_of_administration already have them (since 20260411130000).
-- affected tables: therapeutic_areas, marker_types, event_categories
-- spec: docs/superpowers/specs/2026-05-23-entity-name-uniqueness-design.md

-- =============================================================================
-- 1. dedup safety net
-- =============================================================================
-- Production may have duplicate (space_id, name) rows. Resolve them before
-- adding constraints: keep the row with the lexicographically smallest id
-- (deterministic), reassign FK references, then delete the losers.
-- On a clean local reset this block is a no-op.

do $$
begin
  -- therapeutic_areas: space_id is NOT NULL, FK = trials.therapeutic_area_id
  -- Keep the oldest row per (space_id, name) group; reassign FKs then delete losers.
  with keepers as (
    select distinct on (space_id, name) id, space_id, name
    from public.therapeutic_areas
    order by space_id, name, created_at
  )
  update public.trials t
  set therapeutic_area_id = k.id
  from public.therapeutic_areas ta
  join keepers k on k.space_id = ta.space_id and k.name = ta.name and k.id <> ta.id
  where t.therapeutic_area_id = ta.id;

  delete from public.therapeutic_areas ta
  where exists (
    select 1 from public.therapeutic_areas other
    where other.space_id = ta.space_id
      and other.name = ta.name
      and other.created_at < ta.created_at
  );

  -- marker_types: space_id is nullable, FK = markers.marker_type_id
  with keepers as (
    select distinct on (space_id, name) id, space_id, name
    from public.marker_types
    order by space_id, name, created_at
  )
  update public.markers m
  set marker_type_id = k.id
  from public.marker_types mt
  join keepers k
    on k.space_id is not distinct from mt.space_id
   and k.name = mt.name
   and k.id <> mt.id
  where m.marker_type_id = mt.id;

  delete from public.marker_types mt
  where exists (
    select 1 from public.marker_types other
    where other.space_id is not distinct from mt.space_id
      and other.name = mt.name
      and other.created_at < mt.created_at
  );

  -- event_categories: space_id is nullable, FK = events.category_id
  with keepers as (
    select distinct on (space_id, name) id, space_id, name
    from public.event_categories
    order by space_id, name, created_at
  )
  update public.events e
  set category_id = k.id
  from public.event_categories ec
  join keepers k
    on k.space_id is not distinct from ec.space_id
   and k.name = ec.name
   and k.id <> ec.id
  where e.category_id = ec.id;

  delete from public.event_categories ec
  where exists (
    select 1 from public.event_categories other
    where other.space_id is not distinct from ec.space_id
      and other.name = ec.name
      and other.created_at < ec.created_at
  );

  raise notice 'entity name dedup complete';
end$$;

-- =============================================================================
-- 2. unique constraints
-- =============================================================================

-- therapeutic_areas: space_id is NOT NULL, so the constraint covers all rows.
alter table public.therapeutic_areas
  add constraint therapeutic_areas_space_name_unique unique (space_id, name);

-- marker_types: space_id is nullable (NULL for system types).
-- The table-level constraint covers space-scoped rows. PostgreSQL treats NULLs
-- as distinct in unique constraints, so system rows need a separate partial
-- unique index.
alter table public.marker_types
  add constraint marker_types_space_name_unique unique (space_id, name);

create unique index idx_marker_types_system_name_unique
  on public.marker_types (name) where space_id is null and is_system = true;

-- event_categories: same nullable space_id pattern as marker_types.
alter table public.event_categories
  add constraint event_categories_space_name_unique unique (space_id, name);

create unique index idx_event_categories_system_name_unique
  on public.event_categories (name) where space_id is null and is_system = true;
