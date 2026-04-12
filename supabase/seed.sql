-- seed data for the clinical trial dashboard
-- this file is executed after all migrations on `supabase start` and `supabase db reset`.
-- it populates system marker types and a small set of sample markers for local dev.

-- =============================================================================
-- system marker types (idempotent)
-- category_id references the system marker_categories seeded in the redesign
-- migration (20260412130100). category UUIDs follow the c0000000-... pattern.
-- =============================================================================

insert into public.marker_types (id, space_id, created_by, name, icon, shape, fill_style, color, is_system, display_order, category_id)
values
  -- Data category (c...0002)
  ('a0000000-0000-0000-0000-000000000001', null, null, 'Projected Data Reported',       'projected-data',    'circle',   'outline',  '#22c55e', true,  1, 'c0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000002', null, null, 'Data Reported',                 'data-reported',     'circle',   'filled',   '#22c55e', true,  2, 'c0000000-0000-0000-0000-000000000002'),
  -- Regulatory category (c...0003)
  ('a0000000-0000-0000-0000-000000000003', null, null, 'Projected Regulatory Filing',   'projected-filing',  'diamond',  'outline',  '#ef4444', true,  3, 'c0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000004', null, null, 'Submitted Regulatory Filing',   'submitted-filing',  'diamond',  'filled',   '#ef4444', true,  4, 'c0000000-0000-0000-0000-000000000003'),
  -- Approval category (c...0004)
  ('a0000000-0000-0000-0000-000000000005', null, null, 'Label Projected Approval/Launch','projected-approval','flag',    'outline',  '#3b82f6', true,  5, 'c0000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-000000000006', null, null, 'Label Update',                  'label-update',      'flag',     'striped',  '#3b82f6', true,  6, 'c0000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-000000000007', null, null, 'Est. Range of Potential Launch','est-launch-range',  'bar',      'gradient', '#3b82f6', true,  7, 'c0000000-0000-0000-0000-000000000004'),
  -- Clinical Trial category (c...0001)
  ('a0000000-0000-0000-0000-000000000008', null, null, 'Primary Completion Date (PCD)', 'pcd',               'circle',   'filled',   '#374151', true,  8, 'c0000000-0000-0000-0000-000000000001'),
  -- Data category (c...0002)
  ('a0000000-0000-0000-0000-000000000009', null, null, 'Change from Prior Update',      'change-prior',      'arrow',    'filled',   '#f97316', true,  9, 'c0000000-0000-0000-0000-000000000002'),
  -- Clinical Trial category (c...0001)
  ('a0000000-0000-0000-0000-000000000010', null, null, 'Event No Longer Expected',      'no-longer-expected','x',        'filled',   '#ef4444', true, 10, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
