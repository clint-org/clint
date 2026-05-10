# Audit Log Design

**Status:** Draft. Reached through brainstorm on 2026-05-10.
**Companion spec:** `2026-04-29-observability-design.md` (errors + ops logs via Sentry + Axiom; audit logging is a separate concern with the database as system of record).

---

## Goal

Establish a compliance- and forensics-grade audit trail for privileged actions across Clint's multi-tenant whitelabel hierarchy. Optimize for:

1. **Internal forensics** (today): "who did what when" when something goes wrong.
2. **SOC 2 readiness** (next 6-12 months): privileged-action history evidence on demand.
3. **Customer trust signal**: owners at each scope can self-serve their own audit data.

Explicitly NOT optimizing for HIPAA-on-PHI today (Clint stores no PHI) or 21 CFR Part 11 (would require hash chain / signed records; deferred).

## Scope

### In scope

**Tier 1 mutations only** — admin, security, governance actions. The action set:

| Action family | Specific actions |
|---|---|
| Agency lifecycle | `agency.provision`, `agency.branding_updated`, `agency.suspended`, `agency.unsuspended`, `agency_invite.consumed` |
| Tenant lifecycle | `tenant.provision`, `tenant.suspend`, `tenant.unsuspend`, `tenant.deleted`, `tenant.branding_updated`, `tenant.access_policy_updated` |
| Tenant membership | `tenant_member.added`, `tenant_member.removed`, `tenant_member.role_changed`, `tenant_invite.issued`, `tenant_invite.revoked`, `tenant_invite.redeemed` |
| Agency membership | `agency_member.added`, `agency_member.removed`, `agency_invite.issued`, `agency_invite.revoked` |
| Space lifecycle | `space.created`, `space.deleted` |
| Space membership | `space_member.added`, `space_member.removed`, `space_member.role_changed`, `space_invite.issued`, `space_invite.revoked`, `space_invite.redeemed`, `tenant.self_join_consumed` |
| Domains | `custom_domain.registered`, `custom_domain.retired` |
| Platform admin | `platform_admin.granted`, `platform_admin.revoked` |
| Compliance | `compliance.user_pii_redacted` (emitted by `redact_user_pii` itself) |

### Out of scope (explicitly)

- **Read events.** Pharma users review dozens of trials per session; logging every SELECT swamps the log and gives marginal SOC 2 value (auditors review privileged actions, not bulk reads). Clint stores no PHI today, so HIPAA's read-on-PHI requirement does not apply. Reconstructing reads, if ever needed, leans on the observability stack.
- **Editorial data mutations.** Edits to `companies` / `products` / `trials` / `markers` / `primary_intelligence` / `materials` / `trial_notes` stay in their entity-specific change-feed tables (`marker_changes`, `trial_field_changes`, `primary_intelligence_revisions`). These answer "what changed about this asset" — a different question from "what did this user do" — and have different retention, consumers, and indexing needs.
- **System-driven writes.** The ctgov sync worker writes to `trial_ctgov_snapshots`, `trial_field_changes`, `trial_change_events`, `markers` via `seed_ctgov_markers_on_sync`. These are routine data ingestion, not privileged actions. They keep their existing home in `ctgov_sync_runs` and the change-feed tables; they do NOT write to `audit_events`.

## Schema

```sql
create table public.audit_events (
  id              uuid primary key default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  action          text not null,                                           -- 'tenant.provision', 'space_member.role_changed', ...
  source          text not null check (source in ('rpc','trigger','edge_function','system')),
  rpc_name        text,                                                    -- populated when source = 'rpc'

  -- actor (denormalized point-in-time so user deletion doesn't break the trail)
  actor_user_id   uuid references auth.users(id) on delete set null,
  actor_email     text,
  actor_role      text,                                                    -- 'tenant_owner','agency_owner','platform_admin','space_owner','space_editor','system','worker','anon'

  -- request context
  actor_ip        inet,
  actor_user_agent text,
  request_id      text,                                                    -- correlation id for observability cross-reference

  -- scope (any or all may be set; visibility derives from these)
  agency_id       uuid references public.agencies(id) on delete set null,
  tenant_id       uuid references public.tenants(id) on delete set null,
  space_id        uuid references public.spaces(id)  on delete set null,

  -- resource the action targeted
  resource_type   text not null,                                           -- 'tenant','space','tenant_member','tenant_invite','agency','agency_member','space_member','space_invite','platform_admin','custom_domain','access_policy','user_pii'
  resource_id     uuid,                                                    -- nullable for actions without a single primary resource

  -- structured payload; controlled surface (never cleartext secrets, see Conventions)
  metadata        jsonb not null default '{}'
);

-- indexes
create index audit_events_agency_occurred   on public.audit_events (agency_id, occurred_at desc) where agency_id is not null;
create index audit_events_tenant_occurred   on public.audit_events (tenant_id, occurred_at desc) where tenant_id is not null;
create index audit_events_space_occurred    on public.audit_events (space_id,  occurred_at desc) where space_id  is not null;
create index audit_events_actor_occurred    on public.audit_events (actor_user_id, occurred_at desc) where actor_user_id is not null;
create index audit_events_resource          on public.audit_events (resource_type, resource_id, occurred_at desc);
create index audit_events_action_occurred   on public.audit_events (action, occurred_at desc);
create index audit_events_occurred_brin     on public.audit_events using brin (occurred_at);
```

Notes:

- `actor_user_id` is `on delete set null` so deleting an `auth.users` row does not leave a dangling FK. The GDPR redaction RPC is the supported way to scrub PII; deleting the user without first redacting will null `actor_user_id` but leave the email/IP/UA columns populated, so the documented order is **always run `redact_user_pii(p_user_id)` before deleting from `auth.users`**.
- `actor_email`, `actor_role` are denormalized point-in-time. The audit row is self-contained. If the user changes their email later, the audit row keeps the address they had at the time of the action.
- All scope columns (`agency_id`, `tenant_id`, `space_id`) are nullable; an event may belong to multiple scopes. `tenant.provision` carries both `agency_id` (parent) and `tenant_id` (new tenant). `platform_admin.granted` has no scope set.
- BRIN on `occurred_at` is for archival range scans. The btree on `(scope_id, occurred_at desc)` powers the in-app list views.

## Capture mechanism

### Primary path: `record_audit_event` from RPCs

```sql
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
    resource_type, resource_id,
    metadata
  )
  values (
    p_action, p_source,
    case when p_source = 'rpc' then current_setting('audit.rpc_name', true) else null end,
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

  -- signal to safety-net triggers that this event was already RPC-emitted
  perform set_config('audit.suppress_trigger', v_id::text, true);

  return v_id;
end
$$;

alter function public.record_audit_event(text,text,text,uuid,uuid,uuid,uuid,jsonb) owner to audit_writer;
revoke all on function public.record_audit_event(text,text,text,uuid,uuid,uuid,uuid,jsonb) from public;
grant execute on function public.record_audit_event(text,text,text,uuid,uuid,uuid,uuid,jsonb) to authenticated, service_role;
```

Every Tier 1 RPC calls `record_audit_event(...)` as part of its body, before returning success. RPCs first compute the actor role for the action (e.g., `'tenant_owner'`, `'agency_owner'`, `'platform_admin'`) and stash it via `set_config('audit.actor_role', ..., true)` so the helper can read it.

### Safety-net triggers

`AFTER INSERT/UPDATE/DELETE` triggers on the highest-risk tables back up the RPC path in case any code path writes directly:

- `platform_admins` — INSERT/DELETE → `platform_admin.granted` / `platform_admin.revoked`
- `tenant_members` — INSERT/DELETE/UPDATE-of-role → `tenant_member.added` / `tenant_member.removed` / `tenant_member.role_changed`
- `agency_members` — same shape
- `space_members` — same shape
- `tenants` — column-level trigger on `suspended_at` (NULL ↔ non-NULL) → `tenant.suspend` / `tenant.unsuspend`

Each trigger checks `current_setting('audit.suppress_trigger', true)` against a row identifier set by the RPC path. If set, the trigger skips — preventing duplicate events for the same logical action. If the trigger fires *without* a prior RPC suppression, the row was written by a path that didn't go through an instrumented RPC; the trigger inserts an event with `source = 'trigger'`, `rpc_name = NULL`, and whatever actor info `auth.uid()` and `current_setting('request.*')` expose. Trigger-sourced rows are the "something went around the RPC layer" signal — they should be investigated.

### Edge functions

`send-invite-email` and any future edge function calls `record_audit_event(...)` via service role. The service-role grant on the function allows this; direct INSERT on `audit_events` does not (see Locked write path).

### Locked write path

```sql
revoke insert, update, delete on public.audit_events from authenticated, service_role, public;
-- only audit_writer (the owner of record_audit_event and redact_user_pii) can write directly
-- authenticated / service_role can only write via record_audit_event(...)
```

`audit_writer` is a dedicated role created specifically for this purpose. `record_audit_event` and `redact_user_pii` are the only two functions owned by it. An attacker holding the `service_role` key cannot `INSERT` a forged audit row by direct REST call — they would have to call `record_audit_event`, which captures `auth.uid()` from the JWT (which they don't have unless they also forged a session).

## RLS

```sql
alter table public.audit_events enable row level security;

-- SELECT: strict-scope owners + platform admin
create policy "audit_events_select_strict_scope_owners"
  on public.audit_events
  for select
  to authenticated
  using (
    is_platform_admin()
    or (agency_id is not null and is_agency_member(agency_id, array['owner']))
    or (tenant_id  is not null and is_tenant_owner_strict(tenant_id))
    or (space_id   is not null and has_space_access(space_id, array['owner']))
  );

-- No INSERT, UPDATE, or DELETE policies. Writes flow only through record_audit_event;
-- updates only through redact_user_pii. Both are SECURITY DEFINER owned by audit_writer.
```

`is_tenant_owner_strict(p_tenant_id)` is a new helper:

```sql
create or replace function public.is_tenant_owner_strict(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- tenant_members.role is constrained to 'owner', so any row is an owner row.
  -- This helper deliberately differs from is_tenant_member by omitting the
  -- agency-owner and platform-admin disjuncts.
  select exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id   = auth.uid()
  );
$$;
```

The contrast with the existing `is_tenant_member` is intentional. `is_tenant_member` returns true for an agency owner of the parent agency and for platform admins (those cascading disjuncts). `is_tenant_owner_strict` returns true only when there is an explicit `tenant_members` row. The strict-scope visibility model says: an agency owner sees agency-scoped audit rows, and they see tenant-scoped audit rows ONLY if they also hold an explicit `tenant_members` membership.

### Visibility matrix

| Audit row scope | Visible to |
|---|---|
| `agency_id` set | Agency owner of that agency; platform admin |
| `tenant_id` set | Strict tenant owner (explicit `tenant_members.role = 'owner'`); platform admin |
| `space_id` set | Space owner; platform admin |
| No scope set (e.g., `platform_admin.granted`) | Platform admin only |
| Multiple scopes set | Union of the above (e.g., `tenant.provision` is visible to the agency owner via `agency_id` and to the new tenant's first owner via `tenant_id`) |

Editors and viewers never see audit rows. Tier 1 events are not cascade-visible from one scope down to a lower one — a tenant owner does not see space-scoped audit rows for spaces in their tenant unless they are also a space owner of that space. This matches the migration-75 no-implicit-cascade principle applied to audit.

## Retention and GDPR

### Retention

Indefinite hot retention in Postgres. At Tier 1 volume (~5 events/day per active tenant peak, ~1-2/day steady), a 100-tenant deployment generates well under 1M rows/year — comfortable for Postgres with the BRIN index on `occurred_at`. Cold archival to R2 is a documented follow-up if/when volume forces it; the BRIN index is already in place to make range exports efficient.

### GDPR right-to-erasure

Audit logs are processed under the legitimate-interest legal basis (SOC 2 evidence; tamper-resistant action history). Erasure requests are handled by redacting actor PII fields, not by deleting rows:

```sql
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
      metadata         = jsonb_strip_pii_keys(metadata)
  where actor_user_id = p_user_id;

  get diagnostics v_count = row_count;

  -- emit an audit event recording the redaction itself
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

alter function public.redact_user_pii(uuid) owner to audit_writer;
revoke all on function public.redact_user_pii(uuid) from public;
grant execute on function public.redact_user_pii(uuid) to authenticated;
```

`jsonb_strip_pii_keys(jsonb)` is a helper that removes a known set of PII keys from the metadata payload: `email`, `user_email`, `recipient_email`, `full_name`, `display_name` (when matching the redacted user), `phone`. Keys are documented and extended as new action types are added.

**Operational rule.** Always run `redact_user_pii(p_user_id)` *before* deleting the user from `auth.users`. The order matters: deletion via `auth.users` triggers `on delete set null` on `actor_user_id` and we lose the ability to look up which rows referenced the user. The redaction RPC must run while the FK is still intact.

The redaction RPC writes its own audit event (`compliance.user_pii_redacted`) with the row count — so the act of redaction is itself recorded, and so is the platform admin who ran it.

## Customer-facing UI

Four dedicated audit log pages in v1, all using PrimeNG `p-table` with the same column set and filter shape:

| Scope | Route | Gate | Visible rows |
|---|---|---|---|
| Agency | `/admin/audit-log` | agency owner (`is_agency_member(brand.id, ['owner'])`) | `agency_id = brand.id` |
| Tenant | `/t/:tenantId/settings/audit-log` (settings tab) | strict tenant owner (`is_tenant_owner_strict(:tenantId)`) | `tenant_id = :tenantId` |
| Space | `/t/:tenantId/s/:spaceId/settings/audit-log` (space settings tab) | space owner (`has_space_access(:spaceId, ['owner'])`) | `space_id = :spaceId` |
| Super-admin | `/super-admin/audit-log` | platform admin | all rows; tenant + agency filter chips on the page |

### Capabilities

- Default sort: `occurred_at desc`
- Filters: actor (autocomplete by email), action (multi-select from the known action catalog for the visible scope), date range
- CSV export (button on the page) — emits the currently filtered set
- Pagination: server-side, page size 50
- No full-text search in v1 (filters cover most needs)

### Data RPC

```sql
create or replace function public.list_audit_events(
  p_scope_kind text,                                  -- 'agency' | 'tenant' | 'space' | 'platform'
  p_scope_id   uuid,                                  -- null when p_scope_kind = 'platform'
  p_actor_user_id uuid default null,
  p_action        text default null,
  p_from          timestamptz default null,
  p_to            timestamptz default null,
  p_limit         integer default 50,
  p_offset        integer default 0
)
returns table (
  id              uuid,
  occurred_at     timestamptz,
  action          text,
  source          text,
  rpc_name        text,
  actor_user_id   uuid,
  actor_email     text,
  actor_role      text,
  actor_ip        inet,
  actor_user_agent text,
  request_id      text,
  agency_id       uuid,
  tenant_id       uuid,
  space_id        uuid,
  resource_type   text,
  resource_id     uuid,
  metadata        jsonb
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
  limit p_limit offset p_offset;
$$;
```

The RPC is NOT `security definer` — it relies on the table's own RLS policy. A platform admin querying `'tenant'` scope sees all matching rows because the RLS policy says so; a tenant owner querying `'agency'` scope sees nothing because the RLS policy denies. The RPC's role is to consolidate the filter logic, not to bypass authorization.

### CSV export RPC

```sql
create or replace function public.export_audit_events_csv(
  p_scope_kind text, p_scope_id uuid,
  p_actor_user_id uuid default null,
  p_action        text default null,
  p_from          timestamptz default null,
  p_to            timestamptz default null
) returns text
```

Returns a CSV blob. The frontend triggers a download. Export reuses the same filter parameters as the list RPC. Hard cap of 10,000 rows per export in v1 to keep response times sane; if a customer hits the cap, follow-up is a paginated export tool.

## Observability relationship

DB is the system of record. Axiom mirror is **deferred to v2** and lands alongside the observability rollout. The hook is a single `pg_net.http_post` call added to `record_audit_event` after the DB insert; no schema migration is needed. No Sentry breadcrumb integration in v1.

`request_id` is captured at write time even in v1 so that future Axiom-mirrored rows can be cross-referenced with structured logs without a backfill.

## Hard rules and conventions

1. **Invite codes, webhook secrets, and one-time tokens never appear in `metadata`.** Log the FK (`invite_id`), not the code. Enforced by code review; recorded as a non-negotiable rule.
2. **Action names use `domain.verb` snake_case.** Examples: `tenant.provision`, `space_member.role_changed`, `compliance.user_pii_redacted`.
3. **Every Tier 1 RPC must call `record_audit_event`** before returning success. Failures inside the RPC body that don't reach the audit call are acceptable — we audit successful actions, not attempts.
4. **Coverage test (mandatory).** A Postgres test scans the function bodies of every Tier 1 RPC (identified by a `-- @audit:tier1` SQL comment marker at the top of the function definition) and asserts that the body contains a `record_audit_event` call. Adding a new Tier 1 RPC without the marker or without the audit call fails the test.
5. **Free-text fields in `metadata` are limited to admin-entered text.** Suspension reasons, denial reasons, and similar admin-entered strings are captured verbatim; visibility is gated by the row's scope (a tenant suspension reason is visible to the tenant owner and platform admin). End-user-provided free text (notes, descriptions) does not belong in `metadata` — it lives in entity-specific tables and is audited via those entities' change feeds, not via `audit_events`.
6. **GDPR redaction runs before user deletion.** Documented in the runbook entry that gets created with this feature; called out in the Supabase auth user-deletion playbook.
7. **`audit_writer` role is created once and never granted to a human.** Only `record_audit_event` and `redact_user_pii` are owned by it.

## Deferred follow-ups

These are not v1 but the spec explicitly leaves room for them:

| Follow-up | When | Cost to defer |
|---|---|---|
| Cold archival to R2 | When `audit_events` exceeds ~10M rows or query latency degrades | Low — BRIN index already prepared |
| Axiom mirror | When observability rollout lands | Low — single function change |
| Hash chain | If a customer or auditor explicitly asks for tamper evidence | Low-medium — additive columns + verifier; can backfill from current state |
| KMS row signing | Only if a regulated-data customer signs | Higher — operational dependency |
| Per-tenant retention policy | Only if a tenant requests shorter retention | Medium — needs purge RPC + scope-tagged retention table |
| Read event capture | If a customer brings PHI-adjacent data and HIPAA enters scope | High — fundamentally different volume model |
| Editorial-mutation unification | If the existing change-feed tables prove too fragmented | High — non-trivial migration of existing change capture |

## Testing

| Layer | Test |
|---|---|
| RLS | Existing cross-tenant isolation pattern (`whitelabel_isolation_smoke_tests.sql`) extended with audit rows: an agency owner cannot read another agency's audit; a tenant owner cannot read another tenant's audit; a space editor / viewer cannot read any audit row. |
| Capture coverage | Coverage test as described in Hard rules #4: every `-- @audit:tier1` RPC has a `record_audit_event` call. |
| Safety-net triggers | Bypass test: a service-role direct UPDATE on `tenant_members.role` (which would skip the RPC path) emits an event with `source = 'trigger'`. |
| Locked write path | Negative test: direct `INSERT INTO audit_events` as `service_role` raises `42501`. |
| GDPR redaction | After `redact_user_pii(p_user_id)`, every row that previously had that user as actor has `actor_email`, `actor_ip`, `actor_user_agent` set to NULL and `metadata` keys scrubbed. |
| Append-only | After any operation, an attempted `UPDATE` or `DELETE` on `audit_events` from `authenticated` or `service_role` raises a policy violation. |
| List RPC | A tenant owner calling `list_audit_events('agency', someAgencyId)` sees zero rows; calling `list_audit_events('tenant', ownTenantId)` sees their tenant's rows. |
| CSV export | A 10K-row export completes within p95 < 3s on a realistic dataset. |

## Migration plan

1. Migration: create `audit_writer` role, `audit_events` table + indexes, RLS policy, `is_tenant_owner_strict` helper, `record_audit_event`, `redact_user_pii`, `jsonb_strip_pii_keys`, `list_audit_events`, `export_audit_events_csv`. Revoke direct writes from `authenticated` and `service_role`.
2. Migration: install safety-net triggers on `platform_admins`, `tenant_members`, `agency_members`, `space_members`, `tenants.suspended_at`.
3. Code change: instrument every Tier 1 RPC with the `-- @audit:tier1` marker and a `record_audit_event` call. Capture in `audit.actor_role` GUC before calling.
4. Code change: add coverage test (Tier 1 RPC marker → audit call presence).
5. Frontend: build the four audit log pages (agency / tenant / space / super-admin), the shared `AuditLogTableComponent`, filter shape, and CSV export wiring.
6. Add a "GDPR redaction before deletion" entry to the runbook and the auth-user-deletion playbook.
7. Update `docs/runbook/08-authentication-security.md` to remove the "v2 deliverable" caveat for audit logging and add the audit log surface to the section.

## Open questions

None remaining from the brainstorm. The deferred items above are explicit punts, not open questions.
