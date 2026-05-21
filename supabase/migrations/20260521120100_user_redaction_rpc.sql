-- migration: 20260521120100_user_redaction_rpc
-- purpose: preserve authorship across user removal via redaction rather than
--          deletion. addresses cascade-safety finding #6 (auth.users deletion
--          is half-cascade, half-block; the user row is effectively immortal
--          by accident, not by design). the redact_user rpc wipes all four
--          membership rows for the subject, mangles the auth.users row to
--          break login, sweeps audit_events.metadata via jsonb_strip_pii_keys,
--          and inserts a public.user_redactions marker so the ui can render
--          '(redacted user)' on authorship surfaces.
--
--   schema:
--     public.user_redactions      mirror table (user_id pk, redacted_at)
--
--   rpc:
--     public.redact_user(uuid)    platform-admin gated; -- @audit:tier1
--
--   inline smoke test verifies:
--     - returned jsonb carries the four membership count fields.
--     - tenant_members, space_members, agency_members, platform_admins are
--       clean for the subject after the call.
--     - auth.users row survives with email mangled to redacted-<uuid>@invalid
--       and raw_user_meta_data / raw_app_meta_data emptied.
--     - public.user_redactions row exists for the subject.
--     - spaces.created_by, markers.created_by, materials.uploaded_by, and
--       primary_intelligence.last_edited_by all still point at the subject
--       (authorship preserved).
--     - audit_events has a compliance.user_pii_redacted row for the subject.
--     - non-platform-admin caller hits sqlstate 42501.
--
--   see docs/superpowers/specs/2026-05-20-cascade-safety-design.md
--   ("#6 user redaction").


-- =============================================================================
-- table: user_redactions
-- =============================================================================
-- mirror table for the auth.users redaction flag. modifying auth.users
-- schema directly is fragile across supabase upgrades, so the flag lives
-- in public. rls allows authenticated read so the ui can resolve the
-- '(redacted user)' label on authorship chips. writes happen only inside
-- the redact_user rpc; no insert/update/delete policy is added.

create table public.user_redactions (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  redacted_at timestamptz not null default now()
);

comment on table public.user_redactions is
  'Marker rows for users whose pii has been redacted by redact_user(). '
  'Presence of a row signals the ui to render ''(redacted user)'' on '
  'authorship chips (spaces.created_by, markers.created_by, '
  'materials.uploaded_by, primary_intelligence.last_edited_by). Writes '
  'happen only inside the redact_user rpc.';

alter table public.user_redactions enable row level security;

create policy "authenticated can read user_redactions"
on public.user_redactions for select to authenticated
using ( true );

-- no insert / update / delete policy: writes flow exclusively through the
-- redact_user rpc (security definer).
revoke insert, update, delete on public.user_redactions from anon, authenticated;


-- =============================================================================
-- rpc: redact_user
-- =============================================================================
-- platform-admin only. wipes membership rows across all four tables, mangles
-- the auth.users row so the subject cannot log in, sweeps audit_events
-- metadata via jsonb_strip_pii_keys, inserts the public.user_redactions
-- marker, and emits a compliance.user_pii_redacted audit event with the
-- per-table removal counts in metadata. authorship fks (spaces.created_by,
-- markers.created_by, materials.uploaded_by, primary_intelligence.last_edited_by)
-- are intentionally not touched; they preserve the historical record while
-- the user_redactions marker drives the ui to render '(redacted user)'.

create or replace function public.redact_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  -- (spaces.created_by, markers.created_by, materials.uploaded_by,
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
$$;

revoke execute on function public.redact_user(uuid) from public, anon;
grant  execute on function public.redact_user(uuid) to authenticated;

comment on function public.redact_user(uuid) is
  'Platform-admin-only user redaction. Wipes membership rows across '
  'tenant_members, space_members, agency_members, platform_admins; '
  'mangles the auth.users row (email -> redacted-<uuid>@invalid, raw meta '
  'cleared, encrypted_password nulled); inserts a public.user_redactions '
  'marker; sweeps audit_events.metadata via jsonb_strip_pii_keys; emits a '
  'compliance.user_pii_redacted audit event with per-table counts in '
  'metadata. Authorship fks elsewhere are intentionally preserved. '
  'SECURITY DEFINER; gate is is_platform_admin().';


-- =============================================================================
-- smoke test
-- =============================================================================
-- builds a fixture with a target user that owns content across all four
-- membership tables plus authorship rows on spaces, markers, materials,
-- and primary_intelligence; impersonates a platform admin; calls
-- redact_user; asserts return shape, membership wipe, auth.users mangle,
-- user_redactions presence, authorship preservation, and audit emission.
-- separately exercises the non-platform-admin negative path. teardown
-- uses the clint.member_guard_cascade = on bypass pattern from
-- 20260503090000_delete_space_rpc.sql.

do $$
declare
  v_admin       uuid := gen_random_uuid();
  v_target      uuid := gen_random_uuid();
  v_outsider    uuid := gen_random_uuid();
  v_agency      uuid := gen_random_uuid();
  v_tenant      uuid := gen_random_uuid();
  v_space       uuid := gen_random_uuid();
  v_marker      uuid := gen_random_uuid();
  v_material    uuid := gen_random_uuid();
  v_pi          uuid := gen_random_uuid();
  v_marker_type uuid;
  v_admin_email  text := 'redact-smoke-admin-' || v_admin || '@example.com';
  v_target_email text := 'redact-smoke-target-' || v_target || '@example.com';
  v_outsider_email text := 'redact-smoke-outsider-' || v_outsider || '@example.com';
  v_result        jsonb;
  v_remaining     int;
  v_users_email   text;
  v_users_meta    jsonb;
  v_users_app_meta jsonb;
  v_audit_rows    int;
begin
  select id into v_marker_type from public.marker_types where space_id is null limit 1;
  if v_marker_type is null then
    raise exception 'redact_user smoke FAIL: no global marker_type available';
  end if;

  -- bootstrap users
  insert into auth.users (id, email, instance_id, aud, role)
    values
      (v_admin,    v_admin_email,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_target,   v_target_email,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_outsider, v_outsider_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  -- platform admin row for v_admin
  insert into public.platform_admins (user_id) values (v_admin);

  -- agency for the agency_members coverage on the target
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (
      v_agency,
      'redact-smoke-agency',
      'redact-smoke-' || left(v_agency::text, 8),
      'redact-smoke-' || left(v_agency::text, 8),
      'RedactSmoke',
      'agency-' || v_agency || '@example.com'
    );
  insert into public.agency_members (agency_id, user_id, role)
    values (v_agency, v_target, 'owner');

  -- tenant + tenant_members for the target
  insert into public.tenants (id, name, slug, agency_id)
    values (v_tenant, 'redact-smoke-tenant', 'redact-smoke-t-' || left(v_tenant::text, 8), v_agency);
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_target, 'owner');

  -- space + space_members for the target. v_target is also the created_by
  -- on the space (authorship survives the wipe).
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant, 'redact-smoke-space', v_target);
  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_target, 'owner');

  -- also make v_target a platform admin so we exercise the platform_admins
  -- wipe path. v_admin is the one we will impersonate (separate row).
  insert into public.platform_admins (user_id) values (v_target);

  -- impersonate v_target so the markers BEFORE DELETE trigger can find a
  -- valid changed_by when (later) we leave authorship intact; we then
  -- swap to the admin for the rpc call.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_target::text, 'role', 'authenticated', 'email', v_target_email)::text,
    true
  );

  -- authorship rows that must survive the redaction
  insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
    values (v_marker, v_space, v_marker_type, 'redact-smoke-marker', current_date, 'actual', v_target);

  insert into public.materials (
    id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title
  )
  values (
    v_material, v_space, v_target,
    'materials/' || v_space::text || '/' || v_material::text || '/r.pdf',
    'r.pdf', 1, 'application/pdf', 'briefing', 'redact-smoke-material'
  );

  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline, last_edited_by
  ) values (
    v_pi, v_space, 'marker', v_marker, 'draft',
    'redact-smoke-pi', v_target
  );

  -- seed an audit_events row attributed to the target so the sweep can
  -- assert metadata is stripped of pii keys.
  insert into public.audit_events
    (action, source, resource_type, actor_user_id, actor_email, metadata)
  values
    ('test.preflight', 'system', 'test', v_target, v_target_email,
     jsonb_build_object('email', v_target_email, 'note', 'preserved'));

  -- ----------------------------------------------------------------------
  -- happy path: impersonate the platform admin and call redact_user
  -- ----------------------------------------------------------------------
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated', 'email', v_admin_email)::text,
    true
  );
  set local role authenticated;
  begin
    v_result := public.redact_user(v_target);
  exception when others then
    reset role;
    raise exception 'redact_user smoke FAIL: rpc threw % (sqlstate %)',
      sqlerrm, sqlstate;
  end;
  reset role;

  -- return shape must include the four count fields plus redacted_user_id
  if (v_result ->> 'redacted_user_id') is null
     or not (v_result ? 'tenant_members_removed')
     or not (v_result ? 'space_members_removed')
     or not (v_result ? 'agency_members_removed')
     or not (v_result ? 'platform_admins_removed') then
    raise exception 'redact_user smoke FAIL: return shape missing fields; got %', v_result;
  end if;

  -- membership tables clean for the target
  select count(*)::int into v_remaining from public.tenant_members where user_id = v_target;
  if v_remaining <> 0 then
    raise exception 'redact_user smoke FAIL: tenant_members not wiped (% remaining)', v_remaining;
  end if;
  select count(*)::int into v_remaining from public.space_members where user_id = v_target;
  if v_remaining <> 0 then
    raise exception 'redact_user smoke FAIL: space_members not wiped (% remaining)', v_remaining;
  end if;
  select count(*)::int into v_remaining from public.agency_members where user_id = v_target;
  if v_remaining <> 0 then
    raise exception 'redact_user smoke FAIL: agency_members not wiped (% remaining)', v_remaining;
  end if;
  select count(*)::int into v_remaining from public.platform_admins where user_id = v_target;
  if v_remaining <> 0 then
    raise exception 'redact_user smoke FAIL: platform_admins not wiped (% remaining)', v_remaining;
  end if;

  -- auth.users row mangled but present
  select email, raw_user_meta_data, raw_app_meta_data
    into v_users_email, v_users_meta, v_users_app_meta
    from auth.users where id = v_target;
  if v_users_email is null then
    raise exception 'redact_user smoke FAIL: auth.users row missing after redaction';
  end if;
  if v_users_email <> ('redacted-' || v_target::text || '@invalid') then
    raise exception 'redact_user smoke FAIL: email not mangled; got %', v_users_email;
  end if;
  if coalesce(v_users_meta, '{}'::jsonb) <> '{}'::jsonb then
    raise exception 'redact_user smoke FAIL: raw_user_meta_data not cleared; got %', v_users_meta;
  end if;
  if coalesce(v_users_app_meta, '{}'::jsonb) <> '{}'::jsonb then
    raise exception 'redact_user smoke FAIL: raw_app_meta_data not cleared; got %', v_users_app_meta;
  end if;

  -- user_redactions marker exists
  select count(*)::int into v_remaining from public.user_redactions where user_id = v_target;
  if v_remaining <> 1 then
    raise exception 'redact_user smoke FAIL: user_redactions row not present (% rows)', v_remaining;
  end if;

  -- authorship preserved across all four surfaces
  select count(*)::int into v_remaining
    from public.spaces where id = v_space and created_by = v_target;
  if v_remaining <> 1 then
    raise exception 'redact_user smoke FAIL: spaces.created_by not preserved';
  end if;
  select count(*)::int into v_remaining
    from public.markers where id = v_marker and created_by = v_target;
  if v_remaining <> 1 then
    raise exception 'redact_user smoke FAIL: markers.created_by not preserved';
  end if;
  select count(*)::int into v_remaining
    from public.materials where id = v_material and uploaded_by = v_target;
  if v_remaining <> 1 then
    raise exception 'redact_user smoke FAIL: materials.uploaded_by not preserved';
  end if;
  select count(*)::int into v_remaining
    from public.primary_intelligence where id = v_pi and last_edited_by = v_target;
  if v_remaining <> 1 then
    raise exception 'redact_user smoke FAIL: primary_intelligence.last_edited_by not preserved';
  end if;

  -- compliance.user_pii_redacted audit row emitted
  select count(*)::int into v_audit_rows
    from public.audit_events
    where action = 'compliance.user_pii_redacted'
      and resource_id = v_target;
  if v_audit_rows <> 1 then
    raise exception 'redact_user smoke FAIL: expected 1 compliance.user_pii_redacted row, got %', v_audit_rows;
  end if;

  -- audit_events metadata sweep: the pii 'email' key should be gone from
  -- the seeded row but the non-pii 'note' key should survive.
  if exists (
    select 1 from public.audit_events
    where actor_user_id = v_target
      and action = 'test.preflight'
      and metadata ? 'email'
  ) then
    raise exception 'redact_user smoke FAIL: audit_events metadata pii sweep did not run';
  end if;
  if not exists (
    select 1 from public.audit_events
    where actor_user_id = v_target
      and action = 'test.preflight'
      and (metadata ->> 'note') = 'preserved'
  ) then
    raise exception 'redact_user smoke FAIL: audit_events metadata sweep removed non-pii keys';
  end if;

  -- ----------------------------------------------------------------------
  -- negative path: non-platform-admin caller hits 42501
  -- ----------------------------------------------------------------------
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_outsider::text, 'role', 'authenticated', 'email', v_outsider_email)::text,
    true
  );
  set local role authenticated;
  begin
    perform public.redact_user(v_admin);
    reset role;
    raise exception 'redact_user smoke FAIL: non-admin caller should have raised 42501';
  exception
    when sqlstate '42501' then
      reset role;
    when others then
      reset role;
      raise exception 'redact_user smoke FAIL: non-admin caller raised wrong sqlstate % (%)',
        sqlstate, sqlerrm;
  end;

  -- ----------------------------------------------------------------------
  -- teardown. impersonation cleared; member-row deletes go under the
  -- clint.member_guard_cascade bypass so the self-protection guards stay
  -- out of the way. mirrors the working pattern in
  -- 20260503090000_delete_space_rpc.sql.
  -- ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);

  -- clean up fixture rows that live under the space / tenant / agency.
  delete from public.audit_events
    where actor_user_id in (v_admin, v_target, v_outsider)
       or resource_id   in (v_admin, v_target, v_outsider);
  delete from public.primary_intelligence where id = v_pi;
  delete from public.materials            where id = v_material;
  delete from public.markers              where id = v_marker;
  delete from public.space_members        where space_id = v_space;
  delete from public.spaces               where id = v_space;
  delete from public.tenant_members       where tenant_id = v_tenant;
  delete from public.tenants              where id = v_tenant;
  delete from public.agency_members       where agency_id = v_agency;
  delete from public.agencies             where id = v_agency;
  delete from public.user_redactions      where user_id = v_target;
  delete from public.platform_admins      where user_id in (v_admin, v_target);
  delete from auth.users                  where id in (v_admin, v_target, v_outsider);

  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'redact_user smoke test: PASS';
end $$;
