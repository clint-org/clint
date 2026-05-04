-- migration: 20260504000000_seed_demo_helpers_security_definer
-- purpose: bump every public._seed_demo_* helper to SECURITY DEFINER. The
--   role-access integration suite caught two failure modes that share one
--   root cause:
--
--     - space_owner > seed_demo_data: 'new row violates row-level security
--       policy for table "material_links"'. The cardiometabolic
--       _seed_demo_materials redefinition (20260502130000) writes 36 monthly
--       briefings with one CTE that does INSERT INTO materials RETURNING id
--       then INSERT INTO material_links ... SELECT FROM inserted. The RLS
--       WITH CHECK on material_links queries materials via EXISTS, and PG
--       does not expose CTE-INSERT side effects to subqueries on the same
--       table fired by RLS in the same statement. The check returns false,
--       insert blocked.
--
--     - platform_admin > seed_demo_data: 'new row violates row-level security
--       policy for table "companies"'. Platform admins have no space
--       membership in test fixtures (or in real engagements they do not own).
--       _seed_demo_companies is SECURITY INVOKER, so the companies INSERT
--       policy (has_space_access(space_id, ['owner','editor'])) blocks them
--       even though the orchestrator already accepted them via
--       is_platform_admin().
--
--   public.seed_demo_data already has the authoritative gate (caller must be
--   space owner OR platform admin). _seed_demo_primary_intelligence was
--   already moved to SECURITY DEFINER in 20260501132002 for the same reason
--   (its agency-only RLS would block legitimate space owners). Bringing the
--   other nine helpers in line removes both failure modes at once.
--
-- security note: search_path on each function stays '' (explicit qualifier
--   on every reference), which is the SECURITY DEFINER hardening contract.
--   auth.uid() inside a SECURITY DEFINER function still resolves to the
--   caller, so created_by / uploaded_by attribution remains correct.

alter function public._seed_demo_companies(uuid, uuid)         security definer;
alter function public._seed_demo_therapeutic_areas(uuid, uuid) security definer;
alter function public._seed_demo_products(uuid, uuid)          security definer;
alter function public._seed_demo_moa_roa(uuid, uuid)           security definer;
alter function public._seed_demo_trials(uuid, uuid)            security definer;
alter function public._seed_demo_markers(uuid, uuid)           security definer;
alter function public._seed_demo_trial_notes(uuid, uuid)       security definer;
alter function public._seed_demo_events(uuid, uuid)            security definer;
alter function public._seed_demo_materials(uuid, uuid)         security definer;

-- =============================================================================
-- smoke: confirm every helper is SECURITY DEFINER and that seed_demo_data is
-- still SECURITY INVOKER (the caller-identity gate must run as the caller).
do $$
declare
  v_helper text;
  v_secdef boolean;
  v_helpers text[] := array[
    '_seed_demo_companies',
    '_seed_demo_therapeutic_areas',
    '_seed_demo_products',
    '_seed_demo_moa_roa',
    '_seed_demo_trials',
    '_seed_demo_markers',
    '_seed_demo_trial_notes',
    '_seed_demo_events',
    '_seed_demo_primary_intelligence',
    '_seed_demo_materials'
  ];
begin
  foreach v_helper in array v_helpers loop
    select prosecdef into v_secdef
      from pg_proc
     where proname = v_helper
       and pronamespace = 'public'::regnamespace;
    if v_secdef is null then
      raise exception 'seed_demo helpers smoke FAIL: % missing', v_helper;
    end if;
    if not v_secdef then
      raise exception 'seed_demo helpers smoke FAIL: % is not SECURITY DEFINER', v_helper;
    end if;
  end loop;

  select prosecdef into v_secdef
    from pg_proc
   where proname = 'seed_demo_data'
     and pronamespace = 'public'::regnamespace;
  if v_secdef then
    raise exception 'seed_demo helpers smoke FAIL: orchestrator must stay SECURITY INVOKER';
  end if;

  raise notice 'seed_demo helpers security definer smoke: PASS';
end $$;
