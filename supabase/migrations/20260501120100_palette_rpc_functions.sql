-- migration: 20260501120100_palette_rpc_functions
-- purpose: command palette search and pinned/recents management RPCs

-- ============================================================
-- search_palette - ranked union across entity types, RLS-aware
-- ============================================================
create or replace function public.search_palette (
  p_space_id uuid,
  p_query    text,
  p_kind     text default null,
  p_limit    int  default 25
) returns table (
  kind        text,
  id          uuid,
  name        text,
  secondary   text,
  score       real,
  pinned      boolean,
  recent_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_q   text := lower(coalesce(trim(p_query), ''));
begin
  if v_uid is null then return; end if;
  if not public.has_space_access(p_space_id) then return; end if;
  if length(v_q) < 2 then return; end if;

  return query
  with matches as (
    -- companies
    select 'company'::text as kind,
           c.id,
           c.name::text as name,
           ((select count(*) from public.products pc
             where pc.company_id = c.id and pc.space_id = p_space_id)::text || ' products') as secondary,
           similarity(c.name, v_q)
             + case when c.name ilike v_q || '%' then 0.3 else 0 end as score
    from public.companies c
    where c.space_id = p_space_id
      and (p_kind is null or p_kind = 'company')
      and c.name % v_q

    union all
    -- products
    select 'product'::text,
           p.id,
           p.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = p.company_id),
             nullif(p.generic_name, '')
           ) as secondary,
           greatest(similarity(p.name, v_q), similarity(coalesce(p.generic_name,''), v_q))
             + case when p.name ilike v_q || '%' or coalesce(p.generic_name,'') ilike v_q || '%' then 0.3 else 0 end as score
    from public.products p
    where p.space_id = p_space_id
      and (p_kind is null or p_kind = 'product')
      and (p.name % v_q or coalesce(p.generic_name,'') % v_q)

    union all
    -- trials (search name + identifier, with identifier exact match boost)
    select 'trial'::text,
           t.id,
           t.name::text,
           concat_ws(' · ',
             nullif('Ph' || coalesce(t.phase, ''), 'Ph'),
             t.conditions[1],
             (select co.name::text from public.companies co
                join public.products pp on pp.company_id = co.id
                where pp.id = t.product_id),
             t.identifier
           ) as secondary,
           greatest(similarity(t.name, v_q), similarity(coalesce(t.identifier,''), v_q))
             + case when t.name ilike v_q || '%' then 0.3 else 0 end
             + case when upper(coalesce(t.identifier,'')) = upper(v_q) then 0.5 else 0 end as score
    from public.trials t
    where t.space_id = p_space_id
      and (p_kind is null or p_kind = 'trial')
      and (t.name % v_q or coalesce(t.identifier,'') % v_q)

    union all
    -- catalysts (= markers with optional linked trial)
    select 'catalyst'::text,
           m.id,
           m.title,
           concat_ws(' · ',
             to_char(m.event_date, 'YYYY-MM-DD'),
             (select mc.name from public.marker_types mt
                join public.marker_categories mc on mc.id = mt.category_id
                where mt.id = m.marker_type_id),
             (select t2.name::text from public.trials t2
                join public.marker_assignments ma on ma.trial_id = t2.id
                where ma.marker_id = m.id limit 1)
           ) as secondary,
           similarity(m.title, v_q)
             + case when m.title ilike v_q || '%' then 0.3 else 0 end as score
    from public.markers m
    where m.space_id = p_space_id
      and (p_kind is null or p_kind = 'catalyst')
      and m.title % v_q

    union all
    -- events
    select 'event'::text,
           e.id,
           e.title,
           concat_ws(' · ',
             to_char(e.event_date, 'YYYY-MM-DD'),
             (select ec.name from public.event_categories ec where ec.id = e.category_id),
             (select cc.name::text from public.companies cc where cc.id = e.company_id)
           ) as secondary,
           similarity(e.title, v_q)
             + case when e.title ilike v_q || '%' then 0.3 else 0 end as score
    from public.events e
    where e.space_id = p_space_id
      and (p_kind is null or p_kind = 'event')
      and e.title % v_q
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
$$;

grant execute on function public.search_palette(uuid, text, text, int) to authenticated;

-- ============================================================
-- palette_empty_state - returns pinned and recents for the empty state
-- ============================================================
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
  if v_uid is null then return jsonb_build_object('pinned','[]'::jsonb,'recents','[]'::jsonb); end if;
  if not public.has_space_access(p_space_id) then
    return jsonb_build_object('pinned','[]'::jsonb,'recents','[]'::jsonb);
  end if;

  with pinned_ids as (
    select kind, entity_id, position
    from public.palette_pinned
    where user_id = v_uid and space_id = p_space_id
    order by position asc
    limit 10
  )
  select coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb) into v_pinned from pinned_ids p;

  with recent_ids as (
    select kind, entity_id, last_opened_at
    from public.palette_recents
    where user_id = v_uid and space_id = p_space_id
    order by last_opened_at desc
    limit 8
  )
  select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) into v_recents from recent_ids r;

  return jsonb_build_object('pinned', v_pinned, 'recents', v_recents);
end;
$$;

grant execute on function public.palette_empty_state(uuid) to authenticated;

-- ============================================================
-- palette_touch_recent - upserts a recent open and trims to last 25
-- ============================================================
create or replace function public.palette_touch_recent (
  p_space_id  uuid,
  p_kind      text,
  p_entity_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if not public.has_space_access(p_space_id) then return; end if;
  if p_kind not in ('company','product','trial','catalyst','event') then
    raise exception 'invalid kind %', p_kind;
  end if;

  insert into public.palette_recents(user_id, space_id, kind, entity_id, last_opened_at)
  values (v_uid, p_space_id, p_kind, p_entity_id, now())
  on conflict (user_id, space_id, kind, entity_id)
  do update set last_opened_at = excluded.last_opened_at;

  delete from public.palette_recents r
  where r.user_id = v_uid
    and r.space_id = p_space_id
    and (r.kind, r.entity_id) not in (
      select kind, entity_id
      from public.palette_recents
      where user_id = v_uid and space_id = p_space_id
      order by last_opened_at desc
      limit 25
    );
end;
$$;

grant execute on function public.palette_touch_recent(uuid, text, uuid) to authenticated;
