-- migration: 20260525140000_get_intelligence_notes_for_asset
-- purpose: lightweight RPC returning published intelligence notes for an
--          asset and its trials. used by the bullseye detail panel to show
--          clickable note rows instead of just a count.

create or replace function public.get_intelligence_notes_for_asset(
  p_space_id uuid,
  p_asset_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',          pi.id,
        'entity_type', pi.entity_type,
        'entity_id',   pi.entity_id,
        'entity_name', case pi.entity_type
          when 'product' then (
            select a.name
            from public.assets a
            where a.id = pi.entity_id
          )
          when 'trial' then (
            select t.name
            from public.trials t
            where t.id = pi.entity_id
          )
        end,
        'headline',    pi.headline,
        'updated_at',  pi.updated_at
      )
      order by pi.updated_at desc
    ),
    '[]'::jsonb
  )
  from public.primary_intelligence pi
  where pi.space_id = p_space_id
    and pi.state = 'published'
    and (
      (pi.entity_type = 'product' and pi.entity_id = p_asset_id)
      or
      (pi.entity_type = 'trial' and pi.entity_id in (
        select t.id
        from public.trials t
        where t.asset_id = p_asset_id
          and t.space_id = p_space_id
      ))
    );
$$;

comment on function public.get_intelligence_notes_for_asset(uuid, uuid) is
  'Returns published intelligence notes for an asset and its trials. '
  'Lightweight projection (id, headline, entity context, updated_at) '
  'for the bullseye detail panel.';
