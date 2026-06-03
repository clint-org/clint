-- migration: 20260528003300_trial_acronym
-- purpose: add acronym column to trials, materialized from CT.gov
--   identificationModule.acronym. CT.gov-owned, read-only. Used as the
--   primary display label in the UI when present (falls back to name).

-- 1. add the column
alter table public.trials
  add column if not exists acronym varchar(100);

comment on column public.trials.acronym is
  'CT.gov-owned trial acronym (e.g. STEP 1, SURMOUNT-1). Materialized from identificationModule.acronym by _materialize_trial_from_snapshot. Read-only; analysts use the name column for custom labels.';

-- 2. update _materialize_trial_from_snapshot to extract acronym
create or replace function public._materialize_trial_from_snapshot(
  p_trial_id uuid,
  p_payload  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase            text;
  v_recruitment      text;
  v_study_type       text;
  v_last_update_date date;
  v_acronym          text;
begin
  v_phase            := public._map_phase_array(p_payload #> '{protocolSection,designModule,phases}');
  v_recruitment      := p_payload #>> '{protocolSection,statusModule,overallStatus}';
  v_study_type       := p_payload #>> '{protocolSection,designModule,studyType}';
  v_last_update_date := nullif(p_payload #>> '{protocolSection,statusModule,lastUpdatePostDateStruct,date}', '')::date;
  v_acronym          := nullif(trim(p_payload #>> '{protocolSection,identificationModule,acronym}'), '');

  update public.trials
     set phase                   = coalesce(v_phase, phase),
         recruitment_status      = coalesce(v_recruitment, recruitment_status),
         study_type              = coalesce(v_study_type, study_type),
         last_update_posted_date = coalesce(v_last_update_date, last_update_posted_date),
         acronym                 = coalesce(v_acronym, acronym),
         ctgov_last_synced_at    = now()
   where id = p_trial_id;
end;
$$;

comment on function public._materialize_trial_from_snapshot(uuid, jsonb) is
  'Applies the ct.gov-owned subset of a snapshot payload onto trials via one partial UPDATE. coalesce(derived, existing) keeps prior values when a path is missing. Never touches analyst-owned columns. Called by ingest_ctgov_snapshot.';

-- 3. backfill acronym from existing snapshots (latest per trial)
update public.trials t
   set acronym = nullif(trim(s.payload #>> '{protocolSection,identificationModule,acronym}'), '')
  from (
    select distinct on (trial_id)
           trial_id,
           payload
      from public.trial_ctgov_snapshots
     order by trial_id, ctgov_version desc
  ) s
 where s.trial_id = t.id
   and t.acronym is null
   and nullif(trim(s.payload #>> '{protocolSection,identificationModule,acronym}'), '') is not null;

-- 4. update get_activity_feed to include trial_acronym
create or replace function public.get_activity_feed(
  p_space_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_cursor_observed_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit int default 50
) returns setof jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event_types text[];
  v_sources text[];
  v_trial_id uuid;
begin
  if v_uid is null or not public.has_space_access(p_space_id) then return; end if;

  v_event_types := case when p_filters ? 'event_types' then
    (select array_agg(x::text) from jsonb_array_elements_text(p_filters->'event_types') x)
    else null end;
  v_sources := case when p_filters ? 'sources' then
    (select array_agg(x::text) from jsonb_array_elements_text(p_filters->'sources') x)
    else null end;
  v_trial_id := case when p_filters ? 'trial_id' then (p_filters->>'trial_id')::uuid else null end;

  return query
  select jsonb_build_object(
    'id', ce.id,
    'trial_id', ce.trial_id,
    'space_id', ce.space_id,
    'event_type', ce.event_type,
    'source', ce.source,
    'payload', ce.payload,
    'occurred_at', ce.occurred_at,
    'observed_at', ce.observed_at,
    'trial_name', t.name,
    'trial_acronym', t.acronym,
    'trial_identifier', t.identifier,
    'asset_name', a.name,
    'asset_id', a.id,
    'company_name', co.name,
    'company_id', co.id,
    'company_logo_url', co.logo_url,
    'marker_type', case when ce.marker_id is not null then (
      select jsonb_build_object('id', mt.id, 'name', mt.name, 'icon', mt.icon,
        'shape', mt.shape, 'fill_style', mt.fill_style, 'color', mt.color,
        'inner_mark', mt.inner_mark, 'category_name', mc.name)
      from public.marker_types mt
      left join public.marker_categories mc on mc.id = mt.category_id
      where mt.id = (select m.marker_type_id from public.markers m where m.id = ce.marker_id)
    ) else null end
  )
  from public.trial_change_events ce
  join public.trials t on t.id = ce.trial_id
  left join public.assets a on a.id = t.asset_id
  left join public.companies co on co.id = a.company_id
  where ce.space_id = p_space_id
    and (v_event_types is null or ce.event_type = any(v_event_types))
    and (v_sources is null or ce.source = any(v_sources))
    and (v_trial_id is null or ce.trial_id = v_trial_id)
    and (p_cursor_observed_at is null or (ce.observed_at, ce.id) < (p_cursor_observed_at, p_cursor_id))
  order by ce.observed_at desc, ce.id desc
  limit p_limit;
end;
$$;

-- 5. update get_trial_activity to include trial_acronym
create or replace function public.get_trial_activity(
  p_trial_id uuid,
  p_limit int default 25
) returns setof jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_space_id uuid;
begin
  if v_uid is null then return; end if;
  select t.space_id into v_space_id from public.trials t where t.id = p_trial_id;
  if v_space_id is null or not public.has_space_access(v_space_id) then return; end if;

  return query
  select jsonb_build_object(
    'id', ce.id,
    'trial_id', ce.trial_id,
    'space_id', ce.space_id,
    'event_type', ce.event_type,
    'source', ce.source,
    'payload', ce.payload,
    'occurred_at', ce.occurred_at,
    'observed_at', ce.observed_at,
    'trial_name', t.name,
    'trial_acronym', t.acronym,
    'trial_identifier', t.identifier,
    'asset_name', a.name,
    'asset_id', a.id,
    'company_name', co.name,
    'company_id', co.id,
    'company_logo_url', co.logo_url,
    'marker_type', case when ce.marker_id is not null then (
      select jsonb_build_object('id', mt.id, 'name', mt.name, 'icon', mt.icon,
        'shape', mt.shape, 'fill_style', mt.fill_style, 'color', mt.color,
        'inner_mark', mt.inner_mark, 'category_name', mc.name)
      from public.marker_types mt
      left join public.marker_categories mc on mc.id = mt.category_id
      where mt.id = (select m.marker_type_id from public.markers m where m.id = ce.marker_id)
    ) else null end
  )
  from public.trial_change_events ce
  join public.trials t on t.id = ce.trial_id
  left join public.assets a on a.id = t.asset_id
  left join public.companies co on co.id = a.company_id
  where ce.trial_id = p_trial_id
  order by ce.observed_at desc, ce.id desc
  limit p_limit;
end;
$$;

-- 6. update get_catalyst_detail to include trial_acronym
create or replace function public.get_catalyst_detail(
  p_marker_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_catalyst   jsonb;
  v_trial_id   uuid;
  v_asset_id   uuid;
  v_company_id uuid;
  v_upcoming   jsonb;
  v_related    jsonb;
begin
  select
    jsonb_build_object(
      'marker_id',              m.id,
      'title',                  m.title,
      'event_date',             m.event_date,
      'end_date',               m.end_date,
      'category_name',          mc.name,
      'category_id',            mc.id,
      'marker_type_name',       mt.name,
      'marker_type_icon',       mt.icon,
      'marker_type_color',      mt.color,
      'marker_type_shape',      mt.shape,
      'marker_type_inner_mark', mt.inner_mark,
      'is_projected',           m.is_projected,
      'projection',             m.projection,
      'no_longer_expected',     m.no_longer_expected,
      'company_name',           co.name,
      'company_id',             co.id,
      'company_logo_url',       co.logo_url,
      'asset_name',             pr.name,
      'asset_id',               pr.id,
      'trial_name',             t.name,
      'trial_acronym',          t.acronym,
      'trial_id',               t.id,
      'trial_phase',            t.phase,
      'recruitment_status',     t.recruitment_status,
      'description',            m.description,
      'source_url',             m.source_url,
      'metadata',               m.metadata,
      'ctgov_last_synced_at',   t.ctgov_last_synced_at
    ),
    t.id,
    pr.id,
    co.id
  into v_catalyst, v_trial_id, v_asset_id, v_company_id
  from public.markers m
  join public.marker_types mt on mt.id = m.marker_type_id
  join public.marker_categories mc on mc.id = mt.category_id
  left join lateral (
    select ma_inner.trial_id
    from public.marker_assignments ma_inner
    where ma_inner.marker_id = m.id
    limit 1
  ) ma on true
  left join public.trials t on t.id = ma.trial_id
  left join public.assets pr on pr.id = t.asset_id
  left join public.companies co on co.id = pr.company_id
  where m.id = p_marker_id;

  if v_catalyst is null then
    return null;
  end if;

  if v_trial_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'marker_id',        sub.id,
      'title',            sub.title,
      'event_date',       sub.event_date,
      'marker_type_name', sub.mt_name,
      'is_projected',     sub.is_projected
    )), '[]'::jsonb)
    into v_upcoming
    from (
      select m2.id, m2.title, m2.event_date, mt2.name as mt_name, m2.is_projected
      from public.markers m2
      join public.marker_types mt2 on mt2.id = m2.marker_type_id
      join public.marker_assignments ma2 on ma2.marker_id = m2.id
      where ma2.trial_id = v_trial_id
        and m2.event_date >= current_date
        and m2.id != p_marker_id
        and m2.no_longer_expected = false
      order by m2.event_date asc
      limit 5
    ) sub;
  else
    v_upcoming := '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id',      sub.id,
    'title',         sub.title,
    'event_date',    sub.event_date,
    'category_name', sub.cat_name
  )), '[]'::jsonb)
  into v_related
  from (
    select e.id, e.title, e.event_date, ec.name as cat_name
    from public.events e
    join public.event_categories ec on ec.id = e.category_id
    where (
      (v_trial_id   is not null and e.trial_id   = v_trial_id)
      or (v_asset_id is not null and e.asset_id = v_asset_id)
      or (v_company_id is not null and e.company_id = v_company_id)
    )
    order by e.event_date desc
    limit 10
  ) sub;

  return jsonb_build_object(
    'catalyst',         v_catalyst,
    'upcoming_markers', v_upcoming,
    'related_events',   v_related
  );
end;
$$;

-- 7. update get_key_catalysts to include trial_acronym
create or replace function public.get_key_catalysts(
  p_space_id      uuid,
  p_category_ids  uuid[]   default null,
  p_company_id    uuid     default null,
  p_product_id    uuid     default null
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_category_ids = '{}' then p_category_ids := null; end if;

  select coalesce(jsonb_agg(row_data order by event_date asc, title asc), '[]'::jsonb)
  into result
  from (
    select
      jsonb_build_object(
        'marker_id',        m.id,
        'title',            m.title,
        'event_date',       m.event_date,
        'end_date',         m.end_date,
        'category_name',    mc.name,
        'category_id',      mc.id,
        'marker_type_name', mt.name,
        'marker_type_icon', mt.icon,
        'marker_type_color', mt.color,
        'marker_type_shape', mt.shape,
        'is_projected',     m.is_projected,
        'company_name',     co.name,
        'company_id',       co.id,
        'product_name',     pr.name,
        'product_id',       pr.id,
        'trial_name',       t.name,
        'trial_acronym',    t.acronym,
        'trial_id',         t.id,
        'trial_phase',      t.phase,
        'description',      m.description,
        'source_url',       m.source_url
      ) as row_data,
      m.event_date,
      m.title
    from public.markers m
    join public.marker_types mt on mt.id = m.marker_type_id
    join public.marker_categories mc on mc.id = mt.category_id
    left join lateral (
      select ma_inner.trial_id
      from public.marker_assignments ma_inner
      where ma_inner.marker_id = m.id
      limit 1
    ) ma on true
    left join public.trials t on t.id = ma.trial_id
    left join public.products pr on pr.id = t.product_id
    left join public.companies co on co.id = pr.company_id
    where m.space_id = p_space_id
      and m.event_date >= current_date
      and m.no_longer_expected = false
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (p_company_id is null or co.id = p_company_id)
      and (p_product_id is null or pr.id = p_product_id)
  ) sub;

  return result;
end;
$$;
