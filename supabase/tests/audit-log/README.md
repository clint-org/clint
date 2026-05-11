# audit-log SQL tests

Integration tests for the compliance-grade audit log feature introduced in:

- `20260510000100_audit_events_table.sql`
- `20260510000200_is_tenant_owner_strict.sql`
- `20260510000300_audit_events_rls.sql`
- `20260510000400_record_audit_event.sql`
- `20260510000500_redact_user_pii.sql`
- `20260510000600_list_audit_events.sql`
- `20260510000700_audit_safety_net_triggers.sql`
- `20260510001000_audit_instrument_provision.sql`
- `20260510001100_audit_instrument_branding.sql`
- `20260510001200_audit_instrument_access.sql`
- `20260510001300_audit_instrument_invites.sql`
- `20260510001400_audit_instrument_spaces.sql`
- `20260510001500_audit_instrument_domains.sql`

Spec: `docs/superpowers/specs/2026-05-10-audit-log-design.md`

## Running

Run the full suite (requires local Supabase to be running via `supabase start`):

```bash
./supabase/tests/audit-log/run.sh
```

Run a single file directly:

```bash
docker exec -i supabase_db_clint-v2 \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/audit-log/05_rls_strict_scope.sql
```

## What each test asserts

| File | Asserts |
|---|---|
| `01_schema_integrity.sql` | Table exists, all 7 indexes present, `audit_writer` role exists, RLS enabled, strict-scope SELECT policy exists, 6 required functions present |
| `02_tier1_coverage.sql` | At least 11 functions tagged `@audit:tier1` in `public` schema; every tagged function contains a `record_audit_event()` call |
| `03_locked_write_path.sql` | Direct INSERT/UPDATE/DELETE on `audit_events` denied for both `authenticated` and `service_role`; `record_audit_event()` succeeds as the sanctioned write path |
| `04_record_audit_event.sql` | Return value is a UUID; row appears with correct action, source, rpc_name, resource_type; `actor_user_id` captured from `request.jwt.claim.sub`; `audit.suppress_trigger` GUC set to returned id |
| `05_rls_strict_scope.sql` | All 7 visibility invariants: tenant owner sees own rows but not another tenant's; agency owner sees agency rows but not tenant rows (strict scope, no cascade); space owner sees space rows; space editor sees zero rows; platform admin sees all rows |
| `06_safety_net_triggers.sql` | Direct writes to `tenant_members` (INSERT, UPDATE role, DELETE), `platform_admins` (INSERT), and `tenants.suspended_at` (NULL to timestamp) each produce a trigger-sourced audit event |
| `07_rpc_emission_provision.sql` | `provision_agency` emits `agency.provision` with correct scope and metadata; `provision_tenant` emits `tenant.provision` with correct scope and metadata |
| `08_rpc_emission_branding.sql` | `update_tenant_branding` emits `tenant.branding_updated` with `metadata.changed_fields` listing only submitted fields; `update_agency_branding` emits `agency.branding_updated` similarly |
| `09_rpc_emission_invites.sql` | Direct INSERT into `tenant_invites` fires `tenant_invite.issued` trigger; direct INSERT into `space_invites` fires `space_invite.issued` trigger; metadata verified for both |
| `10_gdpr_redaction.sql` | `redact_user_pii` is platform-admin only (non-admin raises 42501); PII columns nulled; metadata PII keys scrubbed; action/resource columns preserved; `compliance.user_pii_redacted` event emitted |
| `11_list_audit_events.sql` | Platform scope returns all rows; tenant scope returns only that tenant's rows; cross-tenant call returns zero (RLS); `p_action` filter narrows correctly; `p_actor_user_id` filter narrows correctly |
| `12_export_audit_events_csv.sql` | Return is non-empty; first line matches expected column header; data row count matches seeded count |

## Synthetic data

Unlike the intelligence-history tests, the audit-log suite does not depend on demo seed data. Each test file creates its own users, agencies, tenants, spaces, and audit events using predictable UUID prefixes (e.g., file 05 uses `05050505-...`, file 11 uses `11eeeeee-...`). Tests clean up all synthetic rows at the end of each `do $$` block and are safely re-runnable after any `supabase db reset`.

The `clint.member_guard_cascade='on'` GUC pattern is used when deleting from `space_members` and `tenant_members` to bypass the last-owner guard trigger.
