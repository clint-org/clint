-- 01_schema_integrity
-- Asserts the audit log schema is fully wired: table, indexes, role, RLS, functions.

do $$
declare
  v_count int;
  v_ok    boolean;
begin
  raise notice '01_schema_integrity: checking audit_events table exists';

  -- table exists
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'audit_events'
  ) then
    raise exception 'SCHEMA FAIL: public.audit_events table does not exist';
  end if;

  raise notice '01_schema_integrity: checking 7 required indexes';

  -- all 7 indexes present
  select count(*) into v_count
  from pg_indexes
  where schemaname = 'public' and tablename = 'audit_events'
    and indexname in (
      'audit_events_agency_occurred',
      'audit_events_tenant_occurred',
      'audit_events_space_occurred',
      'audit_events_actor_occurred',
      'audit_events_resource',
      'audit_events_action_occurred',
      'audit_events_occurred_brin'
    );
  if v_count <> 7 then
    raise exception 'SCHEMA FAIL: expected 7 indexes on audit_events, found %; missing one or more of the required set', v_count;
  end if;

  raise notice '01_schema_integrity: checking audit_writer role exists';

  -- audit_writer role exists
  if not exists (select 1 from pg_roles where rolname = 'audit_writer') then
    raise exception 'SCHEMA FAIL: audit_writer role does not exist';
  end if;

  raise notice '01_schema_integrity: checking RLS is enabled on audit_events';

  -- RLS enabled
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'audit_events' and c.relrowsecurity
  ) then
    raise exception 'SCHEMA FAIL: RLS is not enabled on public.audit_events';
  end if;

  raise notice '01_schema_integrity: checking strict-scope SELECT policy exists';

  -- strict-scope SELECT policy exists
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'audit_events'
      and policyname = 'audit_events_select_strict_scope_owners'
      and cmd = 'SELECT'
  ) then
    raise exception 'SCHEMA FAIL: policy audit_events_select_strict_scope_owners not found on audit_events';
  end if;

  raise notice '01_schema_integrity: checking required functions exist';

  -- required functions
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'record_audit_event',
      'redact_user_pii',
      'list_audit_events',
      'export_audit_events_csv',
      'jsonb_strip_pii_keys',
      'is_tenant_owner_strict'
    );
  if v_count < 6 then
    raise exception 'SCHEMA FAIL: expected at least 6 required functions, found %', v_count;
  end if;

  raise notice '01_schema_integrity: PASS (table, 7 indexes, audit_writer role, RLS enabled, policy, 6 functions)';
end $$;
