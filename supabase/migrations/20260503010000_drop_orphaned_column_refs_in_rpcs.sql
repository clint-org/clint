-- migration: 20260503010000_drop_orphaned_column_refs_in_rpcs
-- purpose: remove references to t.sample_size from the four bullseye RPCs.
--   Migration 20260502122000_drop_orphaned_trial_columns dropped 36 columns
--   from public.trials including sample_size. The follow-up
--   20260503000000_fix_seed_demo_post_drop only repaired _seed_demo_trials;
--   the bullseye family of RPCs still embedded `'sample_size', t.sample_size`
--   in their trial JSON projection, so every Bullseye-by-{TA,company,MOA,RoA}
--   call against any space with even one trial threw
--   `column t.sample_size does not exist` at runtime. plpgsql validates
--   bodies lazily, so `supabase db reset` succeeded and the regression only
--   surfaced when the UI actually loaded landscape data.
--
-- audit performed against the live DB after the most recent reset:
--   get_bullseye_data         BROKEN: line 91 `'sample_size', t.sample_size,`
--   get_bullseye_by_company   BROKEN: line 102 same
--   get_bullseye_by_moa       BROKEN: line 102 same
--   get_bullseye_by_roa       BROKEN: line 102 same
--   _classify_change          clean (mentions eligibility_criteria only in
--                             event-type comment string)
--   palette_empty_state       clean (comment-only mention of conditions)
--   search_palette            clean (comment-only mention of conditions)
--
-- The frontend BullseyeTrial interface (landscape.model.ts) does not include
-- sample_size, so removing the field from the RPC payload is purely defensive
-- alignment with the post-drop schema.
--
-- See plan: docs/superpowers/plans/2026-05-02-trial-change-feed.md
-- See test script: docs/superpowers/plans/2026-05-02-trial-change-feed-TEST-SCRIPT.md (Section 5)


create or replace function public.get_bullseye_data(p_space_id uuid, p_therapeutic_area_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_scope  jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object(
    'id', ta.id,
    'name', ta.name,
    'abbreviation', ta.abbreviation
  )
  into v_scope
  from public.therapeutic_areas ta
  where ta.id = p_therapeutic_area_id
    and ta.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension',    'therapeutic-area',
      'scope',        null,
      'ring_order',   jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes',       '[]'::jsonb,
      'spoke_label',  'Companies'
    );
  end if;

  with product_rollup as (
    select
      p.id           as product_id,
      p.company_id   as company_id,
      p.name         as product_name,
      p.generic_name as generic_name,
      p.logo_url     as logo_url,
      max(case t.phase_type
        when 'LAUNCHED' then 6
        when 'APPROVED' then 5
        when 'P4'       then 4
        when 'P3'       then 3
        when 'P2'       then 2
        when 'P1'       then 1
        when 'PRECLIN'  then 0
        else null
      end) as max_rank
    from public.products p
    join public.trials t
      on t.product_id = p.id
     and t.space_id = p_space_id
     and t.therapeutic_area_id = p_therapeutic_area_id
     and t.phase_type is not null
     and t.phase_type <> 'OBS'
    where p.space_id = p_space_id
    group by p.id, p.company_id, p.name, p.generic_name, p.logo_url
    having max(case t.phase_type
        when 'LAUNCHED' then 6
        when 'APPROVED' then 5
        when 'P4'       then 4
        when 'P3'       then 3
        when 'P2'       then 2
        when 'P1'       then 1
        when 'PRECLIN'  then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank
    from product_rollup
    group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id',                c.id,
      'name',              c.name,
      'display_order',     c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(product_obj order by pr.max_rank desc, pr.product_name), '[]'::jsonb)
        from product_rollup pr
        cross join lateral (
          select jsonb_build_object(
            'id',                 pr.product_id,
            'name',               pr.product_name,
            'generic_name',       pr.generic_name,
            'logo_url',           pr.logo_url,
            'company_id',         pr.company_id,
            'company_name',       c.name,
            'highest_phase_rank', pr.max_rank,
            'highest_phase', case pr.max_rank
              when 6 then 'LAUNCHED'
              when 5 then 'APPROVED'
              when 4 then 'P4'
              when 3 then 'P3'
              when 2 then 'P2'
              when 1 then 'P1'
              when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.product_mechanisms_of_action pmoa
              join public.mechanisms_of_action m on m.id = pmoa.moa_id
              where pmoa.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration proa
              join public.routes_of_administration r on r.id = proa.roa_id
              where proa.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id',                t.id,
                  'name',              t.name,
                  'identifier',        t.identifier,
                  'status',            t.status,
                  'recruitment_status', t.recruitment_status,
                  'study_type',        t.study_type,
                  'phase',             t.phase_type
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id
                and t.therapeutic_area_id = p_therapeutic_area_id
                and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id',               rmm.id,
                  'event_date',       rmm.event_date,
                  'projection',       rmm.projection,
                  'marker_type_name', mt.name,
                  'icon',             mt.icon,
                  'shape',            mt.shape,
                  'color',            mt.color,
                  'category_name',    mc.name
                ) order by rmm.event_date desc
              ), '[]'::jsonb)
              from (
                select m.id, m.event_date, m.marker_type_id, m.projection
                from public.marker_assignments ma
                join public.markers m on m.id = ma.marker_id
                join public.trials t2 on t2.id = ma.trial_id
                where t2.product_id = pr.product_id
                  and t2.therapeutic_area_id = p_therapeutic_area_id
                  and t2.space_id = p_space_id
                  and m.space_id = p_space_id
                order by m.event_date desc
                limit 3
              ) rmm
              join public.marker_types mt on mt.id = rmm.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension',   'therapeutic-area',
    'scope',       v_scope,
    'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes',      coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$function$;


create or replace function public.get_bullseye_by_company(p_space_id uuid, p_company_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_scope  jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', c.id, 'name', c.name, 'abbreviation', null)
  into v_scope
  from public.companies c
  where c.id = p_company_id and c.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension',   'company',
      'scope',       null,
      'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes',      '[]'::jsonb,
      'spoke_label', 'Therapeutic Areas'
    );
  end if;

  with product_rollup as (
    select
      p.id   as product_id,
      p.name as product_name,
      p.generic_name,
      p.logo_url,
      p.company_id,
      t.therapeutic_area_id,
      max(case t.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.products p
    join public.trials t
      on t.product_id = p.id
     and t.space_id = p_space_id
     and t.phase_type is not null
     and t.phase_type <> 'OBS'
    where p.space_id = p_space_id and p.company_id = p_company_id
    group by p.id, p.name, p.generic_name, p.logo_url, p.company_id, t.therapeutic_area_id
    having max(case t.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  ta_rank as (
    select therapeutic_area_id, max(max_rank) as ta_max_rank
    from product_rollup
    group by therapeutic_area_id
  )
  select coalesce(jsonb_agg(spoke_obj order by tr.ta_max_rank desc, ta.name), '[]'::jsonb)
  into v_spokes
  from public.therapeutic_areas ta
  join ta_rank tr on tr.therapeutic_area_id = ta.id
  cross join lateral (
    select jsonb_build_object(
      'id',                ta.id,
      'name',              ta.name,
      'display_order',     0,
      'highest_phase_rank', tr.ta_max_rank,
      'products', (
        select coalesce(jsonb_agg(product_obj order by pr.max_rank desc, pr.product_name), '[]'::jsonb)
        from product_rollup pr
        cross join lateral (
          select jsonb_build_object(
            'id',                 pr.product_id,
            'name',               pr.product_name,
            'generic_name',       pr.generic_name,
            'logo_url',           pr.logo_url,
            'company_id',         pr.company_id,
            'company_name',       (select c2.name from public.companies c2 where c2.id = pr.company_id),
            'highest_phase_rank', pr.max_rank,
            'highest_phase', case pr.max_rank
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.product_mechanisms_of_action pmoa
              join public.mechanisms_of_action m on m.id = pmoa.moa_id
              where pmoa.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration proa
              join public.routes_of_administration r on r.id = proa.roa_id
              where proa.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id',                 t.id,
                  'name',               t.name,
                  'identifier',         t.identifier,
                  'status',             t.status,
                  'recruitment_status', t.recruitment_status,
                  'study_type',         t.study_type,
                  'phase',              t.phase_type
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id
                and t.therapeutic_area_id = pr.therapeutic_area_id
                and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id',               rmm.id,
                  'event_date',       rmm.event_date,
                  'projection',       rmm.projection,
                  'marker_type_name', mt.name,
                  'icon',             mt.icon,
                  'shape',            mt.shape,
                  'color',            mt.color,
                  'category_name',    mc.name
                ) order by rmm.event_date desc
              ), '[]'::jsonb)
              from (
                select m.id, m.event_date, m.marker_type_id, m.projection
                from public.marker_assignments ma
                join public.markers m on m.id = ma.marker_id
                join public.trials t2 on t2.id = ma.trial_id
                where t2.product_id = pr.product_id
                  and t2.therapeutic_area_id = pr.therapeutic_area_id
                  and t2.space_id = p_space_id
                  and m.space_id = p_space_id
                order by m.event_date desc
                limit 3
              ) rmm
              join public.marker_types mt on mt.id = rmm.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.therapeutic_area_id = ta.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where ta.space_id = p_space_id;

  return jsonb_build_object(
    'dimension',   'company',
    'scope',       v_scope,
    'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes',      coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Therapeutic Areas'
  );
end;
$function$;


create or replace function public.get_bullseye_by_moa(p_space_id uuid, p_moa_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_scope  jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', m.id, 'name', m.name, 'abbreviation', m.abbreviation)
  into v_scope
  from public.mechanisms_of_action m
  where m.id = p_moa_id and m.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension',   'moa',
      'scope',       null,
      'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes',      '[]'::jsonb,
      'spoke_label', 'Companies'
    );
  end if;

  with product_rollup as (
    select
      p.id   as product_id,
      p.name as product_name,
      p.generic_name,
      p.logo_url,
      p.company_id,
      max(case t.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.product_mechanisms_of_action pmoa
    join public.products p on p.id = pmoa.product_id and p.space_id = p_space_id
    join public.trials t
      on t.product_id = p.id
     and t.space_id = p_space_id
     and t.phase_type is not null
     and t.phase_type <> 'OBS'
    where pmoa.moa_id = p_moa_id
    group by p.id, p.name, p.generic_name, p.logo_url, p.company_id
    having max(case t.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank
    from product_rollup
    group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id',                c.id,
      'name',              c.name,
      'display_order',     c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(product_obj order by pr.max_rank desc, pr.product_name), '[]'::jsonb)
        from product_rollup pr
        cross join lateral (
          select jsonb_build_object(
            'id',                 pr.product_id,
            'name',               pr.product_name,
            'generic_name',       pr.generic_name,
            'logo_url',           pr.logo_url,
            'company_id',         pr.company_id,
            'company_name',       c.name,
            'highest_phase_rank', pr.max_rank,
            'highest_phase', case pr.max_rank
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', mm.id, 'name', mm.name) order by mm.display_order, mm.name)
              from public.product_mechanisms_of_action pmoa2
              join public.mechanisms_of_action mm on mm.id = pmoa2.moa_id
              where pmoa2.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration proa
              join public.routes_of_administration r on r.id = proa.roa_id
              where proa.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id',                 t.id,
                  'name',               t.name,
                  'identifier',         t.identifier,
                  'status',             t.status,
                  'recruitment_status', t.recruitment_status,
                  'study_type',         t.study_type,
                  'phase',              t.phase_type
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id',               rmm.id,
                  'event_date',       rmm.event_date,
                  'projection',       rmm.projection,
                  'marker_type_name', mt.name,
                  'icon',             mt.icon,
                  'shape',            mt.shape,
                  'color',            mt.color,
                  'category_name',    mc.name
                ) order by rmm.event_date desc
              ), '[]'::jsonb)
              from (
                select m.id, m.event_date, m.marker_type_id, m.projection
                from public.marker_assignments ma
                join public.markers m on m.id = ma.marker_id
                join public.trials t2 on t2.id = ma.trial_id
                where t2.product_id = pr.product_id
                  and t2.space_id = p_space_id
                  and m.space_id = p_space_id
                order by m.event_date desc
                limit 3
              ) rmm
              join public.marker_types mt on mt.id = rmm.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension',   'moa',
    'scope',       v_scope,
    'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes',      coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$function$;


create or replace function public.get_bullseye_by_roa(p_space_id uuid, p_roa_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_scope  jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation)
  into v_scope
  from public.routes_of_administration r
  where r.id = p_roa_id and r.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension',   'roa',
      'scope',       null,
      'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes',      '[]'::jsonb,
      'spoke_label', 'Companies'
    );
  end if;

  with product_rollup as (
    select
      p.id   as product_id,
      p.name as product_name,
      p.generic_name,
      p.logo_url,
      p.company_id,
      max(case t.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.product_routes_of_administration proa
    join public.products p on p.id = proa.product_id and p.space_id = p_space_id
    join public.trials t
      on t.product_id = p.id
     and t.space_id = p_space_id
     and t.phase_type is not null
     and t.phase_type <> 'OBS'
    where proa.roa_id = p_roa_id
    group by p.id, p.name, p.generic_name, p.logo_url, p.company_id
    having max(case t.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank
    from product_rollup
    group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id',                c.id,
      'name',              c.name,
      'display_order',     c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(product_obj order by pr.max_rank desc, pr.product_name), '[]'::jsonb)
        from product_rollup pr
        cross join lateral (
          select jsonb_build_object(
            'id',                 pr.product_id,
            'name',               pr.product_name,
            'generic_name',       pr.generic_name,
            'logo_url',           pr.logo_url,
            'company_id',         pr.company_id,
            'company_name',       c.name,
            'highest_phase_rank', pr.max_rank,
            'highest_phase', case pr.max_rank
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', mm.id, 'name', mm.name) order by mm.display_order, mm.name)
              from public.product_mechanisms_of_action pmoa
              join public.mechanisms_of_action mm on mm.id = pmoa.moa_id
              where pmoa.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', rr.id, 'name', rr.name, 'abbreviation', rr.abbreviation) order by rr.display_order, rr.name)
              from public.product_routes_of_administration proa2
              join public.routes_of_administration rr on rr.id = proa2.roa_id
              where proa2.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id',                 t.id,
                  'name',               t.name,
                  'identifier',         t.identifier,
                  'status',             t.status,
                  'recruitment_status', t.recruitment_status,
                  'study_type',         t.study_type,
                  'phase',              t.phase_type
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id',               rmm.id,
                  'event_date',       rmm.event_date,
                  'projection',       rmm.projection,
                  'marker_type_name', mt.name,
                  'icon',             mt.icon,
                  'shape',            mt.shape,
                  'color',            mt.color,
                  'category_name',    mc.name
                ) order by rmm.event_date desc
              ), '[]'::jsonb)
              from (
                select m.id, m.event_date, m.marker_type_id, m.projection
                from public.marker_assignments ma
                join public.markers m on m.id = ma.marker_id
                join public.trials t2 on t2.id = ma.trial_id
                where t2.product_id = pr.product_id
                  and t2.space_id = p_space_id
                  and m.space_id = p_space_id
                order by m.event_date desc
                limit 3
              ) rmm
              join public.marker_types mt on mt.id = rmm.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension',   'roa',
    'scope',       v_scope,
    'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes',      coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$function$;


-- =============================================================================
-- Smoke test: assert no bullseye RPC body still references any of the 36
-- columns dropped in 20260502122000_drop_orphaned_trial_columns. Static
-- check rather than runtime, because lazy plpgsql validation means the
-- broken refs would otherwise only surface when the UI hits a populated
-- space.
-- =============================================================================
do $$
declare
  fn_oid       oid;
  body         text;
  fn_name      text;
  fn_names     text[] := array[
    'public.get_bullseye_data(uuid,uuid)',
    'public.get_bullseye_by_company(uuid,uuid)',
    'public.get_bullseye_by_moa(uuid,uuid)',
    'public.get_bullseye_by_roa(uuid,uuid)'
  ];
  bad_cols     text[] := array[
    'lead_sponsor','sponsor_type','collaborators','study_countries',
    'study_regions','design_allocation','design_intervention_model',
    'design_masking','design_primary_purpose','enrollment_type','conditions',
    'intervention_type','intervention_name','primary_outcome_measures',
    'secondary_outcome_measures','is_rare_disease','eligibility_sex',
    'eligibility_min_age','eligibility_max_age','accepts_healthy_volunteers',
    'eligibility_criteria','sampling_method','start_date','start_date_type',
    'primary_completion_date','primary_completion_date_type',
    'study_completion_date','study_completion_date_type','first_posted_date',
    'results_first_posted_date','has_dmc','is_fda_regulated_drug',
    'is_fda_regulated_device','fda_designations','submission_type',
    'sample_size'
  ];
  bad_col      text;
begin
  foreach fn_name in array fn_names loop
    fn_oid := fn_name::regprocedure::oid;
    body   := pg_get_functiondef(fn_oid);
    foreach bad_col in array bad_cols loop
      -- match the SQL projection pattern `t.<col>` or `\m<col>\M` standalone.
      -- this also catches single-quoted JSON keys, which is intentional --
      -- if a key name shadows a dropped column, that's a smell.
      if body ~ ('\mt\.' || bad_col || '\M') then
        raise exception 'orphaned-column-refs RPC smoke FAIL: % still references t.%',
          fn_name, bad_col;
      end if;
    end loop;
  end loop;
  raise notice 'orphaned column refs in bullseye RPCs smoke test: PASS';
end $$;
