-- Stage 3: rename get_catalyst_detail -> get_event_detail and add the unified keys the
-- merged Event form needs for edit-hydration (event_type_id, anchor_type, anchor_id,
-- significance, visibility). The body already reads the unified events model + derives
-- registry_url + emits sources + metadata; existing legacy keys are kept so the current
-- detail panel / export consumers keep working during the IA rename. Also drops the dead
-- get_key_catalysts (no caller).

create or replace function public.get_event_detail(p_event_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_event jsonb;
begin
  select
    jsonb_build_object(
      'marker_id',              e.id,
      'event_id',              e.id,
      'source_doc_id',          e.source_doc_id,
      'title',                  e.title,
      'event_date',             e.event_date,
      'date_precision',         e.date_precision,
      'end_date',               e.end_date,
      'end_date_precision',     e.end_date_precision,
      'is_ongoing',             e.is_ongoing,
      'category_name',          ec.name,
      'category_id',            et.category_id,
      'event_type_id',          e.event_type_id,
      'marker_type_name',       et.name,
      'marker_type_color',      et.color,
      'marker_type_shape',      et.shape,
      'marker_type_inner_mark', et.inner_mark,
      'anchor_type',            e.anchor_type,
      'anchor_id',              e.anchor_id,
      'projection',             e.projection,
      'significance',           e.significance,
      'visibility',             e.visibility,
      'no_longer_expected',     e.no_longer_expected,
      'company_name',           co.name,
      'company_id',             co.id,
      'company_logo_url',       co.logo_url,
      'asset_name',             a.name,
      'asset_id',               a.id,
      'trial_name',             t.name,
      'trial_acronym',          t.acronym,
      'trial_id',               t.id,
      'trial_phase',            t.phase,
      'recruitment_status',     t.recruitment_status,
      'description',            e.description,
      'sources', (
        select coalesce(
          jsonb_agg(jsonb_build_object('id', es.id, 'url', es.url, 'label', es.label)
                    order by es.sort_order, es.created_at),
          '[]'::jsonb)
        from public.event_sources es where es.event_id = e.id
      ),
      'registry_url', case
        when e.anchor_type = 'trial' then public.event_registry_url(t.identifier)
        else null
      end,
      'metadata',               e.metadata,
      'ctgov_last_synced_at',   t.ctgov_last_synced_at
    )
  into v_event
  from public.events e
  join public.event_types et on et.id = e.event_type_id
  join public.event_type_categories ec on ec.id = et.category_id
  left join public.trials t
    on e.anchor_type = 'trial' and t.id = e.anchor_id
  left join public.assets a
    on a.id = coalesce(t.asset_id,
                       case when e.anchor_type = 'asset' then e.anchor_id end)
  left join public.companies co
    on co.id = coalesce(a.company_id,
                        case when e.anchor_type = 'company' then e.anchor_id end)
  where e.id = p_event_id;

  if v_event is null then
    return null;
  end if;

  return jsonb_build_object(
    'catalyst',         v_event,
    'upcoming_markers', '[]'::jsonb,
    'related_events',   '[]'::jsonb
  );
end;
$function$;

drop function if exists public.get_catalyst_detail(uuid);
drop function if exists public.get_key_catalysts(uuid, uuid[], uuid, uuid);

grant execute on function public.get_event_detail(uuid) to authenticated;

-- in-migration smoke: the new fn resolves + returns the added unified keys for a seeded event.
do $$
declare v_id uuid; v_detail jsonb;
begin
  select id into v_id from public.events limit 1;
  if v_id is not null then
    v_detail := public.get_event_detail(v_id);
    if v_detail is null or (v_detail->'catalyst'->>'event_type_id') is null
       or not (v_detail->'catalyst' ? 'anchor_type') then
      raise exception 'get_event_detail smoke failed: missing unified keys: %', v_detail->'catalyst';
    end if;
  end if;
exception when insufficient_privilege then
  -- Local-only sanity check; if an access guard denies the migration role (42501) on a
  -- populated remote DB, skip rather than abort the deploy.
  null;
end $$;

notify pgrst, 'reload schema';
