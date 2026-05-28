-- migration: 20260528130100_update_event_links_rpc
-- purpose: atomic replacement of an event's outgoing links in a single
--          transaction. Same insert-then-prune shape as
--          update_marker_assignments (20260528100000) and
--          update_event_sources (20260528130000).
--
-- design:
--   The Angular EventService.updateLinks() previously did three sequential
--   PostgREST operations: DELETE source-side rows, DELETE target-side rows,
--   then INSERT. That signature is also dead code today -- event-form's
--   edit save path never calls it, so analyst changes to the "linked events"
--   field silently dropped on save. This RPC plus the matching client
--   wire-up fix both the atomicity problem and the persistence bug.
--
--   Source-side only. This RPC manages rows where source_event_id = p_event_id.
--   Rows where target_event_id = p_event_id (back-links other events maintain
--   that happen to point here) are left alone. This matches the existing
--   event_links insert RLS, which only authorizes the source-side editor.
--
--   Validation rejects cross-space targets and self-links explicitly so the
--   error is a clean 22023 from the RPC rather than RLS or check-constraint
--   noise leaking to the client.
--
--   Empty p_linked_event_ids is allowed -- "clear all my outgoing links" is
--   a valid analyst operation.
--
-- not @audit:tier1 -- editorial mutation, not governance.
--
-- callers:
--   - src/client/src/app/core/services/event.service.ts:updateLinks()
--   - src/client/src/app/features/events/event-form.component.ts (edit save path)
--
-- related:
--   - 20260413120000_events_system.sql              (event_links table + RLS + constraints)
--   - 20260528100000_update_marker_assignments_rpc.sql (reference pattern)
--   - 20260528130001_update_event_sources_rpc.sql     (sibling RPC)


-- =============================================================================
-- 1. update_event_links
-- =============================================================================

create or replace function public.update_event_links(
  p_event_id         uuid,
  p_linked_event_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id   uuid;
  v_target_id  uuid;
  v_target_sp  uuid;
begin
  select space_id into v_space_id from public.events where id = p_event_id;

  if v_space_id is null then
    raise exception 'event not found' using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Validate every target id before any mutation: must exist, must not be
  -- the source itself, must be in a space the caller can read. Surfaces a
  -- clean 22023 instead of letting the unique/check constraints leak through.
  if p_linked_event_ids is not null then
    foreach v_target_id in array p_linked_event_ids loop
      if v_target_id = p_event_id then
        raise exception 'self-link not allowed (target = source)' using errcode = '22023';
      end if;
      select space_id into v_target_sp from public.events where id = v_target_id;
      if v_target_sp is null then
        raise exception 'target event % not found', v_target_id using errcode = '22023';
      end if;
      if not public.has_space_access(v_target_sp) then
        raise exception 'target event % not accessible to caller', v_target_id using errcode = '22023';
      end if;
    end loop;
  end if;

  -- Insert-then-prune. ON CONFLICT against the existing
  -- (source_event_id, target_event_id) unique constraint.
  if p_linked_event_ids is not null then
    foreach v_target_id in array p_linked_event_ids loop
      insert into public.event_links (source_event_id, target_event_id)
        values (p_event_id, v_target_id)
        on conflict (source_event_id, target_event_id) do nothing;
    end loop;
  end if;

  delete from public.event_links
   where source_event_id = p_event_id
     and target_event_id <> all(coalesce(p_linked_event_ids, array[]::uuid[]));
end;
$$;

revoke execute on function public.update_event_links(uuid, uuid[]) from public;
grant  execute on function public.update_event_links(uuid, uuid[]) to authenticated;

comment on function public.update_event_links(uuid, uuid[]) is
  'Atomically replace the source-side outgoing links from an event in one transaction. Inserts new links first (idempotent), then deletes stale ones. Source-side only: back-links from other events to this one are not touched. SECURITY DEFINER. Caller must hold owner/editor on the source event''s space; targets must be readable to the caller; self-links and unreachable targets raise 22023; empty array clears all outgoing links.';


-- =============================================================================
-- inline smoke tests
-- =============================================================================

do $$
declare
  v_category uuid;
begin
  select id into v_category from public.event_categories where space_id is null limit 1;
  if v_category is null then
    raise exception 'update_event_links smoke FAIL: no system event_category available';
  end if;

  -- ===========================================================================
  -- case A: event with one outgoing link -> swap target.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_src     uuid := gen_random_uuid();
    v_tgt_a   uuid := gen_random_uuid();
    v_tgt_b   uuid := gen_random_uuid();
    v_email   text := 'uel-a-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_t       uuid;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uel-a-tenant', 'uel-a-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uel-a-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.events (id, space_id, category_id, title, event_date, created_by)
      values (v_src,   v_space, v_category, 'uel-a-src',   current_date, v_user),
             (v_tgt_a, v_space, v_category, 'uel-a-tgt-a', current_date, v_user),
             (v_tgt_b, v_space, v_category, 'uel-a-tgt-b', current_date, v_user);
    insert into public.event_links (source_event_id, target_event_id)
      values (v_src, v_tgt_a);

    perform public.update_event_links(v_src, array[v_tgt_b]);

    select count(*)::int into v_count from public.event_links where source_event_id = v_src;
    if v_count <> 1 then
      raise exception 'update_event_links smoke FAIL case A: expected 1 link, got %', v_count;
    end if;
    select target_event_id into v_t from public.event_links where source_event_id = v_src;
    if v_t <> v_tgt_b then
      raise exception 'update_event_links smoke FAIL case A: expected tgt_b, got %', v_t;
    end if;

    raise notice 'update_event_links smoke ok A: outgoing-link swap';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.events         where space_id = v_space;
    delete from public.space_members  where space_id = v_space;
    delete from public.tenant_members where tenant_id = v_tenant;
    delete from public.spaces         where id = v_space;
    delete from public.tenants        where id = v_tenant;
    delete from auth.users            where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case B: src with [A, B] -> [B, C]. Back-link from D->src is NOT touched.
  -- This is the source-side-only contract.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_src     uuid := gen_random_uuid();
    v_tgt_a   uuid := gen_random_uuid();
    v_tgt_b   uuid := gen_random_uuid();
    v_tgt_c   uuid := gen_random_uuid();
    v_other_d uuid := gen_random_uuid();
    v_email   text := 'uel-b-' || gen_random_uuid() || '@example.com';
    v_count   int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uel-b-tenant', 'uel-b-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uel-b-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.events (id, space_id, category_id, title, event_date, created_by)
      values (v_src,     v_space, v_category, 'uel-b-src',   current_date, v_user),
             (v_tgt_a,   v_space, v_category, 'uel-b-tgt-a', current_date, v_user),
             (v_tgt_b,   v_space, v_category, 'uel-b-tgt-b', current_date, v_user),
             (v_tgt_c,   v_space, v_category, 'uel-b-tgt-c', current_date, v_user),
             (v_other_d, v_space, v_category, 'uel-b-otr-d', current_date, v_user);
    insert into public.event_links (source_event_id, target_event_id)
      values (v_src,     v_tgt_a),
             (v_src,     v_tgt_b),
             (v_other_d, v_src);  -- back-link from D, must not be touched

    perform public.update_event_links(v_src, array[v_tgt_b, v_tgt_c]);

    select count(*)::int into v_count from public.event_links
     where source_event_id = v_src and target_event_id in (v_tgt_b, v_tgt_c);
    if v_count <> 2 then
      raise exception 'update_event_links smoke FAIL case B: expected outgoing [B, C], got % rows', v_count;
    end if;

    select count(*)::int into v_count from public.event_links
     where source_event_id = v_src and target_event_id = v_tgt_a;
    if v_count <> 0 then
      raise exception 'update_event_links smoke FAIL case B: tgt_a should be pruned from outgoing';
    end if;

    -- back-link D->src untouched
    select count(*)::int into v_count from public.event_links
     where source_event_id = v_other_d and target_event_id = v_src;
    if v_count <> 1 then
      raise exception 'update_event_links smoke FAIL case B: back-link D->src was disturbed';
    end if;

    raise notice 'update_event_links smoke ok B: add/remove diff, back-link preserved';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.events         where space_id = v_space;
    delete from public.space_members  where space_id = v_space;
    delete from public.tenant_members where tenant_id = v_tenant;
    delete from public.spaces         where id = v_space;
    delete from public.tenants        where id = v_tenant;
    delete from auth.users            where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case C: empty p_linked_event_ids clears all outgoing links.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_src     uuid := gen_random_uuid();
    v_tgt_a   uuid := gen_random_uuid();
    v_email   text := 'uel-c-' || gen_random_uuid() || '@example.com';
    v_count   int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uel-c-tenant', 'uel-c-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uel-c-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.events (id, space_id, category_id, title, event_date, created_by)
      values (v_src,   v_space, v_category, 'uel-c-src',   current_date, v_user),
             (v_tgt_a, v_space, v_category, 'uel-c-tgt-a', current_date, v_user);
    insert into public.event_links (source_event_id, target_event_id) values (v_src, v_tgt_a);

    perform public.update_event_links(v_src, array[]::uuid[]);

    select count(*)::int into v_count from public.event_links where source_event_id = v_src;
    if v_count <> 0 then
      raise exception 'update_event_links smoke FAIL case C: expected 0 outgoing, got %', v_count;
    end if;
    select count(*)::int into v_count from public.events where id = v_src;
    if v_count <> 1 then
      raise exception 'update_event_links smoke FAIL case C: source event was dropped';
    end if;

    raise notice 'update_event_links smoke ok C: empty clears outgoing, event survives';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.events         where space_id = v_space;
    delete from public.space_members  where space_id = v_space;
    delete from public.tenant_members where tenant_id = v_tenant;
    delete from public.spaces         where id = v_space;
    delete from public.tenants        where id = v_tenant;
    delete from auth.users            where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case D: viewer cannot edit -> 42501.
  -- ===========================================================================
  declare
    v_owner   uuid := gen_random_uuid();
    v_viewer  uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_src     uuid := gen_random_uuid();
    v_tgt_a   uuid := gen_random_uuid();
    v_tgt_b   uuid := gen_random_uuid();
    v_o_email text := 'uel-d-o-' || gen_random_uuid() || '@example.com';
    v_v_email text := 'uel-d-v-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_caught  boolean := false;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_owner,  v_o_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
             (v_viewer, v_v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uel-d-tenant', 'uel-d-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_owner, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uel-d-space', v_owner);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_owner,  'owner'),
             (v_space, v_viewer, 'viewer');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role', 'authenticated', 'email', v_o_email)::text,
      true
    );
    insert into public.events (id, space_id, category_id, title, event_date, created_by)
      values (v_src,   v_space, v_category, 'uel-d-src',   current_date, v_owner),
             (v_tgt_a, v_space, v_category, 'uel-d-tgt-a', current_date, v_owner),
             (v_tgt_b, v_space, v_category, 'uel-d-tgt-b', current_date, v_owner);
    insert into public.event_links (source_event_id, target_event_id) values (v_src, v_tgt_a);

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_viewer::text, 'role', 'authenticated', 'email', v_v_email)::text,
      true
    );

    begin
      perform public.update_event_links(v_src, array[v_tgt_b]);
    exception when others then
      if sqlstate <> '42501' then
        raise exception 'update_event_links smoke FAIL case D: expected sqlstate 42501, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'update_event_links smoke FAIL case D: viewer call should have raised forbidden';
    end if;

    select count(*)::int into v_count from public.event_links
     where source_event_id = v_src and target_event_id = v_tgt_a;
    if v_count <> 1 then
      raise exception 'update_event_links smoke FAIL case D: original link disturbed';
    end if;

    raise notice 'update_event_links smoke ok D: viewer rejected, links untouched';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.events         where space_id = v_space;
    delete from public.space_members  where space_id = v_space;
    delete from public.tenant_members where tenant_id = v_tenant;
    delete from public.spaces         where id = v_space;
    delete from public.tenants        where id = v_tenant;
    delete from auth.users            where id in (v_owner, v_viewer);
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case E: simulated future orphan-cleanup trigger on event_links. The OLD
  -- DELETE-then-INSERT pattern would lose the source event; the RPC survives.
  -- Same construction as update_event_sources case E.
  -- ===========================================================================
  declare
    v_user      uuid := gen_random_uuid();
    v_tenant    uuid := gen_random_uuid();
    v_space     uuid := gen_random_uuid();
    v_src_old   uuid := gen_random_uuid();
    v_src_rpc   uuid := gen_random_uuid();
    v_tgt_a     uuid := gen_random_uuid();
    v_tgt_b     uuid := gen_random_uuid();
    v_email     text := 'uel-e-' || gen_random_uuid() || '@example.com';
    v_count     int;
    v_caught    boolean := false;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uel-e-tenant', 'uel-e-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uel-e-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.events (id, space_id, category_id, title, event_date, created_by)
      values (v_src_old, v_space, v_category, 'uel-e-src-old', current_date, v_user),
             (v_src_rpc, v_space, v_category, 'uel-e-src-rpc', current_date, v_user),
             (v_tgt_a,   v_space, v_category, 'uel-e-tgt-a',   current_date, v_user),
             (v_tgt_b,   v_space, v_category, 'uel-e-tgt-b',   current_date, v_user);
    insert into public.event_links (source_event_id, target_event_id)
      values (v_src_old, v_tgt_a),
             (v_src_rpc, v_tgt_a);

    -- transient trigger: when a source's outgoing links go to zero, drop
    -- the source event. Models a hypothetical "events with no outgoing
    -- links should be cleaned up" rule.
    create or replace function pg_temp._smoke_orphan_event_via_links()
      returns trigger language plpgsql as $fn$
      begin
        delete from public.events
         where id = OLD.source_event_id
           and not exists (
             select 1 from public.event_links where source_event_id = OLD.source_event_id
           );
        return null;
      end $fn$;
    create trigger _smoke_orphan_event_links_trigger
      after delete on public.event_links
      for each row execute function pg_temp._smoke_orphan_event_via_links();

    -- OLD pattern: DELETE all outgoing then INSERT a fresh one. The trigger
    -- fires on the DELETE and orphans v_src_old.
    delete from public.event_links where source_event_id = v_src_old;
    select count(*)::int into v_count from public.events where id = v_src_old;
    if v_count <> 0 then
      raise exception 'update_event_links smoke FAIL case E: simulated trigger did not orphan src_old, count=%', v_count;
    end if;
    begin
      insert into public.event_links (source_event_id, target_event_id)
        values (v_src_old, v_tgt_b);
      raise exception 'update_event_links smoke FAIL case E: INSERT should have failed FK';
    exception when others then
      if sqlstate not in ('42501', '23503', '23514') then
        raise exception 'update_event_links smoke FAIL case E: expected RLS/FK failure, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'update_event_links smoke FAIL case E: INSERT did not raise';
    end if;

    -- RPC under the SAME trigger: insert-first keeps src_rpc alive.
    perform public.update_event_links(v_src_rpc, array[v_tgt_b]);
    select count(*)::int into v_count from public.events where id = v_src_rpc;
    if v_count <> 1 then
      raise exception 'update_event_links smoke FAIL case E: src_rpc dropped despite insert-first, count=%', v_count;
    end if;
    select count(*)::int into v_count from public.event_links
     where source_event_id = v_src_rpc and target_event_id = v_tgt_b;
    if v_count <> 1 then
      raise exception 'update_event_links smoke FAIL case E: RPC link missing, count=%', v_count;
    end if;

    drop trigger _smoke_orphan_event_links_trigger on public.event_links;

    raise notice 'update_event_links smoke ok E: simulated-trigger regression contract holds';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.events         where space_id = v_space;
    delete from public.space_members  where space_id = v_space;
    delete from public.tenant_members where tenant_id = v_tenant;
    delete from public.spaces         where id = v_space;
    delete from public.tenants        where id = v_tenant;
    delete from auth.users            where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  raise notice 'update_event_links smoke test: PASS';
end $$;
