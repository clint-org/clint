-- Add mechanisms_of_action and routes_of_administration to the inventory
-- snapshot so the extraction LLM can match existing reference entries
-- instead of always creating new ones.

create or replace function public.get_space_inventory_snapshot(p_space_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_companies jsonb;
  v_assets    jsonb;
  v_trials    jsonb;
  v_indications jsonb;
  v_marker_types jsonb;
  v_event_categories jsonb;
  v_moas      jsonb;
  v_roas      jsonb;
  v_hash      text;
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

  v_hash := md5(v_companies::text || v_assets::text || v_trials::text || v_indications::text
    || v_marker_types::text || v_event_categories::text || v_moas::text || v_roas::text);

  return jsonb_build_object(
    'companies', v_companies,
    'assets', v_assets,
    'trials', v_trials,
    'indications', v_indications,
    'marker_types', v_marker_types,
    'event_categories', v_event_categories,
    'mechanisms_of_action', v_moas,
    'routes_of_administration', v_roas,
    'hash', v_hash
  );
end;
$$;
