-- migration: 20260607120000_lock_down_function_execute_grants
--
-- Purpose: close the direct PostgREST /rest/v1/rpc/ path on functions that were
-- never meant to be called by clients, and clear the bulk of the Supabase
-- advisor 0028 (anon) / 0029 (authenticated) "SECURITY DEFINER function
-- executable" warnings.
--
-- Why earlier `revoke ... from public` lines did not work: Supabase grants
-- EXECUTE on public-schema functions DIRECTLY to anon and authenticated (not
-- only via PUBLIC). Revoking from PUBLIC alone leaves the direct grants in
-- place, which is why e.g. _log_marker_change still appeared in the advisor
-- output after a prior `revoke ... from public`. To actually remove access you
-- must revoke from anon/authenticated explicitly.
--
-- Safety model:
--   * Block 1 (trigger functions): revoke from anon, authenticated, public.
--     Postgres executes a trigger function when the trigger fires REGARDLESS of
--     whether the firing role holds EXECUTE on it, so stripping all three roles
--     can never break trigger execution. It only removes the (meaningless)
--     direct /rpc/ call path.
--   * Block 2 (internal `_`-prefixed helpers) and Block 3 (write RPCs): revoke
--     from anon, public only -- KEEP authenticated. Several internal helpers are
--     reached through SECURITY INVOKER parents (e.g. seed_demo_data ->
--     _seed_demo_*), where the nested call runs as the original caller; removing
--     authenticated there would break those flows. Authenticated grants are
--     direct, so revoking PUBLIC does not disturb them.
--
-- Intentionally left callable by anon (legitimate pre-auth / worker paths):
--   get_brand_by_host, check_subdomain_available (pre-bootstrap brand fetch),
--   and the worker-secret RPCs (ai_call_*, ingest_ctgov_snapshot,
--   get_trials_for_polling, record_sync_run, bulk_update_last_polled,
--   claim_pending_r2_deletes, mark_r2_delete_*) which are gated by a shared
--   secret verified inside the function.
--
-- Read RPCs (get_* / list_* / search_*) are intentionally NOT touched here:
-- the host-aware public site work may surface some of them to anon, so their
-- anon grant is left for a follow-up once that read surface is settled.

-- ---------------------------------------------------------------------------
-- Block 1: trigger functions -- revoke from anon, authenticated, public.
-- ---------------------------------------------------------------------------
do $$
declare
  fn   text;
  proc record;
  trigger_fns text[] := array[
    '_audit_trigger_agency_members',
    '_audit_trigger_platform_admins',
    '_audit_trigger_retired_hostnames',
    '_audit_trigger_space_invite_issued',
    '_audit_trigger_space_members',
    '_audit_trigger_tenant_invite_issued',
    '_audit_trigger_tenant_members',
    '_audit_trigger_tenant_suspension',
    '_auto_derive_asset_indication_status',
    '_auto_derive_on_trial_condition_change',
    '_cleanup_orphan_marker',
    '_cleanup_polymorphic_refs',
    '_enqueue_r2_delete',
    '_guard_ctgov_locked_phase_fields',
    '_log_marker_change',
    '_set_created_by',
    '_set_updated_audit',
    '_trial_assets_bootstrap',
    '_trial_assets_sync_indications',
    '_trial_assets_sync_primary',
    'assign_primary_intelligence_version',
    'enforce_agency_member_guards',
    'enforce_custom_domain_unique_across_tables',
    'enforce_member_email_domain',
    'enforce_space_member_guards',
    'enforce_subdomain_unique_across_tables',
    'enforce_tenant_member_guards',
    'guard_primary_intelligence_state',
    'handle_new_user',
    'member_guard_mark_cascade_end',
    'member_guard_mark_cascade_start',
    'retire_hostname_on_change',
    'write_primary_intelligence_revision'
  ];
begin
  foreach fn in array trigger_fns loop
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
-- Block 2: internal `_`-prefixed helpers -- revoke from anon, public.
--   Keep authenticated: some are invoked through SECURITY INVOKER parents
--   (seed_demo_data -> _seed_demo_*) where the nested call runs as the caller.
--   Trigger helpers already fully revoked in Block 1 are a harmless no-op here.
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
      and p.prokind = 'f'
      and p.proname like '\_%'
  loop
    execute format('revoke execute on function %s from anon, public', proc.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Block 3: write RPCs (client-called mutations) -- revoke from anon, public.
--   Keep authenticated; the app calls these as a signed-in user, and each
--   authorizes internally (has_space_access / is_tenant_member / etc.). anon
--   could never satisfy those checks, so closing the anon path is pure
--   surface reduction.
-- ---------------------------------------------------------------------------
do $$
declare
  fn   text;
  proc record;
  write_rpcs text[] := array[
    'accept_invite',
    'accept_space_invite',
    'add_agency_member',
    'add_tenant_owner',
    'archive_space',
    'backfill_marker_history',
    'commit_source_import',
    'create_asset',
    'create_company',
    'create_event',
    'create_marker',
    'create_space',
    'create_trial',
    'delete_agency',
    'delete_change_event_annotation',
    'delete_material',
    'delete_primary_intelligence',
    'finalize_material',
    'invite_to_space',
    'link_asset_moa_roa',
    'palette_set_pinned',
    'palette_touch_recent',
    'palette_unpin',
    'permanently_delete_space',
    'platform_admin_set_ai_enabled',
    'prepare_material_upload',
    'provision_agency',
    'provision_tenant',
    'purge_primary_intelligence',
    'redact_user',
    'redact_user_pii',
    'register_custom_domain',
    'register_material',
    'release_retired_hostname',
    'reset_asset_indication_status',
    'restore_space',
    'self_join_tenant',
    'set_trial_assets',
    'set_trial_indications',
    'tenant_owner_update_ai_config',
    'update_agency_branding',
    'update_asset_mechanisms',
    'update_asset_routes',
    'update_event_links',
    'update_event_sources',
    'update_marker_assignments',
    'update_material',
    'update_space_field_visibility',
    'update_space_show_preclinical',
    'update_tenant_access',
    'update_tenant_branding',
    'upsert_change_event_annotation',
    'upsert_primary_intelligence',
    'withdraw_primary_intelligence',
    'seed_demo_data'
  ];
begin
  foreach fn in array write_rpcs loop
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

-- Reload PostgREST's schema cache so the revised RPC surface is reflected.
notify pgrst, 'reload schema';
