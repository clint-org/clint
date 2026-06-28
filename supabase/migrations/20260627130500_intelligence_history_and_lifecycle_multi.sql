-- migration: 20260627130500_intelligence_history_and_lifecycle_multi
-- purpose: re-key get_primary_intelligence_history to a single anchor id;
--   add _promote_next_intelligence_lead helper; rebase withdraw, delete, and
--   purge to anchor semantics with lead auto-promotion and anchor cleanup.
--
-- rebase notes:
--   - get_primary_intelligence_history: live body had rows CTE filtering on
--     p.entity_type / p.entity_id which were dropped from primary_intelligence
--     in 20260627130000; that dead code is replaced by where p.anchor_id = p_anchor_id.
--     access guard now resolves space from the anchor instead of the param.
--   - withdraw_primary_intelligence: rebased from live body; access gate
--     (owner/editor + agency) and state guards preserved intact; appended
--     lead demotion + promotion after the withdraw UPDATE.
--   - delete_primary_intelligence: rebased from live body; author/editor/owner
--     gate and draft-only guard preserved intact; anchor cleanup + promotion
--     appended after the delete. anchor data captured before deletion so
--     _promote_next_intelligence_lead can be called even when the anchor row
--     is removed.
--   - purge_primary_intelligence: rebased from live body; owner/agency gate
--     and confirmation guard preserved. p_purge_anchor now deletes by anchor_id
--     (versions/links cascade) instead of the removed entity_type/entity_id
--     columns. anchor data captured before deletion for the same reason as delete.
--   - redact_user (migration 20260521120100): does NOT delete primary_intelligence
--     rows. it intentionally preserves authorship FKs (last_edited_by). no
--     _promote_next_intelligence_lead call is needed; see note in section 6.

-- =============================================================================
-- 1. drop old history signature (entity triple) and recreate anchor-keyed
-- =============================================================================
drop function if exists public.get_primary_intelligence_history(uuid, text, uuid);

create or replace function public.get_primary_intelligence_history(
  p_anchor_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
  v_can_read boolean;
begin
  select space_id into v_space_id
    from public.primary_intelligence_anchors
   where id = p_anchor_id;
  if v_space_id is null then return null; end if;

  v_can_read := public.is_agency_member_of_space(v_space_id)
                or public.has_space_access(v_space_id);
  if not v_can_read then return null; end if;

  return (
    with rows as (
      select * from public.primary_intelligence p
       where p.anchor_id = p_anchor_id
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
$$;

revoke execute on function public.get_primary_intelligence_history(uuid) from public, anon;
grant  execute on function public.get_primary_intelligence_history(uuid) to authenticated;

-- =============================================================================
-- 2. _promote_next_intelligence_lead
--    internal helper: if the entity has no lead anchor, promote the
--    most-recently-published anchor as lead.
-- =============================================================================
create or replace function public._promote_next_intelligence_lead(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.primary_intelligence_anchors
     where space_id    = p_space_id
       and entity_type = p_entity_type
       and entity_id   = p_entity_id
       and is_lead
  ) then
    return;  -- a lead already stands
  end if;

  update public.primary_intelligence_anchors
     set is_lead = true, updated_at = now()
   where id = (
     select a.id
       from public.primary_intelligence_anchors a
       join public.primary_intelligence p
         on p.anchor_id = a.id and p.state = 'published'
      where a.space_id    = p_space_id
        and a.entity_type = p_entity_type
        and a.entity_id   = p_entity_id
      order by p.published_at desc nulls last
      limit 1
   );
end;
$$;

-- internal helper: no direct client access needed; called by SECURITY DEFINER siblings.
revoke execute on function public._promote_next_intelligence_lead(uuid, text, uuid) from public, anon, authenticated;

-- =============================================================================
-- 3. withdraw_primary_intelligence: add lead demotion + auto-promote
--    rebased from live body; gating (owner/editor + agency, state, change_note)
--    preserved intact.
-- =============================================================================
create or replace function public.withdraw_primary_intelligence(p_id uuid, p_change_note text)
returns void
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

  -- if this anchor was the lead and now has no published version, demote it
  update public.primary_intelligence_anchors ana
     set is_lead = false, updated_at = now()
   where ana.id = v_row.anchor_id
     and ana.is_lead
     and not exists (
       select 1 from public.primary_intelligence p
        where p.anchor_id = ana.id and p.state = 'published'
     );

  -- promote another anchor for this entity if no lead remains
  perform public._promote_next_intelligence_lead(a.space_id, a.entity_type, a.entity_id)
    from public.primary_intelligence_anchors a where a.id = v_row.anchor_id;
end;
$$;

-- =============================================================================
-- 4. delete_primary_intelligence: anchor cleanup + auto-promote
--    rebased from live body; author/editor/owner gate and draft-only guard
--    preserved intact. anchor data captured before deletion so promotion
--    works even when the anchor row is removed.
-- =============================================================================
create or replace function public.delete_primary_intelligence(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.primary_intelligence%rowtype;
  v_anchor_id uuid;
  v_anchor    public.primary_intelligence_anchors%rowtype;
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

  v_anchor_id := v_row.anchor_id;
  -- capture anchor data before potential deletion so promotion can run
  -- using the entity coordinates even when the anchor row is gone
  select * into v_anchor from public.primary_intelligence_anchors where id = v_anchor_id;

  delete from public.primary_intelligence where id = p_id;

  -- drop the anchor if it now has no version rows
  delete from public.primary_intelligence_anchors a
   where a.id = v_anchor_id
     and not exists (select 1 from public.primary_intelligence p where p.anchor_id = a.id);

  -- promote next lead if the entity has no lead anchor
  -- uses captured anchor data so this works even when the anchor was just deleted above
  if v_anchor.id is not null then
    perform public._promote_next_intelligence_lead(
      v_anchor.space_id, v_anchor.entity_type, v_anchor.entity_id
    );
  end if;
end;
$$;

-- =============================================================================
-- 5. purge_primary_intelligence: anchor-keyed purge + auto-promote
--    rebased from live body; owner/agency gate and confirmation guard preserved.
--    p_purge_anchor branch deletes by anchor_id (versions/links cascade via FK)
--    instead of the removed entity_type/entity_id columns. anchor data captured
--    before deletion for the same reason as delete above.
-- =============================================================================
create or replace function public.purge_primary_intelligence(
  p_id           uuid,
  p_confirmation text,
  p_purge_anchor boolean default false
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.primary_intelligence%rowtype;
  v_anchor_id uuid;
  v_anchor    public.primary_intelligence_anchors%rowtype;
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

  v_anchor_id := v_row.anchor_id;
  -- capture anchor data before potential deletion so promotion can run
  -- using the entity coordinates even when the anchor row is gone
  select * into v_anchor from public.primary_intelligence_anchors where id = v_anchor_id;

  if p_purge_anchor then
    -- delete the entire anchor; versions and links cascade via anchor_id FK
    delete from public.primary_intelligence_anchors where id = v_anchor_id;
  else
    delete from public.primary_intelligence where id = p_id;
    -- drop the anchor if it now has no version rows
    delete from public.primary_intelligence_anchors a
     where a.id = v_anchor_id
       and not exists (select 1 from public.primary_intelligence p where p.anchor_id = a.id);
  end if;

  -- promote next lead if the entity has no lead anchor
  -- uses captured anchor data so this works even when the anchor was just deleted above
  if v_anchor.id is not null then
    perform public._promote_next_intelligence_lead(
      v_anchor.space_id, v_anchor.entity_type, v_anchor.entity_id
    );
  end if;
end;
$$;

-- =============================================================================
-- 6. redact_user (migration 20260521120100) -- no change needed
-- =============================================================================
-- The live redact_user function intentionally does NOT delete
-- primary_intelligence rows. It preserves authorship FKs (last_edited_by,
-- published_by, withdrawn_by) so the historical record stays intact; only
-- the user_redactions marker drives the UI to render '(redacted user)'.
-- Because redact_user never removes a PI version, no call to
-- _promote_next_intelligence_lead is needed here.
-- Ref: 20260521120100_user_redaction_rpc.sql step 5 comment.

-- =============================================================================
-- 7. reload schema (history signature changed from triple to single anchor id)
-- =============================================================================
notify pgrst, 'reload schema';
