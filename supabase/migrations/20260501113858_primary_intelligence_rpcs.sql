-- migration: 20260501113858_primary_intelligence_rpcs
-- purpose: rpcs that back the primary intelligence ui. all rpcs follow the
--   read-shape used by other detail fetchers (jsonb objects with embedded
--   arrays). write rpcs check is_agency_member_of_space() before mutating.

-- =============================================================================
-- upsert_primary_intelligence
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

  -- the trigger reads this transient session variable for the change_note.
  perform set_config('app.change_note', coalesce(p_change_note, ''), true);

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
-- delete_primary_intelligence
-- =============================================================================

create or replace function public.delete_primary_intelligence(
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id
  from public.primary_intelligence
  where id = p_id;

  if v_space_id is null then
    return;
  end if;

  if not public.is_agency_member_of_space(v_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.primary_intelligence where id = p_id;
end;
$$;

revoke execute on function public.delete_primary_intelligence(uuid) from public;
revoke execute on function public.delete_primary_intelligence(uuid) from anon;
grant  execute on function public.delete_primary_intelligence(uuid) to authenticated;

-- =============================================================================
-- internal helper: build a normalized intelligence payload (jsonb)
-- =============================================================================
-- returns: { record, links, contributors, recent_revisions }

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

-- =============================================================================
-- internal helper: list the published reads that link TO an entity
-- =============================================================================
-- returns array of compact "referenced in" rows.

create or replace function public.referenced_in_entity(
  p_space_id     uuid,
  p_entity_type  text,
  p_entity_id    uuid,
  p_limit        int default 20
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
        'id', p.id,
        'entity_type', p.entity_type,
        'entity_id', p.entity_id,
        'state', p.state,
        'headline', p.headline,
        'updated_at', p.updated_at,
        'last_edited_by', p.last_edited_by,
        'relationship_type', l.relationship_type,
        'gloss', l.gloss
      )
      order by p.updated_at desc
    ),
    '[]'::jsonb
  )
  from (
    select distinct on (l.primary_intelligence_id) l.*
    from public.primary_intelligence_links l
    where l.entity_type = p_entity_type
      and l.entity_id = p_entity_id
    order by l.primary_intelligence_id, l.display_order, l.created_at
  ) l
  join public.primary_intelligence p on p.id = l.primary_intelligence_id
  where p.space_id = p_space_id
    and p.state = 'published'
  limit p_limit;
$$;

-- =============================================================================
-- get_trial_detail_with_intelligence
-- =============================================================================
-- one round-trip fetch of a trial plus its primary intelligence, draft,
-- referenced-in entries, and recent revisions.

create or replace function public.get_trial_detail_with_intelligence(
  p_trial_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_space_id uuid;
  v_published jsonb;
  v_draft jsonb;
  v_ref_in jsonb;
begin
  select space_id into v_space_id from public.trials where id = p_trial_id;
  if v_space_id is null then
    return null;
  end if;

  v_published := public.build_intelligence_payload(v_space_id, 'trial', p_trial_id, 'published');
  v_draft := public.build_intelligence_payload(v_space_id, 'trial', p_trial_id, 'draft');
  v_ref_in := public.referenced_in_entity(v_space_id, 'trial', p_trial_id);

  return jsonb_build_object(
    'space_id', v_space_id,
    'entity_type', 'trial',
    'entity_id', p_trial_id,
    'published', v_published,
    'draft', v_draft,
    'referenced_in', v_ref_in
  );
end;
$$;

revoke execute on function public.get_trial_detail_with_intelligence(uuid) from public;
revoke execute on function public.get_trial_detail_with_intelligence(uuid) from anon;
grant  execute on function public.get_trial_detail_with_intelligence(uuid) to authenticated;

-- =============================================================================
-- get_marker_detail_with_intelligence
-- =============================================================================

create or replace function public.get_marker_detail_with_intelligence(
  p_marker_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id from public.markers where id = p_marker_id;
  if v_space_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'space_id', v_space_id,
    'entity_type', 'marker',
    'entity_id', p_marker_id,
    'published', public.build_intelligence_payload(v_space_id, 'marker', p_marker_id, 'published'),
    'draft', public.build_intelligence_payload(v_space_id, 'marker', p_marker_id, 'draft'),
    'referenced_in', public.referenced_in_entity(v_space_id, 'marker', p_marker_id)
  );
end;
$$;

revoke execute on function public.get_marker_detail_with_intelligence(uuid) from public;
revoke execute on function public.get_marker_detail_with_intelligence(uuid) from anon;
grant  execute on function public.get_marker_detail_with_intelligence(uuid) to authenticated;

-- =============================================================================
-- get_company_detail_with_intelligence
-- =============================================================================

create or replace function public.get_company_detail_with_intelligence(
  p_company_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id from public.companies where id = p_company_id;
  if v_space_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'space_id', v_space_id,
    'entity_type', 'company',
    'entity_id', p_company_id,
    'published', public.build_intelligence_payload(v_space_id, 'company', p_company_id, 'published'),
    'draft', public.build_intelligence_payload(v_space_id, 'company', p_company_id, 'draft'),
    'referenced_in', public.referenced_in_entity(v_space_id, 'company', p_company_id)
  );
end;
$$;

revoke execute on function public.get_company_detail_with_intelligence(uuid) from public;
revoke execute on function public.get_company_detail_with_intelligence(uuid) from anon;
grant  execute on function public.get_company_detail_with_intelligence(uuid) to authenticated;

-- =============================================================================
-- get_product_detail_with_intelligence
-- =============================================================================

create or replace function public.get_product_detail_with_intelligence(
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id from public.products where id = p_product_id;
  if v_space_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'space_id', v_space_id,
    'entity_type', 'product',
    'entity_id', p_product_id,
    'published', public.build_intelligence_payload(v_space_id, 'product', p_product_id, 'published'),
    'draft', public.build_intelligence_payload(v_space_id, 'product', p_product_id, 'draft'),
    'referenced_in', public.referenced_in_entity(v_space_id, 'product', p_product_id)
  );
end;
$$;

revoke execute on function public.get_product_detail_with_intelligence(uuid) from public;
revoke execute on function public.get_product_detail_with_intelligence(uuid) from anon;
grant  execute on function public.get_product_detail_with_intelligence(uuid) to authenticated;

-- =============================================================================
-- get_space_intelligence
-- =============================================================================
-- thematic engagement-level intelligence (entity_type = 'space', entity_id = space).

create or replace function public.get_space_intelligence(
  p_space_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'space_id', p_space_id,
    'entity_type', 'space',
    'entity_id', p_space_id,
    'published', public.build_intelligence_payload(p_space_id, 'space', p_space_id, 'published'),
    'draft', public.build_intelligence_payload(p_space_id, 'space', p_space_id, 'draft'),
    'referenced_in', '[]'::jsonb
  );
end;
$$;

revoke execute on function public.get_space_intelligence(uuid) from public;
revoke execute on function public.get_space_intelligence(uuid) from anon;
grant  execute on function public.get_space_intelligence(uuid) to authenticated;

-- =============================================================================
-- list_primary_intelligence
-- =============================================================================
-- backs Latest from Stout, the browse view, and the Referenced in section.

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
        or exists (
          select 1 from public.primary_intelligence_revisions rev
          where rev.primary_intelligence_id = p.id
            and rev.edited_by = p_author_id
        )
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
            'contributors', coalesce(
              (
                select jsonb_agg(distinct rev.edited_by)
                from public.primary_intelligence_revisions rev
                where rev.primary_intelligence_id = x.id
              ),
              '[]'::jsonb
            )
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
