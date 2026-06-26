-- =============================================================================
-- Heatmap PI presence: count an asset's TRIALS' intelligence, not just the
-- asset's own.
--
-- 20260626170000 defined get_positioning_data.has_intelligence as published PI
-- with entity_type='product' on the asset only. But the app's canonical notion
-- of "an asset has intelligence" -- the one the bullseye node and
-- get_intelligence_notes_for_asset use -- is published PI ABOUT THE ASSET OR ANY
-- OF ITS TRIALS. Most PI is authored on trials, so the product-only flag left
-- the heatmap empty even where the bullseye lit up. Align the two: an asset has
-- intelligence when there is published PI with entity_type='product' on it, or
-- entity_type='trial' on any trial linked to it via trial_assets.
--
-- Body is the verbatim 20260626170000 definition; only the has_intelligence
-- subquery and the comment change.
-- =============================================================================

create or replace function public.get_positioning_data(
  p_space_id                    uuid,
  p_grouping                    text default 'moa',
  p_count_unit                  text default 'products',
  p_company_ids                 uuid[] default null,
  p_asset_ids                   uuid[] default null,
  p_indication_ids              uuid[] default null,
  p_mechanism_of_action_ids     uuid[] default null,
  p_route_of_administration_ids uuid[] default null,
  p_phases                      text[] default null,
  p_recruitment_statuses        text[] default null,
  p_study_types                 text[] default null
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_bubbles            jsonb;
  v_latest_event_date  timestamptz;
begin
  -- coerce empty arrays to null so the "is null" checks below work
  if p_company_ids = '{}' then p_company_ids := null; end if;
  if p_asset_ids = '{}' then p_asset_ids := null; end if;
  if p_indication_ids = '{}' then p_indication_ids := null; end if;
  if p_mechanism_of_action_ids = '{}' then p_mechanism_of_action_ids := null; end if;
  if p_route_of_administration_ids = '{}' then p_route_of_administration_ids := null; end if;
  if p_phases = '{}' then p_phases := null; end if;
  if p_recruitment_statuses = '{}' then p_recruitment_statuses := null; end if;
  if p_study_types = '{}' then p_study_types := null; end if;

  with status_rank_map(status_name, status_rank) as (
    values
      ('PRECLIN'::text, 0), ('P1', 1), ('P2', 2), ('P3', 3),
      ('P4', 4), ('APPROVED', 5), ('LAUNCHED', 6)
  ),

  -- eligible assets after applying all filters
  eligible_assets as (
    select distinct a.id as asset_id, a.name as asset_name,
           a.generic_name as asset_generic_name,
           a.company_id, c.name as company_name, c.logo_url as company_logo_url,
           a.updated_at as asset_updated_at
    from public.assets a
    join public.companies c on c.id = a.company_id
    join public.asset_indications ai on ai.asset_id = a.id
    join status_rank_map srm on srm.status_name = ai.development_status
    where a.space_id = p_space_id
      and ai.development_status is not null
      and (p_company_ids is null or a.company_id = any(p_company_ids))
      and (p_asset_ids is null or a.id = any(p_asset_ids))
      and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))
      and (p_mechanism_of_action_ids is null or exists (
        select 1 from public.asset_mechanisms_of_action am
        where am.asset_id = a.id and am.moa_id = any(p_mechanism_of_action_ids)
      ))
      and (p_route_of_administration_ids is null or exists (
        select 1 from public.asset_routes_of_administration ar
        where ar.asset_id = a.id and ar.roa_id = any(p_route_of_administration_ids)
      ))
      and (p_phases is null or ai.development_status = any(p_phases))
  ),

  -- roll up to one row per asset with its highest phase and trial count
  asset_highest_phase as (
    select ea.asset_id, ea.asset_name, ea.asset_generic_name,
           ea.company_id, ea.company_name, ea.company_logo_url, ea.asset_updated_at,
           max(srm.status_rank) as highest_phase_rank,
           (array_agg(srm.status_name order by srm.status_rank desc))[1] as highest_phase,
           count(distinct t.id) as trial_count,
           exists (
             select 1 from public.primary_intelligence pi
             where pi.space_id = p_space_id
               and pi.state    = 'published'
               and (
                 (pi.entity_type = 'product' and pi.entity_id = ea.asset_id)
                 or (pi.entity_type = 'trial' and exists (
                       select 1
                       from public.trial_assets ta2
                       join public.trials t2 on t2.id = ta2.trial_id
                       where ta2.trial_id = pi.entity_id
                         and ta2.asset_id = ea.asset_id
                         and t2.space_id  = p_space_id))
               )
           ) as has_intelligence
    from eligible_assets ea
    join public.asset_indications ai on ai.asset_id = ea.asset_id
    join status_rank_map srm on srm.status_name = ai.development_status
    left join public.trial_assets ta on ta.asset_id = ea.asset_id
    left join public.trials t on t.id = ta.trial_id and t.space_id = p_space_id
    where ai.development_status is not null
      and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))
    group by ea.asset_id, ea.asset_name, ea.asset_generic_name,
             ea.company_id, ea.company_name, ea.company_logo_url, ea.asset_updated_at
  ),

  -- fan out assets into their grouping dimension
  asset_groups as (
    select
      ahp.asset_id, ahp.asset_name, ahp.asset_generic_name,
      ahp.company_id, ahp.company_name, ahp.company_logo_url, ahp.asset_updated_at,
      ahp.highest_phase_rank, ahp.highest_phase, ahp.trial_count, ahp.has_intelligence,
      case p_grouping
        when 'moa' then m.id::text
        when 'indication' then ind.id::text
        when 'moa+indication' then m.id::text || '|' || ind.id::text
        when 'company' then ahp.company_id::text
        when 'roa' then r.id::text
        else null
      end as group_key,
      case p_grouping
        when 'moa' then m.name
        when 'indication' then ind.name
        when 'moa+indication' then m.name || ' + ' || ind.name
        when 'company' then ahp.company_name
        when 'roa' then r.name
        else null
      end as group_label,
      case p_grouping
        when 'moa' then jsonb_build_object('moa_id', m.id, 'moa_name', m.name)
        when 'indication' then jsonb_build_object('indication_id', ind.id, 'indication_name', ind.name)
        when 'moa+indication' then jsonb_build_object('moa_id', m.id, 'moa_name', m.name, 'indication_id', ind.id, 'indication_name', ind.name)
        when 'company' then jsonb_build_object('company_id', ahp.company_id, 'company_name', ahp.company_name)
        when 'roa' then jsonb_build_object('roa_id', r.id, 'roa_name', r.name)
        else '{}'::jsonb
      end as group_keys
    from asset_highest_phase ahp
    left join public.asset_mechanisms_of_action am
      on am.asset_id = ahp.asset_id and p_grouping in ('moa', 'moa+indication')
    left join public.mechanisms_of_action m
      on m.id = am.moa_id and p_grouping in ('moa', 'moa+indication')
    left join public.asset_indications ai2
      on ai2.asset_id = ahp.asset_id and p_grouping in ('indication', 'moa+indication')
    left join public.indications ind
      on ind.id = ai2.indication_id and p_grouping in ('indication', 'moa+indication')
    left join public.asset_routes_of_administration ar
      on ar.asset_id = ahp.asset_id and p_grouping = 'roa'
    left join public.routes_of_administration r
      on r.id = ar.roa_id and p_grouping = 'roa'
    where
      case p_grouping
        when 'moa' then m.id is not null
        when 'indication' then ind.id is not null
        when 'moa+indication' then m.id is not null and ind.id is not null
        when 'company' then true
        when 'roa' then r.id is not null
        else false
      end
  ),

  -- aggregate each group into a bubble with phase_counts
  bubble_agg as (
    select
      ag.group_key, ag.group_label, ag.group_keys,
      count(distinct ag.company_id) as competitor_count,
      max(ag.highest_phase_rank) as highest_phase_rank,
      (array_agg(ag.highest_phase order by ag.highest_phase_rank desc))[1] as highest_phase,
      count(distinct ag.asset_id) filter (where ag.has_intelligence) as intelligence_count,
      case p_count_unit
        when 'products' then count(distinct ag.asset_id)
        when 'trials' then sum(ag.trial_count)
        when 'companies' then count(distinct ag.company_id)
      end as unit_count,
      jsonb_agg(distinct jsonb_build_object(
        'id', ag.asset_id, 'name', ag.asset_name,
        'generic_name', ag.asset_generic_name,
        'company_id', ag.company_id, 'company_name', ag.company_name,
        'company_logo_url', ag.company_logo_url,
        'highest_phase', ag.highest_phase,
        'highest_phase_rank', ag.highest_phase_rank,
        'trial_count', ag.trial_count,
        'has_intelligence', ag.has_intelligence
      )) as products,
      -- phase_counts: always asset-based, regardless of p_count_unit
      (select jsonb_object_agg(hp, cnt)
       from (
         select ag2.highest_phase as hp, count(distinct ag2.asset_id) as cnt
         from asset_groups ag2
         where ag2.group_key = ag.group_key
         group by ag2.highest_phase
       ) sub
      ) as phase_counts
    from asset_groups ag
    group by ag.group_key, ag.group_label, ag.group_keys
  ),

  -- max updated_at across all assets in the result set
  freshness as (
    select max(ag.asset_updated_at) as latest_event_date
    from asset_groups ag
  )

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'label', ba.group_label, 'group_keys', ba.group_keys,
        'competitor_count', ba.competitor_count,
        'highest_phase', ba.highest_phase, 'highest_phase_rank', ba.highest_phase_rank,
        'unit_count', ba.unit_count, 'products', ba.products,
        'intelligence_count', ba.intelligence_count,
        'phase_counts', ba.phase_counts
      ) order by ba.competitor_count desc, ba.highest_phase_rank desc
    ), '[]'::jsonb),
    max(f.latest_event_date)
  into v_bubbles, v_latest_event_date
  from bubble_agg ba
  cross join freshness f;

  return jsonb_build_object(
    'grouping', p_grouping,
    'count_unit', p_count_unit,
    'latest_event_date', v_latest_event_date,
    'bubbles', v_bubbles
  );
end;
$$;

comment on function public.get_positioning_data(uuid, text, text, uuid[], uuid[], uuid[], uuid[], uuid[], text[], text[], text[]) is
  'Heatmap/positioning bubbles grouped by moa | indication | moa+indication | company | roa. Each product carries has_intelligence (true when published PI is about the asset OR any of its trials, matching get_intelligence_notes_for_asset and the bullseye node); each bubble carries intelligence_count (assets in the group with intelligence) so the heatmap renders the PI bookmark flag and the "N of M assets have intelligence" detail line; see 20260626180000.';

-- =============================================================================
-- smoke test: a published TRIAL PI on a trial linked to an asset surfaces as
-- has_intelligence=true on that asset's product node + intelligence_count>=1 on
-- the bubble. Direct call is viable (STABLE security-invoker, no in-body access
-- gate; DO block runs as migration owner). UUIDs distinct from neighbours.
-- =============================================================================
do $$
declare
  v_agency_id  uuid := 'c1800000-c180-c180-c180-c18000000001';
  v_tenant_id  uuid := 'c1800000-c180-c180-c180-c18000000002';
  v_owner_id   uuid := 'c1800000-c180-c180-c180-c18000000003';
  v_space_id   uuid := 'c1800000-c180-c180-c180-c18000000004';
  v_company_id uuid := 'c1800000-c180-c180-c180-c18000000005';
  v_asset_id   uuid := 'c1800000-c180-c180-c180-c18000000006';
  v_indication uuid := 'c1800000-c180-c180-c180-c18000000007';
  v_condition  uuid := 'c1800000-c180-c180-c180-c180000000a8';
  v_trial_id   uuid := 'c1800000-c180-c180-c180-c18000000008';
  v_pos        jsonb;
  v_bubbles    jsonb;
  v_product    jsonb;
begin
  insert into auth.users (id, email) values
    (v_owner_id, 'pi-positioning-trials@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'PIPos', 'pipos', 'pipos', 'PIPos', 'p@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'PIPos', 'pipos-t', 'pipost', 'PIPos');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant_id, v_owner_id, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space_id, v_tenant_id, 'Primary', v_owner_id);
  insert into public.space_members (space_id, user_id, role) values (v_space_id, v_owner_id, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company_id, v_space_id, v_owner_id, 'PIPos Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'PIPos Asset');
  insert into public.indications (id, space_id, created_by, name, abbreviation)
    values (v_indication, v_space_id, v_owner_id, 'Obesity', 'OBES');
  insert into public.asset_indications (asset_id, indication_id, space_id, development_status, created_by)
    values (v_asset_id, v_indication, v_space_id, 'P2', v_owner_id);
  insert into public.conditions (id, space_id, name, source)
    values (v_condition, v_space_id, 'Obesity', 'analyst');
  insert into public.condition_indication_map (condition_id, indication_id)
    values (v_condition, v_indication);
  -- asset_id auto-derives the trial_assets row; the condition link keeps the
  -- asset_indication (otherwise trg_auto_derive nulls development_status).
  insert into public.trials (id, space_id, created_by, asset_id, name, phase_type)
    values (v_trial_id, v_space_id, v_owner_id, v_asset_id, 'PIPos Trial', 'P2');
  insert into public.trial_conditions (trial_id, condition_id)
    values (v_trial_id, v_condition);
  -- PI is on the TRIAL, not the product -- the case the old flag missed.
  insert into public.primary_intelligence
    (space_id, entity_type, entity_id, state, headline, summary_md, implications_md, last_edited_by)
    values (v_space_id, 'trial', v_trial_id, 'published', 'Trial-level PI', '', '', v_owner_id);

  v_pos := public.get_positioning_data(v_space_id, 'company', 'products');
  v_bubbles := v_pos -> 'bubbles';
  v_product := jsonb_path_query_first(
    v_bubbles, '$[*].products[*] ? (@.id == $aid)', jsonb_build_object('aid', v_asset_id));
  if v_product is null then
    raise exception 'positioning trial-PI smoke FAIL: asset node missing';
  end if;
  if (v_product ->> 'has_intelligence') is distinct from 'true' then
    raise exception 'positioning trial-PI smoke FAIL: asset has_intelligence not true via trial (got %)',
      v_product ->> 'has_intelligence';
  end if;
  if not jsonb_path_exists(v_bubbles, '$[*] ? (@.intelligence_count >= 1)') then
    raise exception 'positioning trial-PI smoke FAIL: no bubble reports intelligence_count >= 1';
  end if;

  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.primary_intelligence where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'positioning_intelligence_includes_trials smoke test: PASS';
end$$;

notify pgrst, 'reload schema';
