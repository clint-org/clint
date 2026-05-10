-- migration: 20260510000100_audit_events_table
-- purpose: foundational audit log table. introduces audit_writer role that owns
--   record_audit_event/redact_user_pii (added in later migrations), the events
--   table itself with scope columns and structured metadata, indexes for the
--   four primary query shapes, and the jsonb PII-strip helper used by
--   redact_user_pii.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md

-- dedicated role; owns the two functions that mutate audit_events.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'audit_writer') then
    create role audit_writer noinherit nologin;
  end if;
end $$;

create table public.audit_events (
  id               uuid primary key default gen_random_uuid(),
  occurred_at      timestamptz not null default now(),
  action           text not null,
  source           text not null check (source in ('rpc','trigger','edge_function','system')),
  rpc_name         text,

  actor_user_id    uuid references auth.users(id) on delete set null,
  actor_email      text,
  actor_role       text,

  actor_ip         inet,
  actor_user_agent text,
  request_id       text,

  agency_id        uuid references public.agencies(id) on delete set null,
  tenant_id        uuid references public.tenants(id)  on delete set null,
  space_id         uuid references public.spaces(id)   on delete set null,

  resource_type    text not null,
  resource_id      uuid,

  metadata         jsonb not null default '{}'::jsonb
);

create index audit_events_agency_occurred   on public.audit_events (agency_id, occurred_at desc) where agency_id is not null;
create index audit_events_tenant_occurred   on public.audit_events (tenant_id, occurred_at desc) where tenant_id is not null;
create index audit_events_space_occurred    on public.audit_events (space_id,  occurred_at desc) where space_id  is not null;
create index audit_events_actor_occurred    on public.audit_events (actor_user_id, occurred_at desc) where actor_user_id is not null;
create index audit_events_resource          on public.audit_events (resource_type, resource_id, occurred_at desc);
create index audit_events_action_occurred   on public.audit_events (action, occurred_at desc);
create index audit_events_occurred_brin     on public.audit_events using brin (occurred_at);

comment on table public.audit_events is
  'Append-only Tier 1 (admin/security/governance) audit trail. Writes only through record_audit_event(); updates only through redact_user_pii(). See docs/superpowers/specs/2026-05-10-audit-log-design.md.';

-- jsonb helper used by redact_user_pii to scrub known PII keys from metadata
create or replace function public.jsonb_strip_pii_keys(p_meta jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  -- strip these keys recursively at the top level; metadata is intentionally
  -- shallow so single-level removal is sufficient for v1.
  select coalesce(p_meta, '{}'::jsonb)
         - 'email'
         - 'user_email'
         - 'recipient_email'
         - 'full_name'
         - 'display_name'
         - 'phone';
$$;

-- audit_events ownership: keep table owner default (postgres) so migrations can
-- evolve it; the locked write path is enforced via GRANTs, not via OWNERSHIP.
-- the writer functions own themselves under audit_writer and run as
-- security definer.

revoke all on public.audit_events from public;
revoke insert, update, delete on public.audit_events from authenticated, anon, service_role;
grant select on public.audit_events to authenticated;  -- RLS filters rows
grant select, insert, update, delete on public.audit_events to audit_writer;
