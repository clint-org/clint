-- migration: 20260612190000_fix_search_palette_phase_label
-- purpose: fix the trial phase label in command palette results, which
--   rendered as "PhPhase 3" (UI review 2026-06-12, item 25).
--
-- root cause:
--   20260501120100 built the trial secondary line with
--     nullif('Ph' || coalesce(t.phase, ''), 'Ph')
--   assuming t.phase holds a bare number ("3"). CT.gov sync stores full
--   labels ("Phase 3"), so the prefix doubled: "PhPhase 3".
--
-- fix: derive the label from phase_type (the canonical enum the rest of the
--   UI renders) and fall back to a cleaned t.phase string. Strips any
--   existing Ph/Phase prefix before re-prefixing; values without a digit
--   (e.g. "Not Applicable") pass through without a prefix. Everything else
--   in the function body is unchanged from 20260605120000.

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
set search_path = ''
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

    union all
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
           extensions.similarity(m.title, v_q)
             + case when m.title ilike v_q || '%' then 0.3 else 0 end as score
    from public.markers m
    where m.space_id = p_space_id
      and (p_kind is null or p_kind = 'catalyst')
      and m.title operator(extensions.%) v_q

    union all
    select 'event'::text,
           e.id,
           e.title,
           concat_ws(' · ',
             to_char(e.event_date, 'YYYY-MM-DD'),
             (select ec.name from public.event_categories ec where ec.id = e.category_id),
             (select cc.name::text from public.companies cc where cc.id = e.company_id)
           ) as secondary,
           extensions.similarity(e.title, v_q)
             + case when e.title ilike v_q || '%' then 0.3 else 0 end as score
    from public.events e
    where e.space_id = p_space_id
      and (p_kind is null or p_kind = 'event')
      and e.title operator(extensions.%) v_q
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

notify pgrst, 'reload schema';
