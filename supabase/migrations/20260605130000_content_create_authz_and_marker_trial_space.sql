-- migration: 20260605130000_content_create_authz_and_marker_trial_space
-- purpose: close two authorization gaps in the content-write path that a
--          security audit surfaced.
--
-- Gap 1 -- viewer write escalation (privilege escalation).
--   The shared entity-create RPCs (create_company, create_asset, create_trial,
--   create_marker, create_event) and link_asset_moa_roa are SECURITY DEFINER
--   and granted to `authenticated`, but gate only on has_space_access(p_space_id)
--   with NO role array. has_space_access(space_id) returns true for ANY space
--   member -- including a `viewer`. Because these functions are SECURITY
--   DEFINER they bypass the table RLS policies, which DO require
--   has_space_access(space_id, array['owner','editor']) for writes. Net effect:
--   a space viewer (read-only role) can call these RPCs directly via PostgREST
--   and create companies/assets/trials/markers/events, defeating the read-only
--   role contract.
--
--   Fix: every content-create RPC now gates on
--   has_space_access(p_space_id, array['owner','editor']), matching the table
--   write policies. commit_source_import is NOT recreated here: it is itself
--   SECURITY DEFINER but auth.uid() is preserved across nested SECURITY DEFINER
--   calls, so a viewer's import now fails at the first inner create_company /
--   create_asset call and the whole import transaction rolls back. Tightening
--   the leaf RPCs closes the import path transitively without re-emitting the
--   ~200-line commit_source_import body (and the transcription risk that
--   carries).
--
-- Gap 2 -- cross-space marker->trial assignment (tenant/space isolation).
--   create_marker and update_marker_assignments validate access to the
--   marker's space but never validate that each trial in p_trial_ids lives in
--   that same space. The marker_assignments INSERT/UPDATE RLS policies have the
--   same blind spot -- they check the marker's space via has_space_access but
--   not the trial's space. The trial FK only enforces existence. So an editor
--   in space A could link a marker in space A to a trial in space B, breaking
--   the space-isolation invariant (and confusing any downstream join of
--   markers and trials).
--
--   Fix: both RPCs now reject any trial_id whose space_id differs from the
--   marker's space, and the marker_assignments INSERT/UPDATE policies require
--   the trial to share the marker's space.
--
-- affected objects (all `create or replace` / policy recreation -- no data
-- migration):
--   public.create_company            (gate -> owner/editor)
--   public.create_asset              (gate -> owner/editor)
--   public.create_trial              (gate -> owner/editor)
--   public.create_marker             (gate -> owner/editor; + trial-space check)
--   public.create_event             (gate -> owner/editor)
--   public.link_asset_moa_roa        (gate -> owner/editor)
--   public.update_marker_assignments (+ trial-space check)
--   marker_assignments INSERT policy (+ trial-space match)
--   marker_assignments UPDATE policy (+ trial-space match)
--
-- related:
--   - 20260526120100_shared_entity_create_rpcs.sql           (create_* origin)
--   - 20260528060000_commit_source_import_redelegate_and_backfill.sql (latest create_asset / link_asset_moa_roa)
--   - 20260528100000_update_marker_assignments_rpc.sql       (update_marker_assignments origin)
--   - 20260412130100_marker_system_redesign.sql              (marker_assignments RLS origin)
--   - 20260429010000_owner_only_explicit_space_access.sql    (has_space_access role semantics)


-- =============================================================================
-- 1. create_company -- gate on owner/editor
-- =============================================================================

create or replace function public.create_company(
  p_space_id      uuid,
  p_name          text,
  p_logo_url      text     default null,
  p_source_doc_id uuid     default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if not public.has_space_access(p_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.companies (name, logo_url, space_id, created_by, source_doc_id)
    values (p_name, p_logo_url, p_space_id, v_uid, p_source_doc_id)
    returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_company(uuid, text, text, uuid) is
  'Shared entity-create RPC for companies. Used by both commit_source_import and the Angular UI. Caller must hold owner/editor on the space.';


-- =============================================================================
-- 2. create_asset -- gate on owner/editor (base: 20260528060000)
-- =============================================================================

create or replace function public.create_asset(
  p_space_id      uuid,
  p_company_id    uuid,
  p_name          text,
  p_generic_name  text     default null,
  p_moa_names     text[]   default null,
  p_roa_names     text[]   default null,
  p_source_doc_id uuid     default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if not public.has_space_access(p_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.assets (name, generic_name, company_id, space_id, created_by, source_doc_id)
    values (p_name, p_generic_name, p_company_id, p_space_id, v_uid, p_source_doc_id)
    returning id into v_id;

  perform public.link_asset_moa_roa(p_space_id, v_id, p_moa_names, p_roa_names);

  return v_id;
end;
$$;

comment on function public.create_asset(uuid, uuid, text, text, text[], text[], uuid) is
  'Shared entity-create RPC for assets. Delegates MOA/ROA join-table writes to link_asset_moa_roa. Used by both commit_source_import and the Angular UI. Caller must hold owner/editor on the space.';


-- =============================================================================
-- 3. create_trial -- gate on owner/editor
-- =============================================================================

create or replace function public.create_trial(
  p_space_id         uuid,
  p_asset_id         uuid,
  p_name             text,
  p_identifier       text     default null,
  p_status           text     default null,
  p_phase_type       text     default null,
  p_phase_start_date date     default null,
  p_phase_end_date   date     default null,
  p_indication_name  text     default null,
  p_source_doc_id    uuid     default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid := auth.uid();
  v_id             uuid;
  v_indication_id  uuid;
  v_condition_id   uuid;
begin
  if not public.has_space_access(p_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.trials (
    name, identifier, status, phase_type, phase_start_date, phase_end_date,
    asset_id, space_id, created_by, source_doc_id
  ) values (
    p_name, p_identifier, p_status, p_phase_type,
    p_phase_start_date, p_phase_end_date,
    p_asset_id, p_space_id, v_uid, p_source_doc_id
  )
  returning id into v_id;

  if p_indication_name is not null then
    insert into public.indications (name, space_id, created_by)
      values (p_indication_name, p_space_id, v_uid)
      on conflict (space_id, name) do nothing;

    select id into v_indication_id
      from public.indications
     where space_id = p_space_id and name = p_indication_name;

    insert into public.conditions (name, space_id, source)
      values (p_indication_name, p_space_id, 'analyst')
      on conflict (space_id, name) do nothing;

    select id into v_condition_id
      from public.conditions
     where space_id = p_space_id and name = p_indication_name;

    if v_indication_id is not null and v_condition_id is not null then
      insert into public.condition_indication_map (condition_id, indication_id)
        values (v_condition_id, v_indication_id)
        on conflict do nothing;

      insert into public.trial_conditions (trial_id, condition_id, source)
        values (v_id, v_condition_id, 'analyst')
        on conflict do nothing;

      insert into public.asset_indications (
        asset_id, indication_id, space_id,
        development_status_source, created_by
      ) values (
        p_asset_id, v_indication_id, p_space_id,
        'auto', v_uid
      ) on conflict (asset_id, indication_id) do nothing;

      perform public._recompute_asset_indication_status(p_asset_id);
    end if;
  end if;

  return v_id;
end;
$$;

comment on function public.create_trial(uuid, uuid, text, text, text, text, date, date, text, uuid) is
  'Shared entity-create RPC for trials. Creates trial_conditions, condition_indication_map, and asset_indications when an indication is provided. Used by both commit_source_import and the Angular UI. Caller must hold owner/editor on the space.';


-- =============================================================================
-- 4. create_marker -- gate on owner/editor + reject cross-space trials
-- =============================================================================

create or replace function public.create_marker(
  p_space_id       uuid,
  p_marker_type_id uuid,
  p_title          text,
  p_projection     text,
  p_event_date     date,
  p_end_date       date      default null,
  p_description    text      default null,
  p_source_url     text      default null,
  p_trial_ids      uuid[]    default null,
  p_source_doc_id  uuid      default null,
  p_change_source  text      default 'analyst'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_id        uuid;
  v_audit_id  uuid;
  v_trial_id  uuid;
begin
  if not public.has_space_access(p_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Every trial this marker is pinned to must live in the marker's space.
  -- Without this an editor could pin a marker to a trial in another space,
  -- breaking space isolation (the trial FK only enforces existence).
  if p_trial_ids is not null and array_length(p_trial_ids, 1) > 0 then
    foreach v_trial_id in array p_trial_ids
    loop
      if not exists (
        select 1 from public.trials t
         where t.id = v_trial_id and t.space_id = p_space_id
      ) then
        raise exception 'trial % is not in space %', v_trial_id, p_space_id
          using errcode = '42501';
      end if;
    end loop;
  end if;

  insert into public.markers (
    space_id, marker_type_id, title, projection, event_date, end_date,
    description, source_url, created_by, source_doc_id
  ) values (
    p_space_id, p_marker_type_id, p_title, p_projection, p_event_date,
    p_end_date, p_description, p_source_url, v_uid, p_source_doc_id
  )
  returning id into v_id;

  if p_trial_ids is not null and array_length(p_trial_ids, 1) > 0 then
    foreach v_trial_id in array p_trial_ids
    loop
      insert into public.marker_assignments (marker_id, trial_id)
        values (v_id, v_trial_id)
        on conflict do nothing;
    end loop;

    select id into v_audit_id
      from public.marker_changes
     where marker_id = v_id and change_type = 'created'
     order by changed_at desc
     limit 1;

    if v_audit_id is not null then
      perform public._emit_events_from_marker_change(v_audit_id, p_change_source);
    end if;
  end if;

  return v_id;
end;
$$;

comment on function public.create_marker(uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text) is
  'Shared entity-create RPC for markers. Inserts marker, then assignments, then re-emits audit fan-out so trial_change_events are produced with the correct source. Used by both commit_source_import and the Angular UI. Caller must hold owner/editor on the space; every p_trial_ids trial must live in p_space_id.';


-- =============================================================================
-- 5. create_event -- gate on owner/editor
-- =============================================================================

create or replace function public.create_event(
  p_space_id      uuid,
  p_category_id   uuid,
  p_title         text,
  p_event_date    date,
  p_description   text      default null,
  p_priority      text      default 'low',
  p_tags          text[]    default null,
  p_company_id    uuid      default null,
  p_asset_id      uuid      default null,
  p_trial_id      uuid      default null,
  p_source_doc_id uuid      default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if not public.has_space_access(p_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.events (
    space_id, company_id, asset_id, trial_id, category_id,
    title, event_date, description, priority, tags,
    created_by, source_doc_id
  ) values (
    p_space_id, p_company_id, p_asset_id, p_trial_id, p_category_id,
    p_title, p_event_date, p_description,
    coalesce(p_priority, 'low'),
    coalesce(p_tags, '{}'::text[]),
    v_uid, p_source_doc_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_event(uuid, uuid, text, date, text, text, text[], uuid, uuid, uuid, uuid) is
  'Shared entity-create RPC for events. Used by both commit_source_import and the Angular UI. Caller must hold owner/editor on the space.';


-- =============================================================================
-- 6. link_asset_moa_roa -- gate on owner/editor (base: 20260528060000)
-- =============================================================================

create or replace function public.link_asset_moa_roa(
  p_space_id  uuid,
  p_asset_id  uuid,
  p_moa_names text[],
  p_roa_names text[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_id   uuid;
begin
  if not public.has_space_access(p_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_moa_names is not null then
    foreach v_name in array p_moa_names loop
      select id into v_id
        from public.mechanisms_of_action
       where space_id = p_space_id and name = v_name
       limit 1;
      if v_id is not null then
        insert into public.asset_mechanisms_of_action (asset_id, moa_id)
          values (p_asset_id, v_id)
          on conflict do nothing;
      end if;
    end loop;
  end if;

  if p_roa_names is not null then
    foreach v_name in array p_roa_names loop
      select id into v_id
        from public.routes_of_administration
       where space_id = p_space_id and name = v_name
       limit 1;
      if v_id is not null then
        insert into public.asset_routes_of_administration (asset_id, roa_id)
          values (p_asset_id, v_id)
          on conflict do nothing;
      end if;
    end loop;
  end if;
end;
$$;

comment on function public.link_asset_moa_roa(uuid, uuid, text[], text[]) is
  'Links an asset to MOA/ROA rows by name within a space. Caller must hold owner/editor on the space. Called by create_asset and the Angular UI.';


-- =============================================================================
-- 7. update_marker_assignments -- reject cross-space trials
--    (base: 20260528100000; keeps the insert-then-prune ordering and the
--     owner/editor gate, adds per-trial space validation)
-- =============================================================================

create or replace function public.update_marker_assignments(
  p_marker_id uuid,
  p_trial_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_trial_id uuid;
begin
  select space_id into v_space_id
    from public.markers
   where id = p_marker_id;

  if v_space_id is null then
    raise exception 'marker not found' using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- An empty set would delete every assignment, and the AFTER DELETE
  -- orphan-cleanup trigger would then drop the parent marker. The form's
  -- canSubmit() refuses an empty selection; we defend the RPC contract too.
  if p_trial_ids is null or array_length(p_trial_ids, 1) is null then
    raise exception 'at least one trial required' using errcode = '22023';
  end if;

  -- Every target trial must live in the marker's space. Without this an
  -- editor in the marker's space could pin it to a trial in another space
  -- (the trial FK only enforces existence, not space coherence).
  foreach v_trial_id in array p_trial_ids
  loop
    if not exists (
      select 1 from public.trials t
       where t.id = v_trial_id and t.space_id = v_space_id
    ) then
      raise exception 'trial % is not in the marker''s space', v_trial_id
        using errcode = '42501';
    end if;
  end loop;

  -- Insert-then-prune. INSERTs first guarantee the marker keeps at least
  -- one live assignment at every point, so _cleanup_orphan_marker never
  -- observes a zero-row state for this marker. ON CONFLICT DO NOTHING so
  -- existing assignments (the common case for "edit the title, keep the
  -- same trial") are idempotent no-ops rather than constraint failures.
  foreach v_trial_id in array p_trial_ids
  loop
    insert into public.marker_assignments (marker_id, trial_id)
      values (p_marker_id, v_trial_id)
      on conflict (marker_id, trial_id) do nothing;
  end loop;

  delete from public.marker_assignments
   where marker_id = p_marker_id
     and trial_id <> all(p_trial_ids);
end;
$$;

comment on function public.update_marker_assignments(uuid, uuid[]) is
  'Atomically replace marker_assignments for a marker. Inserts new assignments first (idempotent), then deletes stale ones, so the AFTER DELETE _cleanup_orphan_marker trigger never observes zero assignments and never drops the parent marker mid-edit. SECURITY DEFINER. Caller must hold owner/editor on the marker''s space; p_trial_ids must be non-empty and every trial must live in the marker''s space.';


-- =============================================================================
-- 8. marker_assignments INSERT/UPDATE RLS -- require trial to share marker space
--    Defense-in-depth for any direct PostgREST write that bypasses the RPCs.
-- =============================================================================

drop policy if exists "space editors can insert marker_assignments" on public.marker_assignments;
create policy "space editors can insert marker_assignments"
on public.marker_assignments
for insert
to authenticated
with check (
  exists (
    select 1
      from public.markers m
      join public.trials  t on t.id = trial_id
     where m.id = marker_id
       and t.space_id = m.space_id
       and public.has_space_access(m.space_id, array['owner', 'editor'])
  )
);

drop policy if exists "space editors can update marker_assignments" on public.marker_assignments;
create policy "space editors can update marker_assignments"
on public.marker_assignments
for update
to authenticated
using (
  exists (
    select 1 from public.markers m
    where m.id = marker_id
      and public.has_space_access(m.space_id, array['owner', 'editor'])
  )
)
with check (
  exists (
    select 1
      from public.markers m
      join public.trials  t on t.id = trial_id
     where m.id = marker_id
       and t.space_id = m.space_id
       and public.has_space_access(m.space_id, array['owner', 'editor'])
  )
);


-- =============================================================================
-- inline smoke tests
-- =============================================================================
-- Mirror the update_marker_assignments smoke (20260528100000) pattern:
-- hermetic fixture per case, impersonate via set_config so trigger-derived
-- audit rows get a non-null changed_by, tear down under the
-- member_guard_cascade GUC.

do $$
declare
  v_marker_type uuid;
begin
  select id into v_marker_type from public.marker_types where space_id is null limit 1;
  if v_marker_type is null then
    raise exception 'content-authz smoke FAIL: no global marker_type available';
  end if;

  -- ===========================================================================
  -- case E: viewer cannot create content via the create_* RPCs.
  -- ===========================================================================
  declare
    v_owner   uuid := gen_random_uuid();
    v_viewer  uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_o_email text := 'cae-o-' || gen_random_uuid() || '@example.com';
    v_v_email text := 'cae-v-' || gen_random_uuid() || '@example.com';
    v_caught  boolean;
    v_cat     uuid;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_owner,  v_o_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
             (v_viewer, v_v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'cae-tenant', 'cae-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_owner, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'cae-space', v_owner);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_owner,  'owner'),
             (v_space, v_viewer, 'viewer');
    -- owner seeds a company + asset so create_event has fixtures to point at.
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_owner, 'cae-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_owner, v_company, 'cae-drug');
    select id into v_cat from public.event_categories where space_id is null limit 1;

    -- impersonate the viewer.
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_viewer::text, 'role', 'authenticated', 'email', v_v_email)::text,
      true
    );

    -- create_company as viewer -> 42501
    v_caught := false;
    begin
      perform public.create_company(v_space, 'cae-evil-co');
    exception when others then
      if sqlstate <> '42501' then
        raise exception 'content-authz smoke FAIL case E: create_company expected 42501, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'content-authz smoke FAIL case E: viewer created a company';
    end if;

    -- create_marker as viewer -> 42501
    v_caught := false;
    begin
      perform public.create_marker(v_space, v_marker_type, 'cae-evil-marker', 'actual', current_date);
    exception when others then
      if sqlstate <> '42501' then
        raise exception 'content-authz smoke FAIL case E: create_marker expected 42501, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'content-authz smoke FAIL case E: viewer created a marker';
    end if;

    -- create_event as viewer -> 42501 (only attempt if a global category exists)
    if v_cat is not null then
      v_caught := false;
      begin
        perform public.create_event(v_space, v_cat, 'cae-evil-event', current_date);
      exception when others then
        if sqlstate <> '42501' then
          raise exception 'content-authz smoke FAIL case E: create_event expected 42501, got % (%)', sqlstate, sqlerrm;
        end if;
        v_caught := true;
      end;
      if not v_caught then
        raise exception 'content-authz smoke FAIL case E: viewer created an event';
      end if;
    end if;

    raise notice 'content-authz smoke ok E: viewer rejected from create_company/marker/event';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.assets        where space_id = v_space;
    delete from public.companies     where space_id = v_space;
    delete from public.space_members where space_id = v_space;
    delete from public.tenant_members where tenant_id = v_tenant;
    delete from public.spaces        where id = v_space;
    delete from public.tenants       where id = v_tenant;
    delete from auth.users           where id in (v_owner, v_viewer);
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case F: editor cannot pin a marker to a trial in another space.
  --   Two spaces under one tenant. The editor is owner of space A and owner
  --   of space B (so they can read trial_b's id), but cross-space assignment
  --   must still be rejected by both create_marker and update_marker_assignments.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space_a uuid := gen_random_uuid();
    v_space_b uuid := gen_random_uuid();
    v_comp_a  uuid := gen_random_uuid();
    v_comp_b  uuid := gen_random_uuid();
    v_asset_a uuid := gen_random_uuid();
    v_asset_b uuid := gen_random_uuid();
    v_trial_a uuid := gen_random_uuid();
    v_trial_b uuid := gen_random_uuid();
    v_marker  uuid := gen_random_uuid();
    v_email   text := 'caf-' || gen_random_uuid() || '@example.com';
    v_caught  boolean;
    v_count   int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'caf-tenant', 'caf-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space_a, v_tenant, 'caf-space-a', v_user),
             (v_space_b, v_tenant, 'caf-space-b', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space_a, v_user, 'owner'),
             (v_space_b, v_user, 'owner');
    insert into public.companies (id, space_id, created_by, name)
      values (v_comp_a, v_space_a, v_user, 'caf-co-a'),
             (v_comp_b, v_space_b, v_user, 'caf-co-b');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset_a, v_space_a, v_user, v_comp_a, 'caf-drug-a'),
             (v_asset_b, v_space_b, v_user, v_comp_b, 'caf-drug-b');
    insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
      values (v_trial_a, v_space_a, v_user, v_asset_a, 'caf-trial-a', 'NCT-CAF-A'),
             (v_trial_b, v_space_b, v_user, v_asset_b, 'caf-trial-b', 'NCT-CAF-B');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    -- create_marker in space A pinned to a space B trial -> 42501, no marker.
    v_caught := false;
    begin
      perform public.create_marker(
        v_space_a, v_marker_type, 'caf-cross-marker', 'actual', current_date,
        null, null, null, array[v_trial_b]
      );
    exception when others then
      if sqlstate <> '42501' then
        raise exception 'content-authz smoke FAIL case F: create_marker cross-space expected 42501, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'content-authz smoke FAIL case F: create_marker accepted a cross-space trial';
    end if;
    select count(*)::int into v_count from public.markers where space_id = v_space_a and title = 'caf-cross-marker';
    if v_count <> 0 then
      raise exception 'content-authz smoke FAIL case F: cross-space create_marker left a marker behind';
    end if;

    -- Now a legit marker in space A pinned to trial_a, then try to swap it to
    -- the space B trial via update_marker_assignments -> 42501, assignment intact.
    perform public.create_marker(
      v_space_a, v_marker_type, 'caf-marker', 'actual', current_date,
      null, null, null, array[v_trial_a]
    );
    select id into v_marker from public.markers where space_id = v_space_a and title = 'caf-marker' limit 1;

    v_caught := false;
    begin
      perform public.update_marker_assignments(v_marker, array[v_trial_b]);
    exception when others then
      if sqlstate <> '42501' then
        raise exception 'content-authz smoke FAIL case F: update_marker_assignments cross-space expected 42501, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'content-authz smoke FAIL case F: update_marker_assignments accepted a cross-space trial';
    end if;

    -- original assignment to trial_a must be untouched.
    select count(*)::int into v_count
      from public.marker_assignments where marker_id = v_marker and trial_id = v_trial_a;
    if v_count <> 1 then
      raise exception 'content-authz smoke FAIL case F: original same-space assignment was disturbed';
    end if;
    select count(*)::int into v_count
      from public.marker_assignments where marker_id = v_marker and trial_id = v_trial_b;
    if v_count <> 0 then
      raise exception 'content-authz smoke FAIL case F: a cross-space assignment was created';
    end if;

    raise notice 'content-authz smoke ok F: cross-space trial rejected by create_marker and update_marker_assignments';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.markers             where space_id in (v_space_a, v_space_b);
    delete from public.trial_change_events where space_id in (v_space_a, v_space_b);
    delete from public.marker_changes      where space_id in (v_space_a, v_space_b);
    delete from public.trials              where space_id in (v_space_a, v_space_b);
    delete from public.assets              where space_id in (v_space_a, v_space_b);
    delete from public.companies           where space_id in (v_space_a, v_space_b);
    delete from public.space_members       where space_id in (v_space_a, v_space_b);
    delete from public.tenant_members      where tenant_id = v_tenant;
    delete from public.spaces              where id in (v_space_a, v_space_b);
    delete from public.tenants             where id = v_tenant;
    delete from auth.users                 where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case G: editor CAN still create a marker pinned to a same-space trial.
  --   Guards against the validation being too strict (regression guard for the
  --   happy path the UI exercises constantly).
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_trial   uuid := gen_random_uuid();
    v_marker  uuid;
    v_email   text := 'cag-' || gen_random_uuid() || '@example.com';
    v_count   int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'cag-tenant', 'cag-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'cag-space', v_user);
    -- editor (not owner) to confirm editors are allowed to write.
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'editor');
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'cag-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_user, v_company, 'cag-drug');
    insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
      values (v_trial, v_space, v_user, v_asset, 'cag-trial', 'NCT-CAG');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    perform public.create_marker(
      v_space, v_marker_type, 'cag-marker', 'actual', current_date,
      null, null, null, array[v_trial]
    );
    select id into v_marker from public.markers where space_id = v_space and title = 'cag-marker' limit 1;
    if v_marker is null then
      raise exception 'content-authz smoke FAIL case G: editor could not create a same-space marker';
    end if;
    select count(*)::int into v_count from public.marker_assignments where marker_id = v_marker and trial_id = v_trial;
    if v_count <> 1 then
      raise exception 'content-authz smoke FAIL case G: same-space assignment missing, got %', v_count;
    end if;

    raise notice 'content-authz smoke ok G: editor creates same-space marker + assignment';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.markers             where space_id = v_space;
    delete from public.trial_change_events where space_id = v_space;
    delete from public.marker_changes      where space_id = v_space;
    delete from public.trials              where space_id = v_space;
    delete from public.assets              where space_id = v_space;
    delete from public.companies           where space_id = v_space;
    delete from public.space_members       where space_id = v_space;
    delete from public.tenant_members      where tenant_id = v_tenant;
    delete from public.spaces              where id = v_space;
    delete from public.tenants             where id = v_tenant;
    delete from auth.users                 where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  raise notice 'content-authz + marker-trial-space smoke test: PASS';
end $$;

notify pgrst, 'reload schema';
