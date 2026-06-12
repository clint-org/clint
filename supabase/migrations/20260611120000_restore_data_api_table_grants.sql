-- migration: 20260611120000_restore_data_api_table_grants
-- purpose: keep fresh local resets equivalent to the hosted projects after
--   the Supabase CLI 2.106.0 behavior change. Starting with 2.106.0, local
--   start/reset revokes the legacy Data API default privileges before any
--   migration runs:
--
--     alter default privileges for role postgres in schema public
--       revoke select, insert, update, delete on tables
--       from anon, authenticated, service_role;
--     alter default privileges for role postgres in schema public
--       revoke usage, select on sequences
--       from anon, authenticated, service_role;
--     alter default privileges for role postgres in schema public
--       revoke execute on functions
--       from anon, authenticated, service_role;
--
--   Hosted projects provisioned before the change keep the legacy default
--   ACLs, so without this migration a fresh local database ends up with no
--   table privileges for the API roles while dev and prod keep them. RLS
--   remains the row-level gate on every table (advisor-enforced); the
--   table-level grants restored here are the baseline this schema and its
--   policies were built against.
--
-- scope:
--   * tables and sequences: default ACLs restored for future objects, plus
--     a catch-up grant for everything created earlier in this migration
--     run. The deliberate table lockdowns from earlier migrations are
--     re-applied after the catch-up so their net state is preserved.
--   * functions: the legacy default ACLs gave anon, authenticated, and
--     service_role execute on every public function at creation, and the
--     lockdown sweeps (20260607120000, 20260607130000) then revoked the
--     curated sets. On a fresh database those creation-time grants never
--     existed, so this migration reproduces the sweeps' end state directly:
--     service_role gets execute on everything (never revoked anywhere; the
--     integration harness provisions fixtures through RPCs with the service
--     key), and authenticated gets execute on every public function except
--     trigger functions (120000 Block 1) and the deliberately locked names
--     (130000 Block C internal helpers, r2 drain worker RPCs). anon stays
--     explicit per function; every anon-callable RPC already grants it in
--     its own migration. New functions must carry their own revoke/grant
--     statements, and the features-drift check already fails any public
--     function without a capability mapping.
--
-- remote: every statement is a no-op on databases that still carry the
--   legacy default ACLs (dev, prod). Safe to push.

-- Future objects: invert the CLI revoke for tables and sequences.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences
  to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant execute on functions
  to service_role;

-- Catch-up: objects created before this point in a fresh reset.
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

grant execute on all functions in schema public to service_role;

-- authenticated: the callable surface, reproducing the lockdown sweeps' end
-- state (see header). Trigger functions are excluded by return type; the
-- name list mirrors 20260607130000 Block C plus the r2 drain worker RPCs
-- (20260521122000 / 20260521123000), which are anon + shared-secret only.
do $$
declare
  proc record;
  locked_from_authenticated text[] := array[
    -- 20260607130000 Block C internal helpers
    '_emit_events_from_marker_change',
    '_materialize_trial_from_snapshot',
    '_recompute_asset_indication_status',
    '_seed_ctgov_markers',
    '_sync_asset_indications',
    '_verify_ctgov_worker_secret',
    '_verify_extract_source_worker_secret',
    '_verify_r2_drain_worker_secret',
    -- r2 drain worker RPCs
    'claim_pending_r2_deletes',
    'mark_r2_delete_succeeded',
    'mark_r2_delete_failed'
  ];
begin
  for proc in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and p.prorettype <> 'event_trigger'::regtype
      and p.proname <> all (locked_from_authenticated)
  loop
    execute format('grant execute on function %s to authenticated', proc.sig);
  end loop;
end $$;

-- Re-apply the deliberate table lockdowns the catch-up grant would
-- otherwise undo. Mirrors every table-level revoke in earlier migrations:
-- 20260428040000 (platform_admins), 20260521120000 + 20260521121500
-- (r2_pending_deletes), 20260521120100 (user_redactions), 20260510000100
-- (audit_events: record_audit_event() is the only sanctioned write path).
revoke select, insert, update, delete on public.platform_admins
  from anon, authenticated;

revoke select, insert, update, delete on public.r2_pending_deletes
  from anon, authenticated;
grant select on public.r2_pending_deletes to authenticated;
revoke insert, update, delete on public.r2_pending_deletes
  from service_role;

revoke insert, update, delete on public.user_redactions
  from anon, authenticated;

revoke insert, update, delete on public.audit_events
  from anon, authenticated, service_role;

-- =============================================================================
-- smoke test: assert the restored baseline. Catches a future CLI change that
-- alters the revoke shape, and catches this migration drifting from the
-- lockdowns it re-applies.
--
do $$
begin
  -- Spot-check a representative pre-existing table regained authenticated
  -- SELECT (the privilege the 2.106.0 revoke removed on fresh resets).
  if not has_table_privilege('authenticated', 'public.ctgov_sync_runs', 'select') then
    raise exception 'data api grants smoke: authenticated lost select on ctgov_sync_runs';
  end if;

  if not has_table_privilege('service_role', 'public.trials', 'insert') then
    raise exception 'data api grants smoke: service_role lost insert on trials';
  end if;

  -- service_role keeps execute on every public function (legacy parity; the
  -- integration harness provisions fixtures through RPCs with the service
  -- key, e.g. provision_agency / provision_tenant / create_space).
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not has_function_privilege('service_role', p.oid, 'execute')
  ) then
    raise exception 'data api grants smoke: service_role missing execute on a public function';
  end if;

  -- authenticated keeps the callable RPC surface (representative: the app
  -- creates spaces as a signed-in tenant owner).
  if not has_function_privilege('authenticated', 'public.create_space(uuid, text, text)', 'execute') then
    raise exception 'data api grants smoke: authenticated lost execute on create_space';
  end if;

  -- The function lockdowns must survive: internal helpers (20260607130000
  -- Block C) and r2 drain worker RPCs stay non-executable by authenticated.
  if has_function_privilege('authenticated', 'public._verify_ctgov_worker_secret(text)', 'execute') then
    raise exception 'data api grants smoke: _verify_ctgov_worker_secret leaked to authenticated';
  end if;

  if has_function_privilege('authenticated', 'public.mark_r2_delete_succeeded(text, uuid)', 'execute') then
    raise exception 'data api grants smoke: mark_r2_delete_succeeded leaked to authenticated';
  end if;

  -- anon stays explicit per function: no blanket grant may reach it.
  if has_function_privilege('anon', 'public.create_space(uuid, text, text)', 'execute') then
    raise exception 'data api grants smoke: create_space leaked to anon';
  end if;

  -- Lockdowns must survive the catch-up grant.
  if has_table_privilege('authenticated', 'public.platform_admins', 'select') then
    raise exception 'data api grants smoke: platform_admins select leaked to authenticated';
  end if;

  if has_table_privilege('authenticated', 'public.r2_pending_deletes', 'insert') then
    raise exception 'data api grants smoke: r2_pending_deletes insert leaked to authenticated';
  end if;

  if has_table_privilege('authenticated', 'public.user_redactions', 'delete') then
    raise exception 'data api grants smoke: user_redactions delete leaked to authenticated';
  end if;

  if has_table_privilege('service_role', 'public.audit_events', 'insert') then
    raise exception 'data api grants smoke: audit_events insert leaked to service_role';
  end if;

  if has_table_privilege('service_role', 'public.r2_pending_deletes', 'insert') then
    raise exception 'data api grants smoke: r2_pending_deletes insert leaked to service_role';
  end if;

  raise notice 'restore_data_api_table_grants smoke test: PASS';
end$$;
