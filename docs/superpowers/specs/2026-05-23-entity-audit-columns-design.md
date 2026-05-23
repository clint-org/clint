---
id: spec-2026-entity-audit-columns
title: Standardize entity audit columns (created_by, updated_by)
slug: entity-audit-columns
status: draft
created: 2026-05-23
updated: 2026-05-23
---

# Standardize entity audit columns

## Summary

The original core tables (`companies`, `products`, `trials`, `trial_phases`, `marker_types`) use `user_id` for the creator column. Newer tables (`markers`, `events`, `source_documents`) use `created_by`. No entity table has `updated_by`. This migration renames `user_id` to `created_by` on the five legacy tables and adds `updated_by` on all tables that already have `updated_at`, establishing a consistent audit column convention across the entity layer.

## Motivation

1. **Consistency.** Two naming conventions for the same concept (`user_id` vs. `created_by`) create confusion in RPCs, RLS policies, and Angular services. New code must check which convention a given table uses before writing an insert.
2. **Audit completeness.** `updated_at` exists on most entity tables but `updated_by` does not, so there is no record of who last modified a row. The source-ingestion spec (`2026-05-21-source-ingestion-design.md`) and future AI features need `created_by` consistently to populate provenance on bulk inserts.
3. **Mechanical change.** The rename is a column alias, not a data migration. All data is preserved; only references in RLS policies, RPCs, indexes, and application code need updating.

## Scope

### Tables to rename `user_id` to `created_by`

| Table | Current column | Has `updated_at`? | Add `updated_by`? |
|---|---|---|---|
| `companies` | `user_id` (NOT NULL) | Yes | Yes |
| `products` | `user_id` (NOT NULL) | Yes | Yes |
| `trials` | `user_id` (NOT NULL) | Yes | Yes |
| `trial_phases` | `user_id` (NOT NULL) | No (`created_at` only) | No |
| `marker_types` | `user_id` (nullable) | No (`created_at` only) | No |

### Tables that already use `created_by` but need `updated_by`

| Table | Has `updated_at`? | Add `updated_by`? |
|---|---|---|
| `markers` | Yes | Yes |
| `events` | Yes | Yes |

`therapeutic_areas` already uses `created_by` (renamed in `20260315170100`) and does not have `updated_at`, so it is not in scope.

### Tables excluded

- `source_documents`, `ai_calls`, `ai_config`: new tables introduced by the source-ingestion spec; they define their audit columns from scratch.
- `spaces`, `tenants`, `agencies`, `tenant_members`, `space_members`, `tenant_invites`, `audit_events`, `platform_admins`: governance tables with their own column conventions (not entity CRUD tables).

## Migration SQL

```sql
-- === Renames ===

-- companies
alter table public.companies rename column user_id to created_by;
alter table public.companies add column updated_by uuid references auth.users(id);
drop index if exists idx_companies_user_id;
create index idx_companies_created_by on public.companies (created_by);

-- products
alter table public.products rename column user_id to created_by;
alter table public.products add column updated_by uuid references auth.users(id);
drop index if exists idx_products_user_id;
create index idx_products_created_by on public.products (created_by);

-- trials
alter table public.trials rename column user_id to created_by;
alter table public.trials add column updated_by uuid references auth.users(id);
drop index if exists idx_trials_user_id;
create index idx_trials_created_by on public.trials (created_by);

-- trial_phases (no updated_at, skip updated_by)
alter table public.trial_phases rename column user_id to created_by;
drop index if exists idx_trial_phases_user_id;
create index idx_trial_phases_created_by on public.trial_phases (created_by);

-- marker_types (no updated_at, skip updated_by)
alter table public.marker_types rename column user_id to created_by;

-- === Add updated_by to tables that already have updated_at + created_by ===

-- markers (already has created_by)
alter table public.markers add column updated_by uuid references auth.users(id);

-- events (already has created_by)
alter table public.events add column updated_by uuid references auth.users(id);
```

## RLS and RPC updates

All RLS policies and RPCs that reference `user_id` on the five renamed tables must be updated to use `created_by`. This is a mechanical find-and-replace scoped to:

- RLS policy definitions in `supabase/migrations/` that filter on `user_id = auth.uid()` for these tables.
- RPC bodies that insert or select `user_id` on these tables.
- Any Angular services that reference `user_id` in Supabase query builders.

The migration must also update any existing RPC that performs an UPDATE on these tables to set `updated_by = auth.uid()` alongside `updated_at = now()`.

## Testing

Vitest integration tests (`test:integration`) against local Supabase:

- Verify that `created_by` is populated on INSERT for all five renamed tables.
- Verify that `updated_by` is populated on UPDATE for companies, products, trials, markers, events.
- Verify that RLS policies still gate correctly after the rename (SELECT, INSERT, UPDATE, DELETE for each role).
- Verify that existing seed data is unaffected (column rename preserves data).

## Non-goals

- Renaming columns on governance tables (spaces, tenants, etc.). Those have their own conventions.
- Adding `updated_at` to tables that don't have it (trial_phases, marker_types). That can be a separate change if needed.
- Backfilling `updated_by` on existing rows. New column is nullable; existing rows will have `updated_by = NULL` until the next update.
