-- migration: 20260521120600_preview_delete_rpcs
-- purpose: read-only preview RPCs that return jsonb count breakdowns for the
--          cascade footprint of company / product / trial deletes. addresses
--          cascade-safety finding #2 ("Company, product, trial: cascade with
--          count preview"). these RPCs feed the count-aware confirm-delete
--          dialog (T10) so the user sees an honest pre-flight read of every
--          row a delete will actually remove, and only commits the delete
--          once they have typed the entity name back.
--
--          functions:
--            public.preview_company_delete(p_company_id uuid) returns jsonb
--            public.preview_product_delete(p_product_id uuid) returns jsonb
--            public.preview_trial_delete  (p_trial_id   uuid) returns jsonb
--
--          all three are STABLE SECURITY DEFINER with set search_path = ''
--          and gate inside the function body on auth.uid() being non-null
--          (28000) and public.has_space_access(space_id) for the entity's
--          space (42501). non-existent entity raises P0002. read-only: no
--          mutations of any kind; safe to call repeatedly from the UI.
--
--          breakdown keys (preview_company_delete):
--            products                     direct children of the company.
--            trials                       grandchildren via products.
--            trial_notes                  great-grandchildren via trials.
--            events                       events with company_id, product_id,
--                                         or trial_id pointing at the cascade
--                                         set. all three FK paths cascade.
--            material_links               polymorphic link rows that the T3
--                                         trigger will clean. NOT a count of
--                                         materials. materials live by space
--                                         and survive the cascade.
--            primary_intelligence         PI rows whose (entity_type,
--                                         entity_id) matches company / any
--                                         product / any trial in the set.
--                                         cleared by the T3 polymorphic
--                                         trigger when each parent is
--                                         deleted.
--            primary_intelligence_links   same matching predicate as PI; the
--                                         T3 trigger clears these too.
--            marker_assignments           assignment rows whose trial_id is
--                                         in the cascade set. cleared by the
--                                         existing FK cascade from trials.
--            markers_removed_entirely     distinct markers reachable through
--                                         the cascade set that have NO
--                                         assignments to a trial OUTSIDE the
--                                         set. these are orphaned by the T4
--                                         trigger after the last assignment
--                                         row is removed.
--            markers_unlinked_only        distinct markers reachable through
--                                         the cascade set that DO have at
--                                         least one assignment to a trial
--                                         outside the set. these survive the
--                                         cascade -- only their assignment
--                                         rows for in-set trials are cleared.
--          (note: the legacy `marker_notifications` table from the design
--          doc was removed by 20260503080000_drop_marker_notifications.sql.
--          the preview output therefore does not include a
--          marker_notifications key; the count belongs to a feature that no
--          longer exists.)
--
--          preview_product_delete is the same shape with the `products` key
--          dropped (this IS one product, not its children) and the predicate
--          scoped to a single product + its trials.
--
--          preview_trial_delete is narrower still: a single trial, so no
--          products / trials cardinality, just trial_notes / events / PI /
--          PIL / marker_assignments / marker orphan-split / notifications.
--
--          these RPCs are NOT tier-1 audit targets. they perform no mutation
--          (STABLE), so the @audit:tier1 marker is not required (see
--          20260510002000_audit_coverage_smoke.sql). the destructive delete
--          itself is still subject to the audit triggers on each parent
--          table.
--
--          design rationale: docs/superpowers/specs/2026-05-20-cascade-safety
--          -design.md, section "#2 Company, product, trial: cascade with
--          count preview" (jsonb shape) and the breakdown-keys table in the
--          decision log.
--
--   inline smoke test (under begin/rollback envelope) verifies:
--     - deterministic fixture (1 company, 2 products, 3 trials, 4 notes, 5
--       events, 1 material with 4 links, 2 PI rows, 4 PIL rows, 6 marker
--       assignments split across 6 markers where exactly 5 will orphan, 3
--       marker notifications) yields the documented count breakdown.
--     - the RPC is read-only: a second call returns the same output.
--     - a caller without space access gets sqlstate 42501.
--     - preview_product_delete and preview_trial_delete return sensible
--       subsets for the same fixture (cardinality-narrowed).


-- =============================================================================
-- preview_company_delete
-- =============================================================================
-- jsonb count breakdown of everything that a `delete from public.companies
-- where id = p_company_id` would remove given the FK actions installed in
-- 20260521120500_cascade_fk_flips.sql plus the T3 / T4 triggers.

create or replace function public.preview_company_delete(p_company_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid                          uuid := auth.uid();
  v_space_id                     uuid;
  v_product_ids                  uuid[];
  v_trial_ids                    uuid[];
  v_n_products                   bigint;
  v_n_trials                     bigint;
  v_n_trial_notes                bigint;
  v_n_events                     bigint;
  v_n_material_links             bigint;
  v_n_primary_intelligence       bigint;
  v_n_primary_intelligence_links bigint;
  v_n_marker_assignments         bigint;
  v_n_markers_removed_entirely   bigint;
  v_n_markers_unlinked_only      bigint;
begin
  -- authn: caller must be a logged-in user.
  if v_uid is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  -- existence + space lookup. P0002 if the company does not exist.
  select c.space_id into v_space_id
    from public.companies c
    where c.id = p_company_id;
  if v_space_id is null then
    raise exception 'company % not found', p_company_id
      using errcode = 'P0002';
  end if;

  -- authz: caller must see the space. has_space_access covers explicit
  -- space membership, tenant membership, agency owner / member, and the
  -- platform admin read bypass.
  if not public.has_space_access(v_space_id) then
    raise exception 'not authorized for space %', v_space_id
      using errcode = '42501';
  end if;

  -- cascade set: products under the company, then trials under those
  -- products. coalesced to empty arrays so the predicates below are
  -- well-defined when a branch is empty.
  select coalesce(array_agg(p.id), array[]::uuid[]) into v_product_ids
    from public.products p
    where p.company_id = p_company_id;

  select coalesce(array_agg(t.id), array[]::uuid[]) into v_trial_ids
    from public.trials t
    where t.product_id = any(v_product_ids);

  v_n_products := array_length(v_product_ids, 1);
  if v_n_products is null then v_n_products := 0; end if;
  v_n_trials := array_length(v_trial_ids, 1);
  if v_n_trials is null then v_n_trials := 0; end if;

  -- trial_notes under the cascade set. FK cascade from trials handles it.
  select count(*) into v_n_trial_notes
    from public.trial_notes tn
    where tn.trial_id = any(v_trial_ids);

  -- events with company_id / product_id / trial_id pointing into the
  -- cascade set. all three FK columns are ON DELETE CASCADE; the
  -- events_entity_level_check constraint guarantees at most one of the
  -- three is non-null on any given row, so the OR predicate counts each
  -- row exactly once.
  select count(*) into v_n_events
    from public.events e
    where e.company_id = p_company_id
       or e.product_id = any(v_product_ids)
       or e.trial_id   = any(v_trial_ids);

  -- material_links to be cleared by the T3 polymorphic cleanup trigger.
  -- the underlying materials survive (they are space-scoped, not company-
  -- scoped), so this count is link rows, not material rows.
  select count(*) into v_n_material_links
    from public.material_links ml
    where (ml.entity_type = 'company' and ml.entity_id = p_company_id)
       or (ml.entity_type = 'product' and ml.entity_id = any(v_product_ids))
       or (ml.entity_type = 'trial'   and ml.entity_id = any(v_trial_ids));

  -- primary_intelligence rows that the T3 trigger will clear: any PI keyed
  -- to the company, any product, or any trial in the cascade set.
  select count(*) into v_n_primary_intelligence
    from public.primary_intelligence pi
    where (pi.entity_type = 'company' and pi.entity_id = p_company_id)
       or (pi.entity_type = 'product' and pi.entity_id = any(v_product_ids))
       or (pi.entity_type = 'trial'   and pi.entity_id = any(v_trial_ids));

  -- primary_intelligence_links with the same matching predicate. note: a
  -- PIL row can also be removed by FK cascade from its parent PI row, but
  -- here we only count link rows that the T3 trigger fires on per cascade
  -- target. that's the user-visible "rows cleared" surface in the dialog.
  select count(*) into v_n_primary_intelligence_links
    from public.primary_intelligence_links pil
    where (pil.entity_type = 'company' and pil.entity_id = p_company_id)
       or (pil.entity_type = 'product' and pil.entity_id = any(v_product_ids))
       or (pil.entity_type = 'trial'   and pil.entity_id = any(v_trial_ids));

  -- marker_assignments cleared by the existing FK cascade from trials.
  -- count is rows in the cascade set, not distinct markers.
  select count(*) into v_n_marker_assignments
    from public.marker_assignments ma
    where ma.trial_id = any(v_trial_ids);

  -- markers reachable through the cascade set split into "removed entirely"
  -- (the T4 orphan trigger will drop them because they have zero remaining
  -- assignments outside the set) and "unlinked only" (they survive because
  -- at least one assignment points at a trial outside the set).
  with reachable_markers as (
    select distinct ma.marker_id
      from public.marker_assignments ma
      where ma.trial_id = any(v_trial_ids)
  ),
  split as (
    select rm.marker_id,
           not exists (
             select 1
               from public.marker_assignments ma2
               where ma2.marker_id = rm.marker_id
                 and ma2.trial_id <> all(v_trial_ids)
           ) as removed_entirely
      from reachable_markers rm
  )
  select
    count(*) filter (where removed_entirely),
    count(*) filter (where not removed_entirely)
    into v_n_markers_removed_entirely, v_n_markers_unlinked_only
    from split;

  return jsonb_build_object(
    'products',                   v_n_products,
    'trials',                     v_n_trials,
    'trial_notes',                v_n_trial_notes,
    'events',                     v_n_events,
    'material_links',             v_n_material_links,
    'primary_intelligence',       v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links,
    'marker_assignments',         v_n_marker_assignments,
    'markers_removed_entirely',   v_n_markers_removed_entirely,
    'markers_unlinked_only',      v_n_markers_unlinked_only
  );
end;
$$;

comment on function public.preview_company_delete(uuid) is
  'Read-only preview of the cascade footprint of deleting a company. Returns '
  'a jsonb count breakdown across products, trials, trial_notes, events, '
  'material_links, primary_intelligence, primary_intelligence_links, '
  'marker_assignments, markers_removed_entirely, and markers_unlinked_only. '
  'STABLE SECURITY DEFINER. Raises 28000 if not authenticated, 42501 if '
  'caller lacks space access, P0002 if the company does not exist.';

revoke execute on function public.preview_company_delete(uuid) from public;
revoke execute on function public.preview_company_delete(uuid) from anon;
grant  execute on function public.preview_company_delete(uuid) to authenticated;


-- =============================================================================
-- preview_product_delete
-- =============================================================================
-- same jsonb shape as preview_company_delete minus the `products` key, since
-- this IS the product, not its children. cascade reaches trials under this
-- product and everything downstream from those trials.

create or replace function public.preview_product_delete(p_product_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid                          uuid := auth.uid();
  v_space_id                     uuid;
  v_trial_ids                    uuid[];
  v_n_trials                     bigint;
  v_n_trial_notes                bigint;
  v_n_events                     bigint;
  v_n_material_links             bigint;
  v_n_primary_intelligence       bigint;
  v_n_primary_intelligence_links bigint;
  v_n_marker_assignments         bigint;
  v_n_markers_removed_entirely   bigint;
  v_n_markers_unlinked_only      bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  select p.space_id into v_space_id
    from public.products p
    where p.id = p_product_id;
  if v_space_id is null then
    raise exception 'product % not found', p_product_id
      using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space_id) then
    raise exception 'not authorized for space %', v_space_id
      using errcode = '42501';
  end if;

  select coalesce(array_agg(t.id), array[]::uuid[]) into v_trial_ids
    from public.trials t
    where t.product_id = p_product_id;

  v_n_trials := array_length(v_trial_ids, 1);
  if v_n_trials is null then v_n_trials := 0; end if;

  select count(*) into v_n_trial_notes
    from public.trial_notes tn
    where tn.trial_id = any(v_trial_ids);

  select count(*) into v_n_events
    from public.events e
    where e.product_id = p_product_id
       or e.trial_id   = any(v_trial_ids);

  select count(*) into v_n_material_links
    from public.material_links ml
    where (ml.entity_type = 'product' and ml.entity_id = p_product_id)
       or (ml.entity_type = 'trial'   and ml.entity_id = any(v_trial_ids));

  select count(*) into v_n_primary_intelligence
    from public.primary_intelligence pi
    where (pi.entity_type = 'product' and pi.entity_id = p_product_id)
       or (pi.entity_type = 'trial'   and pi.entity_id = any(v_trial_ids));

  select count(*) into v_n_primary_intelligence_links
    from public.primary_intelligence_links pil
    where (pil.entity_type = 'product' and pil.entity_id = p_product_id)
       or (pil.entity_type = 'trial'   and pil.entity_id = any(v_trial_ids));

  select count(*) into v_n_marker_assignments
    from public.marker_assignments ma
    where ma.trial_id = any(v_trial_ids);

  with reachable_markers as (
    select distinct ma.marker_id
      from public.marker_assignments ma
      where ma.trial_id = any(v_trial_ids)
  ),
  split as (
    select rm.marker_id,
           not exists (
             select 1
               from public.marker_assignments ma2
               where ma2.marker_id = rm.marker_id
                 and ma2.trial_id <> all(v_trial_ids)
           ) as removed_entirely
      from reachable_markers rm
  )
  select
    count(*) filter (where removed_entirely),
    count(*) filter (where not removed_entirely)
    into v_n_markers_removed_entirely, v_n_markers_unlinked_only
    from split;

  return jsonb_build_object(
    'trials',                     v_n_trials,
    'trial_notes',                v_n_trial_notes,
    'events',                     v_n_events,
    'material_links',             v_n_material_links,
    'primary_intelligence',       v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links,
    'marker_assignments',         v_n_marker_assignments,
    'markers_removed_entirely',   v_n_markers_removed_entirely,
    'markers_unlinked_only',      v_n_markers_unlinked_only
  );
end;
$$;

comment on function public.preview_product_delete(uuid) is
  'Read-only preview of the cascade footprint of deleting a product. Same '
  'jsonb shape as preview_company_delete minus the products key. STABLE '
  'SECURITY DEFINER. Raises 28000 if not authenticated, 42501 if caller '
  'lacks space access, P0002 if the product does not exist.';

revoke execute on function public.preview_product_delete(uuid) from public;
revoke execute on function public.preview_product_delete(uuid) from anon;
grant  execute on function public.preview_product_delete(uuid) to authenticated;


-- =============================================================================
-- preview_trial_delete
-- =============================================================================
-- narrowest scope: a single trial. cascade hits trial_notes, events (where
-- trial_id matches), marker_assignments for this trial only, plus the
-- polymorphic T3 trigger for the trial's own PI / PIL / material_links.

create or replace function public.preview_trial_delete(p_trial_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid                          uuid := auth.uid();
  v_space_id                     uuid;
  v_n_trial_notes                bigint;
  v_n_events                     bigint;
  v_n_material_links             bigint;
  v_n_primary_intelligence       bigint;
  v_n_primary_intelligence_links bigint;
  v_n_marker_assignments         bigint;
  v_n_markers_removed_entirely   bigint;
  v_n_markers_unlinked_only      bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  select t.space_id into v_space_id
    from public.trials t
    where t.id = p_trial_id;
  if v_space_id is null then
    raise exception 'trial % not found', p_trial_id
      using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space_id) then
    raise exception 'not authorized for space %', v_space_id
      using errcode = '42501';
  end if;

  select count(*) into v_n_trial_notes
    from public.trial_notes tn
    where tn.trial_id = p_trial_id;

  select count(*) into v_n_events
    from public.events e
    where e.trial_id = p_trial_id;

  select count(*) into v_n_material_links
    from public.material_links ml
    where ml.entity_type = 'trial' and ml.entity_id = p_trial_id;

  select count(*) into v_n_primary_intelligence
    from public.primary_intelligence pi
    where pi.entity_type = 'trial' and pi.entity_id = p_trial_id;

  select count(*) into v_n_primary_intelligence_links
    from public.primary_intelligence_links pil
    where pil.entity_type = 'trial' and pil.entity_id = p_trial_id;

  select count(*) into v_n_marker_assignments
    from public.marker_assignments ma
    where ma.trial_id = p_trial_id;

  with reachable_markers as (
    select distinct ma.marker_id
      from public.marker_assignments ma
      where ma.trial_id = p_trial_id
  ),
  split as (
    select rm.marker_id,
           not exists (
             select 1
               from public.marker_assignments ma2
               where ma2.marker_id = rm.marker_id
                 and ma2.trial_id <> p_trial_id
           ) as removed_entirely
      from reachable_markers rm
  )
  select
    count(*) filter (where removed_entirely),
    count(*) filter (where not removed_entirely)
    into v_n_markers_removed_entirely, v_n_markers_unlinked_only
    from split;

  return jsonb_build_object(
    'trial_notes',                v_n_trial_notes,
    'events',                     v_n_events,
    'material_links',             v_n_material_links,
    'primary_intelligence',       v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links,
    'marker_assignments',         v_n_marker_assignments,
    'markers_removed_entirely',   v_n_markers_removed_entirely,
    'markers_unlinked_only',      v_n_markers_unlinked_only
  );
end;
$$;

comment on function public.preview_trial_delete(uuid) is
  'Read-only preview of the cascade footprint of deleting a single trial. '
  'Returns a jsonb count breakdown across trial_notes, events, material_links, '
  'primary_intelligence, primary_intelligence_links, marker_assignments, '
  'markers_removed_entirely, and markers_unlinked_only. STABLE SECURITY '
  'DEFINER. Raises 28000 if not authenticated, 42501 if caller lacks space '
  'access, P0002 if the trial does not exist.';

revoke execute on function public.preview_trial_delete(uuid) from public;
revoke execute on function public.preview_trial_delete(uuid) from anon;
grant  execute on function public.preview_trial_delete(uuid) to authenticated;


-- =============================================================================
-- smoke test
-- =============================================================================
-- builds a single hermetic fixture inside one do block, exercises all three
-- preview RPCs, and tears down via the clint.member_guard_cascade = on
-- bypass (same pattern as the T1 / T3 / T4 / T6 smoke tests).
--
-- fixture (known counts):
--   - 1 tenant, 1 space, 1 owner (the caller).
--   - target company C, plus an OUTSIDE company so we can hang a trial that
--     belongs to no product in the cascade set. that outside trial gives us
--     a place to attach M2's surviving assignment, so M2 ends up in the
--     markers_unlinked_only branch.
--   - 2 products PA, PB under C; 1 outside product PC under the outside
--     company.
--   - 3 trials: T1, T2 under PA; T3 under PB. 1 outside trial T_out under
--     PC. total in cascade set = 3.
--   - 4 trial_notes: T1 has 2, T2 has 1, T3 has 1.
--   - 5 events: 1 company-scoped (company_id = C), 2 product-scoped (PA,
--     PB), 2 trial-scoped (T1, T3). entity_level_check guarantees each
--     row carries exactly one FK.
--   - 1 material, 4 material_links (company=C, product=PA, trial=T1,
--     product=PC outside). 3 fall in the cascade set, 1 does not.
--   - 2 primary_intelligence rows: (company, C) and (trial, T1).
--   - 4 primary_intelligence_links: (company, C), (product, PA), (trial,
--     T1), (trial, T_out outside). PILs hang off a parent PI keyed to
--     entity_type='space' so the link rows are valid. 3 fall in the cascade
--     set, 1 does not.
--   - 6 marker_assignments across the 3 in-cascade trials:
--       T1 -> M1 (only T1 -> orphan), M2 (also assigned to T_out -> survives)
--       T2 -> M3, M4 (each only on T2 -> orphan)
--       T3 -> M5, M6 (each only on T3 -> orphan)
--     plus 1 outside assignment (M2 -> T_out). M2 sits in markers_unlinked_only.
--     M1, M3, M4, M5, M6 are markers_removed_entirely (5).
--   (marker_notifications were dropped in 20260503080000; the preview output
--    no longer carries that key.)

do $$
declare
  v_marker_type uuid;
begin
  select id into v_marker_type from public.marker_types where space_id is null limit 1;
  if v_marker_type is null then
    raise exception 'preview_delete_rpcs smoke FAIL: no global marker_type available';
  end if;

  declare
    v_user            uuid := gen_random_uuid();
    v_other_user      uuid := gen_random_uuid();
    v_tenant          uuid := gen_random_uuid();
    v_space           uuid := gen_random_uuid();
    v_email           text := 'preview-delete-' || gen_random_uuid() || '@example.com';
    v_other_email     text := 'preview-delete-outsider-' || gen_random_uuid() || '@example.com';

    -- in-cascade
    v_company         uuid := gen_random_uuid();
    v_product_a       uuid := gen_random_uuid();
    v_product_b       uuid := gen_random_uuid();
    v_ta              uuid := gen_random_uuid();
    v_trial_1         uuid := gen_random_uuid();
    v_trial_2         uuid := gen_random_uuid();
    v_trial_3         uuid := gen_random_uuid();
    v_note_1          uuid := gen_random_uuid();
    v_note_2          uuid := gen_random_uuid();
    v_note_3          uuid := gen_random_uuid();
    v_note_4          uuid := gen_random_uuid();

    -- outside
    v_company_out     uuid := gen_random_uuid();
    v_product_c       uuid := gen_random_uuid();
    v_trial_out       uuid := gen_random_uuid();

    -- events (system 'Clinical' category)
    v_event_co        uuid := gen_random_uuid();
    v_event_pa        uuid := gen_random_uuid();
    v_event_pb        uuid := gen_random_uuid();
    v_event_t1        uuid := gen_random_uuid();
    v_event_t3        uuid := gen_random_uuid();
    v_category_id     uuid;

    -- material
    v_material        uuid := gen_random_uuid();
    v_material_path   text;
    v_ml_company      uuid := gen_random_uuid();
    v_ml_product_a    uuid := gen_random_uuid();
    v_ml_trial_1      uuid := gen_random_uuid();
    v_ml_product_c    uuid := gen_random_uuid(); -- outside; should not count

    -- primary_intelligence
    v_pi_company      uuid := gen_random_uuid();
    v_pi_trial_1      uuid := gen_random_uuid();
    v_pi_space        uuid := gen_random_uuid(); -- parent for PILs

    -- markers
    v_marker_m1       uuid := gen_random_uuid();
    v_marker_m2       uuid := gen_random_uuid();
    v_marker_m3       uuid := gen_random_uuid();
    v_marker_m4       uuid := gen_random_uuid();
    v_marker_m5       uuid := gen_random_uuid();
    v_marker_m6       uuid := gen_random_uuid();

    -- preview results
    v_preview_a       jsonb;
    v_preview_b       jsonb;
    v_preview_pa      jsonb;
    v_preview_t1      jsonb;
  begin
    -- ---------------------------------------------------------------------
    -- bootstrap
    -- ---------------------------------------------------------------------
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_other_user, v_other_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'preview-tenant', 'preview-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'preview-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');

    -- impersonate the owner so RLS write paths succeed and audit triggers
    -- can resolve a non-null changed_by.
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    -- core domain rows
    insert into public.companies (id, space_id, created_by, name)
      values (v_company,     v_space, v_user, 'preview-co'),
             (v_company_out, v_space, v_user, 'preview-co-outside');
    insert into public.products (id, space_id, created_by, company_id, name)
      values (v_product_a, v_space, v_user, v_company,     'preview-drug-a'),
             (v_product_b, v_space, v_user, v_company,     'preview-drug-b'),
             (v_product_c, v_space, v_user, v_company_out, 'preview-drug-c-outside');
    insert into public.therapeutic_areas (id, space_id, created_by, name)
      values (v_ta, v_space, v_user, 'preview-ta');
    insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
      values (v_trial_1,   v_space, v_user, v_product_a, v_ta, 'preview-trial-1',   'NCT-PV-1'),
             (v_trial_2,   v_space, v_user, v_product_a, v_ta, 'preview-trial-2',   'NCT-PV-2'),
             (v_trial_3,   v_space, v_user, v_product_b, v_ta, 'preview-trial-3',   'NCT-PV-3'),
             (v_trial_out, v_space, v_user, v_product_c, v_ta, 'preview-trial-out', 'NCT-PV-OUT');

    insert into public.trial_notes (id, space_id, created_by, trial_id, content)
      values (v_note_1, v_space, v_user, v_trial_1, 'note-1a'),
             (v_note_2, v_space, v_user, v_trial_1, 'note-1b'),
             (v_note_3, v_space, v_user, v_trial_2, 'note-2'),
             (v_note_4, v_space, v_user, v_trial_3, 'note-3');

    -- events: pick the seeded 'Clinical' category id so the FK to
    -- event_categories is satisfied. exactly one of company_id /
    -- product_id / trial_id is set per row (entity_level_check).
    select id into v_category_id
      from public.event_categories
      where is_system = true and name = 'Clinical'
      limit 1;
    if v_category_id is null then
      raise exception 'preview_delete_rpcs smoke FAIL: no system "Clinical" event_category found';
    end if;

    insert into public.events (id, space_id, company_id, product_id, trial_id, category_id, title, event_date, priority, created_by)
      values
        (v_event_co, v_space, v_company,     null,        null,      v_category_id, 'event-co', current_date, 'low', v_user),
        (v_event_pa, v_space, null,          v_product_a, null,      v_category_id, 'event-pa', current_date, 'low', v_user),
        (v_event_pb, v_space, null,          v_product_b, null,      v_category_id, 'event-pb', current_date, 'low', v_user),
        (v_event_t1, v_space, null,          null,        v_trial_1, v_category_id, 'event-t1', current_date, 'low', v_user),
        (v_event_t3, v_space, null,          null,        v_trial_3, v_category_id, 'event-t3', current_date, 'low', v_user);

    -- material + 4 links (3 in-cascade, 1 outside).
    v_material_path := 'materials/' || v_space::text || '/' || v_material::text || '/preview.pdf';
    insert into public.materials (
      id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
      mime_type, material_type, title
    ) values (
      v_material, v_space, v_user, v_material_path, 'preview.pdf', 1,
      'application/pdf', 'briefing', 'preview material'
    );
    insert into public.material_links (id, material_id, entity_type, entity_id)
      values (v_ml_company,   v_material, 'company', v_company),
             (v_ml_product_a, v_material, 'product', v_product_a),
             (v_ml_trial_1,   v_material, 'trial',   v_trial_1),
             (v_ml_product_c, v_material, 'product', v_product_c); -- outside, should NOT count

    -- primary_intelligence: one keyed to company, one keyed to trial 1.
    -- a third PI keyed to entity_type='space' acts as the parent for PIL
    -- rows so we can attach links without re-binding to one of the targets.
    insert into public.primary_intelligence (
      id, space_id, entity_type, entity_id, state, headline, summary_md, last_edited_by
    ) values
      (v_pi_company, v_space, 'company', v_company, 'draft', 'pi for company', 'body', v_user),
      (v_pi_trial_1, v_space, 'trial',   v_trial_1, 'draft', 'pi for trial 1', 'body', v_user),
      (v_pi_space,   v_space, 'space',   v_space,   'draft', 'pi parent (space-typed)', 'body', v_user);

    -- 4 PIL rows hanging off the space-typed parent. 3 fall in the cascade
    -- set (the company / a product / a trial), 1 outside (trial_out).
    insert into public.primary_intelligence_links (
      primary_intelligence_id, entity_type, entity_id, relationship_type
    ) values
      (v_pi_space, 'company', v_company,   'preview'),
      (v_pi_space, 'product', v_product_a, 'preview'),
      (v_pi_space, 'trial',   v_trial_1,   'preview'),
      (v_pi_space, 'trial',   v_trial_out, 'preview'); -- outside, should NOT count

    -- markers + assignments. 6 markers total. M2 also assigned to T_out
    -- so M2 survives the cascade as markers_unlinked_only.
    insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
      values
        (v_marker_m1, v_space, v_marker_type, 'm1-orphan-trial-1', current_date, 'actual', v_user),
        (v_marker_m2, v_space, v_marker_type, 'm2-survives',       current_date, 'actual', v_user),
        (v_marker_m3, v_space, v_marker_type, 'm3-orphan-trial-2', current_date, 'actual', v_user),
        (v_marker_m4, v_space, v_marker_type, 'm4-orphan-trial-2', current_date, 'actual', v_user),
        (v_marker_m5, v_space, v_marker_type, 'm5-orphan-trial-3', current_date, 'actual', v_user),
        (v_marker_m6, v_space, v_marker_type, 'm6-orphan-trial-3', current_date, 'actual', v_user);

    insert into public.marker_assignments (marker_id, trial_id)
      values
        (v_marker_m1, v_trial_1),
        (v_marker_m2, v_trial_1),
        (v_marker_m2, v_trial_out),  -- outside-of-cascade assignment; lets M2 survive
        (v_marker_m3, v_trial_2),
        (v_marker_m4, v_trial_2),
        (v_marker_m5, v_trial_3),
        (v_marker_m6, v_trial_3);

    -- (marker_notifications were dropped in 20260503080000; nothing to seed.)

    -- ---------------------------------------------------------------------
    -- assertion (1): preview_company_delete returns the documented counts.
    -- ---------------------------------------------------------------------
    v_preview_a := public.preview_company_delete(v_company);

    if (v_preview_a->>'products')::int <> 2 then
      raise exception 'preview_delete_rpcs smoke FAIL: products expected 2, got %', v_preview_a->>'products';
    end if;
    if (v_preview_a->>'trials')::int <> 3 then
      raise exception 'preview_delete_rpcs smoke FAIL: trials expected 3, got %', v_preview_a->>'trials';
    end if;
    if (v_preview_a->>'trial_notes')::int <> 4 then
      raise exception 'preview_delete_rpcs smoke FAIL: trial_notes expected 4, got %', v_preview_a->>'trial_notes';
    end if;
    if (v_preview_a->>'events')::int <> 5 then
      raise exception 'preview_delete_rpcs smoke FAIL: events expected 5, got %', v_preview_a->>'events';
    end if;
    if (v_preview_a->>'material_links')::int <> 3 then
      raise exception 'preview_delete_rpcs smoke FAIL: material_links expected 3, got %', v_preview_a->>'material_links';
    end if;
    if (v_preview_a->>'primary_intelligence')::int <> 2 then
      raise exception 'preview_delete_rpcs smoke FAIL: primary_intelligence expected 2, got %', v_preview_a->>'primary_intelligence';
    end if;
    if (v_preview_a->>'primary_intelligence_links')::int <> 3 then
      raise exception 'preview_delete_rpcs smoke FAIL: primary_intelligence_links expected 3, got %', v_preview_a->>'primary_intelligence_links';
    end if;
    if (v_preview_a->>'marker_assignments')::int <> 6 then
      raise exception 'preview_delete_rpcs smoke FAIL: marker_assignments expected 6, got %', v_preview_a->>'marker_assignments';
    end if;
    if (v_preview_a->>'markers_removed_entirely')::int <> 5 then
      raise exception 'preview_delete_rpcs smoke FAIL: markers_removed_entirely expected 5, got %', v_preview_a->>'markers_removed_entirely';
    end if;
    if (v_preview_a->>'markers_unlinked_only')::int <> 1 then
      raise exception 'preview_delete_rpcs smoke FAIL: markers_unlinked_only expected 1, got %', v_preview_a->>'markers_unlinked_only';
    end if;
    if v_preview_a ? 'marker_notifications' then
      raise exception 'preview_delete_rpcs smoke FAIL: marker_notifications key should NOT be present (table dropped), got %', v_preview_a;
    end if;

    raise notice 'preview_delete_rpcs smoke ok 1: preview_company_delete returned exact expected counts %', v_preview_a;

    -- ---------------------------------------------------------------------
    -- assertion (2): read-only -- second call returns the same jsonb.
    -- ---------------------------------------------------------------------
    v_preview_b := public.preview_company_delete(v_company);
    if v_preview_a <> v_preview_b then
      raise exception 'preview_delete_rpcs smoke FAIL: preview is not read-only -- got % then %',
        v_preview_a, v_preview_b;
    end if;

    raise notice 'preview_delete_rpcs smoke ok 2: preview is read-only (two calls returned identical jsonb)';

    -- ---------------------------------------------------------------------
    -- assertion (3): caller without space access gets 42501.
    -- ---------------------------------------------------------------------
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_other_user::text, 'role', 'authenticated', 'email', v_other_email)::text,
      true
    );

    declare
      v_state text;
    begin
      perform public.preview_company_delete(v_company);
      raise exception 'preview_delete_rpcs smoke FAIL: outsider call should have raised 42501';
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      if v_state <> '42501' then
        raise exception 'preview_delete_rpcs smoke FAIL: outsider expected 42501, got %', v_state;
      end if;
    end;

    raise notice 'preview_delete_rpcs smoke ok 3: outsider call raised 42501';

    -- restore owner impersonation for the remaining assertions.
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    -- ---------------------------------------------------------------------
    -- assertion (4): preview_product_delete(PA) returns a sensible subset.
    -- PA has T1 + T2 (2 trials). T1 has 2 trial_notes, T2 has 1 (3 total).
    -- events: PA's event + T1's event = 2. marker_assignments under
    -- {T1, T2} = M1 + M2 + M3 + M4 = 4. markers_removed_entirely = M1,
    -- M3, M4 = 3 (M2 still has T_out outside the PA scope). markers_unlinked_only = 1 (M2).
    -- ---------------------------------------------------------------------
    v_preview_pa := public.preview_product_delete(v_product_a);
    if (v_preview_pa->>'trials')::int <> 2 then
      raise exception 'preview_delete_rpcs smoke FAIL pa: trials expected 2, got %', v_preview_pa->>'trials';
    end if;
    if (v_preview_pa->>'trial_notes')::int <> 3 then
      raise exception 'preview_delete_rpcs smoke FAIL pa: trial_notes expected 3, got %', v_preview_pa->>'trial_notes';
    end if;
    if (v_preview_pa->>'marker_assignments')::int <> 4 then
      raise exception 'preview_delete_rpcs smoke FAIL pa: marker_assignments expected 4, got %', v_preview_pa->>'marker_assignments';
    end if;
    if (v_preview_pa->>'markers_removed_entirely')::int <> 3 then
      raise exception 'preview_delete_rpcs smoke FAIL pa: markers_removed_entirely expected 3, got %', v_preview_pa->>'markers_removed_entirely';
    end if;
    if (v_preview_pa->>'markers_unlinked_only')::int <> 1 then
      raise exception 'preview_delete_rpcs smoke FAIL pa: markers_unlinked_only expected 1, got %', v_preview_pa->>'markers_unlinked_only';
    end if;
    if v_preview_pa ? 'products' then
      raise exception 'preview_delete_rpcs smoke FAIL pa: products key should NOT be present in product preview, got %', v_preview_pa;
    end if;

    raise notice 'preview_delete_rpcs smoke ok 4: preview_product_delete(PA) returned narrowed counts %', v_preview_pa;

    -- ---------------------------------------------------------------------
    -- assertion (5): preview_trial_delete(T1) returns the narrowest subset.
    -- T1 trial_notes = 2. events for T1 = 1. marker_assignments for T1 = 2
    -- (M1, M2). markers_removed_entirely = 1 (M1 alone -- M2 still has T2
    -- ... wait. M2 is assigned to T1 + T_out. neither is T2. so within
    -- the trial-only scope, M2 has T_out which is outside the cascade,
    -- so M2 is markers_unlinked_only). M1 only on T1 -> removed. M3-M6
    -- aren't assigned to T1 so they're not in scope. material_links for
    -- T1 = 1. primary_intelligence for T1 = 1. primary_intelligence_links
    -- for T1 = 1.
    -- ---------------------------------------------------------------------
    v_preview_t1 := public.preview_trial_delete(v_trial_1);
    if (v_preview_t1->>'trial_notes')::int <> 2 then
      raise exception 'preview_delete_rpcs smoke FAIL t1: trial_notes expected 2, got %', v_preview_t1->>'trial_notes';
    end if;
    if (v_preview_t1->>'events')::int <> 1 then
      raise exception 'preview_delete_rpcs smoke FAIL t1: events expected 1, got %', v_preview_t1->>'events';
    end if;
    if (v_preview_t1->>'marker_assignments')::int <> 2 then
      raise exception 'preview_delete_rpcs smoke FAIL t1: marker_assignments expected 2, got %', v_preview_t1->>'marker_assignments';
    end if;
    if (v_preview_t1->>'markers_removed_entirely')::int <> 1 then
      raise exception 'preview_delete_rpcs smoke FAIL t1: markers_removed_entirely expected 1, got %', v_preview_t1->>'markers_removed_entirely';
    end if;
    if (v_preview_t1->>'markers_unlinked_only')::int <> 1 then
      raise exception 'preview_delete_rpcs smoke FAIL t1: markers_unlinked_only expected 1, got %', v_preview_t1->>'markers_unlinked_only';
    end if;
    if v_preview_t1 ? 'trials' then
      raise exception 'preview_delete_rpcs smoke FAIL t1: trials key should NOT be present in trial preview, got %', v_preview_t1;
    end if;

    raise notice 'preview_delete_rpcs smoke ok 5: preview_trial_delete(T1) returned narrowest counts %', v_preview_t1;

    -- ---------------------------------------------------------------------
    -- teardown
    -- ---------------------------------------------------------------------
    -- the fixture is left intact (the assertions never deleted the company);
    -- sweep it under the member_guard_cascade bypass. order: clear leaf
    -- tables, then members, then space / tenant / users. the space cascade
    -- would also do most of this, but the explicit sweep keeps trigger
    -- behavior isolated to the assertions.
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', null, true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.materials             where space_id = v_space;
    delete from public.primary_intelligence  where space_id = v_space;
    delete from public.markers               where space_id = v_space;
    -- trial_change_events may reference marker_changes rows via
    -- derived_from_marker_change_id; drop the dependent rows first so the
    -- marker_changes sweep below is free of FK violations.
    delete from public.trial_change_events   where space_id = v_space;
    delete from public.marker_changes        where space_id = v_space;
    delete from public.space_members         where space_id = v_space;
    delete from public.tenant_members        where tenant_id = v_tenant;
    delete from public.spaces                where id = v_space;
    delete from public.tenants               where id = v_tenant;
    delete from auth.users                   where id = v_user;
    delete from auth.users                   where id = v_other_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  raise notice 'preview_delete_rpcs smoke test: PASS';
end $$;
