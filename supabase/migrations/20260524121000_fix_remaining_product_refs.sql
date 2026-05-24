-- migration: 20260524121000_fix_remaining_product_refs
-- purpose: update all remaining RPCs that still reference the old
--          public.products table (now public.assets), product_id columns
--          (now asset_id on trials and events), or entity_type = 'product'
--          (now 'asset'). These functions were defined in earlier migrations
--          and not updated during the indication model redesign.
--
-- renames applied:
--   public.products           -> public.assets
--   product_id (trials/events)-> asset_id
--   product_name (jsonb keys) -> asset_name
--   entity_type = 'product'   -> entity_type = 'asset'
--   v_product_id (local vars) -> v_asset_id
--   v_products (local vars)   -> v_assets
--   product_mechanisms_of_action -> asset_mechanisms_of_action
--   product_routes_of_administration -> asset_routes_of_administration
--
-- affected functions:
--   permanently_delete_space, upsert_primary_intelligence (10-param),
--   get_primary_intelligence_history, get_catalyst_detail,
--   build_intelligence_payload (5-param), _seed_demo_primary_intelligence,
--   get_product_detail_with_intelligence -> get_asset_detail_with_intelligence

-- =============================================================================
-- 0. fix entity_type CHECK constraints missed by 20260524120200
-- =============================================================================
-- The rename migration updated data (entity_type 'product' -> 'asset') but
-- forgot to update the CHECK constraints on primary_intelligence and
-- primary_intelligence_links. Fix them here so that new inserts with
-- entity_type = 'asset' are accepted.

alter table public.primary_intelligence
  drop constraint if exists primary_intelligence_entity_type_check;
alter table public.primary_intelligence
  add constraint primary_intelligence_entity_type_check
  check (entity_type in ('trial', 'marker', 'company', 'asset', 'product', 'space'));

alter table public.primary_intelligence_links
  drop constraint if exists primary_intelligence_links_entity_type_check;
alter table public.primary_intelligence_links
  add constraint primary_intelligence_links_entity_type_check
  check (entity_type in ('trial', 'marker', 'company', 'asset', 'product'));

-- =============================================================================
-- 1. permanently_delete_space
-- =============================================================================
-- source: 20260521120400_space_archive_lifecycle.sql
-- changes: public.products -> public.assets, v_products -> v_assets,
--          'products' -> 'assets' in jsonb

create or replace function public.permanently_delete_space(p_space_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- @audit:tier1
declare
  v_tenant_id    uuid;
  v_agency_id    uuid;
  v_space_name   text;
  v_archived_at  timestamptz;
  v_is_admin     boolean;
  v_is_owner     boolean;
  v_counts       jsonb;
  v_companies    int;
  v_assets       int;
  v_trials       int;
  v_markers      int;
  v_materials    int;
  v_events       int;
  v_pi           int;
  v_marker_types int;
  v_actor_role   text;
begin
  if auth.uid() is null then
    raise exception 'permanently_delete_space: must be authenticated'
      using errcode = '28000';
  end if;

  -- existence + parent linkage for both authz and audit scope.
  select s.tenant_id, s.name, s.archived_at, t.agency_id
    into v_tenant_id, v_space_name, v_archived_at, v_agency_id
    from public.spaces s
    join public.tenants t on t.id = s.tenant_id
    where s.id = p_space_id;

  if v_tenant_id is null then
    raise exception 'permanently_delete_space: space % not found', p_space_id
      using errcode = 'P0002';
  end if;

  v_is_admin := public.is_platform_admin();
  v_is_owner := public.is_tenant_member(v_tenant_id, array['owner']);

  if not (v_is_admin or v_is_owner) then
    raise exception 'permanently_delete_space: not authorized to permanently delete space %', p_space_id
      using errcode = '42501';
  end if;

  -- archive gate: non-admins must archive first; admins override.
  if v_archived_at is null and not v_is_admin then
    raise exception 'permanently_delete_space: space must be archived first (call archive_space)'
      using errcode = '42501';
  end if;

  -- capture dependent counts BEFORE the cascade runs so the audit metadata
  -- reflects what was actually purged. these queries each take the space_id
  -- partial index, so even a populated space is cheap.
  select count(*)::int into v_companies    from public.companies    where space_id = p_space_id;
  select count(*)::int into v_assets       from public.assets       where space_id = p_space_id;
  select count(*)::int into v_trials       from public.trials       where space_id = p_space_id;
  select count(*)::int into v_markers      from public.markers      where space_id = p_space_id;
  select count(*)::int into v_materials    from public.materials    where space_id = p_space_id;
  select count(*)::int into v_events       from public.events       where space_id = p_space_id;
  select count(*)::int into v_pi           from public.primary_intelligence where space_id = p_space_id;
  select count(*)::int into v_marker_types from public.marker_types where space_id = p_space_id;

  v_counts := jsonb_build_object(
    'name',          v_space_name,
    'companies',     v_companies,
    'assets',        v_assets,
    'trials',        v_trials,
    'markers',       v_markers,
    'materials',     v_materials,
    'events',        v_events,
    'primary_intelligence', v_pi,
    'marker_types',  v_marker_types,
    'was_archived',  v_archived_at is not null,
    'platform_admin_override', v_is_admin and v_archived_at is null
  );

  -- ordered delete: markers first so the BEFORE DELETE _log_marker_change
  -- trigger writes marker_changes audit rows while the spaces row still
  -- exists (the FK on marker_changes.space_id rejects orphaned inserts).
  -- the existing materials AFTER DELETE trigger (20260521120000) enqueues
  -- every materials.file_path into r2_pending_deletes as the cascade walks.
  delete from public.markers where space_id = p_space_id;
  delete from public.spaces  where id = p_space_id;

  -- ===== audit instrumentation =====
  v_actor_role := case
    when v_is_admin and not v_is_owner then 'platform_admin'
    else 'tenant_owner'
  end;
  perform set_config('audit.actor_role', v_actor_role, true);
  perform set_config('audit.rpc_name', 'permanently_delete_space', true);
  perform public.record_audit_event(
    'space.deleted', 'rpc', 'space', p_space_id,
    v_agency_id, v_tenant_id, p_space_id,
    v_counts
  );

  return v_counts;
end;
$$;

-- =============================================================================
-- 2. upsert_primary_intelligence (10-param, from 20260512000000)
-- =============================================================================
-- changes: entity_type 'product' -> 'asset' in validation

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
  if not public.is_agency_member_of_space(p_space_id) then
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
-- 3. get_primary_intelligence_history (from 20260512000000)
-- =============================================================================
-- changes: 'product' -> 'asset', public.products -> public.assets in link
--          entity_name resolution

create or replace function public.get_primary_intelligence_history(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
      )
    )
  );
end;
$$;

-- =============================================================================
-- 4. build_intelligence_payload (5-param, from 20260510130000)
-- =============================================================================
-- changes: 'product' -> 'asset', public.products -> public.assets in link
--          entity_name resolution

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
               when 'asset'   then (select a.name from public.assets a where a.id = l.entity_id)
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

-- =============================================================================
-- 5. get_product_detail_with_intelligence -> get_asset_detail_with_intelligence
-- =============================================================================
-- DROP the old function, CREATE the renamed version.
-- changes: function name, public.products -> public.assets,
--          entity_type 'product' -> 'asset', param name

drop function if exists public.get_product_detail_with_intelligence(uuid);

create or replace function public.get_asset_detail_with_intelligence(
  p_asset_id uuid
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
  select space_id into v_space_id from public.assets where id = p_asset_id;
  if v_space_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'space_id', v_space_id,
    'entity_type', 'asset',
    'entity_id', p_asset_id,
    'published', public.build_intelligence_payload(v_space_id, 'asset', p_asset_id, 'published'),
    'draft', public.build_intelligence_payload(v_space_id, 'asset', p_asset_id, 'draft'),
    'referenced_in', public.referenced_in_entity(v_space_id, 'asset', p_asset_id)
  );
end;
$$;

revoke execute on function public.get_asset_detail_with_intelligence(uuid) from public;
revoke execute on function public.get_asset_detail_with_intelligence(uuid) from anon;
grant  execute on function public.get_asset_detail_with_intelligence(uuid) to authenticated;

-- =============================================================================
-- 6. get_catalyst_detail (from 20260503070000)
-- =============================================================================
-- changes: public.products -> public.assets, t.product_id -> t.asset_id,
--          product_name/product_id -> asset_name/asset_id in jsonb keys,
--          v_product_id -> v_asset_id, e.product_id -> e.asset_id

create or replace function public.get_catalyst_detail(
  p_marker_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_catalyst   jsonb;
  v_trial_id   uuid;
  v_asset_id   uuid;
  v_company_id uuid;
  v_upcoming   jsonb;
  v_related    jsonb;
begin
  -- Fetch main catalyst data
  select
    jsonb_build_object(
      'marker_id',              m.id,
      'title',                  m.title,
      'event_date',             m.event_date,
      'end_date',               m.end_date,
      'category_name',          mc.name,
      'category_id',            mc.id,
      'marker_type_name',       mt.name,
      'marker_type_icon',       mt.icon,
      'marker_type_color',      mt.color,
      'marker_type_shape',      mt.shape,
      'marker_type_inner_mark', mt.inner_mark,
      'is_projected',           m.is_projected,
      'projection',             m.projection,
      'no_longer_expected',     m.no_longer_expected,
      'company_name',           co.name,
      'company_id',             co.id,
      'company_logo_url',       co.logo_url,
      'asset_name',             pr.name,
      'asset_id',               pr.id,
      'trial_name',             t.name,
      'trial_id',               t.id,
      'trial_phase',            t.phase,
      'recruitment_status',     t.recruitment_status,
      'description',            m.description,
      'source_url',             m.source_url,
      -- new fields for the CT.gov provenance UI block
      'metadata',               m.metadata,
      'ctgov_last_synced_at',   t.ctgov_last_synced_at
    ),
    t.id,
    pr.id,
    co.id
  into v_catalyst, v_trial_id, v_asset_id, v_company_id
  from public.markers m
  join public.marker_types mt on mt.id = m.marker_type_id
  join public.marker_categories mc on mc.id = mt.category_id
  left join lateral (
    select ma_inner.trial_id
    from public.marker_assignments ma_inner
    where ma_inner.marker_id = m.id
    limit 1
  ) ma on true
  left join public.trials t on t.id = ma.trial_id
  left join public.assets pr on pr.id = t.asset_id
  left join public.companies co on co.id = pr.company_id
  where m.id = p_marker_id;

  if v_catalyst is null then
    return null;
  end if;

  -- Upcoming markers for the same trial (next 5, excluding current)
  if v_trial_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'marker_id',        sub.id,
      'title',            sub.title,
      'event_date',       sub.event_date,
      'marker_type_name', sub.mt_name,
      'is_projected',     sub.is_projected
    )), '[]'::jsonb)
    into v_upcoming
    from (
      select m2.id, m2.title, m2.event_date, mt2.name as mt_name, m2.is_projected
      from public.markers m2
      join public.marker_types mt2 on mt2.id = m2.marker_type_id
      join public.marker_assignments ma2 on ma2.marker_id = m2.id
      where ma2.trial_id = v_trial_id
        and m2.event_date >= current_date
        and m2.id != p_marker_id
        and m2.no_longer_expected = false
      order by m2.event_date asc
      limit 5
    ) sub;
  else
    v_upcoming := '[]'::jsonb;
  end if;

  -- Related events for the same trial/asset/company (last 10)
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id',      sub.id,
    'title',         sub.title,
    'event_date',    sub.event_date,
    'category_name', sub.cat_name
  )), '[]'::jsonb)
  into v_related
  from (
    select e.id, e.title, e.event_date, ec.name as cat_name
    from public.events e
    join public.event_categories ec on ec.id = e.category_id
    where (
      (v_trial_id   is not null and e.trial_id   = v_trial_id)
      or (v_asset_id is not null and e.asset_id = v_asset_id)
      or (v_company_id is not null and e.company_id = v_company_id)
    )
    order by e.event_date desc
    limit 10
  ) sub;

  return jsonb_build_object(
    'catalyst',         v_catalyst,
    'upcoming_markers', v_upcoming,
    'related_events',   v_related
  );
end;
$$;

-- =============================================================================
-- 7. _seed_demo_primary_intelligence (from 20260512000000)
-- =============================================================================
-- changes: 'product' -> 'asset' in primary_intelligence_links entity_type
-- NOTE: _seed_ids lookups remain entity_type = 'product' because that is the
-- key used in the _seed_ids temp table (populated by _seed_demo_data).

create or replace function public._seed_demo_primary_intelligence(
  p_space_id uuid,
  p_uid uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t_summit         uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_summit');
  t_redefine_1     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_redefine_1');
  t_sequoia_hcm    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_sequoia_hcm');
  t_fineart_hf     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_fineart_hf');
  t_vk2735_sc_p2   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_vk2735_sc_p2');
  t_attribute_cm   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attribute_cm');
  t_attr_act       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attr_act');
  t_maritide_p2    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_maritide_p2');
  t_attain_1       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attain_1');
  t_achieve_1      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_achieve_1');
  t_maple_hcm      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_maple_hcm');
  t_deliver        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_deliver');
  t_emperor_preserved uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_emperor_preserved');
  t_paradigm_hf    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_paradigm_hf');

  c_apex     uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_apex');
  c_helios   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_helios');
  c_solara   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_solara');
  c_meridian uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');
  c_vantage  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_vantage');
  c_cascade  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cascade');

  p_farxiga      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_farxiga');
  p_jardiance    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_jardiance');
  p_kerendia     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_kerendia');
  p_entresto     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_entresto');
  p_wegovy       uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  p_zepbound     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  p_retatrutide  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_retatrutide');
  p_vk2735_sc    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_sc');
  p_camzyos      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_camzyos');
  p_vyndaqel     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vyndaqel');
  p_orforglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_orforglipron');
  p_rybelsus     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_rybelsus');
  p_azd5004      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_azd5004');
  p_danuglipron  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_danuglipron');
  p_maritide     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_maritide');
  p_mounjaro     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mounjaro');

  m_orforglipron_read uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_orforglipron_read');

  pi_summit       uuid := gen_random_uuid();
  pi_redefine     uuid := gen_random_uuid();
  pi_sequoia      uuid := gen_random_uuid();
  pi_finearts     uuid := gen_random_uuid();
  pi_vk2735       uuid := gen_random_uuid();
  pi_attribute    uuid := gen_random_uuid();
  pi_pfizer       uuid := gen_random_uuid();
  pi_thematic     uuid := gen_random_uuid();
  pi_orfo_draft   uuid := gen_random_uuid();
  pi_maritide_d   uuid := gen_random_uuid();
begin
  -- Read 1: SUMMIT trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_summit, p_space_id, 'trial', t_summit, 'published',
    'Tirzepatide HFpEF readout puts a GLP-1 in the cardiology guideline conversation for the first time',
    E'SUMMIT is the first dedicated outcomes trial showing that a GLP-1-class agent improves both KCCQ-CSS and clinical events in obese HFpEF patients. The composite of CV death and worsening HF events came in favorable, with KCCQ-CSS effect roughly twice the magnitude of the SGLT2 HFpEF wins. The competitive read: tirzepatide is no longer just an obesity drug, it is now a credible HFpEF treatment that will compete for guideline real estate alongside SGLT2 inhibitors and finerenone.',
    E'A guideline-grade HFpEF position for tirzepatide expands the addressable cardiology budget meaningfully. Reframes the competitive map: the HFpEF lane now includes incretins, SGLT2is, and nsMRAs, with combination therapy the likely steady state. Recommend cardiology KOL outreach in the next 60 days.',
    p_uid, now() - interval '14 days', now() - interval '14 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_summit, 'asset', p_farxiga,   'Same class',     'SGLT2 incumbent in HFpEF', 0),
    (pi_summit, 'asset', p_jardiance, 'Competitor',     'SGLT2 incumbent in HFpEF', 1),
    (pi_summit, 'asset', p_kerendia,  'Same class',     'nsMRA HFpEF entrant',      2),
    (pi_summit, 'asset', p_entresto,  'Predecessor',    'ARNI HFrEF predecessor',   3);

  -- Read 2: REDEFINE-1 trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_redefine, p_space_id, 'trial', t_redefine_1, 'published',
    'CagriSema misses 25% bar: Novos combo defense thesis under structural pressure',
    E'REDEFINE-1 delivered 22.7% weight loss at 68 weeks, below the ~25% bar Street consensus had built around CagriSema as the next-generation Novo defense against tirzepatide. The amylin combination thesis (additive to GLP-1) is not invalidated but the magnitude of incremental benefit is smaller than priced. Stock down 20% on the day reflects a structural rerating of Novos pipeline value rather than a simple miss.',
    E'Repositions Novo as a defender rather than a class-defining innovator in obesity. M&A and licensing posture likely to shift; Novo may need to acquire next-class assets rather than rely on internal combos. Recommend reviewing Novo BD activity and investor messaging at next earnings.',
    p_uid, now() - interval '13 days', now() - interval '13 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_redefine, 'asset', p_wegovy,      'Predecessor',    'Same molecule, single-agent', 0),
    (pi_redefine, 'asset', p_zepbound,    'Competitor',     'Tirzepatide obesity benchmark', 1),
    (pi_redefine, 'asset', p_retatrutide, 'Future window',  'Next-class triple agonist',     2),
    (pi_redefine, 'asset', p_vk2735_sc,   'Future window',  'Challenger GIP/GLP-1',          3);

  -- Read 3: SEQUOIA-HCM trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_sequoia, p_space_id, 'trial', t_sequoia_hcm, 'published',
    'Aficamten NDA filed: Cytokinetics vs BMS Camzyos becomes a real two-horse race',
    E'Cytokinetics filed the aficamten NDA for oHCM in Q3 2024 on the basis of a SEQUOIA-HCM readout that closely tracks EXPLORER-HCM with a cleaner safety story. The competitive setup post-PDUFA is now genuinely contested: BMS Camzyos has first-mover scale, but aficamten has a meaningfully simpler dosing regimen and faster onset. The HCM market expands fastest if both products co-promote diagnosis, slowest if they trench around incumbent prescribers.',
    E'A two-product oHCM market drives diagnosis volume up; both companies benefit if the segment doubles. Recommend a refreshed market sizing within 60 days assuming both are launched. Watch for partnership or co-promote commentary, especially from Cytokinetics on commercial scale-up.',
    p_uid, now() - interval '11 days', now() - interval '11 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_sequoia, 'asset', p_camzyos,    'Competitor',  'BMS first-mover in oHCM',    0),
    (pi_sequoia, 'company', c_solara,     'Same class',  'Cytokinetics myosin platform', 1),
    (pi_sequoia, 'company', c_helios,     'Competitor',  'BMS HCM franchise',           2),
    (pi_sequoia, 'trial',   t_maple_hcm,  'Future window', 'Next aficamten readout',    3);

  -- Read 4: FINEARTS-HF trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_finearts, p_space_id, 'trial', t_fineart_hf, 'published',
    'Finerenone HFpEF win opens a non-SGLT2 / non-ARNI lane in HFpEF',
    E'FINEARTS-HF is the first nsMRA win in HFpEF/HFmrEF, with a 16% reduction in CV death and total HF events over a 32-month median follow-up. The clinical implication is meaningful: HFpEF treatment can no longer be characterized as SGLT2-only. The combination treatment cocktail (SGLT2 + finerenone, plus the GLP-1 lane opening from SUMMIT) is the new HFpEF reality, and that has implications for both cardiology economics and trial design.',
    E'HFpEF as a multi-mechanism disease unlocks combination economics for cardiology benefits managers. Recommend updating the HFpEF treatment-cocktail forecast assuming SGLT2 + finerenone as the new baseline, with tirzepatide layered on for obese HFpEF.',
    p_uid, now() - interval '9 days', now() - interval '9 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_finearts, 'trial', t_deliver,           'Same class',  'Dapagliflozin HFpEF win',         0),
    (pi_finearts, 'trial', t_emperor_preserved, 'Same class',  'Empagliflozin HFpEF win',         1),
    (pi_finearts, 'trial', t_paradigm_hf,       'Predecessor', 'Entresto HFrEF; PARAGON-HF HFpEF non-win read-across', 2);

  -- Read 5: VK2735 SC P2 trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_vk2735, p_space_id, 'trial', t_vk2735_sc_p2, 'published',
    'Viking VK2735 P2: takeout target or independent path, both scenarios under-priced',
    E'VK2735 SC delivered ~13-15% body weight reduction at 13 weeks, competitive with the front of the tirzepatide and semaglutide ramp. Viking is now under serious M&A consideration and the question is whether takeout pricing reflects a one-asset thesis (VK2735) or a platform thesis (oral analog, NASH, broader cardiometabolic). The asymmetry in the market is that takeout floors keep moving up as P3 readout proximity increases, while standalone valuation requires a P3 readout to be priced fully.',
    E'Both takeout and independent paths are worth modeling because Viking captures upside in both. Recommend updating the BD-target watch with Viking near the top of the obesity asset queue.',
    p_uid, now() - interval '7 days', now() - interval '7 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_vk2735, 'asset', p_zepbound,  'Competitor',     'Tirzepatide obesity benchmark', 0),
    (pi_vk2735, 'asset', p_wegovy,    'Competitor',     'Semaglutide obesity benchmark', 1),
    (pi_vk2735, 'asset', p_maritide,  'Same class',     'Differentiated incretin combo', 2),
    (pi_vk2735, 'company', c_cascade,   'Future window',  'Roche obesity acquirer profile',3);

  -- Read 6: ATTRibute-CM trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_attribute, p_space_id, 'trial', t_attribute_cm, 'published',
    'Acoramidis launches into a Vyndaqel-saturated market: switching dynamics will define 2026',
    E'BridgeBio Attruby launched December 2024 into a Vyndaqel-saturated ATTR-CM market. The clinical case for switching is supportable but not overwhelming: ATTRibute-CM was placebo-controlled, no head-to-head data exist, and Vyndaqel has multi-year real-world experience plus established prior-auth pathways. The 2026 question is how aggressively cardiology specialty pharmacies and TTR-CM specialists test switching, and whether payers create switch-friendly utilization management.',
    E'Switching velocity is the key 2026 metric. Recommend a quarterly tracker on specialty pharmacy script data plus payer policy changes. Both companies likely benefit from market expansion (undiagnosed pool) as long as awareness investments continue.',
    p_uid, now() - interval '5 days', now() - interval '5 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_attribute, 'asset', p_vyndaqel, 'Competitor',  'Pfizer first-mover ATTR-CM', 0),
    (pi_attribute, 'company', c_apex,     'Competitor',  'Pfizer ATTR-CM franchise',   1),
    (pi_attribute, 'trial',   t_attr_act, 'Predecessor', 'Vyndaqel pivotal trial',     2);

  -- Read 7: Pfizer (company)
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_pfizer, p_space_id, 'company', c_apex, 'published',
    'Pfizers cardiometabolic exit: danuglipron discontinuation reframes the GLP-1 oral race',
    E'Pfizer halted danuglipron in December 2023 after high incidence of adverse events, effectively ending Pfizers near-term oral GLP-1 ambitions. The signal value is greater than the asset value: the drug class is structurally harder for small molecules than for peptides, which reads through to Lilly orforglipron and AZD5004. Pfizer has since signaled a shift away from cardiometabolic R&D, leaving Vyndaqel as the franchises remaining anchor.',
    E'Pfizers exit narrows the oral GLP-1 field meaningfully and concentrates risk on Lilly. Recommend updating the oral-GLP-1 race scoreboard and re-pricing implied probabilities of success for orforglipron given the cleaner field.',
    p_uid, now() - interval '4 days', now() - interval '4 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_pfizer, 'asset', p_orforglipron, 'Future window', 'Next oral GLP-1 readout',         0),
    (pi_pfizer, 'asset', p_rybelsus,     'Same class',    'Approved oral GLP-1 (peptide)',   1),
    (pi_pfizer, 'asset', p_azd5004,      'Competitor',    'AZ oral GLP-1 entrant',           2);

  -- Read 8: Space (engagement-thematic)
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_thematic, p_space_id, 'space', p_space_id, 'published',
    'Cardiometabolic catalyst cluster H2 2026: TRIUMPH-1, ATTAIN-1, ACHIEVE-1, MAPLE-HCM in one window',
    E'Four decision-grade catalysts cluster across May-October 2026: ATTAIN-1 (orforglipron obesity), ACHIEVE-1 (orforglipron T2D), TRIUMPH-1 (retatrutide obesity), and MAPLE-HCM (aficamten head-to-head). Three are Lilly-anchored, one is Cytokinetics. The cluster compresses analyst and KOL bandwidth and creates short windows where multiple readouts must be interpreted in parallel.',
    E'Recommend a daily cadence briefing during the May-October 2026 window plus pre-positioning analyst notes 2-3 weeks before each readout. Cluster-window coverage is the single most leveraged use of analyst time this year.',
    p_uid, now() - interval '2 days', now() - interval '2 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_thematic, 'company', c_meridian, 'Future window', 'Lilly multi-asset readout cluster', 0),
    (pi_thematic, 'company', c_vantage,  'Future window', 'Novo defensive positioning',        1),
    (pi_thematic, 'company', c_solara,   'Future window', 'Cytokinetics MAPLE-HCM readout',    2);

  -- Read 9: Draft, orforglipron readout marker
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_orfo_draft, p_space_id, 'marker', m_orforglipron_read, 'draft',
    'Pre-read framework for the orforglipron Phase 3 cluster',
    E'Drafting the pre-read framework before ATTAIN-1 and ACHIEVE-1 readouts. Three scenarios: (1) clean efficacy + clean tolerability validates oral GLP-1 as a credible peptide alternative; (2) acceptable efficacy with GI tolerability matching SC peptides keeps the oral lane open but commercially constrained; (3) tolerability footprint resembling danuglipron triggers a re-rating of the entire small-molecule GLP-1 thesis.',
    E'',
    p_uid, now() - interval '6 hours', now() - interval '6 hours'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_orfo_draft, 'trial',   t_attain_1,     'Future window', 'Obesity P3 readout',      0),
    (pi_orfo_draft, 'trial',   t_achieve_1,    'Future window', 'T2D P3 readout',          1),
    (pi_orfo_draft, 'asset', p_danuglipron,  'Predecessor',   'Pfizer oral GLP-1 failure', 2);

  -- Read 10: Draft, MariTide P2 trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_maritide_d, p_space_id, 'trial', t_maritide_p2, 'draft',
    'MariTide differentiation thesis: GIPR antagonism vs agonism',
    E'MariTide is the only late-stage incretin program betting on GIPR antagonism rather than agonism (combined with GLP-1 agonism). The mechanistic case rests on whether GIPR signaling drives or counters obesity in chronic dosing. P2 readout supports the antagonism hypothesis but the magnitude of effect (~20% at 52 weeks) is competitive rather than category-leading. Drafting the second-mover positioning thesis ahead of P3 design announcements.',
    E'',
    p_uid, now() - interval '2 hours', now() - interval '2 hours'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_maritide_d, 'asset', p_mounjaro,   'Same class',  'GIP/GLP-1 dual agonist incumbent', 0),
    (pi_maritide_d, 'asset', p_zepbound,   'Competitor',  'Tirzepatide obesity benchmark',    1),
    (pi_maritide_d, 'asset', p_vk2735_sc,  'Same class',  'Other GIP/GLP-1 challenger',       2);
end;
$$;

comment on function public._seed_demo_primary_intelligence(uuid, uuid) is
  'Seeds 8 published primary intelligence reads (6 trial-anchored, 1 company-anchored, 1 space-thematic) plus 2 drafts. Writes summary_md with entity_type=asset for asset links.';
