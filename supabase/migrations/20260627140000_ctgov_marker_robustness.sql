-- ============================================================================
-- CT.gov marker robustness: close the reassign-bypass + add create_marker
-- p_metadata (user-approved follow-ups to 20260627130000_ctgov_trial_dates_markers)
-- ============================================================================
-- Spec: docs/specs/ctgov-trial-dates/spec.md
--
-- Background: trial dates are now ct.gov/analyst-owned markers. The BEFORE
-- UPDATE/DELETE trigger trg_guard_ctgov_locked_markers (190000) blocks an
-- analyst from editing/deleting a metadata.source='ctgov' marker directly.
-- Two robustness gaps remain:
--
--   1. Reassign-bypass. update_marker_assignments(p_marker_id, p_trial_ids)
--      prunes a marker's assignments. If it prunes the LAST one, the AFTER
--      DELETE _cleanup_orphan_marker (which sets the clint.ctgov_seeding GUC
--      bypass) drops the parent marker -- so an analyst can indirectly destroy
--      a ct.gov-owned marker, skirting the edit/delete lock. Closed below by
--      rejecting reassignment of a ct.gov-owned marker at the RPC.
--
--   2. create_marker has no metadata param, so client-created markers land with
--      metadata = null. Add a trailing p_metadata so the trial-date create path
--      can stamp {source:'analyst'} explicitly (keeps the marker un-owned so the
--      first ct.gov sync adopts it instead of duplicating).
--
-- Both functions are re-stated from their LIVE post-merge definitions
-- (pg_get_functiondef), never an older migration copy, to avoid stale-base
-- clobber.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- (a) update_marker_assignments(): close the ct.gov reassign-bypass.
--     Re-stated from live (last defined 20260528100000). The ONLY change is the
--     ct.gov ownership guard added after the authz check. Everything else
--     (insert-then-prune ordering, space-coherence check, empty-set rejection)
--     is verbatim from live.
--
--     This RPC is NOT a tier-1 governance surface -- it is an analyst data edit
--     -- so it carries no `-- @audit:tier1` marker and emits no
--     record_audit_event (the marker_changes audit trigger on the parent markers
--     table already records material marker changes; assignment churn surfaces
--     via the trial_change_events feed). The live body has neither; re-stating
--     from live preserves that posture, which the 20260510002000 audit-coverage
--     smoke depends on (it only requires record_audit_event for functions whose
--     body literally contains `-- @audit:tier1`).
--
--     RESIDUAL (documented, intentionally NOT fixed here): a determined caller
--     could still DELETE a marker_assignments row directly via PostgREST/RLS,
--     orphaning a ct.gov-owned marker and tripping _cleanup_orphan_marker's GUC
--     bypass. Fully closing that needs a BEFORE DELETE trigger on
--     marker_assignments PLUS routing trial deletion through a GUC-setting RPC --
--     trial delete is today a client `.from('trials').delete()` with no GUC, so
--     a naive marker_assignments trigger would break the cascade delete of
--     trials and spaces. That trade-off is out of scope; this RPC fix closes the
--     realistic, RPC-reachable path.
-- ----------------------------------------------------------------------------
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

  -- ct.gov ownership guard. A ct.gov-owned marker (metadata.source = 'ctgov') is
  -- seeded 1:1 per trial and must not be reassigned by analysts. Without this,
  -- pruning its single assignment to a different trial would drive the AFTER
  -- DELETE _cleanup_orphan_marker to drop the ct.gov marker under its own GUC
  -- bypass, skirting the trg_guard_ctgov_locked_markers edit/delete lock. Mirror
  -- that lock's message + errcode. Non-ct.gov markers reassign freely.
  if (
    select metadata->>'source' = 'ctgov'
      from public.markers
     where id = p_marker_id
  ) then
    raise exception 'This marker is managed by ct.gov for this trial; cannot reassign its trials directly. Remove the NCT or wait for the next ct.gov sync.'
      using errcode = 'P0001';
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

-- CREATE OR REPLACE preserves the existing ACL; re-assert it for clarity.
revoke execute on function public.update_marker_assignments(uuid, uuid[]) from public;
grant  execute on function public.update_marker_assignments(uuid, uuid[]) to authenticated;

comment on function public.update_marker_assignments(uuid, uuid[]) is
  'Atomically replace marker_assignments for a marker. Inserts new assignments first (idempotent), then deletes stale ones, so the AFTER DELETE _cleanup_orphan_marker trigger never observes zero assignments and never drops the parent marker mid-edit. Rejects reassignment of a ct.gov-owned marker (metadata.source=''ctgov''), which is seeded 1:1 per trial. SECURITY DEFINER. Caller must hold owner/editor on the marker''s space; p_trial_ids must be non-empty.';


-- ----------------------------------------------------------------------------
-- (b) create_marker(): add a trailing p_metadata jsonb default null that stamps
--     the markers.metadata column. Re-stated from live (last defined
--     20260616120000_marker_ranges). The new param is LAST + defaulted, so
--     existing PostgREST/supabase-js callers (which call by name) are
--     unaffected. The ONLY behavior change is the metadata column now takes
--     p_metadata (was implicit null). All other behavior -- auth.uid() /
--     has_space_access, precision validation, ongoing/end-date guard,
--     trial-space coherence, assignment inserts, change-source audit fan-out --
--     is verbatim from live.
--
--     Adding a param changes the function identity, so the old 14-arg overload
--     must be dropped first (mirrors how 20260615130000 / 20260616120000 added
--     params) to avoid an ambiguous PostgREST overload.
-- ----------------------------------------------------------------------------
drop function if exists public.create_marker(
  uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text, text, text, boolean
);

create or replace function public.create_marker(
  p_space_id           uuid,
  p_marker_type_id     uuid,
  p_title              text,
  p_projection         text,
  p_event_date         date,
  p_end_date           date    default null,
  p_description        text    default null,
  p_source_url         text    default null,
  p_trial_ids          uuid[]  default null,
  p_source_doc_id      uuid    default null,
  p_change_source      text    default 'analyst',
  p_date_precision     text    default 'exact',
  p_end_date_precision text    default 'exact',
  p_is_ongoing         boolean default false,
  p_metadata           jsonb   default null
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

  if p_date_precision not in ('exact', 'month', 'quarter', 'half', 'year')
     or p_end_date_precision not in ('exact', 'month', 'quarter', 'half', 'year') then
    raise exception 'invalid date_precision' using errcode = '22023';
  end if;

  if p_is_ongoing and p_end_date is not null then
    raise exception 'an ongoing marker cannot have an end date' using errcode = '22023';
  end if;

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
    description, source_url, created_by, source_doc_id,
    date_precision, end_date_precision, is_ongoing, metadata
  ) values (
    p_space_id, p_marker_type_id, p_title, p_projection, p_event_date,
    p_end_date, p_description, p_source_url, v_uid, p_source_doc_id,
    p_date_precision, p_end_date_precision, p_is_ongoing, p_metadata
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

comment on function public.create_marker(uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text, text, text, boolean, jsonb) is
  'Shared entity-create RPC for markers. Inserts marker (with date/end-date precision + is_ongoing + optional metadata), assignments, then audit fan-out. Caller must hold owner/editor on the space; every p_trial_ids trial must live in p_space_id; an ongoing marker cannot also have an end date. p_metadata stamps markers.metadata (e.g. {source:''analyst''}); null leaves it unset.';

grant execute on function public.create_marker(
  uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text, text, text, boolean, jsonb
) to authenticated;


-- ----------------------------------------------------------------------------
-- (c) In-migration smoke (the test). Aborts the migration on any assert fail.
--     Covers: create_marker metadata stamping + backward-compat null; and
--     update_marker_assignments rejecting a ct.gov-owned marker while still
--     reassigning a non-ct.gov marker. Hermetic, reverse-dependency teardown.
-- ----------------------------------------------------------------------------
do $smoke$
declare
  v_agency_id   uuid := '99990002-0000-0000-0000-000000000001';
  v_tenant_id   uuid := '99990002-0000-0000-0000-000000000002';
  v_user_id     uuid := '99990002-0000-0000-0000-000000000003';
  v_space_id    uuid := '99990002-0000-0000-0000-000000000004';
  v_company_id  uuid := '99990002-0000-0000-0000-000000000005';
  v_asset_id    uuid := '99990002-0000-0000-0000-000000000006';
  v_trial_a     uuid := '99990002-0000-0000-0000-00000000000a';
  v_trial_b     uuid := '99990002-0000-0000-0000-00000000000b';
  v_ctgov_mk    uuid := '99990002-0000-0000-0000-0000000000c0';

  v_marker_type uuid;
  v_m1          uuid;  -- created WITH p_metadata (analyst)
  v_m2          uuid;  -- created WITHOUT p_metadata (null)
  v_src         text;
  v_meta        jsonb;
  v_trial       uuid;
  v_cnt         int;
  v_threw       boolean;
begin
  select id into v_marker_type from public.marker_types where space_id is null limit 1;
  if v_marker_type is null then
    raise exception 'ctgov marker robustness smoke FAIL: no global marker_type available';
  end if;

  -- ===== bootstrap fixture =====
  insert into auth.users (id, email) values (v_user_id, 'ctgov-robustness-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'CMR Smoke', 'cmr-smoke', 'cmrsmoke', 'CMR', 'cmr@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'CMR', 'cmr-smoke-t', 'cmrsmoket', 'CMR');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);
  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_user_id, 'owner');
  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'CMR Co');
  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_user_id, v_company_id, 'CMR Drug');
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial_a, v_space_id, v_user_id, v_asset_id, 'CMR Trial A', 'NCT-CMR-A'),
           (v_trial_b, v_space_id, v_user_id, v_asset_id, 'CMR Trial B', 'NCT-CMR-B');

  -- impersonate the owner so create_marker's auth.uid() + has_space_access pass.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_id::text, 'role', 'authenticated', 'email', 'ctgov-robustness-smoke@invalid.local')::text,
    true
  );

  -- ===== test 1: create_marker p_metadata stamping + backward-compat null =====
  v_m1 := public.create_marker(
    v_space_id, v_marker_type, 'CMR analyst marker', 'actual', current_date,
    p_trial_ids := array[v_trial_a],
    p_metadata  := jsonb_build_object('source', 'analyst')
  );
  select metadata into v_meta from public.markers where id = v_m1;
  if v_meta is null or v_meta->>'source' is distinct from 'analyst' then
    raise exception 'create_marker metadata FAIL: expected source=analyst, got %', v_meta;
  end if;

  v_m2 := public.create_marker(
    v_space_id, v_marker_type, 'CMR no-metadata marker', 'actual', current_date,
    p_trial_ids := array[v_trial_a]
  );
  select metadata into v_meta from public.markers where id = v_m2;
  if v_meta is not null then
    raise exception 'create_marker metadata FAIL: expected null metadata without p_metadata, got %', v_meta;
  end if;
  raise notice 'ctgov marker robustness smoke ok test 1: create_marker stamps p_metadata; null is backward compatible';

  -- ===== test 2: update_marker_assignments rejects a ct.gov-owned marker =====
  -- Seed a ct.gov-owned marker directly (INSERT is unguarded) assigned to trial A.
  insert into public.markers (id, space_id, marker_type_id, title, projection, event_date, created_by, metadata)
    values (v_ctgov_mk, v_space_id, v_marker_type, 'CMR ctgov marker', 'company', current_date, v_user_id,
            jsonb_build_object('source', 'ctgov'));
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_ctgov_mk, v_trial_a);

  v_threw := false;
  begin
    perform public.update_marker_assignments(v_ctgov_mk, array[v_trial_b]);
  exception when sqlstate 'P0001' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'reassign-guard FAIL: reassigning a ct.gov-owned marker did not raise';
  end if;

  -- the ct.gov marker's assignment must be untouched (still trial A, still alive).
  select count(*) into v_cnt from public.markers where id = v_ctgov_mk;
  if v_cnt <> 1 then raise exception 'reassign-guard FAIL: ct.gov marker was dropped by rejected reassign'; end if;
  select trial_id into v_trial from public.marker_assignments where marker_id = v_ctgov_mk;
  if v_trial <> v_trial_a then
    raise exception 'reassign-guard FAIL: ct.gov marker assignment changed to %', v_trial;
  end if;
  raise notice 'ctgov marker robustness smoke ok test 2: ct.gov-owned marker reassign rejected, marker + assignment intact';

  -- ===== test 3: a non-ct.gov marker still reassigns freely =====
  -- v_m1 is analyst-owned, currently assigned to trial A; reassign to trial B.
  perform public.update_marker_assignments(v_m1, array[v_trial_b]);
  select count(*) into v_cnt from public.marker_assignments where marker_id = v_m1;
  if v_cnt <> 1 then raise exception 'non-ctgov reassign FAIL: expected 1 assignment after swap, got %', v_cnt; end if;
  select trial_id into v_trial from public.marker_assignments where marker_id = v_m1;
  if v_trial <> v_trial_b then
    raise exception 'non-ctgov reassign FAIL: expected trial B after reassign, got %', v_trial;
  end if;
  raise notice 'ctgov marker robustness smoke ok test 3: non-ct.gov marker reassigns freely';

  -- ===== teardown (reverse dependency) =====
  -- Remove markers while the space row still exists so the BEFORE DELETE audit
  -- insert satisfies marker_changes.space_id. The ctgov_seeding GUC bypasses the
  -- ct.gov marker lock; member_guard_cascade bypasses the last-owner guard on
  -- space_members. The space_members row is deleted explicitly (not via the
  -- tenant cascade) because the enforce_space_member_guards bypass GUC is not
  -- observed inside the FK-cascade delete path -- mirroring the working teardown
  -- in 20260528100000_update_marker_assignments_rpc.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  perform set_config('clint.ctgov_seeding', 'on', true);
  delete from public.markers       where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenants       where id = v_tenant_id;   -- cascades spaces -> trials/etc.
  delete from public.agencies      where id = v_agency_id;
  delete from auth.users           where id = v_user_id;
  perform set_config('clint.ctgov_seeding', 'off', true);
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'ctgov_marker_robustness smoke test: PASS';
end
$smoke$;


-- ----------------------------------------------------------------------------
-- (d) Reload PostgREST schema cache so the new create_marker signature resolves.
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';
