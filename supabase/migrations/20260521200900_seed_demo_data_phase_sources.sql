-- migration: 20260521200900_seed_demo_data_phase_sources
-- purpose: extend public.seed_demo_data so that after the demo data is laid
--          down, every seeded trial's phase_type_source /
--          phase_start_date_source / phase_end_date_source columns are
--          populated. NCT-bearing trials (the realistic cardiometabolic seed
--          rows have identifiers that match what ct.gov would publish) get
--          'ctgov'; non-NCT rows (e.g. preclinical or analyst-managed trials
--          with identifier null) get 'analyst'. Trials with a null phase_type
--          leave the corresponding source column null.
--
-- approach: re-declare seed_demo_data with the identical orchestrator body
--          from the prior revision (20260510120200_seed_demo_activity_variety),
--          then append a single UPDATE before `end;` that stamps the source
--          columns on all trials in p_space_id. The UPDATE is idempotent and
--          cheap (per-space).
--
-- affected objects:
--   - public.seed_demo_data(uuid)  (create or replace)
--
-- dependencies:
--   - 20260521195224_trial_phase_source_columns.sql (adds the source columns
--     and the constraint that ctgov-source rows must have phase_type set)
--   - 20260510120200_seed_demo_activity_variety.sql (prior canonical body
--     of seed_demo_data, copied verbatim here)
--
-- idempotency: the wrapping seed function already short-circuits when the
--   target space already has companies, so the appended UPDATE only runs on
--   a fresh seed. Even if it did re-run, the result is deterministic.

create or replace function public.seed_demo_data(p_space_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  existing_count int;
begin
  if uid is null then
    raise exception 'Must be authenticated to seed demo data'
      using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.space_members
     where space_id = p_space_id
       and user_id = uid
       and role = 'owner'
  ) and not public.is_platform_admin() then
    raise exception 'Insufficient permissions: must be space owner to seed demo data'
      using errcode = '42501';
  end if;

  select count(*) into existing_count
    from public.companies
    where space_id = p_space_id;

  if existing_count > 0 then
    return;
  end if;

  create temp table if not exists _seed_ids (
    entity_type text not null,
    key         text not null,
    id          uuid not null,
    primary key (entity_type, key)
  ) on commit drop;

  perform public._seed_demo_companies(p_space_id, uid);
  perform public._seed_demo_therapeutic_areas(p_space_id, uid);
  perform public._seed_demo_products(p_space_id, uid);
  perform public._seed_demo_moa_roa(p_space_id, uid);
  perform public._seed_demo_trials(p_space_id, uid);
  perform public._seed_demo_markers(p_space_id, uid);
  perform public._seed_demo_trial_notes(p_space_id, uid);
  perform public._seed_demo_events(p_space_id, uid);
  perform public._seed_demo_primary_intelligence(p_space_id, uid);
  perform public._seed_demo_materials(p_space_id, uid);
  perform public._seed_demo_recent_activity(p_space_id, uid);
  perform public._seed_demo_activity_variety(p_space_id, uid);

  -- stamp source columns on seeded trials: NCT-bearing trials with phase data
  -- get 'ctgov' (they were seeded to match what ct.gov would say); non-NCT or
  -- analyst-managed trials get 'analyst'.
  update public.trials
     set phase_type_source       = case
           when phase_type is null then null
           when identifier is null then 'analyst'
           else 'ctgov'
         end,
         phase_start_date_source = case
           when phase_start_date is null then null
           when identifier is null then 'analyst'
           else 'ctgov'
         end,
         phase_end_date_source   = case
           when phase_end_date is null then null
           when identifier is null then 'analyst'
           else 'ctgov'
         end
   where space_id = p_space_id;
end;
$$;

comment on function public.seed_demo_data(uuid) is
  'Seeds a space with comprehensive demo data: 8 real pharma companies, 20 fictional products across 4 therapeutic areas, 26 trials covering all phases, 55+ markers, 12 trial notes, 20 events, plus 5 published primary intelligence reads (4 trial-anchored, 1 space-level thematic), 2 drafts, 3 materials, 5 upcoming-catalyst markers in the next 14 days, 3 >90d slips on projected markers so the engagement-landing widgets always have fresh content, and (added 2026-05-10) one demo event of every event_type so the Activity page renders the full row-renderer matrix. Permission gate: caller must be a space owner of p_space_id or a platform admin. Idempotent: returns early if the space already has companies. Also stamps phase_type_source / phase_start_date_source / phase_end_date_source on seeded trials: ctgov for NCT-bearing trials, analyst for non-NCT trials.';
