-- migration: 20260521120200_polymorphic_cleanup_triggers
-- purpose: backfill the cleanup gap left by the polymorphic (entity_type,
--          entity_id) columns on primary_intelligence,
--          primary_intelligence_links, and material_links. those columns
--          intentionally lack foreign keys (the polymorphic pattern cannot
--          point at four different parent tables with a single FK), so
--          nothing today removes the rows when their referenced parent is
--          deleted. four AFTER DELETE triggers, one per parent table
--          (companies, products, trials, markers), call a shared cleanup
--          function with the appropriate p_type literal. fires under
--          cascade too, so deleting a company also runs the products and
--          trials triggers per descendant row -- no coverage gap when the
--          parent goes via cascade.
--
--          design rationale: docs/superpowers/specs/2026-05-20-cascade-safety
--          -design.md, section "#4 Polymorphic entity cleanup triggers".
--
--          the trigger is not a tier-1 audit target. it fires on data
--          mutations in editorial tables, not on admin / security /
--          governance RPCs, so the -- @audit:tier1 marker is not required
--          (see 20260510002000_audit_coverage_smoke.sql).
--
--   inline smoke test verifies that, for each of the four parent tables:
--     - a primary_intelligence row pointing at the parent is removed.
--     - a primary_intelligence_links row pointing at the parent is removed.
--     - a material_links row pointing at the parent is removed.
--     - the parent's own row is gone.


-- =============================================================================
-- trigger fn: _cleanup_polymorphic_refs
-- =============================================================================
-- one function, four call sites. p_type is passed as a CREATE TRIGGER
-- argument literal so the function body is parameterless wrt the parent
-- table identity. security definer so the deletes succeed regardless of
-- the role that triggered the parent delete (cascade path, RPC path, or
-- a direct authenticated delete).

create or replace function public._cleanup_polymorphic_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := tg_argv[0];
begin
  delete from public.primary_intelligence_links
    where entity_type = v_type and entity_id = old.id;
  delete from public.primary_intelligence
    where entity_type = v_type and entity_id = old.id;
  delete from public.material_links
    where entity_type = v_type and entity_id = old.id;
  return old;
end;
$$;

comment on function public._cleanup_polymorphic_refs() is
  'AFTER DELETE trigger fn shared by companies, products, trials, and '
  'markers. Reads tg_argv[0] for the polymorphic entity_type literal and '
  'removes matching rows from primary_intelligence_links, '
  'primary_intelligence, and material_links (which lack FKs by design '
  'because the entity_id column is polymorphic across four parent tables). '
  'Security definer so cascade-driven deletes from any role succeed.';


-- =============================================================================
-- triggers: one per parent table
-- =============================================================================

create trigger _cleanup_polymorphic_refs_company
  after delete on public.companies
  for each row execute function public._cleanup_polymorphic_refs('company');

create trigger _cleanup_polymorphic_refs_product
  after delete on public.products
  for each row execute function public._cleanup_polymorphic_refs('product');

create trigger _cleanup_polymorphic_refs_trial
  after delete on public.trials
  for each row execute function public._cleanup_polymorphic_refs('trial');

create trigger _cleanup_polymorphic_refs_marker
  after delete on public.markers
  for each row execute function public._cleanup_polymorphic_refs('marker');


-- =============================================================================
-- smoke test
-- =============================================================================
-- builds one fixture (tenant, space, owner, plus the four parent rows it
-- needs) and a "parent" primary_intelligence row attached to the space
-- entity_type. that parent row exists so we can attach
-- primary_intelligence_links rows to it; the cleanup-for-space happens
-- through ON DELETE CASCADE on primary_intelligence.space_id, which is
-- unrelated to the polymorphic triggers under test.
--
-- per-parent assertions: insert (1) primary_intelligence row keyed to the
-- parent, (1) primary_intelligence_links row keyed to the parent, (1)
-- material_links row keyed to the parent. delete the parent. confirm all
-- three child counts are zero.
--
-- ordering note: the marker case runs first because the marker delete
-- has the smallest blast radius (no descendant tables under markers, so
-- only the marker trigger fires). the trial / product / company cases
-- delete with no descendants in this fixture (no marker_assignments,
-- no children built underneath), so each trigger fires exactly once for
-- that parent. teardown uses the clint.member_guard_cascade = on bypass
-- pattern from 20260503090000_delete_space_rpc.sql.

do $$
declare
  v_user        uuid := gen_random_uuid();
  v_tenant      uuid := gen_random_uuid();
  v_space       uuid := gen_random_uuid();
  v_email       text := 'poly-cleanup-smoke-' || v_user || '@example.com';
  v_marker_type uuid;
  v_company     uuid := gen_random_uuid();
  v_product     uuid := gen_random_uuid();
  v_ta          uuid := gen_random_uuid();
  v_trial       uuid := gen_random_uuid();
  v_marker      uuid := gen_random_uuid();
  v_pi_space    uuid := gen_random_uuid();
  v_pi_child    uuid;
  v_material    uuid;
  v_remaining   int;
  v_path        text;
  -- canonical list of (parent_id, entity_type) pairs to iterate. order is
  -- intentional: marker first (smallest blast radius), then trial,
  -- product, company.
  v_cases       text[] := array[
                  'marker',  v_marker::text,
                  'trial',   v_trial::text,
                  'product', v_product::text,
                  'company', v_company::text
                ];
  v_i           int;
  v_type        text;
  v_parent_id   uuid;
begin
  -- ---------------------------------------------------------------------------
  -- bootstrap
  -- ---------------------------------------------------------------------------
  select id into v_marker_type from public.marker_types where space_id is null limit 1;
  if v_marker_type is null then
    raise exception 'poly cleanup smoke FAIL: no global marker_type available';
  end if;

  insert into auth.users (id, email, instance_id, aud, role)
    values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.tenants (id, name, slug)
    values (v_tenant, 'poly-smoke-tenant', 'poly-smoke-' || left(v_tenant::text, 8));
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_user, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant, 'poly-smoke-space', v_user);
  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_user, 'owner');

  -- impersonate the owner so auth.uid() resolves to v_user inside any
  -- audit triggers that may fire during fixture mutation. mirrors the
  -- pattern in 20260503090000_delete_space_rpc.sql.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
    true
  );

  -- core domain rows
  insert into public.companies (id, space_id, created_by, name)
    values (v_company, v_space, v_user, 'poly-smoke-co');
  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product, v_space, v_user, v_company, 'poly-smoke-drug');
  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta, v_space, v_user, 'poly-smoke-ta');
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values (v_trial, v_space, v_user, v_product, v_ta, 'poly-smoke-trial', 'NCT-POLY-SMOKE');
  insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
    values (v_marker, v_space, v_marker_type, 'poly-smoke-marker', current_date, 'actual', v_user);

  -- parent PI row keyed to the space (entity_type = 'space'). PI links
  -- created below reference this row's id so that we have a place to
  -- hang link rows whose entity_type points at each parent under test.
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline, summary_md, last_edited_by
  ) values (
    v_pi_space, v_space, 'space', v_space, 'draft',
    'poly-smoke parent pi', 'parent', v_user
  );

  -- ---------------------------------------------------------------------------
  -- per-parent assertions
  -- ---------------------------------------------------------------------------
  -- the cases array is laid out as flat (type, uuid) pairs.
  v_i := 1;
  while v_i <= array_length(v_cases, 1) loop
    v_type      := v_cases[v_i];
    v_parent_id := v_cases[v_i + 1]::uuid;

    -- (1) primary_intelligence row keyed to the parent.
    v_pi_child := gen_random_uuid();
    insert into public.primary_intelligence (
      id, space_id, entity_type, entity_id, state, headline, summary_md, last_edited_by
    ) values (
      v_pi_child, v_space, v_type, v_parent_id, 'draft',
      'poly-smoke pi for ' || v_type, 'body', v_user
    );

    -- (2) primary_intelligence_links row keyed to the parent. parent PI
    -- row is the space-typed v_pi_space; the link points at the parent
    -- under test.
    insert into public.primary_intelligence_links (
      primary_intelligence_id, entity_type, entity_id, relationship_type
    ) values (
      v_pi_space, v_type, v_parent_id, 'smoke'
    );

    -- (3) material_links row keyed to the parent. fresh material per
    -- iteration so the unique (material_id, entity_type, entity_id)
    -- constraint never bites; the materials check constraint allows all
    -- four entity_type values plus 'space'.
    v_material := gen_random_uuid();
    v_path     := 'materials/' || v_space::text || '/' || v_material::text || '/poly-' || v_type || '.pdf';
    insert into public.materials (
      id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
      mime_type, material_type, title
    ) values (
      v_material, v_space, v_user, v_path, 'poly-' || v_type || '.pdf', 1,
      'application/pdf', 'briefing', 'poly smoke material for ' || v_type
    );
    insert into public.material_links (
      material_id, entity_type, entity_id
    ) values (
      v_material, v_type, v_parent_id
    );

    -- delete the parent. issuing this from the migration role bypasses
    -- RLS; the AFTER DELETE trigger runs as security definer regardless.
    case v_type
      when 'marker'  then delete from public.markers   where id = v_parent_id;
      when 'trial'   then delete from public.trials    where id = v_parent_id;
      when 'product' then delete from public.products  where id = v_parent_id;
      when 'company' then delete from public.companies where id = v_parent_id;
    end case;

    -- assertion (a): primary_intelligence cleared for this parent.
    select count(*)::int into v_remaining
      from public.primary_intelligence
      where entity_type = v_type and entity_id = v_parent_id;
    if v_remaining <> 0 then
      raise exception 'poly cleanup smoke FAIL [%]: % primary_intelligence rows remain',
        v_type, v_remaining;
    end if;

    -- assertion (b): primary_intelligence_links cleared for this parent.
    select count(*)::int into v_remaining
      from public.primary_intelligence_links
      where entity_type = v_type and entity_id = v_parent_id;
    if v_remaining <> 0 then
      raise exception 'poly cleanup smoke FAIL [%]: % primary_intelligence_links rows remain',
        v_type, v_remaining;
    end if;

    -- assertion (c): material_links cleared for this parent.
    select count(*)::int into v_remaining
      from public.material_links
      where entity_type = v_type and entity_id = v_parent_id;
    if v_remaining <> 0 then
      raise exception 'poly cleanup smoke FAIL [%]: % material_links rows remain',
        v_type, v_remaining;
    end if;

    v_i := v_i + 2;
  end loop;

  -- ---------------------------------------------------------------------------
  -- teardown
  -- ---------------------------------------------------------------------------
  -- the four parents are already gone (the test deleted them). sweep the
  -- materials, the parent PI row, the therapeutic area, then the space /
  -- tenant / user via the member_guard_cascade bypass pattern.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.materials         where space_id = v_space;
  delete from public.primary_intelligence where space_id = v_space;
  delete from public.therapeutic_areas where space_id = v_space;
  delete from public.space_members     where space_id = v_space;
  delete from public.tenant_members    where tenant_id = v_tenant;
  delete from public.spaces            where id = v_space;
  delete from public.tenants           where id = v_tenant;
  delete from auth.users               where id = v_user;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'polymorphic_cleanup_triggers smoke test: PASS';
end $$;
