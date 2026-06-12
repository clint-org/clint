-- migration: 20260607130000_lock_down_read_rpc_and_helper_grants
--
-- Follow-up to 20260607120000_lock_down_function_execute_grants, which
-- deliberately deferred the read surface and kept `authenticated` on internal
-- helpers. This migration closes the remaining Supabase advisor 0028 (anon) /
-- 0029 (authenticated) "SECURITY DEFINER function executable" warnings that are
-- pure surface (the client never calls these as anon, and the internal helpers
-- are only reached through SECURITY DEFINER parents/triggers).
--
-- Verified before writing:
--   * Every read RPC below is called by the client only from authenticated
--     services (no pre-auth /rpc/ path; the only anon read is get_brand_by_host,
--     left untouched). Each is SECURITY DEFINER and gates internally on
--     has_space_access / has_tenant_access, so the anon grant was pure surface.
--   * record_audit_event has no direct client caller; every caller is a
--     SECURITY DEFINER RPC or trigger, where the nested call runs as the owner.
--     Safe to revoke from both anon and authenticated (closes audit-forgery).
--   * Each `_`-prefixed helper in Block C is invoked only by SECURITY DEFINER
--     parents (ingest_ctgov_snapshot, create_*, commit_source_import,
--     set_trial_indications) or triggers -- nested calls run as owner, so the
--     authenticated grant is unnecessary. The only INVOKER chain is
--     seed_demo_data -> _seed_demo_*, which is intentionally NOT touched here.
--
-- The host-aware public site read surface deferred by the prior migration is
-- not yet built (engagement-landing renders under authGuard/spaceGuard). When
-- it ships, it should re-grant anon EXECUTE on the specific read RPCs it
-- exposes, not blanket-grant the whole surface.

-- ---------------------------------------------------------------------------
-- Block A: read RPCs + lookup_user_by_email -- revoke from anon, public.
--   Keep authenticated; the app calls these as a signed-in user and each
--   authorizes internally. anon could never satisfy those checks.
-- ---------------------------------------------------------------------------
do $$
declare
  fn   text;
  proc record;
  read_rpcs text[] := array[
    'ai_import_status',
    'build_intelligence_payload',
    'download_material',
    'get_activity_feed',
    'get_ai_usage_rollup',
    'get_marker_history',
    'get_space_inventory_snapshot',
    'get_space_landing_stats',
    'get_tenant_access_settings',
    'get_trial_activity',
    'get_trial_indications',
    'list_materials_for_entity',
    'list_materials_for_space',
    'list_recent_materials_for_space',
    'palette_empty_state',
    'search_palette',
    'lookup_user_by_email'
  ];
begin
  foreach fn in array read_rpcs loop
    for proc in
      select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    loop
      execute format('revoke execute on function %s from anon, public', proc.sig);
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Block B: record_audit_event -- revoke from anon, public. KEEP authenticated.
--   record_audit_event is the SANCTIONED audit-write path: direct INSERT on
--   public.audit_events is revoked from every client role (see
--   20260510000100_audit_events_table.sql), and this SECURITY DEFINER RPC --
--   which derives the actor from auth.uid() server-side -- is the only way an
--   authenticated user may log an event (asserted by audit-lockdown.spec.ts).
--   So authenticated must stay; only the meaningless anon default grant is
--   removed (there is no anon actor to attribute an event to).
-- ---------------------------------------------------------------------------
do $$
declare
  proc record;
begin
  for proc in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_audit_event'
  loop
    execute format('revoke execute on function %s from anon, public', proc.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Block C: internal `_`-prefixed helpers reached only via SECURITY DEFINER
--   parents/triggers -- revoke from anon, authenticated, public. The prior
--   migration kept authenticated on all `_` helpers for the seed_demo_data
--   INVOKER chain; these specific helpers are NOT part of that chain, so the
--   authenticated grant is unnecessary surface.
-- ---------------------------------------------------------------------------
do $$
declare
  fn   text;
  proc record;
  internal_helpers text[] := array[
    '_emit_events_from_marker_change',
    '_materialize_trial_from_snapshot',
    '_recompute_asset_indication_status',
    '_seed_ctgov_markers',
    '_sync_asset_indications',
    '_verify_ctgov_worker_secret',
    '_verify_extract_source_worker_secret',
    '_verify_r2_drain_worker_secret'
  ];
begin
  foreach fn in array internal_helpers loop
    for proc in
      select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    loop
      execute format('revoke execute on function %s from anon, authenticated, public', proc.sig);
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Explicit grants for the INVOKER chains the smoke below asserts authenticated
-- keeps (seed_demo_data -> _seed_demo_* and build_intelligence_payload).
-- seed_demo_data itself is included: supabase/seed.sql calls it as
-- authenticated after every reset, and 20260607120000 revoked it from
-- anon/public while relying on the legacy ACL for the authenticated grant.
-- Before Supabase CLI 2.106.0 these grants came from the legacy Data API
-- default ACLs at function creation, so no migration ever granted them
-- explicitly. CLI 2.106.0+ revokes those default ACLs before applying
-- migrations on fresh local databases, where this migration's smoke then
-- failed. Granting here records the intended state explicitly; on databases
-- that applied this migration before the edit (dev, prod) every statement is
-- a no-op re-grant.
-- ---------------------------------------------------------------------------
do $$
declare
  proc record;
begin
  for proc in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like '\_seed\_demo\_%'
           or p.proname in ('seed_demo_data', 'build_intelligence_payload'))
  loop
    execute format('grant execute on function %s to authenticated', proc.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- In-migration smoke: assert the resulting EXECUTE surface is exactly intended.
--   Fails the migration (and therefore reset / db push / CI) on any drift.
-- ---------------------------------------------------------------------------
do $$
declare
  proc record;
  bad  text := '';
begin
  -- Block A: anon revoked, authenticated retained.
  for proc in
    select p.oid, p.oid::regprocedure::text as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'ai_import_status','build_intelligence_payload','download_material',
        'get_activity_feed','get_ai_usage_rollup','get_marker_history',
        'get_space_inventory_snapshot','get_space_landing_stats',
        'get_tenant_access_settings','get_trial_activity','get_trial_indications',
        'list_materials_for_entity','list_materials_for_space',
        'list_recent_materials_for_space','palette_empty_state','search_palette',
        'lookup_user_by_email'])
  loop
    if has_function_privilege('anon', proc.oid, 'EXECUTE') then
      bad := bad || format(E'\n  anon still executes %s', proc.sig);
    end if;
    if not has_function_privilege('authenticated', proc.oid, 'EXECUTE') then
      bad := bad || format(E'\n  authenticated lost %s (should keep)', proc.sig);
    end if;
  end loop;

  -- Block B: record_audit_event anon revoked, authenticated retained
  -- (sanctioned audit-write path).
  for proc in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_audit_event'
  loop
    if has_function_privilege('anon', proc.oid, 'EXECUTE') then
      bad := bad || format(E'\n  anon still executes record_audit_event: %s', proc.sig);
    end if;
    if not has_function_privilege('authenticated', proc.oid, 'EXECUTE') then
      bad := bad || format(E'\n  authenticated lost record_audit_event (sanctioned path): %s', proc.sig);
    end if;
  end loop;

  -- Block C: internal helpers revoked from authenticated.
  for proc in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        '_emit_events_from_marker_change','_materialize_trial_from_snapshot',
        '_recompute_asset_indication_status','_seed_ctgov_markers',
        '_sync_asset_indications','_verify_ctgov_worker_secret',
        '_verify_extract_source_worker_secret','_verify_r2_drain_worker_secret'])
  loop
    if has_function_privilege('authenticated', proc.oid, 'EXECUTE') then
      bad := bad || format(E'\n  authenticated still executes internal helper %s', proc.sig);
    end if;
  end loop;

  -- Regression guard: the seed_demo_data INVOKER chain MUST keep authenticated.
  for proc in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '\_seed\_demo\_%'
  loop
    if not has_function_privilege('authenticated', proc.oid, 'EXECUTE') then
      bad := bad || format(E'\n  authenticated lost seed helper %s (breaks seed_demo_data)', proc.sig);
    end if;
  end loop;

  if bad <> '' then
    raise exception 'lock_down_read_rpc_and_helper_grants smoke failed:%', bad;
  end if;
end $$;

-- Reload PostgREST's schema cache so the revised RPC surface is reflected.
notify pgrst, 'reload schema';
