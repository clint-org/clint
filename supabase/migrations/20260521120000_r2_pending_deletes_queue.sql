-- migration: 20260521120000_r2_pending_deletes_queue
-- purpose: queue r2 file deletes in postgres so file cleanup is enforced by
--          triggers, not client cooperation. addresses cascade-safety
--          finding #5 (storage objects leak when materials are removed via
--          space cascade or any path other than the delete_material rpc).
--
--   schema:
--     public.r2_pending_deletes  enqueue table (worker-drained)
--     index r2_pending_deletes_pending  partial idx for the drain loop
--
--   trigger:
--     public._enqueue_r2_delete()                trigger fn
--     _enqueue_r2_delete_on_materials            after delete on materials
--
--   rpc revision:
--     public.delete_material(p_id uuid)          stops returning file_path
--                                                 the trigger handles the
--                                                 storage cleanup now
--
--   inline smoke test verifies:
--     - delete_material returns jsonb without a file_path key.
--     - one r2_pending_deletes row appears with the expected path.
--     - a direct cascade through spaces enqueues n rows for n materials.
--
--   see docs/superpowers/specs/2026-05-20-cascade-safety-design.md
--   ("r2 file cleanup queue").


-- =============================================================================
-- table: r2_pending_deletes
-- =============================================================================

create table public.r2_pending_deletes (
  id            uuid primary key default gen_random_uuid(),
  file_path     text not null,
  queued_at     timestamptz not null default now(),
  attempted_at  timestamptz,
  succeeded_at  timestamptz,
  attempt_count int not null default 0,
  last_error    text
);

comment on table public.r2_pending_deletes is
  'Worker-drained queue of r2 file paths to delete. Rows are inserted by '
  'the _enqueue_r2_delete trigger on public.materials. A cloudflare worker '
  'polls this table, issues r2 delete calls, and stamps succeeded_at or '
  'last_error + attempt_count. Rows past max attempts surface for ops '
  'review. Not user-facing.';

create index r2_pending_deletes_pending
  on public.r2_pending_deletes (queued_at)
  where succeeded_at is null;


-- =============================================================================
-- rls: worker-only queue
-- =============================================================================
-- the queue is owned by the cloudflare worker (via service_role). end users
-- never read or write it. we still grant select to authenticated so ops can
-- inspect drain health from supabase studio; no policy is added, so the
-- default deny applies under RLS for non-service_role connections.

alter table public.r2_pending_deletes enable row level security;

revoke all on public.r2_pending_deletes from anon, authenticated;
grant select on public.r2_pending_deletes to authenticated;
grant insert, update, delete on public.r2_pending_deletes to service_role;


-- =============================================================================
-- trigger fn: _enqueue_r2_delete
-- =============================================================================
-- after delete on public.materials, enqueue old.file_path. security definer
-- so the insert succeeds regardless of the deleting role; trigger fires
-- whether the delete originated from delete_material(), a space cascade,
-- or a tenant-level cascade.

create or replace function public._enqueue_r2_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.r2_pending_deletes (file_path)
  values (old.file_path);
  return old;
end;
$$;

comment on function public._enqueue_r2_delete() is
  'AFTER DELETE trigger fn for public.materials. Enqueues the deleted '
  'row''s file_path into public.r2_pending_deletes so the r2 drain worker '
  'cleans up the underlying object. Security definer so cascade-driven '
  'deletes from any role succeed.';

create trigger _enqueue_r2_delete_on_materials
  after delete on public.materials
  for each row execute function public._enqueue_r2_delete();


-- =============================================================================
-- delete_material rpc: drop the file_path return value
-- =============================================================================
-- the trigger now handles file cleanup; the client no longer needs the
-- file_path returned. the return shape becomes { material_id: uuid }.

create or replace function public.delete_material(
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select m.id, m.space_id, m.uploaded_by
    into v_row
  from public.materials m
  where m.id = p_id;

  if v_row.id is null then
    raise exception 'material not found' using errcode = 'P0002';
  end if;

  if v_row.uploaded_by <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not public.has_space_access(v_row.space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.materials where id = p_id;

  -- the AFTER DELETE trigger _enqueue_r2_delete_on_materials enqueues
  -- the file_path into public.r2_pending_deletes; the cloudflare worker
  -- removes the object asynchronously. clients no longer call
  -- supabase.storage.from('materials').remove() directly.
  return jsonb_build_object(
    'material_id', v_row.id
  );
end;
$$;

revoke execute on function public.delete_material(uuid) from public, anon;
grant  execute on function public.delete_material(uuid) to authenticated;

comment on function public.delete_material(uuid) is
  'Hard-deletes a material row. The AFTER DELETE trigger on materials '
  'enqueues the file into public.r2_pending_deletes; the cloudflare worker '
  'drains the queue and issues r2 DELETE per row. Return shape is '
  '{ material_id }; file_path is no longer returned (cleanup is now a '
  'database concern, not a client one). Security definer; same gates as '
  'before: caller must be the uploader and have owner/editor access to '
  'the containing space.';


-- =============================================================================
-- smoke test
-- =============================================================================
-- builds a fixture, exercises the direct delete_material path, then a
-- space-level cascade through three materials. asserts return shape lacks
-- file_path and that r2_pending_deletes accumulates the expected rows.
--
-- teardown follows the clint.member_guard_cascade = on pattern from
-- 20260503090000_delete_space_rpc.sql to bypass the membership self-
-- protection guards while removing fixtures.

do $$
declare
  v_user      uuid := gen_random_uuid();
  v_tenant    uuid := gen_random_uuid();
  v_space     uuid := gen_random_uuid();
  v_material  uuid := gen_random_uuid();
  v_email     text := 'r2-queue-smoke-' || v_user || '@example.com';
  v_path      text;
  v_result    jsonb;
  v_queue_rows int;
  v_baseline   int;
begin
  -- baseline queue size so we can assert deltas regardless of seed data
  -- or prior smoke tests in the same db reset.
  select count(*)::int into v_baseline from public.r2_pending_deletes;

  insert into auth.users (id, email, instance_id, aud, role)
    values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.tenants (id, name, slug)
    values (v_tenant, 'r2-smoke-tenant', 'r2-smoke-' || left(v_tenant::text, 8));
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_user, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant, 'r2-smoke-space', v_user);
  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_user, 'owner');

  v_path := 'materials/' || v_space::text || '/' || v_material::text || '/test.pdf';

  -- impersonate the owner so auth.uid() matches the uploaded_by gate inside
  -- delete_material; tenants without a jwt claim see auth.uid() = null.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
    true
  );

  insert into public.materials (
    id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title
  )
  values (
    v_material, v_space, v_user, v_path, 'test.pdf', 1024,
    'application/pdf', 'briefing', 'r2 smoke material'
  );

  -- exercise the rpc as the authenticated role so RLS + the SECURITY DEFINER
  -- gate run end to end.
  set local role authenticated;
  begin
    v_result := public.delete_material(v_material);
  exception when others then
    reset role;
    raise exception 'r2 queue smoke FAIL: delete_material threw % (sqlstate %)',
      sqlerrm, sqlstate;
  end;
  reset role;

  -- return shape must contain material_id and must NOT contain file_path.
  if (v_result ->> 'material_id') is null then
    raise exception 'r2 queue smoke FAIL: delete_material result missing material_id; got %', v_result;
  end if;
  if v_result ? 'file_path' then
    raise exception 'r2 queue smoke FAIL: delete_material result still contains file_path; got %', v_result;
  end if;

  -- exactly one queue row appears with the expected file_path.
  select count(*)::int
    into v_queue_rows
  from public.r2_pending_deletes
  where file_path = v_path;
  if v_queue_rows <> 1 then
    raise exception 'r2 queue smoke FAIL: expected 1 queue row for %, got %', v_path, v_queue_rows;
  end if;

  -- ---------------------------------------------------------------------------
  -- cascade scenario: a fresh space with three materials, then delete the
  -- space directly. trigger should enqueue three new rows.
  -- ---------------------------------------------------------------------------
  declare
    v_space2     uuid := gen_random_uuid();
    v_mat_a      uuid := gen_random_uuid();
    v_mat_b      uuid := gen_random_uuid();
    v_mat_c      uuid := gen_random_uuid();
    v_path_a     text;
    v_path_b     text;
    v_path_c     text;
    v_cascade_n  int;
  begin
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space2, v_tenant, 'r2-smoke-space-cascade', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space2, v_user, 'owner');

    v_path_a := 'materials/' || v_space2::text || '/' || v_mat_a::text || '/a.pdf';
    v_path_b := 'materials/' || v_space2::text || '/' || v_mat_b::text || '/b.pdf';
    v_path_c := 'materials/' || v_space2::text || '/' || v_mat_c::text || '/c.pdf';

    insert into public.materials (
      id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
      mime_type, material_type, title
    )
    values
      (v_mat_a, v_space2, v_user, v_path_a, 'a.pdf', 1, 'application/pdf', 'briefing', 'a'),
      (v_mat_b, v_space2, v_user, v_path_b, 'b.pdf', 1, 'application/pdf', 'briefing', 'b'),
      (v_mat_c, v_space2, v_user, v_path_c, 'c.pdf', 1, 'application/pdf', 'briefing', 'c');

    -- direct cascade: drop the space, which cascades into materials and
    -- fires the AFTER DELETE trigger per row. impersonation cleared so
    -- the unconditional delete runs as the migration role. the markers
    -- explicit-delete dance from delete_space() is unnecessary here since
    -- no markers were created in this fixture.
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', null, true);
    delete from public.spaces where id = v_space2;

    select count(*)::int
      into v_cascade_n
    from public.r2_pending_deletes
    where file_path in (v_path_a, v_path_b, v_path_c);
    if v_cascade_n <> 3 then
      raise exception 'r2 queue smoke FAIL: expected 3 queue rows from space cascade, got %', v_cascade_n;
    end if;
  end;

  -- final total delta: 1 from the direct rpc + 3 from the cascade = 4.
  select count(*)::int into v_queue_rows from public.r2_pending_deletes;
  if v_queue_rows - v_baseline <> 4 then
    raise exception 'r2 queue smoke FAIL: queue delta expected 4, got %', v_queue_rows - v_baseline;
  end if;

  -- teardown. delete_material did not touch the space; sweep all member
  -- rows up front under the bypass GUC, then the parents. This mirrors
  -- the working pattern in 20260503090000_delete_space_rpc.sql: the
  -- spaces / tenants AFTER-delete triggers flip the GUC back to 'off',
  -- so explicit member-row deletes must precede the parent deletes.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members  where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.spaces         where id = v_space;
  delete from public.tenants        where id = v_tenant;
  delete from auth.users            where id = v_user;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'r2_pending_deletes_queue smoke test: PASS';
end $$;
