-- migration: 20260510000400_record_audit_event
-- purpose: the one and only INSERT path into audit_events. SECURITY DEFINER
--   owned by audit_writer. captures actor identity and request context from
--   GUCs and JWT claims. sets the audit.suppress_trigger GUC so safety-net
--   triggers can dedupe RPC-emitted events from direct writes.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md (Capture mechanism)

create or replace function public.record_audit_event(
  p_action          text,
  p_source          text,
  p_resource_type   text,
  p_resource_id     uuid,
  p_agency_id       uuid,
  p_tenant_id       uuid,
  p_space_id        uuid,
  p_metadata        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.audit_events (
    action, source, rpc_name,
    actor_user_id, actor_email, actor_role,
    actor_ip, actor_user_agent, request_id,
    agency_id, tenant_id, space_id,
    resource_type, resource_id, metadata
  )
  values (
    p_action, p_source,
    nullif(current_setting('audit.rpc_name', true), ''),
    auth.uid(),
    nullif(current_setting('request.jwt.claim.email', true), ''),
    nullif(current_setting('audit.actor_role', true), ''),
    nullif(current_setting('request.header.x-forwarded-for', true), '')::inet,
    nullif(current_setting('request.header.user-agent', true), ''),
    nullif(current_setting('request.header.x-request-id', true), ''),
    p_agency_id, p_tenant_id, p_space_id,
    p_resource_type, p_resource_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  -- signal to safety-net triggers that this event was already RPC-emitted.
  -- the GUC value is the audit_events.id; triggers compare and skip on match.
  perform set_config('audit.suppress_trigger', v_id::text, true);

  return v_id;
end
$$;

-- Note: function ownership stays as the default migration role (postgres). Transferring
-- ownership to audit_writer is rejected by Supabase's managed auth schema (auth schema
-- grants are reset by supabase_auth_admin / GoTrue init, breaking the SECURITY DEFINER
-- call to auth.uid()). The locked write path is instead enforced at the table-grant
-- layer: INSERT/UPDATE/DELETE on audit_events are revoked from authenticated and
-- service_role (in 20260510000100); only this SECURITY DEFINER function (callable by
-- authenticated/service_role via the explicit grant below) reaches the table.
revoke all on function public.record_audit_event(text,text,text,uuid,uuid,uuid,uuid,jsonb) from public;
grant execute on function public.record_audit_event(text,text,text,uuid,uuid,uuid,uuid,jsonb) to authenticated, service_role;

comment on function public.record_audit_event(text,text,text,uuid,uuid,uuid,uuid,jsonb) is
  'The only sanctioned INSERT path into audit_events. Tier 1 RPCs and edge functions call this; direct INSERTs are revoked at the GRANT layer.';
