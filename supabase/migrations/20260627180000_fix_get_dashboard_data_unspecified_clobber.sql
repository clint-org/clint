-- Restore the "Unspecified" indication-node branch in get_dashboard_data.
--
-- Root cause: 20260627150000_dashboard_unspecified_indication_node.sql added the
-- synthetic "Unspecified" node so indication-less trials still render on the
-- timeline. A later PR (multi-intelligence-briefs) shipped
-- 20260627130600_intelligence_feed_and_landscape_multi.sql, which ALSO redefines
-- get_dashboard_data but from a base predating 150000 (inlined trial object, no
-- Unspecified branch). Because 130600 sorts BEFORE 150000 by version yet was the
-- newly-added file, `supabase db push` applied it out of order -- LAST -- on dev,
-- silently reverting get_dashboard_data to the pre-fix body. `db reset` (version
-- order) always lands 150000, so local + CI looked green; only the deployed dev
-- DB was wrong. 161000 re-applied the _dashboard_trial_obj helper but not
-- get_dashboard_data, so it did not restore the branch.
--
-- Fix: re-apply the 150000 get_dashboard_data body (helper-based, anchor-aware,
-- WITH the Unspecified branch) at the current top version so it wins the next
-- db push on every environment. The _dashboard_trial_obj helper is intentionally
-- NOT redefined here -- 20260627161000's anchor-aware helper is the intended live
-- version and this function calls it.
--
-- Audit note: get_dashboard_data was the ONLY function hit by this inverted-order
-- collision; all other multi-redefined functions on 2026-06-27 had their highest
-- version applied last (verified against live dev). A CI guard now blocks the
-- recurrence: see src/client/scripts/check-migration-redefs.mjs.

-- 2. Redefine get_dashboard_data from the live body. Only the asset-level
--    'indications' value changes: it now unions the real indications (each tagged
--    is_unspecified=false, trials built via the helper) with one synthetic
--    Unspecified node per asset (orphan trials, emitted only when no indication
--    filter is active and orphans exist). Everything else is byte-for-byte live.
create or replace function public.get_dashboard_data(p_space_id uuid, p_company_ids uuid[] DEFAULT NULL::uuid[], p_asset_ids uuid[] DEFAULT NULL::uuid[], p_indication_ids uuid[] DEFAULT NULL::uuid[], p_start_year integer DEFAULT NULL::integer, p_end_year integer DEFAULT NULL::integer, p_recruitment_statuses text[] DEFAULT NULL::text[], p_study_types text[] DEFAULT NULL::text[], p_phases text[] DEFAULT NULL::text[], p_mechanism_of_action_ids uuid[] DEFAULT NULL::uuid[], p_route_of_administration_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if p_mechanism_of_action_ids = '{}' then p_mechanism_of_action_ids := null; end if;
  if p_route_of_administration_ids = '{}' then p_route_of_administration_ids := null; end if;

  select coalesce(jsonb_agg(company_obj order by c.display_order), '[]'::jsonb)
  into result
  from public.companies c
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'logo_url', c.logo_url,
      'display_order', c.display_order,
      'assets', coalesce((
        select jsonb_agg(asset_obj order by a.display_order)
        from public.assets a
        cross join lateral (
          select jsonb_build_object(
            'id', a.id,
            'name', a.name,
            'generic_name', a.generic_name,
            'logo_url', a.logo_url,
            'display_order', a.display_order,
            'mechanisms_of_action', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.asset_mechanisms_of_action am
              join public.mechanisms_of_action m on m.id = am.moa_id
              where am.asset_id = a.id
            ), '[]'::jsonb),
            'routes_of_administration', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.asset_routes_of_administration ar
              join public.routes_of_administration r on r.id = ar.roa_id
              where ar.asset_id = a.id
            ), '[]'::jsonb),
            'indications', (
              select coalesce(jsonb_agg(ind_obj order by sort_key, ind_display_order, ind_name), '[]'::jsonb)
              from (
                -- real indications, tagged is_unspecified=false
                select 0 as sort_key, ind.display_order as ind_display_order, ind.name as ind_name,
                       jsonb_build_object(
                         'id', ind.id,
                         'name', ind.name,
                         'abbreviation', ind.abbreviation,
                         'is_unspecified', false,
                         'development_status', ai.development_status,
                         'development_status_source', ai.development_status_source,
                         'trials', coalesce((
                           select jsonb_agg(public._dashboard_trial_obj(t, p_space_id, p_start_year, p_end_year)
                                            order by t.display_order)
                           from (
                             select distinct on (t.id) t.*
                             from public.trials t
                             join public.trial_assets ta on ta.trial_id = t.id
                             join public.trial_conditions tc on tc.trial_id = t.id
                             join public.condition_indication_map cim on cim.condition_id = tc.condition_id
                             where ta.asset_id = a.id
                               and t.space_id = p_space_id
                               and cim.indication_id = ind.id
                               and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                               and (p_study_types is null or t.study_type = any(p_study_types))
                               and (p_phases is null or t.phase_type = any(p_phases))
                             order by t.id
                           ) t
                         ), '[]'::jsonb)
                       ) as ind_obj
                from public.asset_indications ai
                join public.indications ind on ind.id = ai.indication_id
                where ai.asset_id = a.id
                  and ai.space_id = p_space_id
                  and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))

                union all

                -- synthetic Unspecified node: only when no indication filter and orphans exist
                select 1 as sort_key, 0 as ind_display_order, '' as ind_name,
                       jsonb_build_object(
                         'id', null,
                         'name', 'Unspecified',
                         'abbreviation', null,
                         'is_unspecified', true,
                         'development_status', null,
                         'development_status_source', null,
                         'trials', coalesce((
                           select jsonb_agg(public._dashboard_trial_obj(t, p_space_id, p_start_year, p_end_year)
                                            order by t.display_order)
                           from (
                             select distinct on (t.id) t.*
                             from public.trials t
                             join public.trial_assets ta on ta.trial_id = t.id
                             where ta.asset_id = a.id
                               and t.space_id = p_space_id
                               and not exists (
                                 select 1 from public.trial_conditions tc
                                 join public.condition_indication_map cim on cim.condition_id = tc.condition_id
                                 where tc.trial_id = t.id
                               )
                               and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                               and (p_study_types is null or t.study_type = any(p_study_types))
                               and (p_phases is null or t.phase_type = any(p_phases))
                             order by t.id
                           ) t
                         ), '[]'::jsonb)
                       ) as ind_obj
                where p_indication_ids is null
                  and exists (
                    select 1 from public.trials t2
                    join public.trial_assets ta2 on ta2.trial_id = t2.id
                    where ta2.asset_id = a.id
                      and t2.space_id = p_space_id
                      and not exists (
                        select 1 from public.trial_conditions tc2
                        join public.condition_indication_map cim2 on cim2.condition_id = tc2.condition_id
                        where tc2.trial_id = t2.id
                      )
                  )
              ) s
            )
          ) as asset_obj
        ) as asset_lateral
        where a.company_id = c.id
          and a.space_id = p_space_id
          and (p_asset_ids is null or a.id = any(p_asset_ids))
          and (
            p_mechanism_of_action_ids is null
            or exists (
              select 1 from public.asset_mechanisms_of_action am2
              where am2.asset_id = a.id
                and am2.moa_id = any(p_mechanism_of_action_ids)
            )
          )
          and (
            p_route_of_administration_ids is null
            or exists (
              select 1 from public.asset_routes_of_administration ar2
              where ar2.asset_id = a.id
                and ar2.roa_id = any(p_route_of_administration_ids)
            )
          )
      ), '[]'::jsonb)
    ) as company_obj
  ) as company_lateral
  where c.space_id = p_space_id
    and (p_company_ids is null or c.id = any(p_company_ids));

  return result;
end;
$function$;

notify pgrst, 'reload schema';

-- 3. Smoke test: orphan trial appears under Unspecified, classified trial does
--    not leak into it, classified is unaffected, and an indication filter
--    suppresses the Unspecified node.
do $$
declare
  v_owner   uuid := 'dddd8888-0001-0001-0001-dddddddd0001';
  v_agency  uuid := 'dddd8888-0002-0002-0002-dddddddd0002';
  v_tenant  uuid := 'dddd8888-0003-0003-0003-dddddddd0003';
  v_space   uuid := 'dddd8888-0004-0004-0004-dddddddd0004';
  v_company uuid := 'dddd8888-0005-0005-0005-dddddddd0005';
  v_asset   uuid := 'dddd8888-0006-0006-0006-dddddddd0006';
  v_classified uuid;
  v_orphan     uuid;
  v_result  jsonb;
  v_orphan_in_unspec boolean;
  v_orphan_in_real   boolean;
  v_classified_in_unspec boolean;
  v_suppressed boolean;
  v_phase_data jsonb;
begin
  insert into auth.users (id, email) values (v_owner, 'unspec-reapply-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'Unsp', 'unsp', 'unsp', 'Unsp', 'u@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'Unsp', 'unsp-t', 'unspt', 'Unsp');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'Primary', v_owner);
  insert into public.space_members (space_id, user_id, role) values (v_space, v_owner, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company, v_space, v_owner, 'Unsp Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset, v_space, v_owner, v_company, 'UnspAsset');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  -- classified trial (indication provided) and orphan trial (no indication)
  v_classified := public.create_trial(v_space, v_asset, 'Classified Trial', 'NCT-UNSP-001', 'Active', 'P3', null, null, 'Unsp Obesity', null);
  v_orphan     := public.create_trial(v_space, v_asset, 'Orphan Trial',     'NCT-UNSP-002', 'Active', 'P2', null, null, null,          null);

  v_result := public.get_dashboard_data(v_space);

  v_orphan_in_unspec := jsonb_path_exists(v_result,
    ('$[*].assets[*] ? (@.id == "' || v_asset || '").indications[*] ? (@.is_unspecified == true).trials[*] ? (@.id == "' || v_orphan || '")')::jsonpath);
  v_orphan_in_real := jsonb_path_exists(v_result,
    ('$[*].assets[*] ? (@.id == "' || v_asset || '").indications[*] ? (@.is_unspecified == false).trials[*] ? (@.id == "' || v_orphan || '")')::jsonpath);
  v_classified_in_unspec := jsonb_path_exists(v_result,
    ('$[*].assets[*] ? (@.id == "' || v_asset || '").indications[*] ? (@.is_unspecified == true).trials[*] ? (@.id == "' || v_classified || '")')::jsonpath);

  if not v_orphan_in_unspec then raise exception 'unspec FAIL: orphan trial not under Unspecified node'; end if;
  if v_orphan_in_real then raise exception 'unspec FAIL: orphan trial leaked into a real indication'; end if;
  if v_classified_in_unspec then raise exception 'unspec FAIL: classified trial wrongly under Unspecified'; end if;

  -- phase_data carries phase_type only (regression guard): classified trial is P3,
  -- so phase_data is non-null and must expose a non-null phase_type. The
  -- phase_start_date/phase_end_date keys were dropped with their columns by the
  -- ctgov-trial-dates base; the bar is now derived from markers client-side.
  v_phase_data := jsonb_path_query_first(v_result,
    ('$[*].assets[*] ? (@.id == "' || v_asset || '").indications[*].trials[*] ? (@.id == "' || v_classified || '").phase_data')::jsonpath);
  if v_phase_data is null then raise exception 'unspec FAIL: classified trial phase_data missing'; end if;
  if not (v_phase_data ? 'phase_type') then
    raise exception 'unspec FAIL: phase_data missing phase_type key: %', v_phase_data;
  end if;
  if (v_phase_data ->> 'phase_type') is null then raise exception 'unspec FAIL: phase_data.phase_type is null for P3 trial'; end if;

  -- filter suppression: filtering to a specific indication must hide the Unspecified node
  v_suppressed := not jsonb_path_exists(
    public.get_dashboard_data(v_space, null, null,
      (select array_agg(indication_id) from public.asset_indications where asset_id = v_asset)),
    ('$[*].assets[*].indications[*] ? (@.is_unspecified == true)')::jsonpath);
  if not v_suppressed then raise exception 'unspec FAIL: Unspecified node not suppressed under indication filter'; end if;

  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  delete from auth.users where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'unspec re-apply smoke ok: orphan visible under Unspecified, classified unaffected, filter suppresses';
end $$;
