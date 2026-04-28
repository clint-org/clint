-- migration: 20260428042300_whitelabel_isolation_smoke_tests
-- purpose: assertion-style migration. creates two synthetic tenants under
--   the same agency, two synthetic users (one per tenant), and verifies
--   that user_a cannot read user_b's space data via has_space_access. also
--   verifies the agency-owner cross-tenant disjunct works. fails the
--   migration if any invariant is violated.
-- this migration is destructive of its own test data (deletes at the end).
--   idempotent: safe to re-run via supabase db reset.

do $$
declare
  v_agency_id uuid := '01010101-0101-0101-0101-010101010101';
  v_t_a uuid := '02020202-0202-0202-0202-020202020202';
  v_t_b uuid := '03030303-0303-0303-0303-030303030303';
  v_u_a uuid := '04040404-0404-0404-0404-040404040404';
  v_u_b uuid := '05050505-0505-0505-0505-050505050505';
  v_u_owner uuid := '06060606-0606-0606-0606-060606060606';
  v_s_a uuid;
  v_s_b uuid;
  v_pass boolean;
begin
  -- bootstrap (use SECURITY DEFINER privileges of this migration)
  insert into auth.users (id, email) values
    (v_u_a, 'usera@a.com'),
    (v_u_b, 'userb@b.com'),
    (v_u_owner, 'owner@agency.com');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'Test Ag', 'test-iso-ag', 'testisoag', 'Test', 'a@b.com');
  insert into public.agency_members (agency_id, user_id, role)
    values (v_agency_id, v_u_owner, 'owner');
  insert into public.tenants (id, name, slug, subdomain, agency_id) values
    (v_t_a, 'TenantA', 'iso-tenant-a', 'iso-tenant-a', v_agency_id),
    (v_t_b, 'TenantB', 'iso-tenant-b', 'iso-tenant-b', v_agency_id);
  insert into public.tenant_members (tenant_id, user_id, role) values
    (v_t_a, v_u_a, 'owner'),
    (v_t_b, v_u_b, 'owner');
  insert into public.spaces (tenant_id, name, created_by) values
    (v_t_a, 'A space', v_u_a),
    (v_t_b, 'B space', v_u_b);
  select id into v_s_a from public.spaces where tenant_id = v_t_a limit 1;
  select id into v_s_b from public.spaces where tenant_id = v_t_b limit 1;

  -- 1. user_a should NOT have access to user_b's space
  perform set_config('request.jwt.claim.sub', v_u_a::text, true);
  v_pass := not public.has_space_access(v_s_b);
  if not v_pass then raise exception 'isolation FAIL: user_a sees user_b''s space'; end if;

  -- 2. user_a should have access to user_a's own space
  v_pass := public.has_space_access(v_s_a);
  if not v_pass then raise exception 'isolation FAIL: user_a denied own space'; end if;

  -- 3. agency owner should have access to BOTH
  perform set_config('request.jwt.claim.sub', v_u_owner::text, true);
  v_pass := public.has_space_access(v_s_a) and public.has_space_access(v_s_b);
  if not v_pass then raise exception 'isolation FAIL: agency owner denied cross-tenant'; end if;

  -- 4. suspending tenant A should block writes from owner; reads still ok
  perform set_config('request.jwt.claim.sub', v_u_a::text, true);
  update public.tenants set suspended_at = now() where id = v_t_a;
  v_pass := public.has_space_access(v_s_a) and not public.has_space_access(v_s_a, array['owner','editor']);
  if not v_pass then raise exception 'isolation FAIL: suspension not enforced for owner'; end if;
  update public.tenants set suspended_at = null where id = v_t_a;

  raise notice 'whitelabel isolation smoke tests: PASS';

  -- cleanup so this migration is idempotent
  delete from public.spaces where tenant_id in (v_t_a, v_t_b);
  delete from public.tenant_members where tenant_id in (v_t_a, v_t_b);
  delete from public.tenants where id in (v_t_a, v_t_b);
  delete from public.agency_members where agency_id = v_agency_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id in (v_u_a, v_u_b, v_u_owner);
end;
$$;
