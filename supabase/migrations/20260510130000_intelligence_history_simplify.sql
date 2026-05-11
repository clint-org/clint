-- migration: 20260510130000_intelligence_history_simplify
-- purpose: replace the snapshot-revisions audit log with a column-based
--   event model on primary_intelligence. Adds publish_note,
--   published_by, archived_at, withdraw_note; backfills from the
--   revisions table; drops the revisions table, its trigger, and the
--   get_intelligence_version_revisions RPC; rewrites
--   upsert_primary_intelligence, withdraw_primary_intelligence,
--   get_primary_intelligence_history, build_intelligence_payload to
--   the new contract.

-- =============================================================================
-- 1. add columns
-- =============================================================================

alter table public.primary_intelligence
  add column if not exists publish_note  text,
  add column if not exists published_by  uuid references auth.users (id),
  add column if not exists archived_at   timestamptz,
  add column if not exists withdraw_note text;

comment on column public.primary_intelligence.publish_note is
  'Change note typed at publish time. Stored on the row that transitioned into state=published. Never written by archive or withdraw flows. Null for drafts and for the first publish on a brand-new anchor.';

comment on column public.primary_intelligence.published_by is
  'auth.users id of the agency member who published this version. Null for drafts. Persists through archive/withdraw transitions.';

comment on column public.primary_intelligence.archived_at is
  'Timestamp of the published -> archived transition. Set when a newer version publishes over this one. Null otherwise.';

comment on column public.primary_intelligence.withdraw_note is
  'Change note typed at withdraw time. Stored on the row that transitioned from published to withdrawn. Distinct from publish_note so a withdrawn version retains both.';

-- =============================================================================
-- 2. backfill from primary_intelligence_revisions
-- =============================================================================

update public.primary_intelligence p
   set publish_note  = r.change_note,
       published_by  = r.edited_by
  from (
    select distinct on (primary_intelligence_id)
           primary_intelligence_id,
           change_note,
           edited_by
      from public.primary_intelligence_revisions
     where state = 'published'
     order by primary_intelligence_id, edited_at asc
  ) r
 where r.primary_intelligence_id = p.id;

update public.primary_intelligence p
   set withdraw_note = r.change_note
  from (
    select distinct on (primary_intelligence_id)
           primary_intelligence_id,
           change_note
      from public.primary_intelligence_revisions
     where state = 'withdrawn'
     order by primary_intelligence_id, edited_at desc
  ) r
 where r.primary_intelligence_id = p.id
   and p.state = 'withdrawn';

-- Pair archived_at to the next version's published_at where possible so the
-- frontend timeline can fold the archive event under its causing publish.
update public.primary_intelligence p
   set archived_at = coalesce(
     (select min(p2.published_at)
        from public.primary_intelligence p2
       where p2.space_id    = p.space_id
         and p2.entity_type = p.entity_type
         and p2.entity_id   = p.entity_id
         and p2.version_number > p.version_number
         and p2.published_at is not null),
     (select min(r.edited_at)
        from public.primary_intelligence_revisions r
       where r.primary_intelligence_id = p.id
         and r.state = 'archived'),
     p.updated_at
   )
 where p.state = 'archived';

-- =============================================================================
-- 3. drop the snapshot log + its plumbing
-- =============================================================================

drop function if exists public.get_intelligence_version_revisions(uuid);

drop trigger if exists primary_intelligence_revision_trigger
  on public.primary_intelligence;

drop function if exists public.write_primary_intelligence_revision();

-- table drops cascade its RLS policies and indexes
drop table if exists public.primary_intelligence_revisions;

-- =============================================================================
-- 4. replace upsert_primary_intelligence (drop GUCs + changed_fields)
-- =============================================================================

create or replace function public.upsert_primary_intelligence(
  p_id              uuid,
  p_space_id        uuid,
  p_entity_type     text,
  p_entity_id       uuid,
  p_headline        text,
  p_thesis_md       text,
  p_watch_md        text,
  p_implications_md text,
  p_state           text,
  p_change_note     text,
  p_links           jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_agency_member_of_space(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_state not in ('draft', 'published') then
    raise exception 'invalid state %', p_state using errcode = '22023';
  end if;

  if p_entity_type not in ('trial', 'marker', 'company', 'product', 'space') then
    raise exception 'invalid entity_type %', p_entity_type using errcode = '22023';
  end if;

  if p_state = 'published' then
    -- enforce change_note when any prior non-draft version exists for this anchor
    if exists (
      select 1 from public.primary_intelligence
       where space_id    = p_space_id
         and entity_type = p_entity_type
         and entity_id   = p_entity_id
         and state in ('published','archived','withdrawn')
         and id is distinct from p_id
    ) and (p_change_note is null or length(trim(p_change_note)) = 0) then
      raise exception 'change_note required when republishing'
        using errcode = '22023';
    end if;

    -- archive any prior published row for this anchor.
    -- Spec: do NOT write updated_at on the archive transition -- archiving
    -- is a side effect of a sibling row publishing, not a content edit, and
    -- bumping updated_at would distort recency feeds + "latest from Stout".
    update public.primary_intelligence
       set state       = 'archived',
           archived_at = now()
     where space_id    = p_space_id
       and entity_type = p_entity_type
       and entity_id   = p_entity_id
       and state       = 'published'
       and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.primary_intelligence (
      space_id, entity_type, entity_id, state, headline,
      thesis_md, watch_md, implications_md,
      publish_note, published_by, last_edited_by
    ) values (
      p_space_id, p_entity_type, p_entity_id, p_state, p_headline,
      coalesce(p_thesis_md, ''), coalesce(p_watch_md, ''),
      coalesce(p_implications_md, ''),
      case when p_state = 'published' then nullif(trim(coalesce(p_change_note, '')), '') else null end,
      case when p_state = 'published' then auth.uid() else null end,
      auth.uid()
    )
    returning id into v_id;
  else
    update public.primary_intelligence
       set state = p_state,
           headline = p_headline,
           thesis_md = coalesce(p_thesis_md, ''),
           watch_md = coalesce(p_watch_md, ''),
           implications_md = coalesce(p_implications_md, ''),
           -- publish_note is write-once: only set on the published transition.
           -- Mirrors published_by below so a no-op republish (same row id, no
           -- change_note) doesn't clobber the note captured at first publish.
           publish_note = case
             when p_state = 'published' and publish_note is null
               then nullif(trim(coalesce(p_change_note, '')), '')
             else publish_note
           end,
           published_by = case
             when p_state = 'published' and published_by is null then auth.uid()
             else published_by
           end,
           last_edited_by = auth.uid(),
           updated_at = now()
     where id = p_id
       and space_id = p_space_id
    returning id into v_id;

    if v_id is null then
      raise exception 'primary_intelligence % not found in space %', p_id, p_space_id
        using errcode = 'P0002';
    end if;
  end if;

  delete from public.primary_intelligence_links
   where primary_intelligence_id = v_id;

  if p_links is not null and jsonb_array_length(p_links) > 0 then
    insert into public.primary_intelligence_links (
      primary_intelligence_id, entity_type, entity_id,
      relationship_type, gloss, display_order
    )
    select v_id,
           (l->>'entity_type')::text,
           (l->>'entity_id')::uuid,
           (l->>'relationship_type')::text,
           nullif(l->>'gloss', ''),
           coalesce((l->>'display_order')::int, 0)
      from jsonb_array_elements(p_links) l;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.upsert_primary_intelligence(
  uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb
) from public;
revoke execute on function public.upsert_primary_intelligence(
  uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb
) from anon;
grant execute on function public.upsert_primary_intelligence(
  uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb
) to authenticated;

-- =============================================================================
-- 5. replace withdraw_primary_intelligence (drop GUC, write withdraw_note)
-- =============================================================================

create or replace function public.withdraw_primary_intelligence(
  p_id uuid,
  p_change_note text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.primary_intelligence%rowtype;
begin
  select * into v_row from public.primary_intelligence where id = p_id;
  if v_row.id is null then
    raise exception 'primary_intelligence % not found', p_id using errcode = 'P0002';
  end if;
  if not public.is_agency_member_of_space(v_row.space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_row.state <> 'published' then
    raise exception 'only published versions can be withdrawn (state=%)', v_row.state
      using errcode = '22023';
  end if;
  if p_change_note is null or length(trim(p_change_note)) = 0 then
    raise exception 'change_note required for withdraw' using errcode = '22023';
  end if;

  update public.primary_intelligence
     set state          = 'withdrawn',
         withdrawn_at   = now(),
         withdrawn_by   = auth.uid(),
         withdraw_note  = p_change_note,
         last_edited_by = auth.uid(),
         updated_at     = now()
   where id = p_id;
end;
$$;

revoke execute on function public.withdraw_primary_intelligence(uuid, text) from public;
revoke execute on function public.withdraw_primary_intelligence(uuid, text) from anon;
grant  execute on function public.withdraw_primary_intelligence(uuid, text) to authenticated;

-- =============================================================================
-- 6. replace get_primary_intelligence_history (returns events[] + diff_base_id)
-- =============================================================================

create or replace function public.get_primary_intelligence_history(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
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
          'thesis_md',       v.thesis_md,
          'watch_md',        v.watch_md,
          'implications_md', v.implications_md,
          'publish_note',    v.publish_note,
          'published_at',    v.published_at,
          'published_by',    v.published_by,
          'archived_at',     v.archived_at,
          'withdrawn_at',    v.withdrawn_at,
          'withdrawn_by',    v.withdrawn_by,
          'withdraw_note',   v.withdraw_note,
          'diff_base_id',    v.diff_base_id
        )
        order by v.version_number desc
      ) from versions_with_base v),
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
          -- Tie-break by kind so a `published` event always precedes the
          -- `archived` event it caused at the same instant. Alphabetical
          -- ordering would put `archived` first, breaking the frontend's
          -- "archive as sub-line under its causing publish" rendering.
          case e.kind
            when 'draft_started' then 0
            when 'published'     then 1
            when 'archived'      then 2
            when 'withdrawn'     then 3
          end
      ) from events e),
      '[]'::jsonb
    )
  );
$$;

revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from public;
revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from anon;
grant  execute on function public.get_primary_intelligence_history(uuid, text, uuid) to authenticated;

-- =============================================================================
-- 7. replace build_intelligence_payload (drop recent_revisions)
-- =============================================================================
-- Preserves the existing contract for { record, links, contributors }.
-- Links carry entity_name resolved server-side per the prior migration.
-- Stays security definer (with an explicit access gate at the top) so that
-- agency-only / agency-owner authors -- who have no space_members row -- can
-- still see linked entity names. This mirrors the gate added in
-- 20260505220000_intel_payload_resolve_names_for_agency.sql; switching to
-- security invoker would re-introduce the regression that migration fixed.
-- Drop first because the parameter rename (p_revisions_limit -> p_revision_limit)
-- is not allowed by create-or-replace; the parameter is unused now anyway.

drop function if exists public.build_intelligence_payload(uuid, text, uuid, text, int);

create or replace function public.build_intelligence_payload(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_state       text,
  p_revision_limit int default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
               when 'product' then (select pr.name from public.products pr where pr.id = l.entity_id)
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
        )
      )
    end
  );
end;
$$;

comment on function public.build_intelligence_payload(uuid, text, uuid, text, int) is
  'After spec-2026-008: returns { record, links, contributors }. The record carries publish_note; the revisions log was dropped. Stays security definer to resolve entity_name for agency authors with no space_members row.';

revoke execute on function public.build_intelligence_payload(uuid, text, uuid, text, int) from public;
revoke execute on function public.build_intelligence_payload(uuid, text, uuid, text, int) from anon;
grant  execute on function public.build_intelligence_payload(uuid, text, uuid, text, int) to authenticated;

-- =============================================================================
-- 8. replace list_draft_intelligence_for_space (drop revisions join)
-- =============================================================================
-- The old body joined primary_intelligence_revisions to assemble the
-- contributors array. Post spec-2026-008 the revisions table is gone, and the
-- canonical contributor for a draft is the row's own last_edited_by. Returns
-- a single-element jsonb array so the frontend (drafts widget) keeps the
-- same shape.

create or replace function public.list_draft_intelligence_for_space(
  p_space_id uuid,
  p_limit    int default 3
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_data order by updated_at desc), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'id', p.id,
        'space_id', p.space_id,
        'entity_type', p.entity_type,
        'entity_id', p.entity_id,
        'state', p.state,
        'headline', p.headline,
        'thesis_md', p.thesis_md,
        'last_edited_by', p.last_edited_by,
        'updated_at', p.updated_at,
        'links', '[]'::jsonb,
        'contributors', case
          when p.last_edited_by is null then '[]'::jsonb
          else jsonb_build_array(p.last_edited_by)
        end
      ) as row_data,
      p.updated_at
    from public.primary_intelligence p
    where p.space_id = p_space_id
      and p.state = 'draft'
    order by p.updated_at desc
    limit p_limit
  ) ordered;
$$;

revoke execute on function public.list_draft_intelligence_for_space(uuid, int) from public;
revoke execute on function public.list_draft_intelligence_for_space(uuid, int) from anon;
grant  execute on function public.list_draft_intelligence_for_space(uuid, int) to authenticated;

comment on function public.list_draft_intelligence_for_space(uuid, int) is
  'Returns up to p_limit draft primary_intelligence rows for a space, recency-ordered. After spec-2026-008, contributors is a single-element array of the row''s last_edited_by; the snapshot revisions table is gone.';

-- =============================================================================
-- 9. replace list_primary_intelligence (drop revisions join + author filter)
-- =============================================================================
-- Same shape as before, but the contributors array and the p_author_id filter
-- now read p.last_edited_by directly instead of scanning the dropped
-- primary_intelligence_revisions table.

create or replace function public.list_primary_intelligence(
  p_space_id                  uuid,
  p_entity_types              text[]        default null,
  p_author_id                 uuid          default null,
  p_since                     timestamptz   default null,
  p_query                     text          default null,
  p_referencing_entity_type   text          default null,
  p_referencing_entity_id     uuid          default null,
  p_limit                     int           default 50,
  p_offset                    int           default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_total int;
  v_query_pattern text;
begin
  v_query_pattern := case
    when p_query is null or length(trim(p_query)) = 0 then null
    else '%' || lower(trim(p_query)) || '%'
  end;

  with base as (
    select p.*
    from public.primary_intelligence p
    where p.space_id = p_space_id
      and p.state = 'published'
      and (p_entity_types is null or p.entity_type = any(p_entity_types))
      and (p_since is null or p.updated_at >= p_since)
      and (
        v_query_pattern is null
        or lower(p.headline) like v_query_pattern
        or lower(p.thesis_md) like v_query_pattern
      )
      and (
        p_author_id is null
        or p.last_edited_by = p_author_id
      )
      and (
        p_referencing_entity_type is null
        or p_referencing_entity_id is null
        or exists (
          select 1 from public.primary_intelligence_links l
          where l.primary_intelligence_id = p.id
            and l.entity_type = p_referencing_entity_type
            and l.entity_id = p_referencing_entity_id
        )
      )
  ), counted as (
    select count(*)::int as total from base
  ), paged as (
    select * from base
    order by updated_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0)
  )
  select
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', x.id,
            'space_id', x.space_id,
            'entity_type', x.entity_type,
            'entity_id', x.entity_id,
            'state', x.state,
            'headline', x.headline,
            'thesis_md', x.thesis_md,
            'last_edited_by', x.last_edited_by,
            'updated_at', x.updated_at,
            'links', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'entity_type', l.entity_type,
                    'entity_id', l.entity_id,
                    'relationship_type', l.relationship_type,
                    'gloss', l.gloss
                  )
                  order by l.display_order, l.created_at
                )
                from public.primary_intelligence_links l
                where l.primary_intelligence_id = x.id
              ),
              '[]'::jsonb
            ),
            'contributors', case
              when x.last_edited_by is null then '[]'::jsonb
              else jsonb_build_array(x.last_edited_by)
            end
          )
          order by x.updated_at desc
        )
        from paged x
      ),
      '[]'::jsonb
    ),
    (select total from counted)
  into v_rows, v_total;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset
  );
end;
$$;

revoke execute on function public.list_primary_intelligence(
  uuid, text[], uuid, timestamptz, text, text, uuid, int, int
) from public;
revoke execute on function public.list_primary_intelligence(
  uuid, text[], uuid, timestamptz, text, text, uuid, int, int
) from anon;
grant  execute on function public.list_primary_intelligence(
  uuid, text[], uuid, timestamptz, text, text, uuid, int, int
) to authenticated;

comment on function public.list_primary_intelligence(
  uuid, text[], uuid, timestamptz, text, text, uuid, int, int
) is
  'Backs Latest from Stout, the intelligence browse view, and the Referenced in section. After spec-2026-008, contributors is a single-element array of last_edited_by, and p_author_id filters on last_edited_by directly; the snapshot revisions table is gone.';

-- =============================================================================
-- 10. smoke test: catch any lingering reference to the dropped revisions
--     table at migration time. Each RPC is exercised with a random uuid so
--     it returns an empty result without erroring on resolution.
-- =============================================================================

do $$
declare
  v_drafts jsonb;
  v_list   jsonb;
  v_hist   jsonb;
  v_fake   uuid := gen_random_uuid();
begin
  v_drafts := public.list_draft_intelligence_for_space(v_fake, 3);
  v_list   := public.list_primary_intelligence(
                v_fake, null, null, null, null, null, null, 5, 0
              );
  v_hist   := public.get_primary_intelligence_history(v_fake, 'trial', v_fake);
end $$;
