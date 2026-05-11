-- migration: 20260510002000_audit_coverage_smoke
-- purpose: every function tagged `-- @audit:tier1` in its body MUST contain a
--   record_audit_event call. fails the migration if any tagged function lacks
--   instrumentation. enforces the spec rule that all Tier 1 RPCs emit audit events.

do $$
declare
  v_tier1_count int := 0;
  v_missing_count int := 0;
  v_fn_name text;
begin
  -- Count functions tagged with @audit:tier1
  select count(*)
  into v_tier1_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and prosrc ilike '%-- @audit:tier1%';

  -- Find functions tagged with @audit:tier1 but missing record_audit_event
  for v_fn_name in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and prosrc ilike '%-- @audit:tier1%'
      and prosrc !~ 'record_audit_event\s*\('
  loop
    raise exception 'audit coverage FAIL: function % tagged @audit:tier1 missing record_audit_event', v_fn_name;
  end loop;

  raise notice 'audit coverage smoke: PASS (% functions tagged @audit:tier1, all emit record_audit_event)',
    v_tier1_count;
end $$;
