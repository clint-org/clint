-- migration: 20260414024141_marker_visual_redesign
-- purpose: reduce marker types from 21 to 12, add inner_mark to marker_types,
--          add no_longer_expected to markers, archive old types, insert new types,
--          and update get_dashboard_data RPC to surface new fields.
-- affected tables (altered):
--   public.marker_types  -- adds inner_mark column, updates shape constraint
--   public.markers       -- adds no_longer_expected column
-- affected data:
--   15 old marker types archived (display_order = -1)
--   6 existing types updated (color, inner_mark, shape, display_order)
--   7 new marker types inserted
-- affected functions:
--   public.get_dashboard_data  -- adds inner_mark and no_longer_expected to output

-- =============================================================================
-- 1. add inner_mark column to marker_types
-- =============================================================================

alter table public.marker_types
  add column inner_mark text not null default 'none'
  check (inner_mark in ('dot', 'dash', 'check', 'x', 'none'));

-- =============================================================================
-- 2. update shape constraint to include dashed-line
-- =============================================================================

-- normalize any legacy shape values that are outside the new allowed set
-- (e.g. 'bar', 'arrow', 'x' from archived types) so the constraint can be applied
update public.marker_types
set shape = 'circle'
where shape not in ('circle', 'diamond', 'flag', 'triangle', 'square', 'dashed-line');

alter table public.marker_types drop constraint if exists marker_types_shape_check;
alter table public.marker_types
  add constraint marker_types_shape_check
  check (shape in ('circle', 'diamond', 'flag', 'triangle', 'square', 'dashed-line'));

-- =============================================================================
-- 3. add no_longer_expected column to markers
-- =============================================================================

alter table public.markers
  add column no_longer_expected boolean not null default false;

-- =============================================================================
-- 4. archive old marker types (set display_order to -1)
-- =============================================================================

update public.marker_types
set display_order = -1
where id in (
  'a0000000-0000-0000-0000-000000000001',  -- Projected Data Reported
  'a0000000-0000-0000-0000-000000000002',  -- Data Reported
  'a0000000-0000-0000-0000-000000000003',  -- Projected Regulatory Filing
  'a0000000-0000-0000-0000-000000000004',  -- Submitted Regulatory Filing
  'a0000000-0000-0000-0000-000000000005',  -- Label Projected Approval/Launch
  'a0000000-0000-0000-0000-000000000006',  -- Label Update
  'a0000000-0000-0000-0000-000000000007',  -- Est. Range of Potential Launch
  'a0000000-0000-0000-0000-000000000009',  -- Change from Prior Update
  'a0000000-0000-0000-0000-000000000010',  -- Event No Longer Expected
  'a0000000-0000-0000-0000-000000000014',  -- old Interim Data
  'a0000000-0000-0000-0000-000000000015',  -- old Full Data
  'a0000000-0000-0000-0000-000000000016',  -- FDA Submission
  'a0000000-0000-0000-0000-000000000017',  -- FDA Acceptance
  'a0000000-0000-0000-0000-000000000018',  -- PDUFA Date
  'a0000000-0000-0000-0000-000000000019'   -- Launch Date
);

-- =============================================================================
-- 5. update existing marker types that stay active
-- =============================================================================

-- Topline Data (a0...0013): new color, inner_mark, display_order
update public.marker_types
set color = '#4ade80', inner_mark = 'dot', display_order = 1
where id = 'a0000000-0000-0000-0000-000000000013';

-- Primary Completion Date (PCD) (a0...0008): new color, display_order
update public.marker_types
set color = '#475569', display_order = 7
where id = 'a0000000-0000-0000-0000-000000000008';

-- Trial Start (a0...0011): new shape, color, fill_style, display_order
update public.marker_types
set shape = 'dashed-line', color = '#94a3b8', fill_style = 'filled', display_order = 8
where id = 'a0000000-0000-0000-0000-000000000011';

-- Trial End (a0...0012): new shape, color, fill_style, display_order
update public.marker_types
set shape = 'dashed-line', color = '#94a3b8', fill_style = 'filled', display_order = 9
where id = 'a0000000-0000-0000-0000-000000000012';

-- LOE Date (a0...0020): new color, inner_mark, display_order
update public.marker_types
set color = '#78350f', inner_mark = 'x', display_order = 11
where id = 'a0000000-0000-0000-0000-000000000020';

-- Generic Entry Date (a0...0021): new color, display_order
update public.marker_types
set color = '#d97706', display_order = 12
where id = 'a0000000-0000-0000-0000-000000000021';

-- =============================================================================
-- 6. insert new marker types
-- =============================================================================

insert into public.marker_types (id, space_id, name, icon, shape, color, inner_mark, fill_style, is_system, display_order, category_id)
values
  -- Data category (c...0002)
  ('a0000000-0000-0000-0000-000000000030', null, 'Interim Data',      'interim-data',  'circle',      '#22c55e', 'dash',  'filled', true, 2,  'c0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000031', null, 'Full Data',         'full-data',     'circle',      '#16a34a', 'none',  'filled', true, 3,  'c0000000-0000-0000-0000-000000000002'),
  -- Regulatory category (c...0003)
  ('a0000000-0000-0000-0000-000000000032', null, 'Regulatory Filing', 'reg-filing',    'diamond',     '#f97316', 'dot',   'filled', true, 4,  'c0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000033', null, 'Submission',        'submission',    'diamond',     '#f97316', 'none',  'filled', true, 5,  'c0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000034', null, 'Acceptance',        'acceptance',    'diamond',     '#f97316', 'check', 'filled', true, 6,  'c0000000-0000-0000-0000-000000000003'),
  -- Approval category (c...0004)
  ('a0000000-0000-0000-0000-000000000035', null, 'Approval',          'approval',      'flag',        '#3b82f6', 'none',  'filled', true, 10, 'c0000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-000000000036', null, 'Launch',            'launch',        'triangle',    '#7c3aed', 'none',  'filled', true, 11, 'c0000000-0000-0000-0000-000000000004')
on conflict (id) do nothing;

-- =============================================================================
-- 7. update get_dashboard_data RPC to include inner_mark and no_longer_expected
-- =============================================================================

drop function if exists public.get_dashboard_data(uuid, uuid[], uuid[], uuid[], int, int, text[], text[], text[], uuid[], uuid[]);

create or replace function public.get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_therapeutic_area_ids uuid[] default null,
  p_start_year int default null,
  p_end_year int default null,
  p_recruitment_statuses text[] default null,
  p_study_types text[] default null,
  p_phases text[] default null,
  p_mechanism_of_action_ids uuid[] default null,
  p_route_of_administration_ids uuid[] default null
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
  -- normalize empty arrays to null so callers passing [] instead of null
  -- for "no filter" do not silently get zero results
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
      'products', coalesce((
        select jsonb_agg(product_obj order by p.display_order)
        from public.products p
        cross join lateral (
          select jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'generic_name', p.generic_name,
            'logo_url', p.logo_url,
            'display_order', p.display_order,
            'mechanisms_of_action', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.product_mechanisms_of_action pm
              join public.mechanisms_of_action m on m.id = pm.moa_id
              where pm.product_id = p.id
            ), '[]'::jsonb),
            'routes_of_administration', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration pr
              join public.routes_of_administration r on r.id = pr.roa_id
              where pr.product_id = p.id
            ), '[]'::jsonb),
            'trials', coalesce((
              select jsonb_agg(trial_obj order by t.display_order)
              from public.trials t
              cross join lateral (
                select jsonb_build_object(
                  'id', t.id,
                  'name', t.name,
                  'identifier', t.identifier,
                  'sample_size', t.sample_size,
                  'status', t.status,
                  'notes', t.notes,
                  'display_order', t.display_order,
                  'product_id', t.product_id,
                  'therapeutic_area_id', t.therapeutic_area_id,
                  'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type,
                  'phase', t.phase,
                  'intervention_type', t.intervention_type,
                  'intervention_name', t.intervention_name,
                  'lead_sponsor', t.lead_sponsor,
                  'study_countries', t.study_countries,
                  'fda_designations', t.fda_designations,
                  'has_dmc', t.has_dmc,
                  'start_date', t.start_date,
                  'primary_completion_date', t.primary_completion_date,
                  'ctgov_last_synced_at', t.ctgov_last_synced_at,
                  'therapeutic_area', (
                    select jsonb_build_object('id', ta.id, 'name', ta.name, 'abbreviation', ta.abbreviation)
                    from public.therapeutic_areas ta where ta.id = t.therapeutic_area_id
                  ),
                  -- single phase object built from the inline columns on trials
                  'phase_data', case
                    when t.phase_type is not null then jsonb_build_object(
                      'phase_type',       t.phase_type,
                      'phase_start_date', t.phase_start_date,
                      'phase_end_date',   t.phase_end_date
                    )
                    else null
                  end,
                  'markers', coalesce((
                    select jsonb_agg(
                      jsonb_build_object(
                        'id',                 m.id,
                        'title',              m.title,
                        'projection',         m.projection,
                        'event_date',         m.event_date,
                        'end_date',           m.end_date,
                        'description',        m.description,
                        'source_url',         m.source_url,
                        'metadata',           m.metadata,
                        'is_projected',       m.is_projected,
                        'no_longer_expected', m.no_longer_expected,
                        'marker_type', (
                          select jsonb_build_object(
                            'id',            mt.id,
                            'name',          mt.name,
                            'icon',          mt.icon,
                            'shape',         mt.shape,
                            'fill_style',    mt.fill_style,
                            'color',         mt.color,
                            'inner_mark',    mt.inner_mark,
                            'category_name', mc.name
                          )
                          from public.marker_types mt
                          left join public.marker_categories mc on mc.id = mt.category_id
                          where mt.id = m.marker_type_id
                        )
                      )
                      order by m.event_date
                    )
                    from public.marker_assignments ma
                    join public.markers m on m.id = ma.marker_id
                    where ma.trial_id = t.id
                      and m.space_id = p_space_id
                      and (p_start_year is null or extract(year from m.event_date) >= p_start_year)
                      and (p_end_year   is null or extract(year from m.event_date) <= p_end_year)
                  ), '[]'::jsonb),
                  'trial_notes', coalesce((
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', tn.id, 'content', tn.content,
                        'created_at', tn.created_at, 'updated_at', tn.updated_at
                      )
                      order by tn.created_at
                    )
                    from public.trial_notes tn
                    where tn.trial_id = t.id
                      and tn.space_id = p_space_id
                  ), '[]'::jsonb)
                ) as trial_obj
              ) as trial_lateral
              where t.product_id = p.id
                and t.space_id = p_space_id
                and (p_therapeutic_area_ids is null or t.therapeutic_area_id = any(p_therapeutic_area_ids))
                and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                and (p_study_types is null or t.study_type = any(p_study_types))
                and (p_phases is null or t.phase = any(p_phases))
            ), '[]'::jsonb)
          ) as product_obj
        ) as product_lateral
        where p.company_id = c.id
          and p.space_id = p_space_id
          and (p_product_ids is null or p.id = any(p_product_ids))
          and (
            p_mechanism_of_action_ids is null
            or exists (
              select 1 from public.product_mechanisms_of_action pm2
              where pm2.product_id = p.id
                and pm2.moa_id = any(p_mechanism_of_action_ids)
            )
          )
          and (
            p_route_of_administration_ids is null
            or exists (
              select 1 from public.product_routes_of_administration pr2
              where pr2.product_id = p.id
                and pr2.roa_id = any(p_route_of_administration_ids)
            )
          )
      ), '[]'::jsonb)
    ) as company_obj
  ) as company_lateral
  where c.space_id = p_space_id
    and (p_company_ids is null or c.id = any(p_company_ids));

  return result;
end;
$$;
