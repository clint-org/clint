-- migration: 20260510000600_list_audit_events
-- purpose: read RPCs for the four audit log UI pages. NOT security definer:
--   relies on the audit_events RLS policy. a tenant owner calling
--   list_audit_events('agency', X) sees zero rows because RLS denies; the
--   RPC is a filter consolidator, not an authorization bypass.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md (Data RPC)

create or replace function public.list_audit_events(
  p_scope_kind    text,
  p_scope_id      uuid,
  p_actor_user_id uuid default null,
  p_action        text default null,
  p_from          timestamptz default null,
  p_to            timestamptz default null,
  p_limit         integer default 50,
  p_offset        integer default 0
)
returns table (
  id               uuid,
  occurred_at      timestamptz,
  action           text,
  source           text,
  rpc_name         text,
  actor_user_id    uuid,
  actor_email      text,
  actor_role       text,
  actor_ip         inet,
  actor_user_agent text,
  request_id       text,
  agency_id        uuid,
  tenant_id        uuid,
  space_id         uuid,
  resource_type    text,
  resource_id      uuid,
  metadata         jsonb
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    e.id, e.occurred_at, e.action, e.source, e.rpc_name,
    e.actor_user_id, e.actor_email, e.actor_role,
    e.actor_ip, e.actor_user_agent, e.request_id,
    e.agency_id, e.tenant_id, e.space_id,
    e.resource_type, e.resource_id, e.metadata
  from public.audit_events e
  where (
    (p_scope_kind = 'agency'   and e.agency_id = p_scope_id) or
    (p_scope_kind = 'tenant'   and e.tenant_id = p_scope_id) or
    (p_scope_kind = 'space'    and e.space_id  = p_scope_id) or
    (p_scope_kind = 'platform' and is_platform_admin())
  )
    and (p_actor_user_id is null or e.actor_user_id = p_actor_user_id)
    and (p_action        is null or e.action        = p_action)
    and (p_from          is null or e.occurred_at  >= p_from)
    and (p_to            is null or e.occurred_at  <  p_to)
  order by e.occurred_at desc
  limit greatest(1, least(p_limit, 500))
  offset greatest(0, p_offset);
$$;

revoke all on function public.list_audit_events(text,uuid,uuid,text,timestamptz,timestamptz,integer,integer) from public;
grant execute on function public.list_audit_events(text,uuid,uuid,text,timestamptz,timestamptz,integer,integer) to authenticated;

create or replace function public.export_audit_events_csv(
  p_scope_kind    text,
  p_scope_id      uuid,
  p_actor_user_id uuid default null,
  p_action        text default null,
  p_from          timestamptz default null,
  p_to            timestamptz default null
)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_header text;
  v_body   text;
begin
  v_header := 'occurred_at,action,source,rpc_name,actor_user_id,actor_email,actor_role,actor_ip,actor_user_agent,request_id,agency_id,tenant_id,space_id,resource_type,resource_id,metadata';

  with rows as (
    select e.*
    from public.audit_events e
    where (
      (p_scope_kind = 'agency'   and e.agency_id = p_scope_id) or
      (p_scope_kind = 'tenant'   and e.tenant_id = p_scope_id) or
      (p_scope_kind = 'space'    and e.space_id  = p_scope_id) or
      (p_scope_kind = 'platform' and is_platform_admin())
    )
      and (p_actor_user_id is null or e.actor_user_id = p_actor_user_id)
      and (p_action        is null or e.action        = p_action)
      and (p_from          is null or e.occurred_at  >= p_from)
      and (p_to            is null or e.occurred_at  <  p_to)
    order by e.occurred_at desc
    limit 10000
  )
  select string_agg(
    rows.occurred_at::text || ',' ||
    rows.action || ',' ||
    rows.source || ',' ||
    coalesce(rows.rpc_name, '') || ',' ||
    coalesce(rows.actor_user_id::text, '') || ',' ||
    coalesce(rows.actor_email, '') || ',' ||
    coalesce(rows.actor_role, '') || ',' ||
    coalesce(rows.actor_ip::text, '') || ',' ||
    coalesce(replace(rows.actor_user_agent, ',', ' '), '') || ',' ||
    coalesce(rows.request_id, '') || ',' ||
    coalesce(rows.agency_id::text, '') || ',' ||
    coalesce(rows.tenant_id::text, '') || ',' ||
    coalesce(rows.space_id::text, '') || ',' ||
    rows.resource_type || ',' ||
    coalesce(rows.resource_id::text, '') || ',' ||
    '"' || replace(rows.metadata::text, '"', '""') || '"',
    E'\n'
  )
  into v_body
  from rows;

  if v_body is null then
    return v_header || E'\n';
  end if;
  return v_header || E'\n' || v_body || E'\n';
end
$$;

revoke all on function public.export_audit_events_csv(text,uuid,uuid,text,timestamptz,timestamptz) from public;
grant execute on function public.export_audit_events_csv(text,uuid,uuid,text,timestamptz,timestamptz) to authenticated;
