-- seed data for the clinical trial dashboard
-- this file is executed after all migrations on `supabase start` and `supabase db reset`.
-- it populates system marker types.

-- =============================================================================
-- system marker types (idempotent)
-- =============================================================================

insert into public.marker_types (id, space_id, created_by, name, icon, shape, fill_style, color, is_system, display_order)
values
  ('a0000000-0000-0000-0000-000000000001', null, null, 'Projected Data Reported', 'projected-data', 'circle', 'outline', '#22c55e', true, 1),
  ('a0000000-0000-0000-0000-000000000002', null, null, 'Data Reported', 'data-reported', 'circle', 'filled', '#22c55e', true, 2),
  ('a0000000-0000-0000-0000-000000000003', null, null, 'Projected Regulatory Filing', 'projected-filing', 'diamond', 'outline', '#ef4444', true, 3),
  ('a0000000-0000-0000-0000-000000000004', null, null, 'Submitted Regulatory Filing', 'submitted-filing', 'diamond', 'filled', '#ef4444', true, 4),
  ('a0000000-0000-0000-0000-000000000005', null, null, 'Label Projected Approval/Launch', 'projected-approval', 'flag', 'outline', '#3b82f6', true, 5),
  ('a0000000-0000-0000-0000-000000000006', null, null, 'Label Update', 'label-update', 'flag', 'striped', '#3b82f6', true, 6),
  ('a0000000-0000-0000-0000-000000000007', null, null, 'Est. Range of Potential Launch', 'est-launch-range', 'bar', 'gradient', '#3b82f6', true, 7),
  ('a0000000-0000-0000-0000-000000000008', null, null, 'Primary Completion Date (PCD)', 'pcd', 'circle', 'filled', '#374151', true, 8),
  ('a0000000-0000-0000-0000-000000000009', null, null, 'Change from Prior Update', 'change-prior', 'arrow', 'filled', '#f97316', true, 9),
  ('a0000000-0000-0000-0000-000000000010', null, null, 'Event No Longer Expected', 'no-longer-expected', 'x', 'filled', '#ef4444', true, 10)
on conflict (id) do nothing;
