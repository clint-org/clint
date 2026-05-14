-- Tests for the five motion signals returned by get_space_landing_stats.
-- Seeds a single synthetic space with known fixtures and asserts each count.
-- Wrapped in a transaction so it rolls back cleanly.

begin;

-- Disable RLS so we can read back the RPC result without bothering with auth.
set local row_security = off;

do $$
declare
  v_space_id   uuid := gen_random_uuid();
  v_tenant_id  uuid := gen_random_uuid();
  v_user_id    uuid := gen_random_uuid();
  v_ta_id      uuid := gen_random_uuid();
  v_company_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_trial_p3_a  uuid := gen_random_uuid();
  v_trial_p3_b  uuid := gen_random_uuid();
  v_trial_other uuid := gen_random_uuid();
  v_marker_p3_readout     uuid := gen_random_uuid();
  v_marker_other_catalyst uuid := gen_random_uuid();
  v_marker_loe            uuid := gen_random_uuid();
  v_result jsonb;
begin
  -- Minimal auth.users row so FKs and has_space_access work.
  insert into auth.users (id, email)
    values (v_user_id, 'test-motion-counts@example.com');

  -- Set JWT claims so has_space_access(v_space_id) returns true.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_id)::text, true);

  -- Tenant + space.
  insert into public.tenants (id, name, slug)
    values (v_tenant_id, 'Test Tenant',
            'test-motion-' || substr(v_space_id::text, 1, 8));
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Test Space', v_user_id);

  -- Membership so has_space_access passes via space_members path.
  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_user_id, 'owner');

  -- Therapeutic area required by trials FK.
  insert into public.therapeutic_areas (id, space_id, name, created_by)
    values (v_ta_id, v_space_id, 'Oncology', v_user_id);

  -- Company + product (asset).
  insert into public.companies (id, space_id, name, created_by)
    values (v_company_id, v_space_id, 'Test Co', v_user_id);
  insert into public.products (id, space_id, company_id, name, created_by)
    values (v_product_id, v_space_id, v_company_id, 'Test Product', v_user_id);

  -- Three trials: two Phase 3, one Phase 2.
  insert into public.trials (id, space_id, product_id, therapeutic_area_id, name, phase, recruitment_status, created_by)
  values
    (v_trial_p3_a, v_space_id, v_product_id, v_ta_id, 'Trial P3 A', 'Phase 3', 'recruiting', v_user_id),
    (v_trial_p3_b, v_space_id, v_product_id, v_ta_id, 'Trial P3 B', 'Phase 3', 'recruiting', v_user_id),
    (v_trial_other, v_space_id, v_product_id, v_ta_id, 'Trial P2', 'Phase 2', 'recruiting', v_user_id);

  -- One P3 readout marker (Data category) within 90 days, assigned to a P3 trial.
  insert into public.markers (id, space_id, marker_type_id, event_date, title, created_by)
    values (
      v_marker_p3_readout,
      v_space_id,
      'a0000000-0000-0000-0000-000000000013', -- Topline Data (Data category)
      current_date + 30,
      'Topline readout',
      v_user_id
    );
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker_p3_readout, v_trial_p3_a);

  -- One non-P3 catalyst within 90 days (Approval category): counts toward
  -- catalysts_90d but NOT p3_readouts_90d.
  insert into public.markers (id, space_id, marker_type_id, event_date, title, created_by)
    values (
      v_marker_other_catalyst,
      v_space_id,
      'a0000000-0000-0000-0000-000000000035', -- Approval (Approval category)
      current_date + 14,
      'PDUFA decision',
      v_user_id
    );
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker_other_catalyst, v_trial_other);

  -- One LOE marker within 365 days (Loss of Exclusivity category).
  insert into public.markers (id, space_id, marker_type_id, event_date, title, created_by)
    values (
      v_marker_loe,
      v_space_id,
      'a0000000-0000-0000-0000-000000000020', -- LOE Date
      current_date + 200,
      'LOE expected',
      v_user_id
    );

  -- Two trial_change_events in the last 30 days: 1 phase transition + 1 termination.
  insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at, observed_at)
  values
    (v_trial_p3_a, v_space_id, 'phase_transitioned', 'analyst',
      jsonb_build_object('from', 'Phase 2', 'to', 'Phase 3'),
      now() - interval '5 days', now() - interval '5 days'),
    (v_trial_p3_b, v_space_id, 'status_changed', 'analyst',
      jsonb_build_object('from', 'recruiting', 'to', 'TERMINATED'),
      now() - interval '10 days', now() - interval '10 days');

  -- One trial_change_event outside the 30d window: must NOT count.
  insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at, observed_at)
  values (v_trial_p3_a, v_space_id, 'phase_transitioned', 'analyst',
    jsonb_build_object('from', 'Phase 1', 'to', 'Phase 2'),
    now() - interval '40 days', now() - interval '40 days');

  -- Two published primary_intelligence rows in the last 7 days.
  -- Each must use a distinct (entity_type, entity_id) pair to satisfy the
  -- one-published-per-anchor unique constraint.
  -- version_number is supplied explicitly to prevent the assign_version trigger
  -- from overwriting published_at with now().
  insert into public.primary_intelligence
    (id, space_id, entity_type, entity_id, state, headline, summary_md, published_at, last_edited_by, version_number)
  values
    (gen_random_uuid(), v_space_id, 'trial', v_trial_p3_a, 'published',
     'Recent brief A', 'thesis', now() - interval '1 day', v_user_id, 1),
    (gen_random_uuid(), v_space_id, 'trial', v_trial_p3_b, 'published',
     'Recent brief B', 'thesis', now() - interval '6 days', v_user_id, 1);

  -- One published older than 7 days: must NOT count.
  -- Uses v_trial_other to avoid the one-published-per-anchor unique constraint.
  insert into public.primary_intelligence
    (id, space_id, entity_type, entity_id, state, headline, summary_md, published_at, last_edited_by, version_number)
  values
    (gen_random_uuid(), v_space_id, 'trial', v_trial_other, 'published',
     'Older brief', 'thesis', now() - interval '14 days', v_user_id, 1);

  -- One draft within 7 days: must NOT count.
  insert into public.primary_intelligence
    (id, space_id, entity_type, entity_id, state, headline, summary_md, last_edited_by)
  values
    (gen_random_uuid(), v_space_id, 'company', v_company_id, 'draft',
     'Draft brief', 'thesis', v_user_id);

  v_result := public.get_space_landing_stats(v_space_id);

  raise notice 'result: %', v_result;

  assert (v_result ->> 'p3_readouts_90d')::int = 1,
    format('expected p3_readouts_90d = 1, got %s', v_result ->> 'p3_readouts_90d');
  assert (v_result ->> 'catalysts_90d')::int = 2,
    format('expected catalysts_90d = 2, got %s', v_result ->> 'catalysts_90d');
  assert (v_result ->> 'new_intel_7d')::int = 2,
    format('expected new_intel_7d = 2, got %s', v_result ->> 'new_intel_7d');
  assert (v_result ->> 'trial_moves_30d')::int = 2,
    format('expected trial_moves_30d = 2, got %s', v_result ->> 'trial_moves_30d');
  assert (v_result ->> 'loe_365d')::int = 1,
    format('expected loe_365d = 1, got %s', v_result ->> 'loe_365d');

  raise notice 'all motion-count assertions passed';
end;
$$;

rollback;
