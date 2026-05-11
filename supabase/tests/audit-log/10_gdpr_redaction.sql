-- 10_gdpr_redaction
-- Mirrors migration 20260510002300_audit_redaction_smoke.sql with verbose narrative.
-- Asserts redact_user_pii is platform-admin only, nulls PII fields, scrubs metadata
-- PII keys, preserves action record, and emits a compliance.user_pii_redacted event.
--
-- Predictable UUID prefix: 10101010-10xx-10xx-10xx-10xxxxxxxxxx

do $$
declare
  v_pa      uuid := '10101010-1010-1010-1010-101010101001';
  v_subject uuid := '10101010-1010-1010-1010-101010101002';
  v_non_pa  uuid := '10101010-1010-1010-1010-101010101003';
  v_count   int;
  v_remaining_email text;
  v_remaining_ip    inet;
  v_remaining_ua    text;
  v_redact_events   int;
  v_caught          boolean;
begin
  raise notice '10_gdpr_redaction: bootstrapping platform admin, subject user, and non-admin user';

  insert into auth.users (id, email) values
    (v_pa,      'pa@10gdpr.test'),
    (v_subject, 's@10gdpr.test'),
    (v_non_pa,  'np@10gdpr.test');
  insert into public.platform_admins (user_id) values (v_pa);

  raise notice '10_gdpr_redaction: seeding two audit rows with PII fields for the subject user';

  -- direct INSERT as postgres (superuser) to bypass GRANT restrictions on the table
  insert into public.audit_events
    (action, source, resource_type, actor_user_id, actor_email, actor_ip, actor_user_agent, metadata)
  values
    ('10gdpr.test.alpha', 'system', 'test',
     v_subject, 's@10gdpr.test', '10.10.10.1', 'Mozilla/5.0 (10gdpr)',
     jsonb_build_object('email', 's@10gdpr.test', 'value', 'preserved')),
    ('10gdpr.test.beta', 'system', 'test',
     v_subject, 's@10gdpr.test', '10.10.10.2', 'Chrome/10gdpr',
     jsonb_build_object('user_email', 's@10gdpr.test', 'display_name', 'Subject User'));

  -- ----------------------------------------------------------------
  -- Test 1: non-platform-admin call to redact_user_pii raises 42501
  -- ----------------------------------------------------------------
  raise notice '10_gdpr_redaction: [1/5] asserting redact_user_pii is platform-admin only';

  perform set_config('request.jwt.claim.sub', v_non_pa::text, true);
  set local role authenticated;

  v_caught := false;
  begin
    perform public.redact_user_pii(v_subject);
  exception when sqlstate '42501' then
    v_caught := true;
  end;

  reset role;

  if not v_caught then
    raise exception 'GDPR FAIL #1: non-platform-admin was allowed to call redact_user_pii';
  end if;

  -- ----------------------------------------------------------------
  -- Test 2: platform admin can call redact_user_pii and it returns count >= 2
  -- ----------------------------------------------------------------
  raise notice '10_gdpr_redaction: [2/5] platform admin calls redact_user_pii, expecting >= 2 rows scrubbed';

  perform set_config('request.jwt.claim.sub', v_pa::text, true);

  select public.redact_user_pii(v_subject) into v_count;
  if v_count < 2 then
    raise exception 'GDPR FAIL #2: expected >= 2 rows scrubbed, got %', v_count;
  end if;

  -- ----------------------------------------------------------------
  -- Test 3: PII columns are now null on the subject rows
  -- ----------------------------------------------------------------
  raise notice '10_gdpr_redaction: [3/5] verifying actor_email, actor_ip, actor_user_agent are nulled';

  select actor_email, actor_ip, actor_user_agent
    into v_remaining_email, v_remaining_ip, v_remaining_ua
    from public.audit_events
    where actor_user_id = v_subject
      and action in ('10gdpr.test.alpha', '10gdpr.test.beta')
    limit 1;

  if v_remaining_email is not null then
    raise exception 'GDPR FAIL #3: actor_email not nulled, got %', v_remaining_email;
  end if;
  if v_remaining_ip is not null then
    raise exception 'GDPR FAIL #4: actor_ip not nulled, got %', v_remaining_ip;
  end if;
  if v_remaining_ua is not null then
    raise exception 'GDPR FAIL #5: actor_user_agent not nulled, got %', v_remaining_ua;
  end if;

  -- ----------------------------------------------------------------
  -- Test 4: metadata PII keys are scrubbed
  -- ----------------------------------------------------------------
  raise notice '10_gdpr_redaction: [4/5] verifying metadata PII keys (email, user_email, display_name) are scrubbed';

  if exists (
    select 1 from public.audit_events
    where actor_user_id = v_subject
      and action in ('10gdpr.test.alpha', '10gdpr.test.beta')
      and (metadata ? 'email' or metadata ? 'user_email' or metadata ? 'display_name')
  ) then
    raise exception 'GDPR FAIL #6: metadata PII keys still present after redaction';
  end if;

  -- action and resource columns must be preserved (legitimate-interest basis)
  if not exists (
    select 1 from public.audit_events
    where actor_user_id = v_subject and action = '10gdpr.test.alpha' and resource_type = 'test'
  ) then
    raise exception 'GDPR FAIL #7: action or resource_type was lost during redaction (must be preserved)';
  end if;

  -- non-PII metadata key 'value' must survive
  if not exists (
    select 1 from public.audit_events
    where actor_user_id = v_subject and action = '10gdpr.test.alpha'
      and metadata ? 'value'
  ) then
    raise exception 'GDPR FAIL #8: non-PII metadata key "value" was incorrectly scrubbed';
  end if;

  -- ----------------------------------------------------------------
  -- Test 5: compliance.user_pii_redacted event emitted exactly once
  -- ----------------------------------------------------------------
  raise notice '10_gdpr_redaction: [5/5] verifying compliance.user_pii_redacted event was emitted';

  select count(*) into v_redact_events
    from public.audit_events
    where action = 'compliance.user_pii_redacted'
      and resource_id = v_subject;
  if v_redact_events <> 1 then
    raise exception 'GDPR FAIL #9: expected 1 compliance.user_pii_redacted event, got %', v_redact_events;
  end if;

  -- ----------------------------------------------------------------
  -- cleanup
  -- ----------------------------------------------------------------
  raise notice '10_gdpr_redaction: cleanup';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.audit_events
    where actor_user_id = v_subject
       or resource_id = v_subject
       or action in ('10gdpr.test.alpha', '10gdpr.test.beta');
  delete from public.platform_admins where user_id = v_pa;
  delete from auth.users where id in (v_pa, v_subject, v_non_pa);

  raise notice '10_gdpr_redaction: PASS (5 GDPR invariants verified: access gate, row count, PII null, metadata scrub, compliance event)';
end $$;
