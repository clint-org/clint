-- migration: 20260528130001_update_event_sources_rpc
-- purpose: atomic replacement of an event's source URLs in a single transaction
--          to defeat the same class of bug fixed for marker_assignments in
--          20260528100000. The current Angular EventService.updateSources()
--          does DELETE-then-INSERT against event_sources as two PostgREST
--          transactions, which loses every source if the network drops between
--          them and would silently strand under a future orphan-cleanup
--          trigger on event_sources.
--
-- design:
--   Single SECURITY DEFINER RPC. INSERTs every row in (p_urls, p_labels)
--   first (idempotent via the new (event_id, url) unique constraint and
--   ON CONFLICT DO NOTHING), then DELETEs every row whose url is not in
--   p_urls. Order is load-bearing: insert-first guarantees the event keeps
--   its sources at every point if a future trigger drops events with zero
--   sources.
--
--   Empty p_urls is allowed -- "clear all sources" is a valid analyst
--   operation and event_sources has no orphan-cleanup trigger today.
--
--   Two arrays for (url, label) rather than a jsonb payload: the call site
--   already has them as paired arrays, and array misalignment is detectable
--   server-side with array_length checks. Mismatched lengths raise 22023.
--
-- schema change:
--   Add unique index on (event_id, url) so the ON CONFLICT clause has a
--   real target and double-submits cannot create duplicate sources via
--   any path (RPC or PostgREST). Deduplicates existing rows first.
--
-- not @audit:tier1 -- editorial mutation, not governance. The events table
-- is not currently covered by an entity-specific change feed; if one is
-- added, event_sources churn would route there rather than to audit_events.
--
-- callers:
--   - src/client/src/app/core/services/event.service.ts:updateSources()
--
-- related:
--   - 20260413120000_events_system.sql              (event_sources table + RLS)
--   - 20260528100000_update_marker_assignments_rpc.sql (the reference pattern)
--   - 20260521120300_orphan_marker_cleanup.sql       (the trigger class we defend against)


-- =============================================================================
-- 1. dedup + unique index
-- =============================================================================

-- existing event_sources may already contain duplicate (event_id, url) pairs
-- from the old client path or analyst paste-error. dedup before adding the
-- constraint so the migration cannot fail on existing data.
delete from public.event_sources a
 using public.event_sources b
 where a.id < b.id
   and a.event_id = b.event_id
   and a.url      = b.url;

create unique index if not exists event_sources_event_url_uniq
  on public.event_sources (event_id, url);


-- =============================================================================
-- 2. update_event_sources
-- =============================================================================

create or replace function public.update_event_sources(
  p_event_id uuid,
  p_urls     text[],
  p_labels   text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_url      text;
  v_label    text;
  v_i        int;
  v_n_urls   int;
  v_n_labels int;
begin
  select space_id into v_space_id
    from public.events
   where id = p_event_id;

  if v_space_id is null then
    raise exception 'event not found' using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_n_urls   := coalesce(array_length(p_urls,   1), 0);
  v_n_labels := coalesce(array_length(p_labels, 1), 0);
  if v_n_urls <> v_n_labels then
    raise exception 'urls and labels must be the same length (got % and %)',
      v_n_urls, v_n_labels using errcode = '22023';
  end if;

  -- Insert-then-prune. Even with no orphan trigger today, insert-first
  -- defends against a future trigger and against a network drop between
  -- the two operations under the OLD client pattern.
  for v_i in 1 .. v_n_urls loop
    v_url   := p_urls[v_i];
    v_label := p_labels[v_i];
    insert into public.event_sources (event_id, url, label)
      values (p_event_id, v_url, v_label)
      on conflict (event_id, url) do update set label = excluded.label;
  end loop;

  delete from public.event_sources
   where event_id = p_event_id
     and url <> all(coalesce(p_urls, array[]::text[]));
end;
$$;

revoke execute on function public.update_event_sources(uuid, text[], text[]) from public;
grant  execute on function public.update_event_sources(uuid, text[], text[]) to authenticated;

comment on function public.update_event_sources(uuid, text[], text[]) is
  'Atomically replace event_sources for an event. Inserts new sources first (idempotent on event_id+url, updates the label on conflict), then deletes stale ones in a single transaction. SECURITY DEFINER. Caller must hold owner/editor on the event''s space; empty p_urls clears all sources; mismatched p_urls/p_labels lengths raise 22023.';


-- =============================================================================
-- inline smoke tests
-- =============================================================================
-- Same shape as 20260528100000_update_marker_assignments_rpc.sql smoke:
-- hermetic fixture per case, impersonate via set_config, teardown under
-- member_guard_cascade. Case E simulates a future orphan-cleanup trigger
-- on event_sources to prove the OLD client pattern would fail under it and
-- the RPC would survive.

do $$
declare
  v_category uuid;
begin
  select id into v_category from public.event_categories where space_id is null limit 1;
  if v_category is null then
    raise exception 'update_event_sources smoke FAIL: no system event_category available';
  end if;

  -- ===========================================================================
  -- case A: event with one source -> swap url + label.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_event   uuid := gen_random_uuid();
    v_email   text := 'ues-a-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_url     text;
    v_label   text;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'ues-a-tenant', 'ues-a-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'ues-a-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.events (id, space_id, category_id, title, event_date, created_by)
      values (v_event, v_space, v_category, 'ues-a-event', current_date, v_user);
    insert into public.event_sources (event_id, url, label)
      values (v_event, 'https://a.example/old', 'Old label');

    perform public.update_event_sources(
      v_event,
      array['https://a.example/new'],
      array['New label']
    );

    select count(*)::int into v_count from public.event_sources where event_id = v_event;
    if v_count <> 1 then
      raise exception 'update_event_sources smoke FAIL case A: expected 1 source after swap, got %', v_count;
    end if;

    select url, label into v_url, v_label from public.event_sources where event_id = v_event;
    if v_url <> 'https://a.example/new' or v_label <> 'New label' then
      raise exception 'update_event_sources smoke FAIL case A: expected new url/label, got %/%', v_url, v_label;
    end if;

    raise notice 'update_event_sources smoke ok A: single-source swap';

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
  -- case B: event with [A, B] -> [B, C]. add/remove diff + label update on B.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_event   uuid := gen_random_uuid();
    v_email   text := 'ues-b-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_label   text;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'ues-b-tenant', 'ues-b-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'ues-b-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.events (id, space_id, category_id, title, event_date, created_by)
      values (v_event, v_space, v_category, 'ues-b-event', current_date, v_user);
    insert into public.event_sources (event_id, url, label)
      values (v_event, 'https://a.example', 'Original A'),
             (v_event, 'https://b.example', 'Original B');

    perform public.update_event_sources(
      v_event,
      array['https://b.example', 'https://c.example'],
      array['Updated B',         'Fresh C']
    );

    select count(*)::int into v_count from public.event_sources
     where event_id = v_event and url in ('https://b.example', 'https://c.example');
    if v_count <> 2 then
      raise exception 'update_event_sources smoke FAIL case B: expected [B, C], got % rows', v_count;
    end if;

    select count(*)::int into v_count from public.event_sources
     where event_id = v_event and url = 'https://a.example';
    if v_count <> 0 then
      raise exception 'update_event_sources smoke FAIL case B: A should be pruned';
    end if;

    select label into v_label from public.event_sources
     where event_id = v_event and url = 'https://b.example';
    if v_label <> 'Updated B' then
      raise exception 'update_event_sources smoke FAIL case B: B label not updated, got %', v_label;
    end if;

    raise notice 'update_event_sources smoke ok B: add/remove diff + label update';

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
  -- case C: empty p_urls clears all sources (the event survives).
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_event   uuid := gen_random_uuid();
    v_email   text := 'ues-c-' || gen_random_uuid() || '@example.com';
    v_count   int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'ues-c-tenant', 'ues-c-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'ues-c-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.events (id, space_id, category_id, title, event_date, created_by)
      values (v_event, v_space, v_category, 'ues-c-event', current_date, v_user);
    insert into public.event_sources (event_id, url, label)
      values (v_event, 'https://a.example', 'A');

    perform public.update_event_sources(v_event, array[]::text[], array[]::text[]);

    select count(*)::int into v_count from public.event_sources where event_id = v_event;
    if v_count <> 0 then
      raise exception 'update_event_sources smoke FAIL case C: expected 0 sources after clear-all, got %', v_count;
    end if;

    -- event itself survives
    select count(*)::int into v_count from public.events where id = v_event;
    if v_count <> 1 then
      raise exception 'update_event_sources smoke FAIL case C: event was dropped after clear-all';
    end if;

    raise notice 'update_event_sources smoke ok C: empty array clears all, event survives';

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
  -- case D: viewer cannot edit -> 42501, sources untouched.
  -- ===========================================================================
  declare
    v_owner   uuid := gen_random_uuid();
    v_viewer  uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_event   uuid := gen_random_uuid();
    v_o_email text := 'ues-d-o-' || gen_random_uuid() || '@example.com';
    v_v_email text := 'ues-d-v-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_caught  boolean := false;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_owner,  v_o_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
             (v_viewer, v_v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'ues-d-tenant', 'ues-d-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_owner, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'ues-d-space', v_owner);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_owner,  'owner'),
             (v_space, v_viewer, 'viewer');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role', 'authenticated', 'email', v_o_email)::text,
      true
    );
    insert into public.events (id, space_id, category_id, title, event_date, created_by)
      values (v_event, v_space, v_category, 'ues-d-event', current_date, v_owner);
    insert into public.event_sources (event_id, url, label)
      values (v_event, 'https://a.example', 'A');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_viewer::text, 'role', 'authenticated', 'email', v_v_email)::text,
      true
    );

    begin
      perform public.update_event_sources(
        v_event,
        array['https://b.example'],
        array['B']
      );
    exception when others then
      if sqlstate <> '42501' then
        raise exception 'update_event_sources smoke FAIL case D: expected sqlstate 42501, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'update_event_sources smoke FAIL case D: viewer call should have raised forbidden';
    end if;

    select count(*)::int into v_count from public.event_sources where event_id = v_event;
    if v_count <> 1 then
      raise exception 'update_event_sources smoke FAIL case D: original source disturbed, got %', v_count;
    end if;

    raise notice 'update_event_sources smoke ok D: viewer rejected, sources untouched';

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
  -- case E: simulate a future orphan-cleanup trigger on event_sources to prove
  -- the OLD client DELETE-then-INSERT pattern would lose the parent event and
  -- the RPC would not. The trigger is installed transiently and dropped at the
  -- end of this block. If future schema work installs a real version of this
  -- trigger, the RPC already defends against it; if future schema work weakens
  -- the RPC (reorders insert/delete), this case fails.
  -- ===========================================================================
  declare
    v_user      uuid := gen_random_uuid();
    v_tenant    uuid := gen_random_uuid();
    v_space     uuid := gen_random_uuid();
    v_event_old uuid := gen_random_uuid();
    v_event_rpc uuid := gen_random_uuid();
    v_email     text := 'ues-e-' || gen_random_uuid() || '@example.com';
    v_count     int;
    v_caught    boolean := false;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'ues-e-tenant', 'ues-e-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'ues-e-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.events (id, space_id, category_id, title, event_date, created_by)
      values (v_event_old, v_space, v_category, 'ues-e-old', current_date, v_user),
             (v_event_rpc, v_space, v_category, 'ues-e-rpc', current_date, v_user);
    insert into public.event_sources (event_id, url, label)
      values (v_event_old, 'https://old.example', 'Old'),
             (v_event_rpc, 'https://rpc.example', 'Rpc');

    -- install transient orphan-cleanup trigger, modeled on
    -- _cleanup_orphan_marker (migration 20260521120300).
    create or replace function pg_temp._smoke_orphan_event()
      returns trigger language plpgsql as $fn$
      begin
        delete from public.events
         where id = OLD.event_id
           and not exists (
             select 1 from public.event_sources where event_id = OLD.event_id
           );
        return null;
      end $fn$;
    create trigger _smoke_orphan_event_trigger
      after delete on public.event_sources
      for each row execute function pg_temp._smoke_orphan_event();

    -- OLD client pattern: DELETE then INSERT. The DELETE fires the trigger,
    -- which drops the parent event; the subsequent INSERT then fails because
    -- the FK target row no longer exists.
    --
    -- The DELETE runs outside the exception block so the trigger's parent
    -- delete persists. Wrapping it inside a `begin ... exception` would
    -- bundle both statements into one savepoint -- the FK failure on INSERT
    -- would roll the DELETE (and the trigger's effect) back, hiding the
    -- failure we are trying to demonstrate. The real-world client does these
    -- as two separate PostgREST transactions; we approximate that with one
    -- unprotected statement followed by one protected statement.
    delete from public.event_sources where event_id = v_event_old;

    -- trigger has now fired and orphaned v_event_old.
    select count(*)::int into v_count from public.events where id = v_event_old;
    if v_count <> 0 then
      raise exception 'update_event_sources smoke FAIL case E: simulated trigger did not orphan the event (count=%); is _smoke_orphan_event installed?', v_count;
    end if;

    -- the INSERT now fails because v_event_old is gone (FK violation).
    begin
      insert into public.event_sources (event_id, url, label)
        values (v_event_old, 'https://new-old.example', 'NewOld');
      raise exception 'update_event_sources smoke FAIL case E: INSERT should have failed FK under orphaned parent';
    exception when others then
      if sqlstate not in ('42501', '23503', '23514') then
        raise exception 'update_event_sources smoke FAIL case E: expected RLS/FK/check failure under simulated trigger, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'update_event_sources smoke FAIL case E: INSERT did not raise';
    end if;

    -- the RPC under the SAME trigger: insert-first keeps the parent alive.
    perform public.update_event_sources(
      v_event_rpc,
      array['https://rpc-new.example'],
      array['RpcNew']
    );

    select count(*)::int into v_count from public.events where id = v_event_rpc;
    if v_count <> 1 then
      raise exception 'update_event_sources smoke FAIL case E: RPC-path event dropped despite insert-first, count=%', v_count;
    end if;
    select count(*)::int into v_count from public.event_sources
     where event_id = v_event_rpc and url = 'https://rpc-new.example';
    if v_count <> 1 then
      raise exception 'update_event_sources smoke FAIL case E: RPC source missing, count=%', v_count;
    end if;

    -- drop the trigger explicitly before the block ends. pg_temp keeps the
    -- function out of public.* even if drop were skipped, but the trigger
    -- itself was attached to public.event_sources and must come off.
    drop trigger _smoke_orphan_event_trigger on public.event_sources;

    raise notice 'update_event_sources smoke ok E: simulated-trigger regression contract holds';

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

  raise notice 'update_event_sources smoke test: PASS';
end $$;
