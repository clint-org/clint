-- seed data for the clinical trial dashboard
-- this file is executed after all migrations on `supabase start` and `supabase db reset`.
-- it populates the predefined system marker types used across all dashboards.

-- =============================================================================
-- system marker types
-- =============================================================================
-- these are the 10 built-in marker types available to all users.
-- system markers have is_system = true and user_id = null.

insert into public.marker_types (id, user_id, name, icon, shape, fill_style, color, is_system, display_order)
values
  (gen_random_uuid(), null, 'Projected Data Reported', 'projected-data', 'circle', 'outline', '#22c55e', true, 1),
  (gen_random_uuid(), null, 'Data Reported', 'data-reported', 'circle', 'filled', '#22c55e', true, 2),
  (gen_random_uuid(), null, 'Projected Regulatory Filing', 'projected-filing', 'diamond', 'outline', '#ef4444', true, 3),
  (gen_random_uuid(), null, 'Submitted Regulatory Filing', 'submitted-filing', 'diamond', 'filled', '#ef4444', true, 4),
  (gen_random_uuid(), null, 'Label Projected Approval/Launch', 'projected-approval', 'flag', 'outline', '#3b82f6', true, 5),
  (gen_random_uuid(), null, 'Label Update', 'label-update', 'flag', 'striped', '#3b82f6', true, 6),
  (gen_random_uuid(), null, 'Est. Range of Potential Launch', 'est-launch-range', 'bar', 'gradient', '#3b82f6', true, 7),
  (gen_random_uuid(), null, 'Primary Completion Date (PCD)', 'pcd', 'circle', 'filled', '#374151', true, 8),
  (gen_random_uuid(), null, 'Change from Prior Update', 'change-prior', 'arrow', 'filled', '#f97316', true, 9),
  (gen_random_uuid(), null, 'Event No Longer Expected', 'no-longer-expected', 'x', 'filled', '#ef4444', true, 10);
