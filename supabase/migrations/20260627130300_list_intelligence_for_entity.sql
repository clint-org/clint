-- migration: 20260627130300_list_intelligence_for_entity
-- purpose: add list_intelligence_for_entity (brief-drawer source) and its
--   per-row payload helper build_intelligence_payload_for_row.
--
-- build_intelligence_payload_for_row(p_row_id) returns the full payload shape
--   {record, links, contributors} for a single primary_intelligence row. SECURITY
--   INVOKER so RLS gates which rows and links the caller can read. Entity-name
--   resolution works for space members via RLS; agency-only users (no
--   space_members row) will see null entity_name on links -- a pre-existing
--   limitation that Task 5 will address via SECURITY DEFINER detail RPCs.
--
-- list_intelligence_for_entity(p_space_id, p_entity_type, p_entity_id) returns
--   a jsonb array ordered lead-first, then display_order, then created_at. Each
--   element carries {anchor_id, is_lead, display_order, published, draft,
--   updated_at, version_count}. SECURITY INVOKER: the RLS policy on
--   primary_intelligence_anchors hides draft-only anchors from space members
--   (non-agency), so viewers naturally see only published-bearing anchors.
--
-- callers of the old build_intelligence_payload(uuid,text,uuid,text,int):
--   20260501113858_primary_intelligence_rpcs.sql (get_trial_detail_with_intelligence,
--   get_marker_detail_with_intelligence, get_company_detail_with_intelligence,
--   get_product_detail_with_intelligence, get_space_intelligence) and
--   20260524121000_fix_remaining_product_refs.sql (get_asset_detail_with_intelligence).
--   All six are the detail-bundle RPCs that Task 5 will rewrite. No other callers
--   exist. The old function is left unchanged; Task 5 stops calling it.
--
-- not tier-1: no @audit:tier1 marker.

-- =============================================================================
-- 1. Per-row payload builder
-- =============================================================================

create or replace function public.build_intelligence_payload_for_row(p_row_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'record', to_jsonb(pi),
    'links', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id',                l.id,
            'entity_type',       l.entity_type,
            'entity_id',         l.entity_id,
            'entity_name',       case l.entity_type
              when 'trial'   then (select t.name  from public.trials   t where t.id = l.entity_id)
              when 'marker'  then (select m.title from public.markers  m where m.id = l.entity_id)
              when 'company' then (select c.name  from public.companies c where c.id = l.entity_id)
              when 'asset'   then (select a.name  from public.assets   a where a.id = l.entity_id)
              when 'product' then (select a.name  from public.assets   a where a.id = l.entity_id)
              else null
            end,
            'relationship_type', l.relationship_type,
            'gloss',             l.gloss,
            'display_order',     l.display_order
          )
          order by l.display_order asc, l.relationship_type asc
        )
        from public.primary_intelligence_links l
        where l.primary_intelligence_id = p_row_id
      ),
      '[]'::jsonb
    ),
    'contributors', coalesce(
      (
        select to_jsonb(array_agg(distinct c.last_edited_by))
        from public.primary_intelligence c
        where c.anchor_id = pi.anchor_id
      ),
      '[]'::jsonb
    )
  )
  from public.primary_intelligence pi
  where pi.id = p_row_id;
$$;

comment on function public.build_intelligence_payload_for_row(uuid) is
  'Returns {record, links(with entity_name), contributors} for a single '
  'primary_intelligence row. SECURITY INVOKER: callers only see what RLS '
  'allows. Entity names resolve for space members; agency-only users see '
  'null entity_name (no space_members row to satisfy table RLS). Task 5 '
  'detail RPCs address agency entity-name resolution with SECURITY DEFINER.';

revoke execute on function public.build_intelligence_payload_for_row(uuid) from public, anon;
grant  execute on function public.build_intelligence_payload_for_row(uuid) to authenticated;

-- =============================================================================
-- 2. Ordered brief list for one entity
-- =============================================================================

create or replace function public.list_intelligence_for_entity(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid
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
        'anchor_id',     a.id,
        'is_lead',       a.is_lead,
        'display_order', a.display_order,
        'published', (
          select public.build_intelligence_payload_for_row(p.id)
          from public.primary_intelligence p
          where p.anchor_id = a.id and p.state = 'published'
          limit 1
        ),
        'draft', (
          select public.build_intelligence_payload_for_row(p.id)
          from public.primary_intelligence p
          where p.anchor_id = a.id and p.state = 'draft'
          order by p.updated_at desc
          limit 1
        ),
        'updated_at', (
          select max(p.updated_at)
          from public.primary_intelligence p
          where p.anchor_id = a.id
        ),
        'version_count', (
          select count(*)
          from public.primary_intelligence p
          where p.anchor_id = a.id
            and p.state in ('published', 'archived', 'withdrawn')
        )
      )
      order by a.is_lead desc, a.display_order asc, a.created_at asc
    ),
    '[]'::jsonb
  )
  from public.primary_intelligence_anchors a
  where a.space_id    = p_space_id
    and a.entity_type = p_entity_type
    and a.entity_id   = p_entity_id
    and (
      public.is_agency_member_of_space(p_space_id)
      or exists (
        select 1 from public.primary_intelligence p
        where p.anchor_id = a.id and p.state = 'published'
      )
    );
$$;

comment on function public.list_intelligence_for_entity(uuid, text, uuid) is
  'Returns a jsonb array of briefs for one entity, ordered lead-first then '
  'by display_order. Each element: {anchor_id, is_lead, display_order, '
  'published, draft, updated_at, version_count}. published/draft are full '
  'payload objects from build_intelligence_payload_for_row or null. '
  'SECURITY INVOKER: anchor RLS hides draft-only anchors from non-agency '
  'callers; the agency-or-has-published predicate mirrors that policy so '
  'agency members see draft-only anchors regardless of space_members status.';

revoke execute on function public.list_intelligence_for_entity(uuid, text, uuid) from public, anon;
grant  execute on function public.list_intelligence_for_entity(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
