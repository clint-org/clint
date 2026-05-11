-- migration: 20260510002300_audit_redaction_smoke
-- purpose: assert redact_user_pii nulls actor_email/ip/ua and scrubs metadata
--   PII keys on rows where actor_user_id matches; preserves action and
--   resource_id; emits a compliance.user_pii_redacted event.

do $$
declare
  v_pa uuid := '31111111-1111-1111-1111-111111111111';
  v_subject uuid := '32222222-2222-2222-2222-222222222222';
  v_count int;
  v_remaining_email text;
  v_remaining_ip inet;
  v_remaining_ua text;
  v_redaction_events int;
begin
  -- bootstrap
  insert into auth.users (id, email) values
    (v_pa, 'pa@redact.test'),
    (v_subject, 's@redact.test');
  insert into public.platform_admins (user_id) values (v_pa);

  -- seed two rows attributed to the subject with PII fields populated.
  -- direct INSERT works as postgres (superuser bypass).
  insert into public.audit_events
    (action, source, resource_type, actor_user_id, actor_email, actor_ip, actor_user_agent, metadata)
  values
    ('test.alpha', 'system', 'test', v_subject, 's@redact.test', '10.0.0.1', 'Mozilla/5.0', jsonb_build_object('email','s@redact.test')),
    ('test.beta',  'system', 'test', v_subject, 's@redact.test', '10.0.0.2', 'Chrome/100', jsonb_build_object('user_email','s@redact.test'));

  -- impersonate the platform admin so redact_user_pii's is_platform_admin() gate passes
  perform set_config('request.jwt.claim.sub', v_pa::text, true);

  select public.redact_user_pii(v_subject) into v_count;
  if v_count < 2 then
    raise exception 'REDACTION FAIL #1: expected >=2 rows scrubbed, got %', v_count;
  end if;

  -- actor_email should be null on all subject rows
  select actor_email, actor_ip, actor_user_agent into v_remaining_email, v_remaining_ip, v_remaining_ua
    from public.audit_events
    where actor_user_id = v_subject and action in ('test.alpha','test.beta')
    limit 1;
  if v_remaining_email is not null then
    raise exception 'REDACTION FAIL #2: actor_email not nulled, got %', v_remaining_email;
  end if;
  if v_remaining_ip is not null then
    raise exception 'REDACTION FAIL #3: actor_ip not nulled, got %', v_remaining_ip;
  end if;
  if v_remaining_ua is not null then
    raise exception 'REDACTION FAIL #4: actor_user_agent not nulled, got %', v_remaining_ua;
  end if;

  -- metadata.email / metadata.user_email keys should be gone
  if exists (
    select 1 from public.audit_events
    where actor_user_id = v_subject
      and action in ('test.alpha','test.beta')
      and (metadata ? 'email' or metadata ? 'user_email')
  ) then
    raise exception 'REDACTION FAIL #5: metadata PII keys retained';
  end if;

  -- action and resource columns should be preserved (not nulled out)
  if not exists (
    select 1 from public.audit_events
    where actor_user_id = v_subject and action = 'test.alpha' and resource_type = 'test'
  ) then
    raise exception 'REDACTION FAIL #6: action or resource_type lost during redaction';
  end if;

  -- compliance.user_pii_redacted event should have been emitted exactly once
  select count(*) into v_redaction_events
    from public.audit_events
    where action = 'compliance.user_pii_redacted'
      and resource_id = v_subject;
  if v_redaction_events <> 1 then
    raise exception 'REDACTION FAIL #7: expected 1 compliance.user_pii_redacted event, got %', v_redaction_events;
  end if;

  -- cleanup
  delete from public.audit_events
    where actor_user_id = v_subject or resource_id = v_subject;
  delete from public.platform_admins where user_id = v_pa;
  delete from auth.users where id in (v_pa, v_subject);

  raise notice 'audit redaction smoke: PASS (7 invariants verified)';
end $$;
