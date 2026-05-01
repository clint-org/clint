-- migration: 20260501130000_palette_empty_state_enrich
-- purpose: palette_empty_state must return name + secondary for each row,
--          joined from the underlying entity table per kind. The original
--          RPC only emitted kind + entity_id, so the palette empty state
--          showed empty rows.

create or replace function public.palette_empty_state (
  p_space_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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

  -- ============================================================
  -- pinned: enriched rows (top 10 by position)
  -- ============================================================
  with pinned_raw as (
    select kind, entity_id, position
    from public.palette_pinned
    where user_id = v_uid and space_id = p_space_id
    order by position asc
    limit 10
  ),
  pinned_enriched as (
    -- companies
    select pr.kind, pr.entity_id as id,
           c.name::text as name,
           ((select count(*) from public.products pc
             where pc.company_id = c.id and pc.space_id = p_space_id)::text || ' products') as secondary,
           pr.position
    from pinned_raw pr
    join public.companies c on c.id = pr.entity_id
    where pr.kind = 'company' and c.space_id = p_space_id

    union all
    -- products
    select pr.kind, pr.entity_id, p.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = p.company_id),
             nullif(p.generic_name, '')
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.products p on p.id = pr.entity_id
    where pr.kind = 'product' and p.space_id = p_space_id

    union all
    -- trials
    select pr.kind, pr.entity_id, t.name::text,
           concat_ws(' · ',
             nullif('Ph' || coalesce(t.phase, ''), 'Ph'),
             t.conditions[1],
             (select co.name::text from public.companies co
                join public.products pp on pp.company_id = co.id
                where pp.id = t.product_id),
             t.identifier
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.trials t on t.id = pr.entity_id
    where pr.kind = 'trial' and t.space_id = p_space_id

    union all
    -- catalysts (markers)
    select pr.kind, pr.entity_id, m.title,
           concat_ws(' · ',
             to_char(m.event_date, 'YYYY-MM-DD'),
             (select mc.name from public.marker_types mt
                join public.marker_categories mc on mc.id = mt.category_id
                where mt.id = m.marker_type_id),
             (select t2.name::text from public.trials t2
                join public.marker_assignments ma on ma.trial_id = t2.id
                where ma.marker_id = m.id limit 1)
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.markers m on m.id = pr.entity_id
    where pr.kind = 'catalyst' and m.space_id = p_space_id

    union all
    -- events
    select pr.kind, pr.entity_id, e.title,
           concat_ws(' · ',
             to_char(e.event_date, 'YYYY-MM-DD'),
             (select ec.name from public.event_categories ec where ec.id = e.category_id),
             (select cc.name::text from public.companies cc where cc.id = e.company_id)
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.events e on e.id = pr.entity_id
    where pr.kind = 'event' and e.space_id = p_space_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind',      kind,
        'id',        id,
        'name',      name,
        'secondary', secondary,
        'score',     0,
        'pinned',    true,
        'recentAt',  null
      ) order by position asc
    ),
    '[]'::jsonb
  ) into v_pinned
  from pinned_enriched;

  -- ============================================================
  -- recents: enriched rows (top 8 by last_opened_at desc)
  -- ============================================================
  with recents_raw as (
    select kind, entity_id, last_opened_at
    from public.palette_recents
    where user_id = v_uid and space_id = p_space_id
    order by last_opened_at desc
    limit 8
  ),
  recents_enriched as (
    select rr.kind, rr.entity_id as id, c.name::text as name,
           ((select count(*) from public.products pc
             where pc.company_id = c.id and pc.space_id = p_space_id)::text || ' products') as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.companies c on c.id = rr.entity_id
    where rr.kind = 'company' and c.space_id = p_space_id

    union all
    select rr.kind, rr.entity_id, p.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = p.company_id),
             nullif(p.generic_name, '')
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.products p on p.id = rr.entity_id
    where rr.kind = 'product' and p.space_id = p_space_id

    union all
    select rr.kind, rr.entity_id, t.name::text,
           concat_ws(' · ',
             nullif('Ph' || coalesce(t.phase, ''), 'Ph'),
             t.conditions[1],
             (select co.name::text from public.companies co
                join public.products pp on pp.company_id = co.id
                where pp.id = t.product_id),
             t.identifier
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.trials t on t.id = rr.entity_id
    where rr.kind = 'trial' and t.space_id = p_space_id

    union all
    select rr.kind, rr.entity_id, m.title,
           concat_ws(' · ',
             to_char(m.event_date, 'YYYY-MM-DD'),
             (select mc.name from public.marker_types mt
                join public.marker_categories mc on mc.id = mt.category_id
                where mt.id = m.marker_type_id),
             (select t2.name::text from public.trials t2
                join public.marker_assignments ma on ma.trial_id = t2.id
                where ma.marker_id = m.id limit 1)
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.markers m on m.id = rr.entity_id
    where rr.kind = 'catalyst' and m.space_id = p_space_id

    union all
    select rr.kind, rr.entity_id, e.title,
           concat_ws(' · ',
             to_char(e.event_date, 'YYYY-MM-DD'),
             (select ec.name from public.event_categories ec where ec.id = e.category_id),
             (select cc.name::text from public.companies cc where cc.id = e.company_id)
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.events e on e.id = rr.entity_id
    where rr.kind = 'event' and e.space_id = p_space_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind',      kind,
        'id',        id,
        'name',      name,
        'secondary', secondary,
        'score',     0,
        'pinned',    false,
        'recentAt',  last_opened_at
      ) order by last_opened_at desc
    ),
    '[]'::jsonb
  ) into v_recents
  from recents_enriched;

  return jsonb_build_object('pinned', v_pinned, 'recents', v_recents);
end;
$$;
