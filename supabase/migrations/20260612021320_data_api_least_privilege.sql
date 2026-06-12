-- migration: 20260612021320_data_api_least_privilege
-- purpose: replace the broad legacy-parity table grants restored by
--   20260611120000_restore_data_api_table_grants with an explicit
--   least-privilege matrix. Two locks on every table from here on: an
--   explicit table grant plus RLS. A single buggy or missing policy no
--   longer exposes rows by itself.
--
-- scope:
--   * default ACLs: the anon/authenticated auto-grants for future tables and
--     sequences (re-established by 20260611120000) are revoked, so new
--     tables start dark and every future create-table migration must declare
--     its own grants. The service_role default ACLs stay untouched
--     (root-credential model, see the design doc).
--   * anon: zero table access. Its pre-auth surface is exactly the
--     explicitly granted SECURITY DEFINER RPCs (get_brand_by_host etc.).
--   * authenticated: exactly the per-table privileges recorded in
--     supabase/data-api-grants.json, the reviewed single source of truth.
--     Every row there carries a justification naming the consumer (client
--     service, integration spec, SECURITY INVOKER seed helper, or worker).
--     Tables absent from the matrix are no-access by construction.
--   * service_role: broad by default; the explicit deny-list (audit_events
--     and r2_pending_deletes writes) is re-asserted here so this migration
--     is self-contained even though 20260611120000 already revokes both.
--   * functions: unchanged except six stray anon execute grants that exist
--     only on hosted projects (provisioned before the function lockdown
--     sweeps); revoking them aligns hosted with the tighter local state.
--
-- remote: on dev and prod the default-ACL and blanket revokes do real work
--   (hosted still carries the legacy ACLs); the matrix grants are largely
--   no-ops there. On a fresh local reset the revokes undo 20260611120000's
--   catch-up grants and the matrix grants establish the end state. Either
--   way the database converges on supabase/data-api-grants.json, and the
--   grants drift gate keeps it there. Safe to push.

-- =============================================================================
-- 1. default ACLs: stop auto-granting anon/authenticated on future tables and
--    sequences. service_role's default ACLs are left as 20260611120000 set
--    them (tables, sequences, functions). Only the postgres-owned default
--    ACL is in scope: migrations run as postgres and own every app table.
--    The platform-managed supabase_admin default ACL also lists the API
--    roles, but postgres cannot alter it (not superuser, not a member of
--    supabase_admin, local and hosted alike) and it never applies to
--    migration-created objects.

-- revoke all, not just select/insert/update/delete: the legacy default ACL
-- carried the full table privilege set (arwdDxtm: also truncate, references,
-- trigger, maintain) and the 2.106.0 CLI revoke plus 20260611120000 only
-- cycled the four DML bits, so the residue would otherwise survive.

alter default privileges for role postgres in schema public
  revoke all on tables
  from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences
  from anon, authenticated;

-- =============================================================================
-- 2. blanket revoke: clear every existing anon/authenticated table and
--    sequence grant in public, including the deliberate single-table grants
--    from earlier migrations. The matrix below re-grants the authenticated
--    surface explicitly; anon gets nothing back. service_role keeps
--    everything it has.

-- revoke all for the same reason as section 1: tables provisioned under the
-- legacy default ACL on hosted carry the full privilege set, not just the
-- four DML bits a fresh local reset grants.

revoke all on all tables in schema public
  from anon, authenticated;

revoke all on all sequences in schema public
  from anon, authenticated;

-- =============================================================================
-- 3. matrix grants: one statement per table, generated from
--    supabase/data-api-grants.json (the single source of truth; see each
--    entry's justification there). Regenerate with:
--
--      node -e 'const m = require("./supabase/data-api-grants.json");
--        for (const t of Object.keys(m.tables).sort())
--          console.log(`grant ${m.tables[t].authenticated.join(", ")} on public.${t} to authenticated;`)'

grant select on public.agencies to authenticated;
grant select, insert, update, delete on public.agency_members to authenticated;
grant select on public.ai_config to authenticated;
grant insert on public.asset_indications to authenticated;
grant select, insert on public.asset_mechanisms_of_action to authenticated;
grant select, insert on public.asset_routes_of_administration to authenticated;
grant select, insert, update, delete on public.assets to authenticated;
grant select on public.audit_events to authenticated;
grant select on public.change_event_annotations to authenticated;
grant select, insert, update, delete on public.companies to authenticated;
grant insert on public.condition_indication_map to authenticated;
grant select, insert on public.conditions to authenticated;
grant select on public.event_categories to authenticated;
grant insert on public.event_links to authenticated;
grant insert on public.event_sources to authenticated;
grant select, insert, delete on public.event_threads to authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant select, insert, update, delete on public.indications to authenticated;
grant select, delete on public.marker_assignments to authenticated;
grant select on public.marker_categories to authenticated;
grant select, insert, update, delete on public.marker_types to authenticated;
grant select, insert, update, delete on public.markers to authenticated;
grant select on public.material_links to authenticated;
grant select, update on public.materials to authenticated;
grant select, insert, update, delete on public.mechanisms_of_action to authenticated;
grant select on public.primary_intelligence to authenticated;
grant select on public.retired_hostnames to authenticated;
grant select, insert, update, delete on public.routes_of_administration to authenticated;
grant select, delete on public.space_invites to authenticated;
grant select, insert, update, delete on public.space_members to authenticated;
grant select, update on public.spaces to authenticated;
grant select, insert on public.tenant_invites to authenticated;
grant select, delete on public.tenant_members to authenticated;
grant select, update, delete on public.tenants to authenticated;
grant select on public.trial_assets to authenticated;
grant insert on public.trial_conditions to authenticated;
grant select on public.trial_ctgov_snapshots to authenticated;
grant select, insert, update, delete on public.trial_notes to authenticated;
grant select, insert, update, delete on public.trials to authenticated;

-- =============================================================================
-- 4. service_role deny-list: tables where even root-key writes must go
--    through SECURITY DEFINER RPCs. Generated from the matrix's
--    service_role_denied block:
--
--      node -e 'const m = require("./supabase/data-api-grants.json");
--        for (const t of Object.keys(m.service_role_denied).sort())
--          console.log(`revoke ${m.service_role_denied[t].denied.join(", ")} on public.${t} from service_role;`)'
--
--    20260611120000 already revokes both; re-asserting keeps this migration
--    self-contained. record_audit_event() is the only audit_events write
--    path; r2_pending_deletes is written only by the _enqueue_r2_delete
--    trigger and the shared-secret drain RPCs.

revoke insert, update, delete on public.audit_events from service_role;
revoke insert, update, delete on public.r2_pending_deletes from service_role;

-- =============================================================================
-- 5. stray hosted anon function grants: these six exist only on dev/prod
--    (legacy creation-time default ACLs predating the lockdown sweeps).
--    No-ops on a fresh local database; real revokes on hosted.

revoke execute on function public.export_audit_events_csv(text, uuid, uuid, text, timestamp with time zone, timestamp with time zone) from anon;
revoke execute on function public.get_latest_sync_run() from anon;
revoke execute on function public.is_tenant_owner_strict(uuid) from anon;
revoke execute on function public.list_audit_events(text, uuid, uuid, text, timestamp with time zone, timestamp with time zone, integer, integer) from anon;
revoke execute on function public.recompute_trial_change_events(uuid) from anon;
revoke execute on function public.trigger_single_trial_sync(uuid) from anon;

-- =============================================================================
-- smoke test: assert the least-privilege end state. Catches the matrix and
-- this migration drifting apart, a future migration re-broadening the
-- baseline, and the default ACLs regrowing the auto-grant.

do $$
begin
  -- A granted read and a granted write from the matrix.
  if not has_table_privilege('authenticated', 'public.trials', 'select') then
    raise exception 'least privilege smoke: authenticated lost select on trials';
  end if;

  if not has_table_privilege('authenticated', 'public.trials', 'insert') then
    raise exception 'least privilege smoke: authenticated lost insert on trials';
  end if;

  -- anon cannot address tables at all.
  if has_table_privilege('anon', 'public.trials', 'select') then
    raise exception 'least privilege smoke: anon can select trials';
  end if;

  if has_table_privilege('anon', 'public.companies', 'select') then
    raise exception 'least privilege smoke: anon can select companies';
  end if;

  -- service_role deny-list holds.
  if has_table_privilege('service_role', 'public.audit_events', 'insert') then
    raise exception 'least privilege smoke: audit_events insert leaked to service_role';
  end if;

  -- Tables absent from the matrix stay dark for authenticated.
  if has_table_privilege('authenticated', 'public.ctgov_sync_runs', 'select') then
    raise exception 'least privilege smoke: ctgov_sync_runs select leaked to authenticated';
  end if;

  if has_table_privilege('authenticated', 'public.platform_admins', 'select') then
    raise exception 'least privilege smoke: platform_admins select leaked to authenticated';
  end if;

  -- The stray hosted anon function revokes hold (no-op locally, real on
  -- hosted; this assertion keeps both converged).
  if has_function_privilege('anon', 'public.list_audit_events(text, uuid, uuid, text, timestamp with time zone, timestamp with time zone, integer, integer)', 'execute') then
    raise exception 'least privilege smoke: list_audit_events executable by anon';
  end if;

  -- Default ACLs: the postgres-owned default ACL for public relations and
  -- sequences may no longer auto-grant anon or authenticated. Scoped to
  -- defaclrole = postgres: migrations run as postgres and own every app
  -- table, so this is the only default ACL that ever applies to them. The
  -- platform-managed supabase_admin default ACL also lists the API roles,
  -- but postgres is neither superuser nor a member of supabase_admin (local
  -- and hosted alike), so a migration cannot alter it; it only governs
  -- objects supabase_admin itself creates and is out of scope here.
  if exists (
    select 1
    from pg_default_acl
    join pg_namespace on pg_namespace.oid = pg_default_acl.defaclnamespace
    cross join lateral aclexplode(pg_default_acl.defaclacl) as acl
    where pg_namespace.nspname = 'public'
      and pg_default_acl.defaclrole = 'postgres'::regrole
      and pg_default_acl.defaclobjtype in ('r', 'S')
      and acl.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)
  ) then
    raise exception 'least privilege smoke: postgres default ACL still auto-grants anon or authenticated';
  end if;

  -- ... while the service_role table default ACL must survive (new tables
  -- stay reachable with the service key without per-migration grants).
  if not exists (
    select 1
    from pg_default_acl
    join pg_namespace on pg_namespace.oid = pg_default_acl.defaclnamespace
    cross join lateral aclexplode(pg_default_acl.defaclacl) as acl
    where pg_namespace.nspname = 'public'
      and pg_default_acl.defaclrole = 'postgres'::regrole
      and pg_default_acl.defaclobjtype = 'r'
      and acl.grantee = 'service_role'::regrole::oid
  ) then
    raise exception 'least privilege smoke: service_role table default ACL is gone';
  end if;

  raise notice 'data_api_least_privilege smoke test: PASS';
end$$;

-- PostgREST caches the grant surface; reload so the new privileges apply to
-- API traffic immediately (see feedback_postgrest_reload_after_rpc_signature).
notify pgrst, 'reload schema';
