-- migration: 20260521120500_cascade_fk_flips
-- purpose: flip four foreign key actions to make company / product / trial /
--          therapeutic_area deletes behave the way the cascade-safety design
--          requires. addresses cascade-safety finding #2 ("Company, product,
--          trial: cascade with count preview"). today every one of the four
--          parent-entity FKs uses postgres NO ACTION semantics, which causes
--          owner-level deletes to fail outright when the parent still has
--          descendants; users hit a 23503 from the dialog with no path
--          forward. the design instead defers blast-radius control to the
--          preview RPCs + count-aware confirm dialog (T7 / T10) and makes
--          the cascade itself first-class so a confirmed delete actually
--          succeeds.
--
--          fk action flips:
--            products.company_id            NOT NULL, NO ACTION -> NOT NULL, CASCADE
--            trials.product_id              NOT NULL, NO ACTION -> NOT NULL, CASCADE
--            trial_notes.trial_id           NOT NULL, NO ACTION -> NOT NULL, CASCADE
--            trials.therapeutic_area_id     NOT NULL, NO ACTION -> NULL allowed, SET NULL
--
--          the therapeutic_area column is intentionally the odd one out:
--          deleting a category should NOT delete the trials filed under it.
--          ta becomes an annotation, the trial keeps living, and the UI
--          renders the null as "Uncategorized" via the display-fallbacks
--          util (T9). this preserves the editorial cost of a categorical
--          delete (cheap, reversible by re-categorizing) vs. a structural
--          delete (company / product / trial, which carry data).
--
--          downstream FKs that already cascade and are NOT touched here:
--            products.space_id              -> spaces.id ON DELETE CASCADE
--            trials.space_id                -> spaces.id ON DELETE CASCADE
--            trial_notes.space_id           -> spaces.id ON DELETE CASCADE
--            marker_assignments.trial_id    -> trials.id ON DELETE CASCADE
--            events.product_id              -> products.id ON DELETE CASCADE
--            events.trial_id                -> trials.id ON DELETE CASCADE
--            trial_change_events.trial_id   -> trials.id ON DELETE CASCADE
--          the polymorphic primary_intelligence / primary_intelligence_links
--          / material_links columns are cleaned by the AFTER DELETE triggers
--          installed in 20260521120200_polymorphic_cleanup_triggers.sql;
--          marker rows that end up with zero assignments are dropped by the
--          AFTER DELETE trigger installed in
--          20260521120300_orphan_marker_cleanup.sql. taken together a
--          single `delete from companies where id = X` cascades fully
--          without leaving polymorphic or marker orphans.
--
--          the migration is not a tier-1 audit target. it changes FK
--          metadata, not RPC behavior, so no -- @audit:tier1 marker is
--          required (see 20260510002000_audit_coverage_smoke.sql).
--
--          constraint names are kept identical (products_company_id_fkey,
--          trials_product_id_fkey, trial_notes_trial_id_fkey,
--          trials_therapeutic_area_id_fkey) so future migrations have
--          stable handles. existing data is preserved -- the column drop /
--          recreate path would have nulled out the values.
--
--          design rationale: docs/superpowers/specs/2026-05-20-cascade-safety
--          -design.md, section "#2 Company, product, trial: cascade with
--          count preview".
--
--   inline smoke test verifies (under begin/rollback envelope):
--     scenario A: deleting a company cascades cleanly through products,
--                 trials, trial_notes, marker_assignments (FK), the orphan
--                 trigger (T4) drops a single-assignment marker, the
--                 polymorphic trigger (T3) clears primary_intelligence and
--                 material_links rows keyed on the company, the underlying
--                 material survives (it is space-scoped, only the link
--                 cleared), and no r2_pending_deletes rows are added
--                 (materials are space-scoped).
--     scenario B: deleting a therapeutic_area leaves trials in place with
--                 therapeutic_area_id set to NULL, surfacing as
--                 Uncategorized in the UI.


-- =============================================================================
-- 1. products.company_id : NOT NULL, NO ACTION -> NOT NULL, CASCADE
-- =============================================================================

alter table public.products
  drop constraint products_company_id_fkey;

alter table public.products
  add constraint products_company_id_fkey
  foreign key (company_id) references public.companies (id)
  on delete cascade;


-- =============================================================================
-- 2. trials.product_id : NOT NULL, NO ACTION -> NOT NULL, CASCADE
-- =============================================================================

alter table public.trials
  drop constraint trials_product_id_fkey;

alter table public.trials
  add constraint trials_product_id_fkey
  foreign key (product_id) references public.products (id)
  on delete cascade;


-- =============================================================================
-- 3. trial_notes.trial_id : NOT NULL, NO ACTION -> NOT NULL, CASCADE
-- =============================================================================

alter table public.trial_notes
  drop constraint trial_notes_trial_id_fkey;

alter table public.trial_notes
  add constraint trial_notes_trial_id_fkey
  foreign key (trial_id) references public.trials (id)
  on delete cascade;


-- =============================================================================
-- 4. trials.therapeutic_area_id : NOT NULL, NO ACTION -> NULL allowed, SET NULL
-- =============================================================================
-- drop NOT NULL first so the SET NULL action has somewhere to land. the
-- existing values stay intact; only the constraint metadata changes.

alter table public.trials
  alter column therapeutic_area_id drop not null;

alter table public.trials
  drop constraint trials_therapeutic_area_id_fkey;

alter table public.trials
  add constraint trials_therapeutic_area_id_fkey
  foreign key (therapeutic_area_id) references public.therapeutic_areas (id)
  on delete set null;


-- =============================================================================
-- smoke test
-- =============================================================================
-- two scenarios, each in its own nested block for hermetic fixtures.
-- impersonation, tenant_members / space_members setup, and teardown all
-- mirror the patterns established in the T1 / T3 / T4 smoke tests
-- (20260521120000_r2_pending_deletes_queue.sql,
-- 20260521120200_polymorphic_cleanup_triggers.sql,
-- 20260521120300_orphan_marker_cleanup.sql).

do $$
declare
  v_marker_type uuid;
begin
  select id into v_marker_type from public.marker_types where space_id is null limit 1;
  if v_marker_type is null then
    raise exception 'cascade_fk_flips smoke FAIL: no global marker_type available';
  end if;

  -- ===========================================================================
  -- scenario A: full cascade chain on company delete.
  -- ===========================================================================
  -- fixture: agency-free tenant + space + owner. one company, one product,
  -- one trial, one trial_note, one marker assigned to the single trial, one
  -- primary_intelligence row keyed entity_type='company', one material plus
  -- a material_link keyed entity_type='company'. delete the company. assert
  -- the entire chain unwinds: product (cascade), trial (cascade), trial_note
  -- (cascade, via new FK), marker_assignment (cascade, pre-existing FK),
  -- marker (orphan trigger -- only assignment was to that trial),
  -- primary_intelligence (polymorphic trigger), material_link (polymorphic
  -- trigger). the material itself survives -- it's space-scoped, only the
  -- polymorphic link is cleared. no r2_pending_deletes rows accumulate
  -- because no material was deleted (materials live by space, not company).
  declare
    v_user           uuid := gen_random_uuid();
    v_tenant         uuid := gen_random_uuid();
    v_space          uuid := gen_random_uuid();
    v_email          text := 'cascade-flip-a-' || gen_random_uuid() || '@example.com';
    v_ta             uuid := gen_random_uuid();
    v_company        uuid := gen_random_uuid();
    v_product        uuid := gen_random_uuid();
    v_trial          uuid := gen_random_uuid();
    v_note           uuid := gen_random_uuid();
    v_marker         uuid := gen_random_uuid();
    v_assignment     uuid := gen_random_uuid();
    v_pi             uuid := gen_random_uuid();
    v_material       uuid := gen_random_uuid();
    v_material_link  uuid := gen_random_uuid();
    v_path           text;
    v_count          int;
    v_r2_baseline    int;
    v_r2_after       int;
  begin
    -- baseline so we can assert no new r2_pending_deletes rows landed.
    select count(*)::int into v_r2_baseline from public.r2_pending_deletes;

    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'cascade-a-tenant', 'cascade-a-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'cascade-a-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');

    -- impersonate the owner so auth.uid() resolves for any audit triggers
    -- that fire during fixture mutation (marker insert in particular).
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.therapeutic_areas (id, space_id, created_by, name)
      values (v_ta, v_space, v_user, 'cascade-a-ta');
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'cascade-a-co');
    insert into public.products (id, space_id, created_by, company_id, name)
      values (v_product, v_space, v_user, v_company, 'cascade-a-drug');
    insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
      values (v_trial, v_space, v_user, v_product, v_ta, 'cascade-a-trial', 'NCT-CA-A');
    insert into public.trial_notes (id, space_id, created_by, trial_id, content)
      values (v_note, v_space, v_user, v_trial, 'cascade-a-note');

    insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
      values (v_marker, v_space, v_marker_type, 'cascade-a-marker', current_date, 'actual', v_user);
    insert into public.marker_assignments (id, marker_id, trial_id)
      values (v_assignment, v_marker, v_trial);

    insert into public.primary_intelligence (
      id, space_id, entity_type, entity_id, state, headline, summary_md, last_edited_by
    ) values (
      v_pi, v_space, 'company', v_company, 'draft',
      'cascade-a primary intel for company', 'body', v_user
    );

    v_path := 'materials/' || v_space::text || '/' || v_material::text || '/co.pdf';
    insert into public.materials (
      id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
      mime_type, material_type, title
    ) values (
      v_material, v_space, v_user, v_path, 'co.pdf', 1,
      'application/pdf', 'briefing', 'cascade-a material'
    );
    insert into public.material_links (id, material_id, entity_type, entity_id)
      values (v_material_link, v_material, 'company', v_company);

    -- the act under test: a direct delete on the company. issued from the
    -- migration role so RLS doesn't enter the picture -- the FK cascade and
    -- the AFTER DELETE triggers run regardless.
    delete from public.companies where id = v_company;

    -- assertion (a): company gone.
    select count(*)::int into v_count from public.companies where id = v_company;
    if v_count <> 0 then
      raise exception 'cascade_fk_flips smoke FAIL A: company row still present (count %)', v_count;
    end if;

    -- assertion (b): product gone (FK cascade we just installed).
    select count(*)::int into v_count from public.products where id = v_product;
    if v_count <> 0 then
      raise exception 'cascade_fk_flips smoke FAIL A: product not cascaded (count %)', v_count;
    end if;

    -- assertion (c): trial gone (FK cascade from product).
    select count(*)::int into v_count from public.trials where id = v_trial;
    if v_count <> 0 then
      raise exception 'cascade_fk_flips smoke FAIL A: trial not cascaded (count %)', v_count;
    end if;

    -- assertion (d): trial_note gone (FK cascade we just installed).
    select count(*)::int into v_count from public.trial_notes where id = v_note;
    if v_count <> 0 then
      raise exception 'cascade_fk_flips smoke FAIL A: trial_note not cascaded (count %)', v_count;
    end if;

    -- assertion (e): marker_assignment gone (pre-existing FK on trials).
    select count(*)::int into v_count from public.marker_assignments where id = v_assignment;
    if v_count <> 0 then
      raise exception 'cascade_fk_flips smoke FAIL A: marker_assignment not cascaded (count %)', v_count;
    end if;

    -- assertion (f): marker gone (orphan trigger from T4 -- only assignment
    -- was to that trial, so the marker has zero remaining assignments and
    -- the trigger drops it).
    select count(*)::int into v_count from public.markers where id = v_marker;
    if v_count <> 0 then
      raise exception 'cascade_fk_flips smoke FAIL A: marker not removed by orphan trigger (count %)', v_count;
    end if;

    -- assertion (g): primary_intelligence row gone (polymorphic trigger T3
    -- for entity_type='company').
    select count(*)::int into v_count from public.primary_intelligence where id = v_pi;
    if v_count <> 0 then
      raise exception 'cascade_fk_flips smoke FAIL A: primary_intelligence not removed by polymorphic trigger (count %)', v_count;
    end if;

    -- assertion (h): material_link gone (polymorphic trigger T3 for
    -- entity_type='company').
    select count(*)::int into v_count from public.material_links where id = v_material_link;
    if v_count <> 0 then
      raise exception 'cascade_fk_flips smoke FAIL A: material_link not removed by polymorphic trigger (count %)', v_count;
    end if;

    -- assertion (i): material itself SURVIVES. materials live by space, not
    -- by company. the polymorphic trigger clears the link but the file row
    -- stays so the same material can still be linked to other entities in
    -- the space.
    select count(*)::int into v_count from public.materials where id = v_material;
    if v_count <> 1 then
      raise exception 'cascade_fk_flips smoke FAIL A: material should survive (count % expected 1)', v_count;
    end if;

    -- assertion (j): no new r2_pending_deletes rows. the AFTER DELETE
    -- trigger on materials (T1) only enqueues when a material row is
    -- deleted. company-scoped delete touches the polymorphic link, not the
    -- material file itself, so the queue should be untouched.
    select count(*)::int into v_r2_after from public.r2_pending_deletes;
    if v_r2_after - v_r2_baseline <> 0 then
      raise exception 'cascade_fk_flips smoke FAIL A: expected 0 r2_pending_deletes delta, got %',
        v_r2_after - v_r2_baseline;
    end if;

    raise notice 'cascade_fk_flips smoke ok A: company delete cascaded through products/trials/trial_notes/marker_assignments/marker/primary_intelligence/material_link; material survived; r2 queue untouched';

    -- teardown scenario A. the marker is gone (no marker_changes cleanup
    -- needed via FK -- marker_changes only carries a space_id FK, no marker
    -- FK, so the audit rows from the BEFORE DELETE marker trigger persist
    -- until the space is dropped). same for trial_change_events that the
    -- classifier emitted during the company delete; trial_change_events
    -- has FK trial_id ON DELETE CASCADE, so those rows already cleared when
    -- the trial was deleted. sweep materials so the r2_pending_deletes
    -- trigger fires on a clean fixture; then space / tenant / user.
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', null, true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.materials         where space_id = v_space;
    delete from public.marker_changes    where space_id = v_space;
    delete from public.space_members     where space_id = v_space;
    delete from public.tenant_members    where tenant_id = v_tenant;
    delete from public.spaces            where id = v_space;
    delete from public.tenants           where id = v_tenant;
    delete from auth.users               where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- scenario B: therapeutic_area delete leaves trials as Uncategorized.
  -- ===========================================================================
  -- fixture: fresh agency-free tenant + space + owner. one ta, one company,
  -- one product, one trial referencing the ta. delete the ta. assert the
  -- trial survives with therapeutic_area_id = NULL. the UI renders that
  -- null as "Uncategorized" via the display-fallbacks util (T9).
  declare
    v_user      uuid := gen_random_uuid();
    v_tenant    uuid := gen_random_uuid();
    v_space     uuid := gen_random_uuid();
    v_email     text := 'cascade-flip-b-' || gen_random_uuid() || '@example.com';
    v_ta        uuid := gen_random_uuid();
    v_company   uuid := gen_random_uuid();
    v_product   uuid := gen_random_uuid();
    v_trial     uuid := gen_random_uuid();
    v_count     int;
    v_ta_id     uuid;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'cascade-b-tenant', 'cascade-b-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'cascade-b-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.therapeutic_areas (id, space_id, created_by, name)
      values (v_ta, v_space, v_user, 'cascade-b-ta');
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'cascade-b-co');
    insert into public.products (id, space_id, created_by, company_id, name)
      values (v_product, v_space, v_user, v_company, 'cascade-b-drug');
    insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
      values (v_trial, v_space, v_user, v_product, v_ta, 'cascade-b-trial', 'NCT-CB-1');

    -- act: delete the therapeutic_area directly.
    delete from public.therapeutic_areas where id = v_ta;

    -- assertion (a): trial still exists.
    select count(*)::int into v_count from public.trials where id = v_trial;
    if v_count <> 1 then
      raise exception 'cascade_fk_flips smoke FAIL B: trial should survive ta delete (count % expected 1)', v_count;
    end if;

    -- assertion (b): the trial's therapeutic_area_id is now NULL (SET NULL
    -- action we just installed). without the flip the delete would have
    -- raised 23503; with it the trial's column is nulled and rendered as
    -- Uncategorized.
    select therapeutic_area_id into v_ta_id from public.trials where id = v_trial;
    if v_ta_id is not null then
      raise exception 'cascade_fk_flips smoke FAIL B: trial.therapeutic_area_id should be NULL, got %', v_ta_id;
    end if;

    raise notice 'cascade_fk_flips smoke ok B: therapeutic_area delete left trial standing with therapeutic_area_id = NULL';

    -- teardown scenario B. sweep the surviving trial, product, company,
    -- then space / tenant / user under the member_guard_cascade bypass.
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', null, true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.trials            where space_id = v_space;
    delete from public.products          where space_id = v_space;
    delete from public.companies         where space_id = v_space;
    delete from public.space_members     where space_id = v_space;
    delete from public.tenant_members    where tenant_id = v_tenant;
    delete from public.spaces            where id = v_space;
    delete from public.tenants           where id = v_tenant;
    delete from auth.users               where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  raise notice 'cascade_fk_flips smoke test: PASS';
end $$;
