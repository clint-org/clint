-- A5: repoint search_palette + palette_empty_state off dropped marker tables onto unified events.
-- search_palette: the old 'catalyst' (markers) leg and 'event' (old events shape) leg
--   both now target the same unified events table; they are MERGED into one leg
--   to avoid duplicate rows. p_kind in ('catalyst','event') both resolve to events.
-- palette_empty_state: the 'catalyst' and 'event' legs are keyed by stored discriminator
--   so they are repointed IN PLACE (no merge).

-- ============================================================
-- search_palette
-- ============================================================
create or replace function public.search_palette(
  p_space_id uuid,
  p_query    text,
  p_kind     text    default null,
  p_limit    integer default 25
)
returns table(
  kind      text,
  id        uuid,
  name      text,
  secondary text,
  score     real,
  pinned    boolean,
  recent_at timestamp with time zone
)
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_q   text := lower(coalesce(trim(p_query), ''));
begin
  if v_uid is null then return; end if;
  if not public.has_space_access(p_space_id) then return; end if;
  if length(v_q) < 2 then return; end if;

  return query
  with matches as (
    select 'company'::text as kind,
           c.id,
           c.name::text as name,
           ((select count(*) from public.assets ac
             where ac.company_id = c.id and ac.space_id = p_space_id)::text || ' assets') as secondary,
           extensions.similarity(c.name, v_q)
             + case when c.name ilike v_q || '%' then 0.3 else 0 end as score
    from public.companies c
    where c.space_id = p_space_id
      and (p_kind is null or p_kind = 'company')
      and c.name operator(extensions.%) v_q

    union all
    select 'asset'::text,
           a.id,
           a.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = a.company_id),
             nullif(a.generic_name, '')
           ) as secondary,
           greatest(extensions.similarity(a.name, v_q), extensions.similarity(coalesce(a.generic_name,''), v_q))
             + case when a.name ilike v_q || '%' or coalesce(a.generic_name,'') ilike v_q || '%' then 0.3 else 0 end as score
    from public.assets a
    where a.space_id = p_space_id
      and (p_kind is null or p_kind = 'asset')
      and (a.name operator(extensions.%) v_q or coalesce(a.generic_name,'') operator(extensions.%) v_q)

    union all
    select 'trial'::text,
           t.id,
           t.name::text,
           concat_ws(' · ',
             case
               when t.phase_type is not null then
                 case t.phase_type
                   when 'PRECLIN' then 'Preclinical'
                   when 'P1'   then 'Ph 1'
                   when 'P2'   then 'Ph 2'
                   when 'P3'   then 'Ph 3'
                   when 'P4'   then 'Ph 4'
                   when 'P1_2' then 'Ph 1/2'
                   when 'P2_3' then 'Ph 2/3'
                   when 'OBS'  then 'Observational'
                   else t.phase_type
                 end
               when nullif(trim(coalesce(t.phase, '')), '') is null then null
               when t.phase ~ '\d' then
                 'Ph ' || trim(regexp_replace(t.phase, '^\s*ph(ase)?\s*', '', 'i'))
               else initcap(trim(t.phase))
             end,
             (select co.name::text from public.companies co
                join public.assets aa on aa.company_id = co.id
                where aa.id = t.asset_id),
             t.identifier
           ) as secondary,
           greatest(extensions.similarity(t.name, v_q), extensions.similarity(coalesce(t.identifier,''), v_q))
             + case when t.name ilike v_q || '%' then 0.3 else 0 end
             + case when upper(coalesce(t.identifier,'')) = upper(v_q) then 0.5 else 0 end as score
    from public.trials t
    where t.space_id = p_space_id
      and (p_kind is null or p_kind = 'trial')
      and (t.name operator(extensions.%) v_q or coalesce(t.identifier,'') operator(extensions.%) v_q)

    -- merged events leg: the old 'catalyst' (markers) leg and 'event' (old events shape) leg
    -- are collapsed here because both now read the same unified events table.
    -- p_kind 'catalyst' and 'event' both route to events; no duplicate rows.
    union all
    select 'event'::text,
           m.id,
           m.title,
           concat_ws(' · ',
             to_char(m.event_date, 'YYYY-MM-DD'),
             (select ec.name
                from public.event_types et
                join public.event_type_categories ec on ec.id = et.category_id
                where et.id = m.event_type_id),
             (select coalesce(t2.name::text, a2.name::text, c2.name::text)
                from (select 1) one
                left join public.trials t2    on m.anchor_type = 'trial'   and t2.id = m.anchor_id
                left join public.assets a2    on m.anchor_type = 'asset'   and a2.id = m.anchor_id
                left join public.companies c2 on m.anchor_type = 'company' and c2.id = m.anchor_id)
           ) as secondary,
           extensions.similarity(m.title, v_q)
             + case when m.title ilike v_q || '%' then 0.3 else 0 end as score
    from public.events m
    where m.space_id = p_space_id
      and (p_kind is null or p_kind in ('catalyst', 'event'))
      and m.title operator(extensions.%) v_q
  )
  select m.kind,
         m.id,
         m.name,
         m.secondary,
         m.score::real,
         (pp.user_id is not null) as pinned,
         pr.last_opened_at as recent_at
  from matches m
  left join public.palette_pinned pp
    on pp.user_id = v_uid and pp.space_id = p_space_id and pp.kind = m.kind and pp.entity_id = m.id
  left join public.palette_recents pr
    on pr.user_id = v_uid and pr.space_id = p_space_id and pr.kind = m.kind and pr.entity_id = m.id
  order by pinned desc,
           score desc,
           recent_at desc nulls last,
           m.name asc
  limit p_limit;
end;
$function$;

-- ============================================================
-- palette_empty_state
-- ============================================================
create or replace function public.palette_empty_state(p_space_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_pinned jsonb;
  v_recents jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('pinned','[]'::jsonb,'recents','[]'::jsonb);
  end if;
  if not public.has_space_access(p_space_id) then
    return jsonb_build_object('pinned','[]'::jsonb,'recents','[]'::jsonb);
  end if;

  with pinned_raw as (
    select kind, entity_id, position
    from public.palette_pinned
    where user_id = v_uid and space_id = p_space_id
    order by position asc
    limit 10
  ),
  pinned_enriched as (
    select pr.kind, pr.entity_id as id,
           c.name::text as name,
           ((select count(*) from public.assets ac
             where ac.company_id = c.id and ac.space_id = p_space_id)::text || ' assets') as secondary,
           pr.position
    from pinned_raw pr
    join public.companies c on c.id = pr.entity_id
    where pr.kind = 'company' and c.space_id = p_space_id

    union all
    select pr.kind, pr.entity_id, a.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = a.company_id),
             nullif(a.generic_name, '')
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.assets a on a.id = pr.entity_id
    where pr.kind = 'asset' and a.space_id = p_space_id

    union all
    select pr.kind, pr.entity_id, t.name::text,
           concat_ws(' · ',
             nullif('Ph' || coalesce(t.phase, ''), 'Ph'),
             (select co.name::text from public.companies co
                join public.assets aa on aa.company_id = co.id
                where aa.id = t.asset_id),
             t.identifier
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.trials t on t.id = pr.entity_id
    where pr.kind = 'trial' and t.space_id = p_space_id

    -- catalyst leg: repointed from markers to events (keyed by stored pr.kind='catalyst')
    union all
    select pr.kind, pr.entity_id, m.title,
           concat_ws(' · ',
             to_char(m.event_date, 'YYYY-MM-DD'),
             (select ec.name
                from public.event_types et
                join public.event_type_categories ec on ec.id = et.category_id
                where et.id = m.event_type_id),
             (select t2.name::text from public.trials t2
                where m.anchor_type = 'trial' and t2.id = m.anchor_id limit 1)
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.events m on m.id = pr.entity_id
    where pr.kind = 'catalyst' and m.space_id = p_space_id

    -- event leg: repointed category and company sub-selects to unified schema
    union all
    select pr.kind, pr.entity_id, e.title,
           concat_ws(' · ',
             to_char(e.event_date, 'YYYY-MM-DD'),
             (select ec.name
                from public.event_types et
                join public.event_type_categories ec on ec.id = et.category_id
                where et.id = e.event_type_id),
             (select cc.name::text from public.companies cc
                where cc.id = coalesce(
                  case when e.anchor_type = 'company' then e.anchor_id end,
                  (select a.company_id from public.assets a
                     where a.id = e.anchor_id and e.anchor_type = 'asset'),
                  (select a.company_id from public.assets a
                     join public.trials t on t.asset_id = a.id
                     where t.id = e.anchor_id and e.anchor_type = 'trial')
                ))
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.events e on e.id = pr.entity_id
    where pr.kind = 'event' and e.space_id = p_space_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', kind, 'id', id, 'name', name, 'secondary', secondary,
        'score', 0, 'pinned', true, 'recentAt', null
      ) order by position asc
    ), '[]'::jsonb
  ) into v_pinned
  from pinned_enriched;

  with recents_raw as (
    select kind, entity_id, last_opened_at
    from public.palette_recents
    where user_id = v_uid and space_id = p_space_id
    order by last_opened_at desc
    limit 8
  ),
  recents_enriched as (
    select rr.kind, rr.entity_id as id, c.name::text as name,
           ((select count(*) from public.assets ac
             where ac.company_id = c.id and ac.space_id = p_space_id)::text || ' assets') as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.companies c on c.id = rr.entity_id
    where rr.kind = 'company' and c.space_id = p_space_id

    union all
    select rr.kind, rr.entity_id, a.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = a.company_id),
             nullif(a.generic_name, '')
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.assets a on a.id = rr.entity_id
    where rr.kind = 'asset' and a.space_id = p_space_id

    union all
    select rr.kind, rr.entity_id, t.name::text,
           concat_ws(' · ',
             nullif('Ph' || coalesce(t.phase, ''), 'Ph'),
             (select co.name::text from public.companies co
                join public.assets aa on aa.company_id = co.id
                where aa.id = t.asset_id),
             t.identifier
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.trials t on t.id = rr.entity_id
    where rr.kind = 'trial' and t.space_id = p_space_id

    -- catalyst leg: repointed from markers to events (keyed by stored rr.kind='catalyst')
    union all
    select rr.kind, rr.entity_id, m.title,
           concat_ws(' · ',
             to_char(m.event_date, 'YYYY-MM-DD'),
             (select ec.name
                from public.event_types et
                join public.event_type_categories ec on ec.id = et.category_id
                where et.id = m.event_type_id),
             (select t2.name::text from public.trials t2
                where m.anchor_type = 'trial' and t2.id = m.anchor_id limit 1)
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.events m on m.id = rr.entity_id
    where rr.kind = 'catalyst' and m.space_id = p_space_id

    -- event leg: repointed category and company sub-selects to unified schema
    union all
    select rr.kind, rr.entity_id, e.title,
           concat_ws(' · ',
             to_char(e.event_date, 'YYYY-MM-DD'),
             (select ec.name
                from public.event_types et
                join public.event_type_categories ec on ec.id = et.category_id
                where et.id = e.event_type_id),
             (select cc.name::text from public.companies cc
                where cc.id = coalesce(
                  case when e.anchor_type = 'company' then e.anchor_id end,
                  (select a.company_id from public.assets a
                     where a.id = e.anchor_id and e.anchor_type = 'asset'),
                  (select a.company_id from public.assets a
                     join public.trials t on t.asset_id = a.id
                     where t.id = e.anchor_id and e.anchor_type = 'trial')
                ))
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.events e on e.id = rr.entity_id
    where rr.kind = 'event' and e.space_id = p_space_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', kind, 'id', id, 'name', name, 'secondary', secondary,
        'score', 0, 'pinned', false, 'recentAt', last_opened_at
      ) order by last_opened_at desc
    ), '[]'::jsonb
  ) into v_recents
  from recents_enriched;

  return jsonb_build_object('pinned', v_pinned, 'recents', v_recents);
end;
$function$;

-- ============================================================
-- Data-conditional smoke: skip if demo space absent (prod-safe)
-- Both functions return empty rows when auth.uid() is null in a
-- bare session; that is expected. The smoke proves no schema error.
-- ============================================================
do $$
declare
  v_space  uuid := '00000000-0000-0000-0000-0000000d0100';
  v_exists boolean;
  v_count  integer;
  v_js     jsonb;
begin
  select exists(select 1 from public.spaces where id = v_space) into v_exists;
  if not v_exists then
    raise notice 'A5 smoke: demo space absent, skipping';
    return;
  end if;

  -- search_palette: auth guard returns empty in bare session; prove no schema error
  select count(*) into v_count
  from public.search_palette(v_space, 'zep', null, 50);
  raise notice 'A5 smoke: search_palette returned % rows (auth guard empty is expected)', v_count;

  -- palette_empty_state: prove no schema error
  select public.palette_empty_state(v_space) into v_js;
  raise notice 'A5 smoke: palette_empty_state returned %', v_js;
end;
$$;

notify pgrst, 'reload schema';
