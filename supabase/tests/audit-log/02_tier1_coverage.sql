-- 02_tier1_coverage
-- Asserts every function tagged @audit:tier1 contains a record_audit_event() call.
-- Lists the function names via NOTICE so the reader can see the full coverage surface.

do $$
declare
  v_tier1_count int;
  v_missing     int;
  v_fn_name     text;
  v_fn_list     text := '';
begin
  raise notice '02_tier1_coverage: scanning pg_proc for @audit:tier1 markers in public schema';

  select count(*) into v_tier1_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and prosrc ilike '%-- @audit:tier1%';

  if v_tier1_count < 11 then
    raise exception 'COVERAGE FAIL: expected >= 11 @audit:tier1 functions, found %', v_tier1_count;
  end if;

  raise notice '02_tier1_coverage: found % @audit:tier1 functions', v_tier1_count;

  -- collect names for the notice
  for v_fn_name in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and prosrc ilike '%-- @audit:tier1%'
    order by p.proname
  loop
    v_fn_list := v_fn_list || ' ' || v_fn_name;
  end loop;

  raise notice '02_tier1_coverage: tagged functions:%', v_fn_list;

  -- every tagged function must also contain a record_audit_event( call
  v_missing := 0;
  for v_fn_name in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and prosrc ilike '%-- @audit:tier1%'
      and prosrc !~ 'record_audit_event\s*\('
    order by p.proname
  loop
    raise notice '02_tier1_coverage: MISSING record_audit_event in function %', v_fn_name;
    v_missing := v_missing + 1;
  end loop;

  if v_missing > 0 then
    raise exception 'COVERAGE FAIL: % @audit:tier1 function(s) lack a record_audit_event() call', v_missing;
  end if;

  raise notice '02_tier1_coverage: PASS (% tagged functions, all emit record_audit_event)', v_tier1_count;
end $$;
