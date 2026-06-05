-- Restore the per-space "track preclinical" guard to get_bullseye_assets.
--
-- 20260603120100_guard_preclinical_in_analytic_rpcs added
-- public.space_shows_preclinical(p_space_id) to the analytic RPCs so a space that
-- does not track preclinical (spaces.show_preclinical = false, the default) drops
-- PRECLIN-only assets from the bullseye. The multi-asset rewrite in
-- 20260605043037_landscape_bullseye_multi_asset recreated get_bullseye_assets but
-- dropped that guard from the asset_phase rank CTE, so a PRECLIN-only asset kept a
-- max_rank of 0 and reappeared in the result. (get_bullseye_data in the same
-- migration kept its guard; only get_bullseye_assets regressed.)
--
-- This migration recreates get_bullseye_assets identically to 20260605043037 plus:
--   - v_show_preclin declared from public.space_shows_preclinical(p_space_id)
--   - asset_phase rank join filtered by
--       (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
-- The `is distinct from` form preserves NULL development_status rows (same shape as
-- the other guarded analytic RPCs). Signature is unchanged, so grants are preserved
-- by create or replace and no PostgREST schema reload is required.

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
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
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
      and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
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

-- Smoke: a PRECLIN-only asset is excluded by default (space does not track
-- preclinical) and reappears once the space opts in. This is the regression that
-- 20260605043037 silently reintroduced.
do $$
declare
  v_owner   uuid := 'eeee2021-0001-0001-0001-eeeeeeee0001';
  v_agency  uuid := 'eeee2021-0002-0002-0002-eeeeeeee0002';
  v_tenant  uuid := 'eeee2021-0003-0003-0003-eeeeeeee0003';
  v_space   uuid := 'eeee2021-0004-0004-0004-eeeeeeee0004';
  v_company uuid := 'eeee2021-0005-0005-0005-eeeeeeee0005';
  v_asset_pre uuid := 'eeee2021-0006-0006-0006-eeeeeeee0006';
  v_asset_p2  uuid := 'eeee2021-0007-0007-0007-eeeeeeee0007';
  v_ind     uuid := 'eeee2021-0008-0008-0008-eeeeeeee0008';
  v_ids     jsonb;
begin
  insert into auth.users (id, email) values (v_owner, 'preclin-guard-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'Pg', 'pg', 'pg', 'Pg', 'pg@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'Pg', 'pg-t', 'pgt', 'Pg');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'Primary', v_owner);
  insert into public.space_members (space_id, user_id, role) values (v_space, v_owner, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company, v_space, v_owner, 'Pg Pharma');
  insert into public.indications (id, space_id, created_by, name) values (v_ind, v_space, v_owner, 'Pg Indication');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_pre, v_space, v_owner, v_company, 'Pg PRECLIN');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_p2, v_space, v_owner, v_company, 'Pg P2');
  insert into public.asset_indications (space_id, created_by, asset_id, indication_id, development_status)
    values (v_space, v_owner, v_asset_pre, v_ind, 'PRECLIN'),
           (v_space, v_owner, v_asset_p2,  v_ind, 'P2');

  -- Default: space does not track preclinical -> PRECLIN-only asset is excluded.
  select jsonb_path_query_array(public.get_bullseye_assets(v_space, array[v_ind]), '$.assets[*].id')
    into v_ids;
  if v_ids ? v_asset_pre::text then
    raise exception 'preclinical-guard FAIL: PRECLIN-only asset present while show_preclinical is off';
  end if;
  if not (v_ids ? v_asset_p2::text) then
    raise exception 'preclinical-guard FAIL: P2 asset missing from default bullseye';
  end if;

  -- Opt in -> PRECLIN-only asset reappears.
  update public.spaces set show_preclinical = true where id = v_space;
  select jsonb_path_query_array(public.get_bullseye_assets(v_space, array[v_ind]), '$.assets[*].id')
    into v_ids;
  if not (v_ids ? v_asset_pre::text) then
    raise exception 'preclinical-guard FAIL: PRECLIN asset missing after enabling show_preclinical';
  end if;

  -- Teardown. Deleting the tenant cascades to its spaces and their children
  -- (companies, assets, asset_indications, indications), which clears the
  -- spaces.created_by reference so auth.users can be removed last.
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  delete from auth.users where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);
end $$;
