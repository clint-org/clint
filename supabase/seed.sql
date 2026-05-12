-- seed data for the clinical trial dashboard
-- this file is executed after all migrations on `supabase start` and `supabase db reset`.
-- it populates system marker types and a small set of sample markers for local dev.

-- =============================================================================
-- system marker categories (idempotent)
-- =============================================================================

insert into public.marker_categories (id, space_id, name, display_order, is_system, created_by)
values
  ('c0000000-0000-0000-0000-000000000001', null, 'Clinical Trial',       1, true, null),
  ('c0000000-0000-0000-0000-000000000002', null, 'Data',                 2, true, null),
  ('c0000000-0000-0000-0000-000000000003', null, 'Regulatory',           3, true, null),
  ('c0000000-0000-0000-0000-000000000004', null, 'Approval',             4, true, null),
  ('c0000000-0000-0000-0000-000000000005', null, 'Loss of Exclusivity',  5, true, null)
on conflict (id) do update set
  name          = excluded.name,
  display_order = excluded.display_order,
  is_system     = excluded.is_system;

-- =============================================================================
-- system marker types (idempotent)
-- category_id references the system marker_categories seeded in the redesign
-- migration (20260412130100). category UUIDs follow the c0000000-... pattern.
-- =============================================================================

insert into public.marker_types (id, space_id, created_by, name, icon, shape, fill_style, color, inner_mark, is_system, display_order, category_id)
values
  -- Data category (c...0002)
  ('a0000000-0000-0000-0000-000000000013', null, null, 'Topline Data',      'topline-data',  'circle',      'filled', '#4ade80', 'dot',  true,  1, 'c0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000030', null, null, 'Interim Data',      'interim-data',  'circle',      'filled', '#22c55e', 'dash', true,  2, 'c0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000031', null, null, 'Full Data',         'full-data',     'circle',      'filled', '#16a34a', 'none', true,  3, 'c0000000-0000-0000-0000-000000000002'),
  -- Regulatory category (c...0003)
  ('a0000000-0000-0000-0000-000000000032', null, null, 'Regulatory Filing', 'reg-filing',    'diamond',     'filled', '#f97316', 'dot',  true,  4, 'c0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000033', null, null, 'Submission',        'submission',    'diamond',     'filled', '#f97316', 'none', true,  5, 'c0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000034', null, null, 'Acceptance',        'acceptance',    'diamond',     'filled', '#f97316', 'check',true,  6, 'c0000000-0000-0000-0000-000000000003'),
  -- Clinical Trial category (c...0001)
  ('a0000000-0000-0000-0000-000000000008', null, null, 'Primary Completion Date (PCD)', 'pcd', 'circle',   'filled', '#475569', 'none', true,  7, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000011', null, null, 'Trial Start',       'trial-start',   'dashed-line', 'filled', '#94a3b8', 'none', true,  8, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000012', null, null, 'Trial End',         'trial-end',     'dashed-line', 'filled', '#94a3b8', 'none', true,  9, 'c0000000-0000-0000-0000-000000000001'),
  -- Approval category (c...0004)
  ('a0000000-0000-0000-0000-000000000035', null, null, 'Approval',          'approval',      'flag',        'filled', '#3b82f6', 'none', true, 10, 'c0000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-000000000036', null, null, 'Launch',            'launch',        'triangle',    'filled', '#7c3aed', 'none', true, 11, 'c0000000-0000-0000-0000-000000000004'),
  -- Loss of Exclusivity category (c...0005)
  ('a0000000-0000-0000-0000-000000000020', null, null, 'LOE Date',          'loe-date',      'square',      'filled', '#78350f', 'x',    true, 12, 'c0000000-0000-0000-0000-000000000005'),
  ('a0000000-0000-0000-0000-000000000021', null, null, 'Generic Entry Date','generic-entry-date','square',  'filled', '#d97706', 'none', true, 13, 'c0000000-0000-0000-0000-000000000005')
on conflict (id) do update set
  name          = excluded.name,
  icon          = excluded.icon,
  shape         = excluded.shape,
  fill_style    = excluded.fill_style,
  color         = excluded.color,
  inner_mark    = excluded.inner_mark,
  is_system     = excluded.is_system,
  display_order = excluded.display_order,
  category_id   = excluded.category_id;

-- =============================================================================
-- system event categories (idempotent)
-- =============================================================================

insert into public.event_categories (id, space_id, name, display_order, is_system, created_by)
values
  ('e0000000-0000-0000-0000-000000000001', null, 'Leadership',  1, true, null),
  ('e0000000-0000-0000-0000-000000000002', null, 'Regulatory',  2, true, null),
  ('e0000000-0000-0000-0000-000000000003', null, 'Financial',   3, true, null),
  ('e0000000-0000-0000-0000-000000000004', null, 'Strategic',   4, true, null),
  ('e0000000-0000-0000-0000-000000000005', null, 'Clinical',    5, true, null),
  ('e0000000-0000-0000-0000-000000000006', null, 'Commercial',  6, true, null)
on conflict (id) do update set
  name          = excluded.name,
  display_order = excluded.display_order,
  is_system     = excluded.is_system;

-- =============================================================================
-- LOCAL DEV demo tenant + space (stable across `supabase db reset`).
-- Combined with the auto_join_demo_on_signup trigger at the bottom of this
-- file, any Google sign-in is automatically granted owner access to the demo
-- tenant and space, so a developer never loses their seeded workspace after a
-- reset. In production this block is harmless: the trigger checks for the
-- demo tenant by fixed UUID and no-ops when it is absent.
-- =============================================================================

-- bootstrap user owns the demo content (created_by FKs into auth.users).
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-00000000000d', 'demo-bootstrap@clint.local')
on conflict (id) do nothing;

insert into public.tenants (
  id, name, slug, subdomain, app_display_name, primary_color, email_self_join_enabled
)
values (
  '00000000-0000-0000-0000-0000000d0010',
  'Demo Pharma CI',
  'demo-pharma-ci',
  'demo',
  'Demo Pharma CI',
  '#0d9488',
  true
)
on conflict (id) do nothing;

insert into public.tenant_members (tenant_id, user_id, role)
values ('00000000-0000-0000-0000-0000000d0010', '00000000-0000-0000-0000-00000000000d', 'owner')
on conflict (tenant_id, user_id) do nothing;

insert into public.spaces (id, tenant_id, name, description, created_by)
values (
  '00000000-0000-0000-0000-0000000d0100',
  '00000000-0000-0000-0000-0000000d0010',
  'Pipeline Demo',
  'Seeded demo space for local UI walkthroughs.',
  '00000000-0000-0000-0000-00000000000d'
)
on conflict (id) do nothing;

insert into public.space_members (space_id, user_id, role)
values ('00000000-0000-0000-0000-0000000d0100', '00000000-0000-0000-0000-00000000000d', 'owner')
on conflict (space_id, user_id) do nothing;

-- Fill the demo space with companies, trials, markers, events, and
-- intelligence via the existing seed_demo_data RPC. Spoof auth.uid() to the
-- bootstrap user since the RPC asserts an authenticated session. Skip if the
-- space already has content (idempotent across re-runs of seed.sql).
do $$
declare
  v_existing int;
begin
  select count(*) into v_existing
  from public.companies
  where space_id = '00000000-0000-0000-0000-0000000d0100';
  if v_existing > 0 then return; end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '00000000-0000-0000-0000-00000000000d',
      'role', 'authenticated'
    )::text,
    true
  );
  set local role authenticated;
  perform public.seed_demo_data('00000000-0000-0000-0000-0000000d0100'::uuid);
  reset role;
end
$$;

-- Auto-join: every new auth.users row is added to the demo tenant + space as
-- owner. The trigger is a no-op in environments where the demo tenant does
-- not exist (production), so this is safe to ship in seed.sql.
create or replace function public.auto_join_demo_tenant_local()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demo_tenant uuid := '00000000-0000-0000-0000-0000000d0010';
  v_demo_space  uuid := '00000000-0000-0000-0000-0000000d0100';
begin
  if not exists (select 1 from public.tenants where id = v_demo_tenant) then
    return new;
  end if;
  -- Skip integration-test personas and other fixture accounts. The
  -- role-access.spec asserts that a fresh persona sees zero tenants and
  -- zero spaces; auto-joining them to the demo tenant breaks that
  -- invariant. Real Google-OAuth dev users always pass through.
  if new.email is null
     or new.email like '%@personas.test'
     or new.email like '%@clint.local'
     or new.email like 'e2e-%'
  then
    return new;
  end if;
  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_demo_tenant, new.id, 'owner')
  on conflict (tenant_id, user_id) do nothing;
  insert into public.space_members (space_id, user_id, role)
  values (v_demo_space, new.id, 'owner')
  on conflict (space_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists auto_join_demo_on_signup on auth.users;
create trigger auto_join_demo_on_signup
  after insert on auth.users
  for each row
  execute function public.auto_join_demo_tenant_local();
