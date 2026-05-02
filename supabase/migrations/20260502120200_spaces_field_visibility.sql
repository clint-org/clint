-- migration: 20260502120200_spaces_field_visibility
-- purpose: add a per-space jsonb config column that controls which CT.gov
--   fields are surfaced where (e.g. trial detail vs. change feed). shape is
--   { surface_key: [field_path, ...] }; defaults to an empty object so
--   existing spaces continue to use the built-in defaults until configured.

alter table public.spaces
  add column ctgov_field_visibility jsonb not null default '{}';

comment on column public.spaces.ctgov_field_visibility is
  'Per-surface CT.gov field display config. Shape: { surface_key: [field_path, ...] }';
