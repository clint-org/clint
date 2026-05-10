-- migration: 20260510000500_redact_user_pii
-- purpose: GDPR right-to-erasure path for audit_events. nulls actor_email,
--   actor_ip, actor_user_agent on rows where actor_user_id = subject; scrubs
--   metadata PII keys. preserves the action record under legitimate-interest
--   legal basis. emits its own audit event recording the redaction.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md (Retention and GDPR)
-- operational rule: ALWAYS run this BEFORE deleting the user from auth.users;
--   deleting first triggers on-delete-set-null on actor_user_id and we lose
--   the ability to scope the scrub.

create or replace function public.redact_user_pii(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not is_platform_admin() then
    raise exception 'redact_user_pii is platform admin only' using errcode = '42501';
  end if;

  update public.audit_events
  set actor_email      = null,
      actor_ip         = null,
      actor_user_agent = null,
      metadata         = public.jsonb_strip_pii_keys(metadata)
  where actor_user_id = p_user_id;

  get diagnostics v_count = row_count;

  perform public.record_audit_event(
    'compliance.user_pii_redacted',
    'rpc',
    'user_pii',
    p_user_id,
    null, null, null,
    jsonb_build_object('row_count', v_count)
  );

  return v_count;
end
$$;

-- NOTE: function owner stays as default (postgres). Transferring to audit_writer
-- is rejected by Supabase's managed auth schema (grants get reset on container init).
-- The locked write path on audit_events is enforced by the table GRANTs from Task 1.

revoke all on function public.redact_user_pii(uuid) from public;
grant execute on function public.redact_user_pii(uuid) to authenticated;

comment on function public.redact_user_pii(uuid) is
  'Platform-admin-only GDPR redaction. Scrubs actor PII fields on audit rows for the subject user; preserves the action record. Must run BEFORE deleting the user from auth.users.';
