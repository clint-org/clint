-- migration: 20260523120000_add_updated_by_columns
-- purpose: add updated_by audit column to all entity tables that have updated_at,
--          establishing a consistent convention for tracking who last modified a row.
-- spec: docs/superpowers/specs/2026-05-23-entity-audit-columns-design.md

-- companies
alter table public.companies add column updated_by uuid references auth.users(id);

-- products
alter table public.products add column updated_by uuid references auth.users(id);

-- trials
alter table public.trials add column updated_by uuid references auth.users(id);

-- markers
alter table public.markers add column updated_by uuid references auth.users(id);

-- events
alter table public.events add column updated_by uuid references auth.users(id);

-- trial_notes
alter table public.trial_notes add column updated_by uuid references auth.users(id);
