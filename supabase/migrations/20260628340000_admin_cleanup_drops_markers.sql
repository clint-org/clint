-- migration: 20260628340000_admin_cleanup_drops_markers
-- purpose: Task D1 -- repoint permanently_delete_space and redact_user away from
--   the dropped markers/marker_types tables. markers/marker_types were merged into
--   events/event_types in Phase A; two Tier-1 admin RPCs still referenced them.
--
--   permanently_delete_space: remove v_markers/v_marker_types declarations,
--   their count queries, their keys from the jsonb return value, and the
--   explicit `delete from public.markers` block that existed only to bypass the
--   old BEFORE DELETE _log_marker_change trigger. events/event_changes/
--   event_sources/trial_change_events all have ON DELETE CASCADE from spaces,
--   so the space delete itself is sufficient.
--
--   redact_user: update a stale code comment only (markers.created_by ->
--   events.created_by). No behavioral change; authorship is deliberately
--   preserved by design.
--
-- Both bodies are captured from pg_get_functiondef to avoid stale-base clobber.
-- Both retain SECURITY DEFINER, set search_path to '', and the full
-- record_audit_event() / -- @audit:tier1 instrumentation.

-- =============================================================================
-- 1. permanently_delete_space -- drop marker references
-- =============================================================================
create or replace function public.permanently_delete_space(p_space_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
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
  v_materials    int;
  v_events       int;
  v_pi           int;
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
  select count(*)::int into v_materials    from public.materials    where space_id = p_space_id;
  select count(*)::int into v_events       from public.events       where space_id = p_space_id;
  -- count anchors (briefs) not PI versions: each anchor is one intelligence brief
  select count(*)::int into v_pi           from public.primary_intelligence_anchors where space_id = p_space_id;

  v_counts := jsonb_build_object(
    'name',          v_space_name,
    'companies',     v_companies,
    'assets',        v_assets,
    'trials',        v_trials,
    'materials',     v_materials,
    'events',        v_events,
    'primary_intelligence', v_pi,
    'was_archived',  v_archived_at is not null,
    'platform_admin_override', v_is_admin and v_archived_at is null
  );

  -- events must be deleted explicitly before the spaces row so the
  -- _log_event_change BEFORE DELETE trigger can write its event_changes
  -- audit row while the spaces FK parent still exists. the spaces delete
  -- itself cascade-deletes event_changes / event_sources (via events) /
  -- trial_change_events. event_sources cascades from events, so deleting
  -- events first also removes event_sources in the same statement.
  -- the existing materials AFTER DELETE trigger (20260521120000) enqueues
  -- every materials.file_path into r2_pending_deletes as the cascade walks.
  -- explicitly delete anchors (PI versions + links cascade via anchor_id FK)
  delete from public.events  where space_id = p_space_id;
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

-- =============================================================================
-- 2. redact_user -- update stale code comment only
--    Change: markers.created_by -> events.created_by in the step-5 comment.
--    No behavioral change; authorship is deliberately preserved by design.
-- =============================================================================
create or replace function public.redact_user(p_user_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  -- @audit:tier1
  v_target_exists  boolean;
  v_tenant_count   int;
  v_space_count    int;
  v_agency_count   int;
  v_platform_count int;
begin
  -- step 1: authenticate. anon callers have no auth.uid().
  if auth.uid() is null then
    raise exception 'redact_user: not authenticated'
      using errcode = '28000';
  end if;

  -- step 2: authorize. platform admin only.
  if not public.is_platform_admin() then
    raise exception 'redact_user: not authorized'
      using errcode = '42501';
  end if;

  -- step 3: target must exist in auth.users.
  select exists (select 1 from auth.users where id = p_user_id)
    into v_target_exists;
  if not v_target_exists then
    raise exception 'redact_user: user % not found', p_user_id
      using errcode = 'P0002';
  end if;

  -- step 4: count rows about to be wiped, for the return value and the
  -- audit metadata. counts are taken before the deletes so they reflect
  -- the actual scrub size.
  select count(*)::int into v_tenant_count
    from public.tenant_members where user_id = p_user_id;
  select count(*)::int into v_space_count
    from public.space_members where user_id = p_user_id;
  select count(*)::int into v_agency_count
    from public.agency_members where user_id = p_user_id;
  select count(*)::int into v_platform_count
    from public.platform_admins where user_id = p_user_id;

  -- step 5: wipe all four membership tables. authorship fks elsewhere
  -- (spaces.created_by, events.created_by, materials.uploaded_by,
  -- primary_intelligence.last_edited_by) stay intact; the user_redactions
  -- marker drives the '(redacted user)' label downstream.
  --
  -- the member self-protection guards (last-owner / no-self-eviction) are
  -- bypassed for the duration of the wipe via the transaction-local
  -- clint.member_guard_cascade flag. redaction is a platform-admin
  -- administrative action: it must wipe even the lone owner of an orphaned
  -- tenant. the flag is restored at the end of this block so subsequent
  -- statements in the same transaction (or in a follow-up rpc call within
  -- the same connection) see the guards re-armed.
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.tenant_members  where user_id = p_user_id;
  delete from public.space_members   where user_id = p_user_id;
  delete from public.agency_members  where user_id = p_user_id;
  delete from public.platform_admins where user_id = p_user_id;
  perform set_config('clint.member_guard_cascade', 'off', true);

  -- step 6: mangle the auth.users row. email is set to an unroutable value
  -- to break login retries; raw_user_meta_data and raw_app_meta_data are
  -- cleared so no provider claims survive; encrypted_password is nulled
  -- so password-based login (if ever enabled) cannot succeed.
  update auth.users
    set email              = 'redacted-' || p_user_id::text || '@invalid',
        raw_user_meta_data = '{}'::jsonb,
        raw_app_meta_data  = '{}'::jsonb,
        encrypted_password = null
    where id = p_user_id;

  -- step 7: insert the redaction marker. on conflict do nothing so repeated
  -- calls remain idempotent (the second call still wipes membership rows
  -- but the marker timestamp from the first call is preserved).
  insert into public.user_redactions (user_id)
    values (p_user_id)
    on conflict (user_id) do nothing;

  -- step 8: sweep audit_events metadata for any rows attributed to the
  -- subject. jsonb_strip_pii_keys removes the known pii keys (email,
  -- user_email, recipient_email, full_name, display_name, phone).
  update public.audit_events
    set metadata = public.jsonb_strip_pii_keys(metadata)
    where actor_user_id = p_user_id;

  -- step 9: emit the audit event. metadata carries the per-table counts so
  -- the audit reader can reconstruct the scrub size without re-querying.
  perform public.record_audit_event(
    'compliance.user_pii_redacted',
    'rpc',
    'user_pii',
    p_user_id,
    null, null, null,
    jsonb_build_object(
      'tenant_members_removed',  v_tenant_count,
      'space_members_removed',   v_space_count,
      'agency_members_removed',  v_agency_count,
      'platform_admins_removed', v_platform_count
    )
  );

  return jsonb_build_object(
    'redacted_user_id',        p_user_id,
    'tenant_members_removed',  v_tenant_count,
    'space_members_removed',   v_space_count,
    'agency_members_removed',  v_agency_count,
    'platform_admins_removed', v_platform_count
  );
end;
$function$;

-- =============================================================================
-- In-file smoke: prod-safe, data-conditional, self-cleaning.
-- Proves the cascade invariant permanently_delete_space now relies on:
-- deleting a space removes events / event_sources / event_changes /
-- trial_change_events via ON DELETE CASCADE. Does NOT call the auth-gated
-- RPC (which requires auth.uid() / platform admin); smokes the raw cascade.
-- Runs only when the demo space and a usable owner are present.
-- =============================================================================
do $$
declare
  v_demo_space  uuid := '00000000-0000-0000-0000-0000000d0100';
  v_tenant_id   uuid;
  v_uid         uuid;
  v_type        uuid;
  v_scratch     uuid;
  v_company     uuid;
  v_asset       uuid;
  v_trial       uuid;
  v_event       uuid;
  v_events      int;
  v_sources     int;
  v_changes     int;
  v_tce         int;
begin
  if not exists (select 1 from public.spaces where id = v_demo_space) then
    raise notice 'D1 smoke: demo space absent (prod-safe skip)';
    return;
  end if;

  select s.tenant_id, sm.user_id
    into v_tenant_id, v_uid
    from public.spaces s
    join public.space_members sm on sm.space_id = s.id and sm.role = 'owner'
    where s.id = v_demo_space
    limit 1;

  if v_tenant_id is null or v_uid is null then
    raise notice 'D1 smoke: no tenant/owner for demo space (prod-safe skip)';
    return;
  end if;

  select id into v_type from public.event_types where space_id is null limit 1;

  -- create a scratch space under the demo tenant
  insert into public.spaces (tenant_id, name, created_by)
    values (v_tenant_id, 'D1 Smoke Scratch Space', v_uid)
    returning id into v_scratch;

  -- seed: company -> asset -> trial -> event -> event_sources
  insert into public.companies (space_id, name, created_by)
    values (v_scratch, 'D1 Smoke Co', v_uid)
    returning id into v_company;
  insert into public.assets (space_id, company_id, name, created_by)
    values (v_scratch, v_company, 'D1 Smoke Asset', v_uid)
    returning id into v_asset;
  insert into public.trials (space_id, asset_id, name, created_by)
    values (v_scratch, v_asset, 'D1 Smoke Trial', v_uid)
    returning id into v_trial;
  insert into public.events
    (space_id, event_type_id, title, event_date, anchor_type, anchor_id, created_by)
    values (v_scratch, v_type, 'D1 Smoke Event', '2026-01-01', 'trial', v_trial, v_uid)
    returning id into v_event;
  insert into public.event_sources (event_id, url, label, sort_order)
    values (v_event, 'https://d1smoke.test', 'D1 Smoke Source', 0);

  -- delete the scratch space: cascade should remove all child rows
  delete from public.spaces where id = v_scratch;

  -- assert the cascade cleaned everything up
  select count(*) into v_events  from public.events         where space_id = v_scratch;
  select count(*) into v_sources from public.event_sources  where event_id  = v_event;
  select count(*) into v_changes from public.event_changes  where space_id  = v_scratch;
  select count(*) into v_tce     from public.trial_change_events where space_id = v_scratch;

  if v_events <> 0 then
    raise exception 'D1 smoke FAIL: % events remain after space delete', v_events;
  end if;
  if v_sources <> 0 then
    raise exception 'D1 smoke FAIL: % event_sources remain after space delete', v_sources;
  end if;
  if v_changes <> 0 then
    raise exception 'D1 smoke FAIL: % event_changes remain after space delete', v_changes;
  end if;
  if v_tce <> 0 then
    raise exception 'D1 smoke FAIL: % trial_change_events remain after space delete', v_tce;
  end if;

  raise notice 'D1 smoke: PASS';
end$$;

notify pgrst, 'reload schema';
