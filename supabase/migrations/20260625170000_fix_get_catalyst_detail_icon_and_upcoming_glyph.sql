-- migration: 20260625170000_fix_get_catalyst_detail_icon_and_upcoming_glyph
-- purpose: fix two regressions introduced by 20260625160000, which rebuilt
--          get_catalyst_detail from the stale 20260528003300 body instead of
--          the current 20260618130000 body:
--
--   1. It re-introduced `mt.icon` in the main catalyst object. marker_types.icon
--      was dropped back in 20260530140000, so the function plans fine at CREATE
--      time (plpgsql bodies are not validated against the catalog) but raises
--      `column mt.icon does not exist` (42703) at CALL time. This is the live
--      error on the dev project's get_catalyst_detail.
--   2. It reverted the 20260618130000 enhancement that put the marker glyph
--      fields (color / shape / inner_mark) on each upcoming_markers entry, so
--      the detail pane renders blank glyphs for upcoming markers
--      (UpcomingMarker.marker_type_shape / _inner_mark are consumed by
--      marker-detail-content.component).
--
-- This re-asserts the correct merged body: the 20260618130000 shape (rich
-- upcoming glyph fields) PLUS the source_doc_id provenance field added by
-- 20260625160000, MINUS the dropped marker_types.icon column. A new migration
-- version is required because 20260625160000 is already recorded on dev; a
-- create-or-replace inside it cannot be re-run by `supabase db push`.
--
-- An inline call-time smoke executes the function so any future reference to a
-- dropped column fails the migration loudly instead of arming another time bomb.

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
      'source_doc_id',          m.source_doc_id,
      'title',                  m.title,
      'event_date',             m.event_date,
      'end_date',               m.end_date,
      'category_name',          mc.name,
      'category_id',            mc.id,
      'marker_type_name',       mt.name,
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
      'marker_type_color', sub.mt_color,
      'marker_type_shape', sub.mt_shape,
      'marker_type_inner_mark', sub.mt_inner_mark,
      'is_projected',     sub.is_projected,
      'projection',       sub.projection,
      'no_longer_expected', sub.no_longer_expected
    )), '[]'::jsonb)
    into v_upcoming
    from (
      select m2.id, m2.title, m2.event_date, mt2.name as mt_name,
             mt2.color as mt_color, mt2.shape as mt_shape, mt2.inner_mark as mt_inner_mark,
             m2.is_projected, m2.projection, m2.no_longer_expected
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

-- ---------------------------------------------------------------------------
-- call-time smoke: execute the function so a reference to a dropped column
-- (the 42703 time-bomb class) fails this migration instead of arming silently.
-- Prefer a marker with a trial assignment so the upcoming_markers block is
-- planned too; fall back to a random id (plans the main select) when the DB
-- has no assigned markers (e.g. a freshly seeded environment).
-- ---------------------------------------------------------------------------
do $$
declare
  v_marker_id uuid;
begin
  select m.id into v_marker_id
  from public.markers m
  join public.marker_assignments ma on ma.marker_id = m.id
  limit 1;

  if v_marker_id is not null then
    perform public.get_catalyst_detail(v_marker_id);
    raise notice 'get_catalyst_detail smoke (assigned marker, full path): PASS';
  else
    perform public.get_catalyst_detail(gen_random_uuid());
    raise notice 'get_catalyst_detail smoke (main select only): PASS';
  end if;
end $$;

notify pgrst, 'reload schema';
