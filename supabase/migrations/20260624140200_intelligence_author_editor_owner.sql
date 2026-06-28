-- migration: 20260624140200_intelligence_author_editor_owner
-- purpose: let space editors and owners author primary intelligence, not
--   just agency members. Authoring = draft / publish / modify / republish /
--   withdraw. PURGE stays owners + agency only (editors excluded).
--
-- Before: the four authoring RPCs gated on is_agency_member_of_space, and
-- the draft SELECT RLS exposed drafts only to agency members. Intelligence
-- ("Analysis") is the engagement's deliverable; space editors and owners
-- are part of the engagement team and should be able to author it.
--
-- Each function below is reproduced from its current definition (newest
-- create-or-replace across migrations) with ONLY the access gate changed:
--   upsert  -- 20260524121000_fix_remaining_product_refs.sql
--   withdraw -- 20260510130000_intelligence_history_simplify.sql
--   delete / purge -- 20260509130100_intelligence_history_rpcs.sql
-- These are not Tier-1 governance RPCs, so no @audit:tier1 marker.

-- =============================================================================
-- upsert_primary_intelligence: editor/owner OR agency.
-- =============================================================================

create or replace function public.upsert_primary_intelligence(
  p_id              uuid,
  p_space_id        uuid,
  p_entity_type     text,
  p_entity_id       uuid,
  p_headline        text,
  p_summary_md      text,
  p_implications_md text,
  p_state           text,
  p_change_note     text,
  p_links           jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (
    public.has_space_access(p_space_id, array['owner', 'editor'])
    or public.is_agency_member_of_space(p_space_id)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_state not in ('draft','published') then
    raise exception 'invalid state %', p_state using errcode = '22023';
  end if;
  if p_entity_type not in ('trial', 'marker', 'company', 'asset', 'product', 'space') then
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
      summary_md, implications_md,
      publish_note, published_by, last_edited_by
    ) values (
      p_space_id, p_entity_type, p_entity_id, p_state, p_headline,
      coalesce(p_summary_md, ''),
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
           summary_md = coalesce(p_summary_md, ''),
           implications_md = coalesce(p_implications_md, ''),
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

-- =============================================================================
-- withdraw_primary_intelligence: editor/owner OR agency.
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
  if not (
    public.has_space_access(v_row.space_id, array['owner', 'editor'])
    or public.is_agency_member_of_space(v_row.space_id)
  ) then
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

-- =============================================================================
-- delete_primary_intelligence (drafts only): editor/owner OR agency.
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

  if not (
    public.has_space_access(v_row.space_id, array['owner', 'editor'])
    or public.is_agency_member_of_space(v_row.space_id)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_row.state <> 'draft' then
    raise exception 'delete_primary_intelligence is restricted to drafts; use withdraw_primary_intelligence or purge_primary_intelligence (state=%)', v_row.state
      using errcode = '22023';
  end if;

  delete from public.primary_intelligence where id = p_id;
end;
$$;

-- =============================================================================
-- purge_primary_intelligence: owners + agency ONLY (editors excluded).
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
  if not (
    public.has_space_access(v_row.space_id, array['owner'])
    or public.is_agency_member_of_space(v_row.space_id)
  ) then
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

-- =============================================================================
-- RLS: drafts visible to editor/owner/agency (not just agency); non-draft
-- states stay visible to anyone with space access. Single SELECT policy to
-- avoid the multiple-permissive-policies advisor warning.
-- =============================================================================

drop policy if exists "primary_intelligence read" on public.primary_intelligence;
create policy "primary_intelligence read"
on public.primary_intelligence for select to authenticated
using (
  (
    state = 'draft'
    and (
      public.has_space_access(space_id, array['owner', 'editor'])
      or public.is_agency_member_of_space(space_id)
    )
  )
  or
  (state in ('published','archived','withdrawn') and public.has_space_access(space_id))
);

notify pgrst, 'reload schema';
