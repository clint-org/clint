# Multi-Tenant Model

[Back to index](README.md)

---

## Hierarchy

```
Agency (Consultancy partner; optional)            e.g. ZS Associates -> zs.yourproduct.com
  +-- AgencyMembers (role: owner | member)
  +-- Tenants (Pharma client organizations)        e.g. Pfizer -> pfizer.yourproduct.com
        +-- TenantMembers (role: owner | member)
        +-- TenantInvites (7-day expiry invite codes; branded HTML email via Resend)
        +-- Spaces (Engagements / pipeline projects)
              +-- SpaceMembers (role: owner | editor | viewer)
              +-- Data (companies, products, trials, ...)
```

`tenants.agency_id` is nullable. Direct customers (no agency) live on the apex (`yourproduct.com`) or claim their own subdomain via tenant settings; they keep working unchanged from the pre-whitelabel design.

A user can be a member of multiple agencies AND multiple tenants directly.

## Roles & Permissions

| Role | Scope | Can Do |
|---|---|---|
| Agency Owner | Agency | Provision tenants, edit agency + tenant branding, invite agency members, full read+write on all tenants in the agency (equivalent to being a tenant owner on each) |
| Agency Member | Agency | Read-only across all tenants in the agency; view-only access to the agency portal |
| Tenant Owner | Tenant | Manage members, create spaces, manage invites, configure access (allowlist + self-join), full access to all spaces in the tenant |
| Tenant Member | Tenant | View tenant, join spaces; gets implicit editor/viewer space access via `has_space_access` |
| Space Owner | Space | Full CRUD on space data, manage space members |
| Space Editor | Space | Create/edit/delete data within the space |
| Space Viewer | Space | Read-only access to space data |
| Platform Admin | Global | Cross-cutting read access; writes only via super-admin RPCs |

`tenant_members.role` is constrained to `owner | member` — never `viewer`. Space-level read-only roles live on `space_members`.

Tenant owners automatically have access to all spaces within their tenant; agency owners get implicit access to all spaces in all tenants in their agency. Both are enforced by the `has_space_access()` function with disjuncts for tenant ownership, agency ownership (write-eligible), agency membership (read-only), and platform admin.

## Role-Access Matrix

| Actor | Tenant data SELECT | Tenant data WRITE | Tenant settings | Agency portal | Platform admin |
|---|---|---|---|---|---|
| Pharma user (tenant viewer/editor via space) | own space | scoped by space role | none | none | none |
| Pharma user (tenant owner) | own tenant | own tenant | own tenant | none | none |
| Agency member | all tenants in agency | none | none | view-only | none |
| Agency owner | all tenants in agency | all tenants in agency | all tenants in agency | full | none |
| Platform admin | all (read) | only via write RPCs | all (via super-admin) | all (read) | all |

Write access on tenant child tables (companies, products, trials, etc.) goes through `has_space_access(space_id, ['owner', 'editor'])` — agency *members* are not implicitly editors of child data, only agency *owners* are.

## Tenant Suspension

`tenants.suspended_at` is enforced, not informational. When set, `has_space_access` short-circuits to `false` for write-role checks. Read access continues so users can export their data and the UI can show a "this workspace is suspended" banner.

## Host-Based Tenant Resolution

Tenant identity is resolved from the host before Angular bootstraps. There is no per-request URL parameter for tenant/agency identity on subdomain installs — `BrandContextService.id()` is the source of truth. Legacy `/t/:tenantId/...` URLs still work for direct customers on the apex during the cutover window.

| Host | Resolves to | Source |
|---|---|---|
| `pfizer.yourproduct.com` | tenant | `tenants.subdomain` |
| `competitive.pfizer.com` | tenant | `tenants.custom_domain` |
| `zs.yourproduct.com` | agency | `agencies.subdomain` |
| `admin.yourproduct.com` | super-admin | reserved subdomain |
| `yourproduct.com` (apex) | default | marketing landing or legacy onboarding |

See [Architecture Overview](04-architecture-overview.md) for the full host-resolution flow.

## Auto-Provisioning (handle_new_user trigger)

The `handle_new_user` trigger on `auth.users` was retired during the whitelabel rollout (migration 41) and re-extended in migration 69 with one job: consume any pending `agency_invites` rows matching the new user's email. If a super-admin provisioned an agency to an email that had not yet signed in, the invite is held in `agency_invites`; on that user's first sign-in, the trigger promotes it to an `agency_members` `owner` row and marks the invite accepted. The trigger does not provision tenants or spaces — those stay opt-in. Tenant invites are unchanged: still code-based via `accept_invite(p_code)`.

For demo / testing, the `provision_demo_workspace()` SECURITY DEFINER RPC creates Boehringer Ingelheim + Azurity Pharmaceuticals on demand for the calling user (idempotent). The frontend exposes this via the `/provision-demo` route.

## Onboarding Flow

New users land on `/onboarding` after first sign-in (when not auto-routed by self-join or invite acceptance). Behavior depends on the host kind:

### Tenant subdomain (`kind = tenant`)

- `/onboarding?code=...` accepts an invite via `accept_invite()` and routes into the tenant
- If `brand.has_self_join` is true and the user's email matches the tenant's `email_domain_allowlist`, the auth callback short-circuits and calls `self_join_tenant(p_subdomain)` before navigating — user becomes a `tenant_members.role = 'member'` row
- The "create tenant" path is **not** offered on tenant subdomains — that flow is reserved for the apex

### Default host (`kind = default`, apex)

- Existing legacy onboarding: create a new tenant via `create_tenant()`, or join with an 8-character invite code
- Direct customers can opt into a subdomain later via tenant settings

### Agency subdomain (`kind = agency`)

- Lands on `/admin/tenants` after sign-in (handled by `agencyGuard` + the post-callback redirect)
- Agency owners provision new tenants from `/admin/tenants/new`

## Tenant Settings

The `TenantSettingsComponent` provides:

- **Organization branding**: logo upload (stored in `tenant-logos` Supabase storage bucket; owners can upload/delete, all members can read), display name, primary/accent color, email_from_name — all via `update_tenant_branding`
- **Access** (owners only): `email_domain_allowlist` chip editor + "Allow employees to self-join this workspace" toggle, persisted via `update_tenant_access`. Loaded via `get_tenant_access_settings` (auth-only — never returned to anon)
- **Members table**: lists all members with name, email, role; remove button per member (with confirmation)
- **Pending invites table**: shows invite code, email, role, expiration
- **Invite dialog**: email + role dropdown to generate new invite codes (triggers branded email via the `send-invite-email` Edge Function)

## Data Isolation

All data tables include a `space_id` column. RLS policies enforce that users can only access data in spaces where they (a) are explicit space members, (b) are owners or members of the parent tenant, (c) are owners of the parent tenant's parent agency, (d) are members of the parent tenant's parent agency (read-only), or (e) are platform admins (read-only). All other paths are denied.

There is no way to query across spaces or tenants — isolation is enforced at the database level, validated by the cross-tenant isolation smoke test in migration 24 of the foundation schema (`20260428042300_whitelabel_isolation_smoke_tests.sql`).
