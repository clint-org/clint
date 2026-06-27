-- extend get_space_inventory_snapshot to emit existing marker and event
-- instances per space so the AI extraction validator can match against them
-- and avoid creating duplicates on re-import.
--
-- markers: one row per (marker, trial) assignment pair, ordered recent-first.
-- events:  one row per event with an anchor derived from trial/asset/company_id.
-- both are included in the hash so inventory_drift still fires.
-- the payload is bounded at 1000 rows each; a raise notice is emitted on overflow.

create or replace function public.get_space_inventory_snapshot(p_space_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = 'public'
as $$
declare
  v_companies       jsonb;
  v_assets          jsonb;
  v_trials          jsonb;
  v_indications     jsonb;
  v_marker_types    jsonb;
  v_event_categories jsonb;
  v_moas            jsonb;
  v_roas            jsonb;
  v_markers         jsonb;
  v_events          jsonb;
  v_hash            text;
  v_marker_count    int;
  v_event_count     int;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb)
    into v_companies
    from public.companies c where c.space_id = p_space_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'company_id', a.company_id,
    'generic_name', a.generic_name) order by a.name), '[]'::jsonb)
    into v_assets
    from public.assets a where a.space_id = p_space_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
    'identifier', t.identifier, 'asset_id', t.asset_id, 'phase_type', t.phase_type) order by t.name), '[]'::jsonb)
    into v_trials
    from public.trials t where t.space_id = p_space_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name), '[]'::jsonb)
    into v_indications
    from public.indications i where i.space_id = p_space_id;

  select coalesce(jsonb_agg(
    jsonb_build_object('id', mt.id, 'name', mt.name) order by mt.display_order
  ), '[]'::jsonb)
    into v_marker_types
    from public.marker_types mt
   where (mt.space_id = p_space_id or (mt.space_id is null and mt.is_system))
     and mt.display_order >= 0;

  select coalesce(jsonb_agg(
    jsonb_build_object('id', ec.id, 'name', ec.name) order by ec.display_order
  ), '[]'::jsonb)
    into v_event_categories
    from public.event_categories ec
   where ec.space_id = p_space_id or (ec.space_id is null and ec.is_system);

  select coalesce(jsonb_agg(
    jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name
  ), '[]'::jsonb)
    into v_moas
    from public.mechanisms_of_action m
   where m.space_id = p_space_id;

  select coalesce(jsonb_agg(
    jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name
  ), '[]'::jsonb)
    into v_roas
    from public.routes_of_administration r
   where r.space_id = p_space_id;

  -- markers on in-scope trials via marker_assignments; cap at 1000 rows.
  select count(*)
    into v_marker_count
    from public.markers m
    join public.marker_assignments ma on ma.marker_id = m.id
   where m.space_id = p_space_id;

  if v_marker_count > 1000 then
    raise notice 'inventory_snapshot: markers truncated (% rows, cap 1000) for space %', v_marker_count, p_space_id;
  end if;

  select coalesce(jsonb_agg(row_data order by (row_data->>'event_date') desc nulls last, (row_data->>'id')), '[]'::jsonb)
    into v_markers
    from (
      select jsonb_build_object(
        'id', m.id,
        'trial_id', ma.trial_id,
        'marker_type', mt.name,
        'title', m.title,
        'event_date', m.event_date
      ) as row_data
        from public.markers m
        join public.marker_assignments ma on ma.marker_id = m.id
        join public.marker_types mt on mt.id = m.marker_type_id
       where m.space_id = p_space_id
       order by m.event_date desc nulls last, m.id
       limit 1000
    ) sub;

  -- events scoped to the space with anchor derived from trial/asset/company_id; cap at 1000 rows.
  select count(*)
    into v_event_count
    from public.events e
   where e.space_id = p_space_id;

  if v_event_count > 1000 then
    raise notice 'inventory_snapshot: events truncated (% rows, cap 1000) for space %', v_event_count, p_space_id;
  end if;

  select coalesce(jsonb_agg(row_data order by (row_data->>'event_date') desc nulls last, (row_data->>'id')), '[]'::jsonb)
    into v_events
    from (
      select jsonb_build_object(
        'id', e.id,
        'anchor', jsonb_build_object(
          'level', case
            when e.trial_id is not null then 'trial'
            when e.asset_id is not null then 'asset'
            when e.company_id is not null then 'company'
            else 'space'
          end,
          'id', coalesce(e.trial_id, e.asset_id, e.company_id)
        ),
        'category', ec.name,
        'title', e.title,
        'event_date', e.event_date
      ) as row_data
        from public.events e
        left join public.event_categories ec on ec.id = e.category_id
       where e.space_id = p_space_id
       order by e.event_date desc nulls last, e.id
       limit 1000
    ) sub;

  v_hash := md5(
    v_companies::text || v_assets::text || v_trials::text || v_indications::text
    || v_marker_types::text || v_event_categories::text || v_moas::text || v_roas::text
    || v_markers::text || v_events::text
  );

  return jsonb_build_object(
    'companies', v_companies,
    'assets', v_assets,
    'trials', v_trials,
    'indications', v_indications,
    'marker_types', v_marker_types,
    'event_categories', v_event_categories,
    'mechanisms_of_action', v_moas,
    'routes_of_administration', v_roas,
    'markers', v_markers,
    'events', v_events,
    'hash', v_hash
  );
end;
$$;
