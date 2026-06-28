-- migration: 20260627130200_intelligence_lead_and_order_rpcs
-- purpose: add set_intelligence_lead and reorder_intelligence RPCs.
--   set_intelligence_lead: clears is_lead on sibling anchors, pins the
--     target anchor as lead; rejects if the anchor has no published version.
--   reorder_intelligence: sets display_order by array position; rejects if
--     the supplied anchor_ids set does not exactly match the entity's anchors.
-- both are SECURITY DEFINER, agency-gated via is_agency_member_of_space.
-- these are content ops -- no @audit:tier1 marker.
--
-- stub: _seed_demo_primary_intelligence still references the old entity_type
-- column on primary_intelligence (dropped in 20260627130000). Replace with a
-- no-op so supabase db reset can run the seed step without error. Task 8 will
-- replace this stub with an anchor-aware implementation.
create or replace function public._seed_demo_primary_intelligence(
  p_space_id uuid, p_uid uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- no-op: seed demo intelligence skipped until anchor-aware rewrite in Task 8.
  null;
end;
$$;

create or replace function public.set_intelligence_lead(p_anchor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anchor public.primary_intelligence_anchors%rowtype;
begin
  select * into v_anchor
    from public.primary_intelligence_anchors
   where id = p_anchor_id;

  if v_anchor.id is null then
    raise exception 'anchor % not found', p_anchor_id using errcode = 'P0002';
  end if;

  if not public.is_agency_member_of_space(v_anchor.space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.primary_intelligence
     where anchor_id = p_anchor_id
       and state = 'published'
  ) then
    raise exception 'cannot pin an anchor with no published version'
      using errcode = '22023';
  end if;

  -- clear is_lead on any sibling that currently holds it
  update public.primary_intelligence_anchors
     set is_lead = false, updated_at = now()
   where space_id = v_anchor.space_id
     and entity_type = v_anchor.entity_type
     and entity_id = v_anchor.entity_id
     and is_lead
     and id <> p_anchor_id;

  -- pin the target anchor as lead
  update public.primary_intelligence_anchors
     set is_lead = true, updated_at = now()
   where id = p_anchor_id;
end;
$$;

create or replace function public.reorder_intelligence(
  p_space_id   uuid,
  p_entity_type text,
  p_entity_id  uuid,
  p_anchor_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected int;
  v_matched  int;
begin
  if not public.is_agency_member_of_space(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- count anchors that belong to this entity
  select count(*) into v_expected
    from public.primary_intelligence_anchors
   where space_id   = p_space_id
     and entity_type = p_entity_type
     and entity_id  = p_entity_id;

  -- count how many of the supplied ids are actually in that entity's set
  select count(*) into v_matched
    from public.primary_intelligence_anchors
   where space_id   = p_space_id
     and entity_type = p_entity_type
     and entity_id  = p_entity_id
     and id = any(p_anchor_ids);

  if v_expected <> array_length(p_anchor_ids, 1) or v_matched <> v_expected then
    raise exception 'anchor set does not match the entity''s anchors'
      using errcode = '22023';
  end if;

  -- write display_order by array position (0-based)
  update public.primary_intelligence_anchors a
     set display_order = ord.idx - 1,
         updated_at    = now()
    from (
      select unnest(p_anchor_ids)               as id,
             generate_subscripts(p_anchor_ids, 1) as idx
    ) ord
   where a.id = ord.id;
end;
$$;

revoke execute on function public.set_intelligence_lead(uuid)             from public, anon;
grant  execute on function public.set_intelligence_lead(uuid)             to authenticated;

revoke execute on function public.reorder_intelligence(uuid, text, uuid, uuid[]) from public, anon;
grant  execute on function public.reorder_intelligence(uuid, text, uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
