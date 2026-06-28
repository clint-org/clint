-- migration: 20260627130100_intelligence_upsert_anchor_aware
-- purpose: make upsert_primary_intelligence anchor-aware so multiple briefs
--   can exist for a single entity. adds p_anchor_id as the 2nd parameter.
--   when p_anchor_id is null and p_id is null, a new anchor is created
--   (first anchor on an entity becomes the lead; subsequent ones are siblings
--   with display_order = max + 1). archive and change-note logic now scopes
--   by anchor_id rather than the entity triple. drops the old 10-arg signature.

-- 1. drop the old 10-arg signature -------------------------------------------
drop function if exists public.upsert_primary_intelligence(
  uuid, uuid, text, uuid, text, text, text, text, text, jsonb
);

-- 2. create the new 11-arg anchor-aware function ------------------------------
create or replace function public.upsert_primary_intelligence(
  p_id             uuid,
  p_anchor_id      uuid,
  p_space_id       uuid,
  p_entity_type    text,
  p_entity_id      uuid,
  p_headline       text,
  p_summary_md     text,
  p_implications_md text,
  p_state          text,
  p_change_note    text,
  p_links          jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anchor_id uuid := p_anchor_id;
  v_id        uuid;
  v_has_any   boolean;
begin
  -- access gate: agency member OR space owner/editor
  if not (
    public.has_space_access(p_space_id, array['owner', 'editor'])
    or public.is_agency_member_of_space(p_space_id)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_state not in ('draft', 'published') then
    raise exception 'invalid state %', p_state using errcode = '22023';
  end if;

  if p_entity_type not in ('trial', 'company', 'product', 'space') then
    raise exception 'invalid entity_type %', p_entity_type using errcode = '22023';
  end if;

  -- resolve / create the anchor -----------------------------------------------
  -- if updating an existing version row, derive anchor from that row
  if v_anchor_id is null and p_id is not null then
    select anchor_id into v_anchor_id
      from public.primary_intelligence
     where id = p_id;
  end if;

  -- no anchor supplied or derivable: create one now
  if v_anchor_id is null then
    select exists(
      select 1
        from public.primary_intelligence_anchors
       where space_id    = p_space_id
         and entity_type = p_entity_type
         and entity_id   = p_entity_id
    ) into v_has_any;

    insert into public.primary_intelligence_anchors (
      space_id, entity_type, entity_id, is_lead, display_order, created_by
    ) values (
      p_space_id,
      p_entity_type,
      p_entity_id,
      not v_has_any,  -- first brief for the entity becomes the lead
      coalesce(
        (select max(display_order) + 1
           from public.primary_intelligence_anchors
          where space_id    = p_space_id
            and entity_type = p_entity_type
            and entity_id   = p_entity_id),
        0
      ),
      auth.uid()
    )
    returning id into v_anchor_id;
  end if;

  -- publish path: change_note guard and prior-published archive ---------------
  if p_state = 'published' then
    if exists (
      select 1
        from public.primary_intelligence
       where anchor_id = v_anchor_id
         and state in ('published', 'archived', 'withdrawn')
         and id is distinct from p_id
    ) and (p_change_note is null or length(trim(p_change_note)) = 0) then
      raise exception 'change_note required when republishing'
        using errcode = '22023';
    end if;

    -- archive the current published row for this anchor only
    update public.primary_intelligence
       set state       = 'archived',
           archived_at = now()
     where anchor_id = v_anchor_id
       and state     = 'published'
       and id is distinct from p_id;
  end if;

  -- insert (new version row) or update (edit existing row) -------------------
  if p_id is null then
    insert into public.primary_intelligence (
      anchor_id, space_id, state, headline,
      summary_md, implications_md,
      publish_note, published_by, last_edited_by
    ) values (
      v_anchor_id,
      p_space_id,
      p_state,
      p_headline,
      coalesce(p_summary_md, ''),
      coalesce(p_implications_md, ''),
      case
        when p_state = 'published'
          then nullif(trim(coalesce(p_change_note, '')), '')
        else null
      end,
      case when p_state = 'published' then auth.uid() else null end,
      auth.uid()
    )
    returning id into v_id;
  else
    update public.primary_intelligence
       set state           = p_state,
           headline        = p_headline,
           summary_md      = coalesce(p_summary_md, ''),
           implications_md = coalesce(p_implications_md, ''),
           publish_note    = case
             when p_state = 'published' and publish_note is null
               then nullif(trim(coalesce(p_change_note, '')), '')
             else publish_note
           end,
           published_by    = case
             when p_state = 'published' and published_by is null
               then auth.uid()
             else published_by
           end,
           last_edited_by  = auth.uid(),
           updated_at      = now()
     where id       = p_id
       and space_id = p_space_id
    returning id into v_id;

    if v_id is null then
      raise exception 'primary_intelligence % not found in space %', p_id, p_space_id
        using errcode = 'P0002';
    end if;
  end if;

  -- replace links (delete-then-reinsert keeps ordering clean) ----------------
  delete from public.primary_intelligence_links
   where primary_intelligence_id = v_id;

  if p_links is not null and jsonb_array_length(p_links) > 0 then
    insert into public.primary_intelligence_links (
      primary_intelligence_id, entity_type, entity_id,
      relationship_type, gloss, display_order
    )
    select
      v_id,
      (l ->>'entity_type')::text,
      (l ->>'entity_id')::uuid,
      (l ->>'relationship_type')::text,
      nullif(l ->>'gloss', ''),
      coalesce((l ->>'display_order')::int, 0)
    from jsonb_array_elements(p_links) l;
  end if;

  return v_id;
end;
$$;

-- 3. re-issue grants for the new signature ------------------------------------
revoke execute on function public.upsert_primary_intelligence(
  uuid, uuid, uuid, text, uuid, text, text, text, text, text, jsonb
) from public, anon;

grant execute on function public.upsert_primary_intelligence(
  uuid, uuid, uuid, text, uuid, text, text, text, text, text, jsonb
) to authenticated;

-- 4. inline smoke test --------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'upsert_primary_intelligence'
     and pronargs = 11;
  if v_count <> 1 then
    raise exception 'smoke FAIL: 11-arg upsert_primary_intelligence not found (found % variants)', v_count;
  end if;
  raise notice 'upsert_primary_intelligence anchor-aware smoke ok';
end $$;

-- signal PostgREST to reload (signature changed)
notify pgrst, 'reload schema';
