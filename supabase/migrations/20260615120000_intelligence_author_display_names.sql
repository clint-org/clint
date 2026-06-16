-- migration: 20260615120000_intelligence_author_display_names
-- purpose: surface human author display names in the intelligence payloads so
--   the UI stops rendering UUID-prefix initials ("00"/"31") on the contributors
--   line and version history. (Persona fix P1.2.)
--
-- Two SECURITY DEFINER read RPCs (build_intelligence_payload,
-- get_primary_intelligence_history) return raw auth.users UUIDs in their
-- contributors / last_edited_by / published_by / withdrawn_by / events.by
-- fields. The client has no UUID->name join, so it fell back to the first two
-- characters of the UUID. We add an internal SECURITY DEFINER resolver that
-- maps a set of ids to display names (full_name -> email, mirroring the
-- member-view RPCs) and thread an `authors` map into both payloads.
--
-- affected objects:
--   public.resolve_user_display_names           (NEW internal helper)
--   public.build_intelligence_payload           (extended -- adds `authors`)
--   public.get_primary_intelligence_history     (extended -- adds `authors`)

-- =============================================================================
-- 1. Internal resolver: {uuid_text: display_name} for a set of user ids.
--    Mirrors the display_name expression used by the member-view RPCs
--    (coalesce(full_name, email)). Internal-only: called from the SECURITY
--    DEFINER intelligence RPCs, never granted to client roles.
-- =============================================================================

create or replace function public.resolve_user_display_names(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(
      u.id::text,
      coalesce(
        nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(trim(u.raw_user_meta_data->>'name'), ''),
        u.email,
        '(unknown)'
      )
    ),
    '{}'::jsonb
  )
  from auth.users u
  where p_ids is not null
    and u.id = any(p_ids);
$$;

comment on function public.resolve_user_display_names(uuid[]) is
  'Internal helper: maps a set of auth.users ids to a {id: display_name} jsonb '
  'object (full_name -> name -> email). SECURITY DEFINER so it can read '
  'auth.users; revoked from all client roles -- only the intelligence read RPCs '
  'call it, and they gate access first.';

revoke execute on function public.resolve_user_display_names(uuid[])
  from anon, authenticated, public;

-- =============================================================================
-- 2. build_intelligence_payload: add `authors` map covering contributors
--    (which already aggregates last_edited_by across the entity's rows, so
--    record.last_edited_by is included).
-- =============================================================================

create or replace function public.build_intelligence_payload(
  p_space_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_state text,
  p_revision_limit integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_can_read boolean;
begin
  -- Mirror the primary_intelligence read policies. Without this gate the
  -- function would widen access (security definer bypasses RLS).
  v_can_read := public.is_agency_member_of_space(p_space_id)
                or (p_state in ('published','archived','withdrawn')
                    and public.has_space_access(p_space_id));
  if not v_can_read then
    return null;
  end if;

  return (
    with row as (
      select * from public.primary_intelligence p
       where p.space_id    = p_space_id
         and p.entity_type = p_entity_type
         and p.entity_id   = p_entity_id
         and p.state       = p_state
       limit 1
    ),
    links_resolved as (
      select l.*,
             case l.entity_type
               when 'trial'   then (select t.name from public.trials t where t.id = l.entity_id)
               when 'marker'  then (select m.title from public.markers m where m.id = l.entity_id)
               when 'company' then (select c.name from public.companies c where c.id = l.entity_id)
               when 'asset'   then (select a.name from public.assets a where a.id = l.entity_id)
               when 'product' then (select a.name from public.assets a where a.id = l.entity_id)
             end as entity_name
        from public.primary_intelligence_links l
       where l.primary_intelligence_id = (select id from row)
    ),
    contributors as (
      select array_agg(distinct last_edited_by) as ids
        from public.primary_intelligence
       where space_id    = p_space_id
         and entity_type = p_entity_type
         and entity_id   = p_entity_id
    )
    select case
      when not exists (select 1 from row) then null
      else jsonb_build_object(
        'record', (select to_jsonb(r) from row r),
        'links', coalesce(
          (select jsonb_agg(
            jsonb_build_object(
              'id',               l.id,
              'entity_type',      l.entity_type,
              'entity_id',        l.entity_id,
              'entity_name',      l.entity_name,
              'relationship_type', l.relationship_type,
              'gloss',            l.gloss,
              'display_order',    l.display_order
            )
            order by l.display_order asc, l.relationship_type asc
          ) from links_resolved l),
          '[]'::jsonb
        ),
        'contributors', coalesce(
          (select to_jsonb(ids) from contributors),
          '[]'::jsonb
        ),
        'authors', public.resolve_user_display_names((select ids from contributors))
      )
    end
  );
end;
$function$;

-- =============================================================================
-- 3. get_primary_intelligence_history: add `authors` map covering every actor
--    referenced by events / versions / current / draft.
-- =============================================================================

create or replace function public.get_primary_intelligence_history(
  p_space_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_can_read boolean;
begin
  v_can_read := public.is_agency_member_of_space(p_space_id)
                or public.has_space_access(p_space_id);
  if not v_can_read then
    return null;
  end if;

  return (
    with rows as (
      select * from public.primary_intelligence p
       where p.space_id    = p_space_id
         and p.entity_type = p_entity_type
         and p.entity_id   = p_entity_id
    ),
    current_row as (
      select * from rows where state = 'published' limit 1
    ),
    draft_row as (
      select * from rows where state = 'draft' order by updated_at desc limit 1
    ),
    versions as (
      select * from rows where state in ('published','archived','withdrawn')
    ),
    versions_with_base as (
      select v.*,
             (
               select v2.id
                 from versions v2
                where v2.version_number < v.version_number
                  and v2.published_at is not null
                  and v2.withdrawn_at is null
                order by v2.version_number desc
                limit 1
             ) as diff_base_id
        from versions v
    ),
    version_links as (
      select
        l.primary_intelligence_id as row_id,
        jsonb_agg(
          jsonb_build_object(
            'entity_type',       l.entity_type,
            'entity_id',         l.entity_id,
            'entity_name', case l.entity_type
              when 'trial'   then (select tr.name  from public.trials    tr where tr.id = l.entity_id)
              when 'marker'  then (select mk.title from public.markers   mk where mk.id = l.entity_id)
              when 'company' then (select co.name  from public.companies co where co.id = l.entity_id)
              when 'asset'   then (select a.name   from public.assets    a  where a.id  = l.entity_id)
              when 'product' then (select a.name   from public.assets    a  where a.id  = l.entity_id)
              else null
            end,
            'relationship_type', l.relationship_type,
            'gloss',             l.gloss,
            'display_order',     l.display_order
          )
          order by l.display_order, l.created_at
        ) as links
      from public.primary_intelligence_links l
      join versions_with_base v on v.id = l.primary_intelligence_id
      group by l.primary_intelligence_id
    ),
    events as (
      select created_at as at, 'draft_started'::text as kind, id as row_id,
             null::int as version_number, last_edited_by as by, null::text as note
        from rows
      union all
      select published_at, 'published', id, version_number, published_by, publish_note
        from rows where published_at is not null
      union all
      select archived_at, 'archived', id, version_number, null, null
        from rows where archived_at is not null
      union all
      select withdrawn_at, 'withdrawn', id, version_number, withdrawn_by, withdraw_note
        from rows where withdrawn_at is not null
    ),
    author_ids as (
      select array_agg(distinct id) as ids
        from (
          select by as id from events where by is not null
          union
          select last_edited_by from rows where last_edited_by is not null
        ) s
    )
    select jsonb_build_object(
      'current', (select to_jsonb(c) from current_row c),
      'draft',   (select to_jsonb(d) from draft_row d),
      'versions', coalesce(
        (select jsonb_agg(
          jsonb_build_object(
            'id',              v.id,
            'version_number',  v.version_number,
            'state',           v.state,
            'headline',        v.headline,
            'summary_md',      v.summary_md,
            'implications_md', v.implications_md,
            'publish_note',    v.publish_note,
            'published_at',    v.published_at,
            'published_by',    v.published_by,
            'archived_at',     v.archived_at,
            'withdrawn_at',    v.withdrawn_at,
            'withdrawn_by',    v.withdrawn_by,
            'withdraw_note',   v.withdraw_note,
            'diff_base_id',    v.diff_base_id,
            'links',           coalesce(vl.links, '[]'::jsonb)
          )
          order by v.version_number desc
        )
          from versions_with_base v
          left join version_links vl on vl.row_id = v.id
        ),
        '[]'::jsonb
      ),
      'events', coalesce(
        (select jsonb_agg(
          jsonb_build_object(
            'at',             e.at,
            'kind',           e.kind,
            'row_id',         e.row_id,
            'version_number', e.version_number,
            'by',             e.by,
            'note',           e.note
          )
          order by
            e.at asc,
            case e.kind
              when 'draft_started' then 0
              when 'published'     then 1
              when 'archived'      then 2
              when 'withdrawn'     then 3
            end
        ) from events e),
        '[]'::jsonb
      ),
      'authors', public.resolve_user_display_names((select ids from author_ids))
    )
  );
end;
$function$;

notify pgrst, 'reload schema';
