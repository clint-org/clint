-- migration: 20260527120000_change_event_annotations
-- purpose: analyst annotations on detected change events. one annotation per
--          change event (upsert semantics). two SECURITY INVOKER RPCs for
--          upsert and delete. audit columns (created_by, updated_by) set by
--          the existing _set_created_by / _set_updated_audit DB triggers.
--
-- tables: change_event_annotations (new)
-- rpcs:   upsert_change_event_annotation, delete_change_event_annotation

-- =============================================================================
-- table: change_event_annotations
-- one analyst note per change event. the annotation is the deliverable for
-- the advisory use case: analysts attach context to detected ct.gov changes.
--
create table public.change_event_annotations (
  id               uuid primary key default gen_random_uuid(),
  change_event_id  uuid not null references public.trial_change_events (id) on delete cascade,
  space_id         uuid not null references public.spaces (id) on delete cascade,
  body             text not null,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id),
  constraint uq_annotations_change_event_id unique (change_event_id)
);

comment on table public.change_event_annotations is
  'Analyst notes attached to detected change events. One annotation per change event (upsert semantics). The annotation is the deliverable for the advisory use case.';

-- indexes
create index idx_annotations_space_id
  on public.change_event_annotations (space_id);

-- RLS
alter table public.change_event_annotations enable row level security;

-- select: any space member can read annotations
create policy change_event_annotations_select
  on public.change_event_annotations
  for select
  to authenticated
  using (public.has_space_access(space_id));

-- insert: editors and owners can create annotations
create policy change_event_annotations_insert
  on public.change_event_annotations
  for insert
  to authenticated
  with check (public.has_space_access(space_id, array['owner','editor']));

-- update: editors and owners can update annotations
create policy change_event_annotations_update
  on public.change_event_annotations
  for update
  to authenticated
  using (public.has_space_access(space_id, array['owner','editor']))
  with check (public.has_space_access(space_id, array['owner','editor']));

-- delete: editors and owners can delete annotations
create policy change_event_annotations_delete
  on public.change_event_annotations
  for delete
  to authenticated
  using (public.has_space_access(space_id, array['owner','editor']));

-- =============================================================================
-- audit column triggers: set created_by / updated_by from auth.uid()
-- reuses the trigger functions from 20260523150000_audit_columns_server_side.
--
create trigger trg_change_event_annotations_set_created_by
  before insert on public.change_event_annotations
  for each row execute function public._set_created_by();

create trigger trg_change_event_annotations_set_updated_audit
  before update on public.change_event_annotations
  for each row execute function public._set_updated_audit();

-- =============================================================================
-- RPC: upsert_change_event_annotation
-- inserts or updates the annotation for a change event. returns the row as
-- jsonb. raises 02000 if the change_event_id does not exist, 42501 if the
-- caller lacks editor/owner access to the space.
--
create or replace function public.upsert_change_event_annotation(
  p_change_event_id uuid,
  p_body            text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_space_id uuid;
  v_result   record;
begin
  -- look up the change event's space_id
  select space_id into v_space_id
    from public.trial_change_events
   where id = p_change_event_id;

  if v_space_id is null then
    raise exception 'change event not found'
      using errcode = '02000';
  end if;

  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  insert into public.change_event_annotations (change_event_id, space_id, body)
  values (p_change_event_id, v_space_id, p_body)
  on conflict (change_event_id)
  do update set
    body       = excluded.body,
    updated_at = now()
  returning * into v_result;

  return jsonb_build_object(
    'id',              v_result.id,
    'change_event_id', v_result.change_event_id,
    'space_id',        v_result.space_id,
    'body',            v_result.body,
    'created_by',      v_result.created_by,
    'created_at',      v_result.created_at,
    'updated_at',      v_result.updated_at,
    'updated_by',      v_result.updated_by
  );
end;
$$;

revoke execute on function public.upsert_change_event_annotation(uuid, text) from public;
grant  execute on function public.upsert_change_event_annotation(uuid, text) to authenticated;

comment on function public.upsert_change_event_annotation(uuid, text) is
  'Insert or update the analyst annotation for a change event. Returns the annotation row as jsonb. SECURITY INVOKER; raises 02000 if change_event_id not found, 42501 if caller lacks editor/owner access.';

-- =============================================================================
-- RPC: delete_change_event_annotation
-- deletes the annotation for a change event. no-op if no annotation exists.
-- raises 42501 if caller lacks editor/owner access.
--
create or replace function public.delete_change_event_annotation(
  p_change_event_id uuid
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  -- look up the change event's space_id
  select space_id into v_space_id
    from public.trial_change_events
   where id = p_change_event_id;

  if v_space_id is null then
    raise exception 'change event not found'
      using errcode = '02000';
  end if;

  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  delete from public.change_event_annotations
   where change_event_id = p_change_event_id;
end;
$$;

revoke execute on function public.delete_change_event_annotation(uuid) from public;
grant  execute on function public.delete_change_event_annotation(uuid) to authenticated;

comment on function public.delete_change_event_annotation(uuid) is
  'Delete the analyst annotation for a change event. No-op if no annotation exists. SECURITY INVOKER; raises 02000 if change_event_id not found, 42501 if caller lacks editor/owner access.';

-- =============================================================================
-- smoke tests
--
do $$
declare
  v_agency_id    uuid := 'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_tenant_id    uuid := 'bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_owner_id     uuid := 'bbbbbbb3-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_editor_id    uuid := 'bbbbbbb4-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
  v_viewer_id    uuid := 'bbbbbbb5-bbbb-bbbb-bbbb-bbbbbbbbbbb5';
  v_other_id     uuid := 'bbbbbbb6-bbbb-bbbb-bbbb-bbbbbbbbbbb6';
  v_space_id     uuid := 'bbbbbbb7-bbbb-bbbb-bbbb-bbbbbbbbbbb7';
  v_company_id   uuid := 'bbbbbbb8-bbbb-bbbb-bbbb-bbbbbbbbbbb8';
  v_asset_id     uuid := 'bbbbbbb9-bbbb-bbbb-bbbb-bbbbbbbbbbb9';
  v_trial_id     uuid := 'bbbbbbb0-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_event_id     uuid := 'bbbbbbbc-bbbb-bbbb-bbbb-bbbbbbbbbbbc';
  v_result       jsonb;
  v_threw        boolean;
  v_count        int;
  v_annotation_id uuid;
begin
  -- =========================================================================
  -- bootstrap hermetic fixture
  insert into auth.users (id, email) values
    (v_owner_id,  'annot-owner@invalid.local'),
    (v_editor_id, 'annot-editor@invalid.local'),
    (v_viewer_id, 'annot-viewer@invalid.local'),
    (v_other_id,  'annot-other@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'Annot Smoke', 'annot-smoke', 'annotsmoke', 'AS', 'as@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'AS', 'annot-smoke-t', 'annotsmoket', 'AS');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner_id, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_owner_id);

  insert into public.space_members (space_id, user_id, role) values
    (v_space_id, v_owner_id,  'owner'),
    (v_space_id, v_editor_id, 'editor'),
    (v_space_id, v_viewer_id, 'viewer');

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_owner_id, 'Annot Smoke Co');

  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'Annot Smoke Drug');

  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial_id, v_space_id, v_owner_id, v_asset_id, 'ANNOT_TRIAL', 'NCT-ANNOT-1');

  insert into public.trial_change_events (
    id, trial_id, space_id, event_type, source, payload, occurred_at, observed_at
  ) values (
    v_event_id, v_trial_id, v_space_id, 'status_changed', 'ctgov',
    jsonb_build_object('from', 'RECRUITING', 'to', 'COMPLETED'),
    now() - interval '1 day', now() - interval '1 day'
  );

  -- act as the owner
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- =========================================================================
  -- test 1: upsert inserts a new annotation
  v_result := public.upsert_change_event_annotation(v_event_id, 'Initial analyst note');
  if v_result is null then
    raise exception 'annot smoke FAIL test 1: upsert returned null';
  end if;
  if v_result ->> 'body' <> 'Initial analyst note' then
    raise exception 'annot smoke FAIL test 1: body mismatch, got %', v_result ->> 'body';
  end if;
  if (v_result ->> 'change_event_id')::uuid <> v_event_id then
    raise exception 'annot smoke FAIL test 1: change_event_id mismatch';
  end if;
  if (v_result ->> 'space_id')::uuid <> v_space_id then
    raise exception 'annot smoke FAIL test 1: space_id mismatch';
  end if;
  v_annotation_id := (v_result ->> 'id')::uuid;
  raise notice 'annot smoke ok test 1: upsert inserts new annotation';

  -- =========================================================================
  -- test 2: upsert is idempotent (updates existing annotation, same id)
  v_result := public.upsert_change_event_annotation(v_event_id, 'Updated analyst note');
  if v_result ->> 'body' <> 'Updated analyst note' then
    raise exception 'annot smoke FAIL test 2: body not updated, got %', v_result ->> 'body';
  end if;
  if (v_result ->> 'id')::uuid <> v_annotation_id then
    raise exception 'annot smoke FAIL test 2: id changed on upsert, expected %, got %',
      v_annotation_id, v_result ->> 'id';
  end if;
  raise notice 'annot smoke ok test 2: upsert updates existing annotation (idempotent)';

  -- =========================================================================
  -- test 3: editor can also upsert
  perform set_config('request.jwt.claim.sub', v_editor_id::text, true);
  v_result := public.upsert_change_event_annotation(v_event_id, 'Editor note');
  if v_result ->> 'body' <> 'Editor note' then
    raise exception 'annot smoke FAIL test 3: editor upsert body mismatch';
  end if;
  raise notice 'annot smoke ok test 3: editor can upsert annotation';

  -- =========================================================================
  -- test 4: viewer cannot upsert (42501)
  perform set_config('request.jwt.claim.sub', v_viewer_id::text, true);
  v_threw := false;
  begin
    perform public.upsert_change_event_annotation(v_event_id, 'Viewer note');
  exception when sqlstate '42501' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'annot smoke FAIL test 4: viewer was allowed to upsert';
  end if;
  raise notice 'annot smoke ok test 4: viewer denied upsert (42501)';

  -- =========================================================================
  -- test 5: non-member cannot upsert (42501)
  perform set_config('request.jwt.claim.sub', v_other_id::text, true);
  v_threw := false;
  begin
    perform public.upsert_change_event_annotation(v_event_id, 'Outsider note');
  exception when sqlstate '42501' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'annot smoke FAIL test 5: non-member was allowed to upsert';
  end if;
  raise notice 'annot smoke ok test 5: non-member denied upsert (42501)';

  -- =========================================================================
  -- test 6: delete removes the annotation (as editor)
  perform set_config('request.jwt.claim.sub', v_editor_id::text, true);
  perform public.delete_change_event_annotation(v_event_id);
  select count(*) into v_count
    from public.change_event_annotations
   where change_event_id = v_event_id;
  if v_count <> 0 then
    raise exception 'annot smoke FAIL test 6: annotation not deleted, count=%', v_count;
  end if;
  raise notice 'annot smoke ok test 6: delete removes annotation';

  -- =========================================================================
  -- test 7: delete is a no-op when no annotation exists (no error)
  perform public.delete_change_event_annotation(v_event_id);
  raise notice 'annot smoke ok test 7: delete no-op when no annotation exists';

  -- =========================================================================
  -- test 8: non-member cannot delete (42501)
  -- first, re-insert an annotation as owner
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform public.upsert_change_event_annotation(v_event_id, 'To be protected');

  perform set_config('request.jwt.claim.sub', v_other_id::text, true);
  v_threw := false;
  begin
    perform public.delete_change_event_annotation(v_event_id);
  exception when sqlstate '42501' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'annot smoke FAIL test 8: non-member was allowed to delete';
  end if;
  raise notice 'annot smoke ok test 8: non-member denied delete (42501)';

  -- =========================================================================
  -- test 9: upsert raises 02000 for nonexistent change_event_id
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  v_threw := false;
  begin
    perform public.upsert_change_event_annotation(
      'deadbeef-dead-dead-dead-deaddeadbeef'::uuid,
      'ghost note'
    );
  exception when sqlstate '02000' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'annot smoke FAIL test 9: nonexistent change_event_id did not raise 02000';
  end if;
  raise notice 'annot smoke ok test 9: upsert raises 02000 for nonexistent change event';

  -- =========================================================================
  -- test 10: delete raises 02000 for nonexistent change_event_id
  v_threw := false;
  begin
    perform public.delete_change_event_annotation(
      'deadbeef-dead-dead-dead-deaddeadbeef'::uuid
    );
  exception when sqlstate '02000' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'annot smoke FAIL test 10: nonexistent change_event_id did not raise 02000';
  end if;
  raise notice 'annot smoke ok test 10: delete raises 02000 for nonexistent change event';

  -- =========================================================================
  -- test 11: RLS table verification
  declare
    v_rls boolean;
    v_policy_count int;
  begin
    select c.relrowsecurity into v_rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'change_event_annotations';

    if v_rls is null then
      raise exception 'annot smoke FAIL test 11: table missing';
    end if;
    if not v_rls then
      raise exception 'annot smoke FAIL test 11: RLS not enabled';
    end if;

    select count(*) into v_policy_count
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'change_event_annotations';
    if v_policy_count < 4 then
      raise exception 'annot smoke FAIL test 11: expected at least 4 policies, got %', v_policy_count;
    end if;
  end;
  raise notice 'annot smoke ok test 11: RLS enabled with 4 policies';

  -- =========================================================================
  -- cleanup
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);

  delete from public.change_event_annotations where space_id = v_space_id;
  delete from public.trial_change_events where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants  where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id in (v_owner_id, v_editor_id, v_viewer_id, v_other_id);

  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'change_event_annotations smoke test: PASS';
end$$;
