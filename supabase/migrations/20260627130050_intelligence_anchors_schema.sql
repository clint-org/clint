-- migration: 20260627130000_intelligence_anchors_schema
-- purpose: make an entity able to own MANY primary-intelligence briefs.
--   introduce primary_intelligence_anchors (the "brief": entity binding +
--   is_lead + display_order). primary_intelligence rows become version rows
--   hanging off an anchor via anchor_id. entity_type/entity_id move off
--   primary_intelligence onto the anchor. re-key the one-published index and
--   the version_number trigger from the entity triple to anchor_id. rewire the
--   polymorphic cleanup trigger and the space-delete PI cleanup to delete
--   anchors (versions/links/revisions cascade via real FKs).
--
-- note: timestamp 20260627120000 was already used by dashboard_data_drop_notes;
--       this migration uses 20260627130000.

-- 1. anchors table -----------------------------------------------------------
create table public.primary_intelligence_anchors (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  entity_type text not null check (entity_type in ('trial','company','product','space')),
  entity_id uuid not null,
  is_lead boolean not null default false,
  display_order int not null default 0,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.primary_intelligence_anchors is
  'One row per intelligence brief. Owns the entity binding (entity_type, '
  'entity_id, polymorphic, no FK), the pinned-lead flag, and manual order. '
  'primary_intelligence rows are versions of an anchor.';

create index idx_pi_anchors_entity
  on public.primary_intelligence_anchors (space_id, entity_type, entity_id, display_order);

-- one pinned lead per entity
create unique index primary_intelligence_one_lead_per_entity
  on public.primary_intelligence_anchors (space_id, entity_type, entity_id)
  where is_lead;

alter table public.primary_intelligence_anchors enable row level security;

-- grant select so the authenticated role can reach the table through PostgREST
-- (writes go through SECURITY DEFINER RPCs — insert/update/delete not granted here)
grant select on public.primary_intelligence_anchors to authenticated;

-- 2. add anchor_id to primary_intelligence (nullable first for backfill) -----
alter table public.primary_intelligence
  add column anchor_id uuid references public.primary_intelligence_anchors (id) on delete cascade;

-- 3. backfill: one anchor per existing (space, entity_type, entity_id) group.
--    today each entity has at most one brief (archived rows are its versions),
--    so every existing group becomes exactly one anchor, marked lead.
--    skip rows whose entity_type='marker' (vestigial; never surfaced) by
--    deleting them -- markers are not owners in the new model.
delete from public.primary_intelligence where entity_type = 'marker';

with grp as (
  select distinct space_id, entity_type, entity_id
    from public.primary_intelligence
), ins as (
  insert into public.primary_intelligence_anchors
    (space_id, entity_type, entity_id, is_lead, display_order)
  select space_id, entity_type, entity_id, true, 0 from grp
  returning id, space_id, entity_type, entity_id
)
update public.primary_intelligence p
   set anchor_id = ins.id
  from ins
 where p.space_id = ins.space_id
   and p.entity_type = ins.entity_type
   and p.entity_id = ins.entity_id;

-- 4. tighten: anchor_id required, drop the entity columns + old indexes --------
alter table public.primary_intelligence alter column anchor_id set not null;

drop index if exists primary_intelligence_one_published;
drop index if exists idx_primary_intelligence_entity;
drop index if exists idx_primary_intelligence_anchor_versions;

alter table public.primary_intelligence drop column entity_type;
alter table public.primary_intelligence drop column entity_id;

create unique index primary_intelligence_one_published_per_anchor
  on public.primary_intelligence (anchor_id)
  where state = 'published';

create index idx_primary_intelligence_anchor_versions
  on public.primary_intelligence (anchor_id, version_number desc)
  where state in ('published','archived','withdrawn');

create index idx_primary_intelligence_anchor
  on public.primary_intelligence (anchor_id);

-- 5. rescope version_number trigger to anchor_id -----------------------------
create or replace function public.assign_primary_intelligence_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.state = 'published' and new.version_number is null then
    new.version_number := coalesce((
      select max(version_number) + 1
        from public.primary_intelligence
       where anchor_id = new.anchor_id
         and id is distinct from new.id
         and version_number is not null
    ), 1);
    new.published_at := now();
  end if;
  return new;
end;
$$;

-- 6. RLS on anchors: single SELECT policy (avoids multiple-permissive-policies
--    WARN): agency members see all anchors in the space; space members see only
--    anchors that have at least one published version.
create policy "primary_intelligence_anchors read"
on public.primary_intelligence_anchors for select to authenticated
using (
  public.is_agency_member_of_space(space_id)
  or (
    public.has_space_access(space_id)
    and exists (
      select 1 from public.primary_intelligence p
      where p.anchor_id = primary_intelligence_anchors.id
        and p.state = 'published'
    )
  )
);

create policy "pi_anchors agency can insert"
on public.primary_intelligence_anchors for insert to authenticated
with check ( public.is_agency_member_of_space(space_id) );

create policy "pi_anchors agency can update"
on public.primary_intelligence_anchors for update to authenticated
using ( public.is_agency_member_of_space(space_id) )
with check ( public.is_agency_member_of_space(space_id) );

create policy "pi_anchors agency can delete"
on public.primary_intelligence_anchors for delete to authenticated
using ( public.is_agency_member_of_space(space_id) );

-- 7. rewire polymorphic cleanup: delete anchors by (entity_type, entity_id)
--    (versions/links/revisions cascade), AND still delete link-target rows.
create or replace function public._cleanup_polymorphic_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := tg_argv[0];
begin
  -- links that POINT TO the deleted entity as a target
  delete from public.primary_intelligence_links
    where entity_type = v_type and entity_id = old.id;
  -- briefs OWNED by the deleted entity (only the four owner types match)
  delete from public.primary_intelligence_anchors
    where entity_type = v_type and entity_id = old.id;
  delete from public.material_links
    where entity_type = v_type and entity_id = old.id;
  return old;
end;
$$;

-- 8. rebase permanently_delete_space: count anchors (briefs) not PI versions;
--    add explicit anchor delete before the space cascade fires. based on live
--    definition as of this migration; @audit:tier1 and record_audit_event()
--    preserved intact.
create or replace function public.permanently_delete_space(p_space_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  -- count anchors (briefs) not PI versions: each anchor is one intelligence brief
  select count(*)::int into v_pi           from public.primary_intelligence_anchors where space_id = p_space_id;
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
  -- bypass the ct.gov marker lock for the teardown (system delete, not an
  -- analyst edit).
  perform set_config('clint.ctgov_seeding', 'on', true);
  delete from public.markers where space_id = p_space_id;
  perform set_config('clint.ctgov_seeding', 'off', true);
  -- explicitly delete anchors (PI versions + links cascade via anchor_id FK)
  delete from public.primary_intelligence_anchors where space_id = p_space_id;
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
$function$;

-- 9. inline smoke test --------------------------------------------------------
do $$
declare
  v_count int;
begin
  -- anchors table exists and has the lead uniqueness guard
  perform 1 from pg_indexes
   where indexname = 'primary_intelligence_one_lead_per_entity';
  if not found then
    raise exception 'smoke FAIL: one-lead-per-entity index missing';
  end if;
  -- primary_intelligence no longer has entity_type
  select count(*) into v_count from information_schema.columns
   where table_schema='public' and table_name='primary_intelligence'
     and column_name in ('entity_type','entity_id');
  if v_count <> 0 then
    raise exception 'smoke FAIL: entity columns still on primary_intelligence';
  end if;
  raise notice 'anchors schema smoke ok';
end $$;

notify pgrst, 'reload schema';
