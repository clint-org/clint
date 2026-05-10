-- migration: 20260509130100_intelligence_history_rpcs
-- purpose: replace destructive republish behavior, add withdraw/purge,
--   and add history-fetcher RPCs. Narrows delete_primary_intelligence
--   to drafts only.

-- =============================================================================
-- upsert_primary_intelligence (replace)
-- =============================================================================
-- Differences from prior version:
--   - on publish, archive any prior published row instead of deleting it.
--   - on publish, require change_note when a prior version (any non-draft) exists.

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

  perform set_config('app.change_note', coalesce(p_change_note, ''), true);

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

    -- archive any prior published row for this anchor (was: delete)
    update public.primary_intelligence
       set state = 'archived', updated_at = now()
     where space_id    = p_space_id
       and entity_type = p_entity_type
       and entity_id   = p_entity_id
       and state       = 'published'
       and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.primary_intelligence (
      space_id, entity_type, entity_id, state, headline,
      thesis_md, watch_md, implications_md, last_edited_by
    ) values (
      p_space_id, p_entity_type, p_entity_id, p_state, p_headline,
      coalesce(p_thesis_md, ''), coalesce(p_watch_md, ''),
      coalesce(p_implications_md, ''), auth.uid()
    )
    returning id into v_id;
  else
    update public.primary_intelligence
       set state = p_state,
           headline = p_headline,
           thesis_md = coalesce(p_thesis_md, ''),
           watch_md = coalesce(p_watch_md, ''),
           implications_md = coalesce(p_implications_md, ''),
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
-- delete_primary_intelligence (narrow to drafts only)
-- =============================================================================

create or replace function public.delete_primary_intelligence(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.primary_intelligence%rowtype;
begin
  select * into v_row from public.primary_intelligence where id = p_id;
  if v_row.id is null then return; end if;

  if not public.is_agency_member_of_space(v_row.space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_row.state <> 'draft' then
    raise exception 'delete_primary_intelligence is restricted to drafts; use withdraw_primary_intelligence or purge_primary_intelligence (state=%)', v_row.state
      using errcode = '22023';
  end if;

  delete from public.primary_intelligence where id = p_id;
end;
$$;

revoke execute on function public.delete_primary_intelligence(uuid) from public;
revoke execute on function public.delete_primary_intelligence(uuid) from anon;
grant  execute on function public.delete_primary_intelligence(uuid) to authenticated;

-- =============================================================================
-- withdraw_primary_intelligence (new)
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

  perform set_config('app.change_note', p_change_note, true);

  update public.primary_intelligence
     set state          = 'withdrawn',
         withdrawn_at   = now(),
         withdrawn_by   = auth.uid(),
         last_edited_by = auth.uid(),
         updated_at     = now()
   where id = p_id;
end;
$$;

revoke execute on function public.withdraw_primary_intelligence(uuid, text) from public;
revoke execute on function public.withdraw_primary_intelligence(uuid, text) from anon;
grant  execute on function public.withdraw_primary_intelligence(uuid, text) to authenticated;

-- =============================================================================
-- purge_primary_intelligence (new)
-- =============================================================================

create or replace function public.purge_primary_intelligence(
  p_id uuid,
  p_confirmation text,
  p_purge_anchor boolean default false
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
  if p_confirmation is null or p_confirmation <> v_row.headline then
    raise exception 'confirmation does not match headline' using errcode = '22023';
  end if;

  if p_purge_anchor then
    delete from public.primary_intelligence
     where space_id    = v_row.space_id
       and entity_type = v_row.entity_type
       and entity_id   = v_row.entity_id;
  else
    delete from public.primary_intelligence where id = p_id;
  end if;
end;
$$;

revoke execute on function public.purge_primary_intelligence(uuid, text, boolean) from public;
revoke execute on function public.purge_primary_intelligence(uuid, text, boolean) from anon;
grant  execute on function public.purge_primary_intelligence(uuid, text, boolean) to authenticated;

-- =============================================================================
-- get_primary_intelligence_history (new)
-- =============================================================================
-- Returns { current, draft, versions[] } for an anchor. RLS on the
-- underlying tables gates draft visibility automatically.

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
  version_revisions as (
    select v.id as version_id,
           (
             select jsonb_build_object(
                      'change_note', rev.change_note,
                      'edited_by',   rev.edited_by,
                      'edited_at',   rev.edited_at
                    )
               from public.primary_intelligence_revisions rev
              where rev.primary_intelligence_id = v.id
                and rev.state = 'published'
              order by rev.edited_at asc
              limit 1
           ) as first_publish
      from versions v
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
          'change_note',     vr.first_publish->>'change_note',
          'edited_by',       v.last_edited_by,
          'published_at',    v.published_at,
          'withdrawn_at',    v.withdrawn_at,
          'withdrawn_by',    v.withdrawn_by
        )
        order by v.version_number desc
      )
      from versions v
      left join version_revisions vr on vr.version_id = v.id),
      '[]'::jsonb
    )
  );
$$;

revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from public;
revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from anon;
grant  execute on function public.get_primary_intelligence_history(uuid, text, uuid) to authenticated;

-- =============================================================================
-- get_intelligence_version_revisions (new, agency-only via RLS)
-- =============================================================================
-- Returns the per-version edit history for a single version row,
-- ordered oldest-first, used to render adjacent-save word diffs.

create or replace function public.get_intelligence_version_revisions(
  p_version_id uuid
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',              rev.id,
        'state',           rev.state,
        'headline',        rev.headline,
        'thesis_md',       rev.thesis_md,
        'watch_md',        rev.watch_md,
        'implications_md', rev.implications_md,
        'change_note',     rev.change_note,
        'edited_by',       rev.edited_by,
        'edited_at',       rev.edited_at
      )
      order by rev.edited_at asc
    ),
    '[]'::jsonb
  )
  from public.primary_intelligence_revisions rev
  where rev.primary_intelligence_id = p_version_id;
$$;

revoke execute on function public.get_intelligence_version_revisions(uuid) from public;
revoke execute on function public.get_intelligence_version_revisions(uuid) from anon;
grant  execute on function public.get_intelligence_version_revisions(uuid) to authenticated;
