-- migration: 20260505201132_intel_revision_changed_fields
-- purpose: track which sections of a primary_intelligence read changed in
--          each revision so the recent-activity surface can render
--          structural diff chips ("Thesis", "Links") instead of relying
--          solely on the optional human-typed change_note.
-- approach: cheap version -- store a jsonb map of changed sections, not
--          the prior text. Sections: headline, thesis, watch, implications,
--          links, state. Initial insert leaves the map empty (the row's
--          existence implies "created").

-- 1. Column on the revisions table.
alter table public.primary_intelligence_revisions
  add column if not exists changed_fields jsonb not null default '{}'::jsonb;

comment on column public.primary_intelligence_revisions.changed_fields is
  'Map of section names that changed in this revision. Keys: '
  'headline, thesis, watch, implications, links, state. Empty for the '
  'initial creation revision (the existence of the row already means '
  '"created"). Computed by upsert_primary_intelligence and read by the '
  'revision trigger via the app.changed_fields session variable.';

-- 2. Trigger picks up the session variable set by the upsert RPC.
create or replace function public.write_primary_intelligence_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_change_note text;
  v_changed_raw text;
  v_changed jsonb;
begin
  v_change_note := nullif(current_setting('app.change_note', true), '');
  v_changed_raw := nullif(current_setting('app.changed_fields_json', true), '');
  v_changed := coalesce(v_changed_raw::jsonb, '{}'::jsonb);

  insert into public.primary_intelligence_revisions (
    primary_intelligence_id, state, headline, thesis_md, watch_md,
    implications_md, change_note, changed_fields, edited_by
  ) values (
    new.id, new.state, new.headline, new.thesis_md, new.watch_md,
    new.implications_md, v_change_note, v_changed, new.last_edited_by
  );

  return new;
end;
$$;

-- 3. Replace upsert_primary_intelligence to compute the field-level diff
--    against the existing row + links before applying the update.
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
  v_old public.primary_intelligence;
  v_changed jsonb := '{}'::jsonb;
  v_link_diff int := 0;
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

  -- For updates: load the current row and compute the scalar diff so the
  -- revision row can record which sections changed. p_id null means a new
  -- row; we leave changed_fields empty for the creation revision.
  if p_id is not null then
    select * into v_old from public.primary_intelligence
    where id = p_id and space_id = p_space_id;

    if v_old.id is not null then
      if v_old.state is distinct from p_state then
        v_changed := v_changed || jsonb_build_object('state', true);
      end if;
      if v_old.headline is distinct from p_headline then
        v_changed := v_changed || jsonb_build_object('headline', true);
      end if;
      if v_old.thesis_md is distinct from coalesce(p_thesis_md, '') then
        v_changed := v_changed || jsonb_build_object('thesis', true);
      end if;
      if v_old.watch_md is distinct from coalesce(p_watch_md, '') then
        v_changed := v_changed || jsonb_build_object('watch', true);
      end if;
      if v_old.implications_md is distinct from coalesce(p_implications_md, '') then
        v_changed := v_changed || jsonb_build_object('implications', true);
      end if;

      -- Link diff: symmetric difference between the existing link set and
      -- the incoming p_links payload. Counts as changed if any tuple is
      -- added, removed, or has a different relationship/gloss/order.
      with old_links as (
        select entity_type, entity_id, relationship_type,
               coalesce(gloss, '') as gloss,
               coalesce(display_order, 0) as display_order
        from public.primary_intelligence_links
        where primary_intelligence_id = p_id
      ),
      new_links as (
        select (l->>'entity_type')::text as entity_type,
               (l->>'entity_id')::uuid as entity_id,
               (l->>'relationship_type')::text as relationship_type,
               coalesce(nullif(l->>'gloss', ''), '') as gloss,
               coalesce((l->>'display_order')::int, 0) as display_order
        from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) l
      ),
      diff as (
        select * from old_links except select * from new_links
        union all
        select * from new_links except select * from old_links
      )
      select count(*) into v_link_diff from diff;

      if v_link_diff > 0 then
        v_changed := v_changed || jsonb_build_object('links', true);
      end if;
    end if;
  end if;

  -- Trigger reads these session vars when writing the revision row.
  perform set_config('app.change_note', coalesce(p_change_note, ''), true);
  perform set_config('app.changed_fields_json', v_changed::text, true);

  -- when publishing, retire any prior published row for the same anchor.
  if p_state = 'published' then
    delete from public.primary_intelligence
    where space_id = p_space_id
      and entity_type = p_entity_type
      and entity_id = p_entity_id
      and state = 'published'
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

-- 4. Replace build_intelligence_payload so revisions surface changed_fields.
create or replace function public.build_intelligence_payload(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_state       text,
  p_revisions_limit int default 25
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    select * from public.primary_intelligence p
    where p.space_id = p_space_id
      and p.entity_type = p_entity_type
      and p.entity_id = p_entity_id
      and p.state = p_state
    order by p.updated_at desc
    limit 1
  )
  select case when t.id is null then null else
    jsonb_build_object(
      'record', jsonb_build_object(
        'id', t.id,
        'space_id', t.space_id,
        'entity_type', t.entity_type,
        'entity_id', t.entity_id,
        'state', t.state,
        'headline', t.headline,
        'thesis_md', t.thesis_md,
        'watch_md', t.watch_md,
        'implications_md', t.implications_md,
        'last_edited_by', t.last_edited_by,
        'created_at', t.created_at,
        'updated_at', t.updated_at
      ),
      'links', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', l.id,
              'entity_type', l.entity_type,
              'entity_id', l.entity_id,
              'entity_name', case l.entity_type
                when 'trial' then (select tr.name from public.trials tr where tr.id = l.entity_id)
                when 'marker' then (select mk.title from public.markers mk where mk.id = l.entity_id)
                when 'company' then (select co.name from public.companies co where co.id = l.entity_id)
                when 'product' then (select pr.name from public.products pr where pr.id = l.entity_id)
                else null
              end,
              'relationship_type', l.relationship_type,
              'gloss', l.gloss,
              'display_order', l.display_order
            )
            order by l.display_order, l.created_at
          )
          from public.primary_intelligence_links l
          where l.primary_intelligence_id = t.id
        ),
        '[]'::jsonb
      ),
      'contributors', coalesce(
        (
          select jsonb_agg(distinct rev.edited_by)
          from public.primary_intelligence_revisions rev
          where rev.primary_intelligence_id = t.id
        ),
        '[]'::jsonb
      ),
      'recent_revisions', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', rev.id,
              'state', rev.state,
              'headline', rev.headline,
              'change_note', rev.change_note,
              'changed_fields', rev.changed_fields,
              'edited_by', rev.edited_by,
              'edited_at', rev.edited_at
            )
            order by rev.edited_at desc
          )
          from (
            select * from public.primary_intelligence_revisions r
            where r.primary_intelligence_id = t.id
            order by r.edited_at desc
            limit p_revisions_limit
          ) rev
        ),
        '[]'::jsonb
      )
    )
  end
  from target t;
$$;

comment on function public.build_intelligence_payload(uuid, text, uuid, text, int) is
  'Returns the full intelligence read for an entity at a given state. Links '
  'include entity_name resolved per entity_type. Revisions include '
  'changed_fields so callers can render structural diff chips.';
