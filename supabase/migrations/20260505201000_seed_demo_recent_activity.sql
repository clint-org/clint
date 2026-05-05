-- migration: 20260505201000_seed_demo_recent_activity
-- purpose: light up the engagement-landing "Next 14 days" and
--          "What changed" widgets immediately after seed_demo_data() runs
--          against a fresh space. The realistic cardiometabolic seed uses
--          hardcoded calendar dates, so as the calendar advances, both the
--          upcoming-catalysts widget (event_date in [today, today+14]) and
--          the high-signal activity feed (date_moved with days_diff > 90)
--          go empty for fresh provisions. Anchoring a small set of markers
--          to current_date + interval keeps the demo lit regardless of when
--          `supabase db reset` was last run.
-- affected objects:
--   - public._seed_demo_recent_activity (new helper, security definer)
--   - public.seed_demo_data            (orchestrator: appended call to helper)

-- =============================================================================
-- 1. helper: insert 5 upcoming-catalyst markers anchored to current_date and
--    slip 3 existing projected markers by >90 days so the high_signal whitelist
--    surfaces them in the "What changed" widget.
-- =============================================================================

create or replace function public._seed_demo_recent_activity(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Trial lookups by name (the cardiometabolic seed stores the acronym in
  -- trials.name). NULL-tolerant: if the realistic seed isn't loaded, we
  -- bail out below before any write.
  t_redefine_2  uuid;
  t_attain_1    uuid;
  t_achieve_1   uuid;
  t_triumph_1   uuid;
  t_acacia_hcm  uuid;

  m_redefine_2  uuid := gen_random_uuid();
  m_attain_1    uuid := gen_random_uuid();
  m_achieve_1   uuid := gen_random_uuid();
  m_triumph_1   uuid := gen_random_uuid();
  m_acacia_hcm  uuid := gen_random_uuid();
begin
  select id into t_redefine_2 from public.trials where space_id = p_space_id and name = 'REDEFINE-2' limit 1;
  select id into t_attain_1   from public.trials where space_id = p_space_id and name = 'ATTAIN-1'   limit 1;
  select id into t_achieve_1  from public.trials where space_id = p_space_id and name = 'ACHIEVE-1'  limit 1;
  select id into t_triumph_1  from public.trials where space_id = p_space_id and name = 'TRIUMPH-1'  limit 1;
  select id into t_acacia_hcm from public.trials where space_id = p_space_id and name = 'ACACIA-HCM' limit 1;

  -- Bail out if the realistic cardiometabolic seed wasn't loaded. The widget
  -- is meant for that demo dataset; on any other seed variant we leave the
  -- space alone.
  if t_redefine_2 is null then
    return;
  end if;

  -- ---------------------------------------------------------------------------
  -- Upcoming catalysts (next 14 days). marker_type a0...0013 = Topline Data.
  -- ---------------------------------------------------------------------------

  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, description) values
    (m_redefine_2,  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'REDEFINE-2 topline expected',  'company', (current_date + interval '2 days')::date,  'Novo CagriSema P3 in obesity + T2D, follow-on to REDEFINE-1.'),
    (m_attain_1,    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ATTAIN-1 topline expected',    'company', (current_date + interval '5 days')::date,  'Lilly orforglipron P3 obesity readout.'),
    (m_achieve_1,   p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ACHIEVE-1 topline expected',   'company', (current_date + interval '8 days')::date,  'Lilly orforglipron P3 T2D readout.'),
    (m_triumph_1,   p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'TRIUMPH-1 topline expected',   'company', (current_date + interval '11 days')::date, 'Lilly retatrutide P3 obesity readout.'),
    (m_acacia_hcm,  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ACACIA-HCM topline expected',  'company', (current_date + interval '14 days')::date, 'Cytokinetics aficamten in non-obstructive HCM.');

  insert into public.marker_assignments (marker_id, trial_id) values
    (m_redefine_2, t_redefine_2),
    (m_attain_1,   t_attain_1),
    (m_achieve_1,  t_achieve_1),
    (m_triumph_1,  t_triumph_1),
    (m_acacia_hcm, t_acacia_hcm);

  -- ---------------------------------------------------------------------------
  -- Slip three existing projected markers by >90 days. The marker_changes
  -- trigger emits `date_moved` events with days_diff equal to the slip, and
  -- get_activity_feed's whitelist=high_signal accepts date_moved when
  -- days_diff > 90. observed_at is now(), so these land in the last-7-day
  -- window the "What changed" widget queries.
  -- ---------------------------------------------------------------------------

  update public.markers
     set event_date = (event_date + interval '100 days')::date
   where space_id = p_space_id and title = 'TRIUMPH-1 topline projected';

  update public.markers
     set event_date = (event_date + interval '180 days')::date
   where space_id = p_space_id and title = 'SURMOUNT-MMO topline projected';

  update public.markers
     set event_date = (event_date + interval '120 days')::date
   where space_id = p_space_id and title = 'CT-388 P2 final analysis projected';
end;
$$;

comment on function public._seed_demo_recent_activity(uuid, uuid) is
  'Inserts 5 upcoming-catalyst markers (event_date in [today, today+14]) and slips 3 existing projected markers by >90 days so the engagement-landing "Next 14 days" and "What changed" widgets render content immediately after seed_demo_data() runs against a fresh space. SECURITY DEFINER (matches the other _seed_demo_* helpers per migration 20260504000000). Idempotent in practice because seed_demo_data short-circuits when companies already exist.';

-- =============================================================================
-- 2. orchestrator: append the new helper to the seed_demo_data pipeline.
--    Mirrors the body from migration 20260503080000_drop_marker_notifications,
--    plus one extra perform line at the end.
-- =============================================================================

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
end;
$$;

comment on function public.seed_demo_data(uuid) is
  'Seeds a space with comprehensive demo data: 8 real pharma companies, 20 fictional products across 4 therapeutic areas, 26 trials covering all phases, 55+ markers, 12 trial notes, 20 events, plus 5 published primary intelligence reads (4 trial-anchored, 1 space-level thematic), 2 drafts, 3 materials, and (added 2026-05-05) 5 upcoming-catalyst markers in the next 14 days plus 3 >90d slips on projected markers so the engagement-landing widgets always have fresh content. Permission gate: caller must be a space owner of p_space_id or a platform admin. Idempotent: returns early if the space already has companies.';
