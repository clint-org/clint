-- seed system marker types (shared across all users, not tied to any user_id)
-- uses ON CONFLICT to be idempotent

insert into public.marker_types (id, user_id, name, icon, shape, fill_style, color, is_system, display_order)
values
  ('a0000000-0000-0000-0000-000000000001', null, 'Projected Data Reported', 'projected-data', 'circle', 'outline', '#22c55e', true, 1),
  ('a0000000-0000-0000-0000-000000000002', null, 'Data Reported', 'data-reported', 'circle', 'filled', '#22c55e', true, 2),
  ('a0000000-0000-0000-0000-000000000003', null, 'Projected Regulatory Filing', 'projected-filing', 'diamond', 'outline', '#ef4444', true, 3),
  ('a0000000-0000-0000-0000-000000000004', null, 'Submitted Regulatory Filing', 'submitted-filing', 'diamond', 'filled', '#ef4444', true, 4),
  ('a0000000-0000-0000-0000-000000000005', null, 'Label Projected Approval/Launch', 'projected-approval', 'flag', 'outline', '#3b82f6', true, 5),
  ('a0000000-0000-0000-0000-000000000006', null, 'Label Update', 'label-update', 'flag', 'striped', '#3b82f6', true, 6),
  ('a0000000-0000-0000-0000-000000000007', null, 'Est. Range of Potential Launch', 'est-launch-range', 'bar', 'gradient', '#3b82f6', true, 7),
  ('a0000000-0000-0000-0000-000000000008', null, 'Primary Completion Date (PCD)', 'pcd', 'circle', 'filled', '#374151', true, 8),
  ('a0000000-0000-0000-0000-000000000009', null, 'Change from Prior Update', 'change-prior', 'arrow', 'filled', '#f97316', true, 9),
  ('a0000000-0000-0000-0000-000000000010', null, 'Event No Longer Expected', 'no-longer-expected', 'x', 'filled', '#ef4444', true, 10)
on conflict (id) do nothing;
