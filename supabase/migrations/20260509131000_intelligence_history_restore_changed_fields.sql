-- migration: 20260509131000_intelligence_history_restore_changed_fields
-- purpose: restore the changed_fields tracking added by
--   20260505201132_intel_revision_changed_fields, which was dropped
--   in 20260509130100_intelligence_history_rpcs when upsert_primary_intelligence
--   was rewritten to archive-on-republish. The integration suite
--   (rpc-content-write.spec.ts) asserts recent_revisions[0].changed_fields,
--   and the change-feed activity row chips depend on it.
--
-- This combines the changed_fields scalar+link diff logic with the new
-- history-aware behavior (archive prior published row instead of delete,
-- require change_note when republishing).

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

      -- Link diff: symmetric difference between existing and incoming.
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

  -- Trigger reads both session vars when writing the revision row.
  perform set_config('app.change_note', coalesce(p_change_note, ''), true);
  perform set_config('app.changed_fields_json', v_changed::text, true);

  if p_state = 'published' then
    -- Enforce change_note when any prior non-draft version exists for this anchor.
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

    -- Archive any prior published row for this anchor (was: delete).
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
