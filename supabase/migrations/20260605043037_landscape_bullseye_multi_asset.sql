-- Phase 2d: bullseye RPCs attribute trials via trial_assets.
--
-- get_bullseye_data and get_bullseye_assets rolled up trial counts / markers /
-- events / change indicators using the single trials.asset_id. Each trial-to-asset
-- predicate (t.asset_id = X / t2.asset_id = X) is rewritten to an EXISTS against
-- trial_assets, so a master-protocol trial is attributed to every asset it tests.
-- Bodies are the definitions from 20260603120100 (bullseye_data) and
-- 20260530210311 (bullseye_assets) with only those trial predicates changed.
--
-- get_landscape_index_by_{company,moa,roa} are intentionally NOT redefined here:
-- they pivot purely on asset_indications (no trials joins), so 2b already made
-- them multi-asset-correct.

create or replace function public.get_bullseye_data(p_space_id uuid, p_indication_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_scope  jsonb;
  v_spokes jsonb;
  v_indication_ids uuid[];
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
  v_ring_order jsonb := case when public.space_shows_preclinical(p_space_id)
    then jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED')
    else jsonb_build_array('P1','P2','P3','P4','APPROVED','LAUNCHED')
  end;
begin
  select jsonb_build_object('id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation)
  into v_scope
  from public.indications ind
  where ind.id = p_indication_id and ind.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension',   'indication',
      'scope',       null,
      'ring_order',  v_ring_order,
      'spokes',      '[]'::jsonb,
      'spoke_label', 'Companies'
    );
  end if;

  select array_agg(id) into v_indication_ids
  from public.indications
  where id = p_indication_id or parent_id = p_indication_id;

  with asset_rollup as (
    select
      a.id           as asset_id,
      a.company_id,
      a.name         as asset_name,
      a.generic_name,
      a.logo_url,
      max(case ai.development_status
        when 'LAUNCHED'  then 6
        when 'APPROVED'  then 5
        when 'P4'        then 4
        when 'P3'        then 3
        when 'P2'        then 2
        when 'P1'        then 1
        when 'PRECLIN'   then 0
        else null
      end) as max_rank
    from public.assets a
    join public.asset_indications ai on ai.asset_id = a.id
    where a.space_id = p_space_id
      and ai.indication_id = any(v_indication_ids)
      and ai.development_status is not null
      and (v_show_preclin or ai.development_status <> 'PRECLIN')
    group by a.id, a.company_id, a.name, a.generic_name, a.logo_url
    having max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank
    from asset_rollup group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'display_order', c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(asset_obj order by ar.max_rank desc, ar.asset_name), '[]'::jsonb)
        from asset_rollup ar
        cross join lateral (
          select jsonb_build_object(
            'id', ar.asset_id, 'name', ar.asset_name, 'generic_name', ar.generic_name,
            'logo_url', ar.logo_url, 'company_id', ar.company_id, 'company_name', c.name,
            'highest_phase_rank', ar.max_rank,
            'highest_phase', case ar.max_rank
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.asset_mechanisms_of_action amoa join public.mechanisms_of_action m on m.id = amoa.moa_id
              where amoa.asset_id = ar.asset_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.asset_routes_of_administration aroa join public.routes_of_administration r on r.id = aroa.roa_id
              where aroa.asset_id = ar.asset_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', t.id, 'name', t.name, 'acronym', t.acronym, 'identifier', t.identifier,
                  'status', t.status, 'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type, 'phase', t.phase_type
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              join public.trial_conditions tc on tc.trial_id = t.id
              join public.condition_indication_map cim on cim.condition_id = tc.condition_id
              where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = ar.asset_id)
                and t.space_id = p_space_id
                and cim.indication_id = any(v_indication_ids)
                and (v_show_preclin or t.phase_type is distinct from 'PRECLIN')
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', rmm.id, 'event_date', rmm.event_date, 'projection', rmm.projection,
                  'marker_type_name', mt.name, 'shape', mt.shape,
                  'color', mt.color, 'category_name', mc.name
                ) order by rmm.event_date desc
              ), '[]'::jsonb)
              from (
                select mk.id, mk.event_date, mk.marker_type_id, mk.projection
                from public.marker_assignments ma
                join public.markers mk on mk.id = ma.marker_id
                join public.trials t2 on t2.id = ma.trial_id
                join public.trial_conditions tc2 on tc2.trial_id = t2.id
                join public.condition_indication_map cim2 on cim2.condition_id = tc2.condition_id
                where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = ar.asset_id)
                  and cim2.indication_id = any(v_indication_ids)
                  and t2.space_id = p_space_id
                  and mk.space_id = p_space_id
                order by mk.event_date desc limit 3
              ) rmm
              join public.marker_types mt on mt.id = rmm.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
            )
          ) as asset_obj
        ) as asset_lateral
        where ar.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension',   'indication',
    'scope',       v_scope,
    'ring_order',  v_ring_order,
    'spokes',      coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$function$;
create or replace function public.get_bullseye_assets(
  p_space_id       uuid,
  p_indication_ids uuid[]  default null,
  p_company_ids    uuid[]  default null,
  p_moa_ids        uuid[]  default null,
  p_roa_ids        uuid[]  default null,
  p_phases         text[]  default null,
  p_asset_ids      uuid[]  default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- Normalize empty arrays to null (no-filter semantics)
  if p_indication_ids = '{}' then p_indication_ids := null; end if;
  if p_company_ids    = '{}' then p_company_ids    := null; end if;
  if p_moa_ids        = '{}' then p_moa_ids        := null; end if;
  if p_roa_ids        = '{}' then p_roa_ids        := null; end if;
  if p_phases         = '{}' then p_phases         := null; end if;
  if p_asset_ids      = '{}' then p_asset_ids      := null; end if;

  with
  -- Step 1: identify candidate assets passing all scope filters except phase
  candidate_assets as (
    select distinct a.id as asset_id
    from public.assets a
    where a.space_id = p_space_id
      -- company filter
      and (p_company_ids is null or a.company_id = any(p_company_ids))
      -- direct asset filter
      and (p_asset_ids is null or a.id = any(p_asset_ids))
      -- indication filter: asset must have at least one matching indication
      and (p_indication_ids is null or exists (
        select 1 from public.asset_indications ai
        where ai.asset_id = a.id
          and ai.indication_id = any(p_indication_ids)
      ))
      -- moa filter: asset must have at least one matching MOA
      and (p_moa_ids is null or exists (
        select 1 from public.asset_mechanisms_of_action amoa
        where amoa.asset_id = a.id
          and amoa.moa_id = any(p_moa_ids)
      ))
      -- roa filter: asset must have at least one matching ROA
      and (p_roa_ids is null or exists (
        select 1 from public.asset_routes_of_administration aroa
        where aroa.asset_id = a.id
          and aroa.roa_id = any(p_roa_ids)
      ))
  ),

  -- Step 2: compute highest phase rank per candidate asset
  asset_phase as (
    select
      ca.asset_id,
      max(case ai.development_status
        when 'LAUNCHED'  then 6
        when 'APPROVED'  then 5
        when 'P4'        then 4
        when 'P3'        then 3
        when 'P2'        then 2
        when 'P1'        then 1
        when 'PRECLIN'   then 0
        else null
      end) as max_rank
    from candidate_assets ca
    join public.asset_indications ai on ai.asset_id = ca.asset_id
    where ai.development_status is not null
    group by ca.asset_id
    having max(case ai.development_status
      when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
      when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
      else null
    end) is not null
  ),

  -- Step 3: apply phase filter
  filtered_assets as (
    select ap.asset_id, ap.max_rank
    from asset_phase ap
    where p_phases is null or (
      case ap.max_rank
        when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
        when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
      end
    ) = any(p_phases)
  ),

  -- Step 4: compute intelligence count per asset
  --   counts primary_intelligence records linked to the asset directly
  --   OR to any trial belonging to the asset
  asset_intel as (
    select
      fa.asset_id,
      (
        -- asset-level intelligence
        (select count(*)
         from public.primary_intelligence pi
         where pi.entity_type = 'asset'
           and pi.entity_id = fa.asset_id
           and pi.space_id = p_space_id)
        +
        -- trial-level intelligence for trials belonging to this asset
        (select count(*)
         from public.primary_intelligence pi
         where pi.entity_type = 'trial'
           and pi.space_id = p_space_id
           and pi.entity_id in (
             select t.id from public.trials t
             where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id) and t.space_id = p_space_id
           ))
      ) as intelligence_count
    from filtered_assets fa
  ),

  -- Step 5: compute recent change activity per asset (14-day window).
  --   recent_changes_count rolls up everything beneath the asset:
  --     - trial_change_events for the asset's trials, plus
  --     - published primary_intelligence about the asset OR its trials.
  asset_activity as (
    select
      fa.asset_id,
      (
        (select count(*)
         from public.trial_change_events e
         join public.trials t on t.id = e.trial_id
         where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
           and t.space_id = p_space_id
           and e.observed_at >= now() - public.recent_change_window())
        +
        (select count(*)
         from public.primary_intelligence pi
         where pi.space_id = p_space_id
           and pi.state = 'published'
           and pi.updated_at >= now() - public.recent_change_window()
           and (
             (pi.entity_type = 'asset' and pi.entity_id = fa.asset_id)
             or (pi.entity_type = 'trial' and pi.entity_id in (
                   select t2.id from public.trials t2
                   where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
           ))
      ) as recent_changes_count,
      (
        select c.etype
        from (
          select e.event_type::text as etype, e.observed_at as ets
          from public.trial_change_events e
          join public.trials t on t.id = e.trial_id
          where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
            and t.space_id = p_space_id
            and e.observed_at >= now() - public.recent_change_window()
          union all
          select 'intelligence_published'::text as etype, pi.updated_at as ets
          from public.primary_intelligence pi
          where pi.space_id = p_space_id
            and pi.state = 'published'
            and pi.updated_at >= now() - public.recent_change_window()
            and (
              (pi.entity_type = 'asset' and pi.entity_id = fa.asset_id)
              or (pi.entity_type = 'trial' and pi.entity_id in (
                    select t2.id from public.trials t2
                    where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
            )
        ) c
        order by c.ets desc
        limit 1
      ) as most_recent_change_type,
      (
        select c.eid
        from (
          select e.observed_at as ets, e.id as eid
          from public.trial_change_events e
          join public.trials t on t.id = e.trial_id
          where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
            and t.space_id = p_space_id
            and e.observed_at >= now() - public.recent_change_window()
          union all
          select pi.updated_at as ets, null::uuid as eid
          from public.primary_intelligence pi
          where pi.space_id = p_space_id
            and pi.state = 'published'
            and pi.updated_at >= now() - public.recent_change_window()
            and (
              (pi.entity_type = 'asset' and pi.entity_id = fa.asset_id)
              or (pi.entity_type = 'trial' and pi.entity_id in (
                    select t2.id from public.trials t2
                    where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
            )
        ) c
        order by c.ets desc
        limit 1
      ) as most_recent_change_event_id
    from filtered_assets fa
  )

  -- Step 6: assemble result
  select jsonb_build_object(
    'assets', coalesce((
      select jsonb_agg(asset_obj order by fa.max_rank desc, a.name)
      from filtered_assets fa
      join public.assets a on a.id = fa.asset_id
      join public.companies c on c.id = a.company_id
      left join asset_intel ai_cnt on ai_cnt.asset_id = fa.asset_id
      left join asset_activity aa on aa.asset_id = fa.asset_id
      cross join lateral (
        select jsonb_build_object(
          'id', a.id,
          'name', a.name,
          'generic_name', a.generic_name,
          'logo_url', a.logo_url,
          'company_id', c.id,
          'company_name', c.name,
          'highest_phase_rank', fa.max_rank,
          'highest_phase', case fa.max_rank
            when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
            when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
          end,
          'indications', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation)
              order by ind.display_order, ind.name
            )
            from public.asset_indications ai2
            join public.indications ind on ind.id = ai2.indication_id
            where ai2.asset_id = a.id
          ), '[]'::jsonb),
          'moas', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', m.id, 'name', m.name)
              order by m.display_order, m.name
            )
            from public.asset_mechanisms_of_action amoa
            join public.mechanisms_of_action m on m.id = amoa.moa_id
            where amoa.asset_id = a.id
          ), '[]'::jsonb),
          'roas', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation)
              order by r.display_order, r.name
            )
            from public.asset_routes_of_administration aroa
            join public.routes_of_administration r on r.id = aroa.roa_id
            where aroa.asset_id = a.id
          ), '[]'::jsonb),
          'trials', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'name', t.name,
                'acronym', t.acronym,
                'identifier', t.identifier,
                'status', t.status,
                'recruitment_status', t.recruitment_status,
                'study_type', t.study_type,
                'phase', t.phase_type
              ) order by t.display_order, t.name
            )
            from public.trials t
            where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = a.id) and t.space_id = p_space_id
          ), '[]'::jsonb),
          'recent_markers', coalesce((
            select jsonb_agg(marker_obj order by mk_sub.event_date desc)
            from (
              select mk.id, mk.event_date, mk.projection,
                     mt.name as marker_type_name, mt.shape, mt.color,
                     mc.name as category_name
              from public.marker_assignments ma
              join public.markers mk on mk.id = ma.marker_id
              join public.marker_types mt on mt.id = mk.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
              join public.trials t2 on t2.id = ma.trial_id
              where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = a.id)
                and t2.space_id = p_space_id
                and mk.space_id = p_space_id
              order by mk.event_date desc
              limit 3
            ) mk_sub
            cross join lateral (
              select jsonb_build_object(
                'id', mk_sub.id,
                'event_date', mk_sub.event_date,
                'projection', mk_sub.projection,
                'marker_type_name', mk_sub.marker_type_name,
                'shape', mk_sub.shape,
                'color', mk_sub.color,
                'category_name', mk_sub.category_name
              ) as marker_obj
            ) mk_lateral
          ), '[]'::jsonb),
          'intelligence_count', coalesce(ai_cnt.intelligence_count, 0),
          'recent_changes_count', coalesce(aa.recent_changes_count, 0),
          'most_recent_change_type', aa.most_recent_change_type,
          'most_recent_change_event_id', aa.most_recent_change_event_id,
          'has_recent_activity', coalesce(aa.recent_changes_count, 0) > 0
        ) as asset_obj
      ) as asset_lateral
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Smoke: bullseye RPCs run cleanly for a space with a two-asset trial. The
-- landscape index RPCs are called too as a regression guard (unchanged here).
do $$
declare
  v_owner   uuid := 'eeee2020-0001-0001-0001-eeeeeeee0001';
  v_agency  uuid := 'eeee2020-0002-0002-0002-eeeeeeee0002';
  v_tenant  uuid := 'eeee2020-0003-0003-0003-eeeeeeee0003';
  v_space   uuid := 'eeee2020-0004-0004-0004-eeeeeeee0004';
  v_company uuid := 'eeee2020-0005-0005-0005-eeeeeeee0005';
  v_asset_a uuid := 'eeee2020-0006-0006-0006-eeeeeeee0006';
  v_asset_b uuid := 'eeee2020-0007-0007-0007-eeeeeeee0007';
  v_trial   uuid;
  v_ind     uuid;
begin
  insert into auth.users (id, email) values (v_owner, 'lb-ma-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'Lb', 'lb', 'lb', 'Lb', 'lb@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'Lb', 'lb-t', 'lbt', 'Lb');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'Primary', v_owner);
  insert into public.space_members (space_id, user_id, role) values (v_space, v_owner, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company, v_space, v_owner, 'Lb Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_a, v_space, v_owner, v_company, 'LbAssetA');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_b, v_space, v_owner, v_company, 'LbAssetB');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_trial := public.create_trial(
    v_space, v_asset_a, 'Lb Trial', 'NCT-LB-001', 'Active', 'P3', null, null, 'Lb Obesity', null
  );
  perform public.set_trial_assets(v_trial, array[v_asset_a, v_asset_b], v_asset_a);
  select id into v_ind from public.indications where space_id = v_space and name = 'Lb Obesity';

  if public.get_bullseye_data(v_space, v_ind) is null then raise exception 'lb-ma FAIL: bullseye_data null'; end if;
  if public.get_bullseye_assets(v_space) is null then raise exception 'lb-ma FAIL: bullseye_assets null'; end if;
  if public.get_landscape_index_by_company(v_space) is null then raise exception 'lb-ma FAIL: by_company null'; end if;
  if public.get_landscape_index_by_moa(v_space) is null then raise exception 'lb-ma FAIL: by_moa null'; end if;
  if public.get_landscape_index_by_roa(v_space) is null then raise exception 'lb-ma FAIL: by_roa null'; end if;

  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  delete from auth.users where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'lb-ma smoke ok: bullseye + landscape RPCs run with a two-asset trial';
end $$;
