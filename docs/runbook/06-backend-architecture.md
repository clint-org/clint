# Backend Architecture

[Back to index](README.md)

---

The backend is managed by Supabase. The only non-database server-side code is one Edge Function (`send-invite-email`).

## Supabase Services Used

| Service | Purpose |
|---|---|
| PostgreSQL 15 | Primary data store for all application data |
| PostgREST | Auto-generated REST API from the Postgres schema; used for CRUD operations |
| Supabase Auth | JWT-based auth with Google + Microsoft (Azure AD) OAuth providers; 1-hour JWT expiry with refresh token rotation |
| Supabase Edge Functions (Deno) | `send-invite-email` only — triggered by a database webhook on `tenant_invites` INSERT; calls Resend |
| Supabase Database Webhooks | Configured in the dashboard (cannot be expressed in `config.toml`); shared-secret `webhook-signature` header gates the function |
| Supabase JS 2.49 | Client library used by Angular to call all backend APIs |

## Database Functions (RPCs)

### get_dashboard_data

```
get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[],
  p_product_ids uuid[],
  p_therapeutic_area_ids uuid[],
  p_start_year int,
  p_end_year int,
  p_recruitment_statuses text[],
  p_study_types text[],
  p_phases text[]
)
```

The single most important function. Accepts a space ID and optional filter arrays, and returns a single nested JSON object:

```json
{
  "companies": [
    {
      "id": "...", "name": "...", "color": "...",
      "products": [
        {
          "id": "...", "name": "...",
          "trials": [
            {
              "id": "...", "name": "...",
              "therapeutic_area": { "name": "...", "abbreviation": "..." },
              "recruitment_status": "...", "study_type": "...", "phase": "...",
              "phases": [{ "phase_type": "...", "start_date": "...", "end_date": "..." }],
              "markers": [{ "event_date": "...", "marker_type": { "shape": "...", "color": "..." } }],
              "notes": [{ "content": "..." }]
            }
          ]
        }
      ]
    }
  ]
}
```

This eliminates N+1 query problems. The entire dashboard renders from a single RPC call. Uses `SECURITY INVOKER` so RLS policies apply to the calling user.

### create_tenant

```
create_tenant(p_name text, p_slug text) -> uuid
```

Creates a new tenant record and adds the calling user as the owner in `tenant_members` in a single transaction. Uses `SECURITY DEFINER` to bypass RLS bootstrapping issues.

### create_space

```
create_space(p_tenant_id uuid, p_name text, p_description text) -> uuid
```

Creates a new space and adds the calling user as the space owner. Verifies the caller is a member of the parent tenant before creation. Uses `SECURITY DEFINER`.

### seed_demo_data

```
seed_demo_data(p_space_id uuid)
```

Populates a space with pharmaceutical demo data -- companies (AstraZeneca, Eli Lilly, Novo Nordisk, etc.), products (Farxiga, Jardiance, Mounjaro, Ozempic), therapeutic areas, 8+ trials with phases and markers, and 20 events covering all entity levels, categories, threads, links, sources, and priorities. Idempotent (checks if user already has companies).

### has_space_access

```
has_space_access(p_space_id uuid, p_roles text[]) -> boolean
```

Helper function used in RLS policies. Rewritten in migration 75 to be **explicit-only** -- no implicit cascade from tenant or agency level. Returns true if the calling user is:
- An explicit `space_members` row at one of the given roles, OR
- A platform admin (read-only -- writes still go through write RPCs)

Tenant owners and agency owners get NO implicit space access. To see space data they must be added to that space explicitly. This is the firewall between engagements: a Stout consultant on the Pfizer space does not see Boehringer's data just because Stout owns both tenants.

Short-circuits to `false` for write-role checks when `tenants.suspended_at IS NOT NULL` (suspended-tenant enforcement).

### is_tenant_member

```
is_tenant_member(p_tenant_id uuid, p_roles text[]) -> boolean
```

Helper for tenant-level RLS. Returns true if the calling user has the specified role in the tenant, OR is an agency owner of the parent agency, OR is a platform admin.

### is_agency_member

```
is_agency_member(p_agency_id uuid, p_roles text[] default null) -> boolean
```

Helper for agency-level RLS. Returns true if the calling user is in `agency_members` for `p_agency_id` with one of the given roles (or any role when `p_roles` is null).

### is_platform_admin

```
is_platform_admin() -> boolean
```

Returns true if `auth.uid()` is in `platform_admins`. Used in RLS disjuncts and as a permission gate in super-admin RPCs.

## Whitelabel RPCs

All whitelabel RPCs follow the project's SECURITY DEFINER convention modeled on `accept_invite()` (migration 39): `set search_path = ''`, fully-qualified object references, `if auth.uid() is null then raise exception ... '28000'` first-line auth check, helper-function authorization (no inline `auth.uid() = ...` against tenancy), specific error codes (`28000` auth, `42501` permission, `P0001` state, `23505` uniqueness), `revoke ... from public, anon` + `grant ... to authenticated` (or `to anon` only for `get_brand_by_host` and `check_subdomain_available`).

### get_brand_by_host

```
get_brand_by_host(p_host text) -> jsonb
```

**Anon-callable.** Looks up `p_host` against `tenants.custom_domain`, `agencies.custom_domain`, the reserved `admin.<anything>` subdomain (returns `kind: "super-admin"` — requires the host to have at least two segments so bare `admin` doesn't match), `tenants.subdomain`, `agencies.subdomain` in that order (custom domains take priority over the magic admin subdomain). Returns a public-safe shape: `kind`, `id`, `app_display_name`, `logo_url`, `favicon_url`, `primary_color`, `auth_providers[]`, `has_self_join` (boolean — never the actual allowlist), `suspended`, `agency` (`{name, logo_url} | null`, populated only for tenant brands whose `tenants.agency_id` is set). Returns `kind: "default"` with Clint defaults if no match.

The `agency` field exists so the tenant-host login footer and the in-app topbar can show "Competitive intelligence by {agency}" attribution — the value prop is that the consultancy is the analyst behind the workspace, even though the chrome inside the app stays tenant-branded. Only `name` + `logo_url` are surfaced (no contact_email, no member counts); both are already public on the agency's own subdomain, so no new disclosure.

### check_subdomain_available

```
check_subdomain_available(p_subdomain text) -> boolean
```

Authenticated. Checks `tenants.subdomain`, `agencies.subdomain`, the reserved-subdomain list, and the active-hold portion of `retired_hostnames`. Used by the agency portal's debounced live-availability indicator.

### provision_agency

```
provision_agency(p_name text, p_slug text, p_subdomain text, p_owner_email text, p_contact_email text default null) -> jsonb
```

**Platform admins only.** Creates an `agencies` row. If `p_owner_email` matches an existing `auth.users` row (case-insensitive), the owner is added directly to `agency_members`. Otherwise an `agency_invites` row is held with `role='owner'`; the existing `handle_new_user` trigger consumes it on the owner's first sign-in. `contact_email` defaults to `p_owner_email` when not supplied (the column is `NOT NULL` and an arbitrary placeholder leaks into the branding page). Validates email shape, subdomain regex (`^[a-z][a-z0-9-]{1,62}$`), reserved-list, cross-table uniqueness, retired-hostname holdback. Returns `owner_invited: boolean` so the caller can distinguish the two paths. Callable from `psql` during phase-6 bootstrap and from the super-admin portal.

### delete_agency

```
delete_agency(p_agency_id uuid) -> jsonb
```

**Platform admins only.** Deletes an agency; cascades to `agency_members` and `agency_invites` via existing FK `on delete cascade`. Refuses with `foreign_key_violation` if any `tenants` rows still reference the agency (`tenants.agency_id` is `on delete set null` by design — the RPC blocks rather than silently orphan customer data). **Does not skip the `retired_hostnames` holdback** — the AFTER DELETE trigger on `agencies` runs in the same transaction and inserts the subdomain into the holdback list. To re-use the subdomain immediately, follow up with `release_retired_hostname()`. Returns `members_removed` and `invites_removed` counts.

### release_retired_hostname

```
release_retired_hostname(p_hostname text) -> jsonb
```

**Platform admins only.** Deletes the named hostname from `retired_hostnames` so it can be re-claimed immediately. Override path for super-admin cleanup; raises `P0002` if the hostname isn't in the holdback list (so typos don't silently no-op). Real customer decommissions should leave the 90-day holdback in place to prevent takeover via stale session cookies and bookmarked links.

### provision_tenant

```
provision_tenant(p_agency_id uuid, p_name text, p_subdomain text, p_brand jsonb) -> jsonb
```

Caller must be agency owner of `p_agency_id` or platform admin. Validates `agencies.max_tenants` quota, subdomain regex/reserved/uniqueness/retirement, applies branding fields from `p_brand`. Creates one default space named "Workspace" so the tenant has somewhere to land on first login. **Auto-adds the calling user as both tenant owner and space owner** so the agency operator who provisions a tenant can immediately see and manage it without needing a separate add-self step.

### add_tenant_owner

```
add_tenant_owner(p_tenant_id uuid, p_email text) -> jsonb
```

Adds an existing user as tenant owner, or holds an invite when the email has no `auth.users` row. Caller must be tenant owner, agency owner of the parent agency, or platform admin. When `agencies.email_domain` is set, `p_email`'s domain must match (platform admin bypass). Returns `{ owner_invited: boolean, ... }` so the UI can distinguish "added directly" from "code-based invite held". The invite is consumed via `accept_invite(p_code)` after the recipient signs in. **Idempotent (since 2026-04-30):** if a valid (unaccepted, unexpired) `tenant_invites` row already exists for the same `(tenant_id, email)`, the existing `invite_code` is returned — repeated clicks do not mint new credentials.

### invite_to_space

```
invite_to_space(p_space_id uuid, p_email text, p_role text) -> jsonb
```

Adds or invites a user to a space at `owner | editor | viewer` (rendered Owner / Contributor / Reader in the UI). Caller must be a space owner (or platform admin). Existing users get an immediate `space_members` row (or role-update on conflict); unknown emails get a `space_invites` row consumed via `accept_space_invite(p_code)`. **No domain restriction** -- spaces include both agency colleagues and pharma client emails. **Idempotent (since 2026-04-30):** if a valid (unaccepted, unexpired) `space_invites` row already exists for the same `(space_id, email, role)`, the existing `invite_code` is returned.

### accept_space_invite

```
accept_space_invite(p_code text) -> jsonb
```

Atomically validates and consumes a space invite. Validates the code, expiry, unused state, and that the invite email matches the caller's authenticated email. Inserts the `space_members` row and marks the invite consumed. Returns `{ id, name, tenant_id }` so the UI can route to `/t/:tenantId/s/:spaceId`. SECURITY DEFINER so callers don't need direct read access to `space_invites`.

### update_tenant_branding

```
update_tenant_branding(p_tenant_id uuid, p_branding jsonb) -> jsonb
```

Caller must be tenant owner, agency owner of the parent agency, or platform admin. Whitelist of fields: `app_display_name`, `logo_url`, `favicon_url`, `primary_color`, `email_from_name`. Validates color hex shape and URL shape. Other fields (subdomain, custom_domain, agency_id, suspension, allowlist) are managed by separate RPCs and rejected if present.

### update_tenant_access

```
update_tenant_access(p_tenant_id uuid, p_settings jsonb) -> jsonb
```

Caller must be tenant owner, agency owner of the parent agency, or platform admin. Accepts `email_domain_allowlist` and `email_self_join_enabled`. Validates each domain against `^[a-z0-9.-]+\.[a-z]{2,}$`.

### get_tenant_access_settings

```
get_tenant_access_settings(p_tenant_id uuid) -> jsonb
```

Authenticated read of the allowlist for tenant settings UI. Caller must be tenant owner, agency owner, or platform admin. Returns `email_domain_allowlist` + `email_self_join_enabled`. Separate from `get_brand_by_host` because the allowlist must never reach anon.

### update_agency_branding

```
update_agency_branding(p_agency_id uuid, p_branding jsonb) -> jsonb
```

Caller must be agency owner or platform admin. Whitelist of fields: `app_display_name`, `logo_url`, `favicon_url`, `primary_color`, `contact_email`. Subdomain / custom_domain / plan_tier / max_tenants are not editable here.

### register_custom_domain

```
register_custom_domain(p_tenant_id uuid, p_custom_domain text) -> jsonb
```

**Platform admins only.** Sets `tenants.custom_domain`. Validates uniqueness across `tenants.custom_domain` and `agencies.custom_domain`, plus retirement holdback. Manual ops checklist required first (Cloudflare Worker custom-domain registration on the customer's hostname + the customer's CNAME pointing at the Worker).

### self_join_tenant

```
self_join_tenant(p_subdomain text) -> jsonb
```

When the calling user's email domain is in `email_domain_allowlist` for that tenant and `email_self_join_enabled = true`, creates a `tenant_members` row at `member` role. Atomic, idempotent. **Returns the same generic error message for all failure modes** ("self-join not available for this workspace") — distinguishing between "tenant doesn't exist," "self-join is off," "your email domain isn't allowed," and "the tenant is suspended" would let an attacker enumerate which subdomains exist and which corporate emails unlock them. Internally logs the actual reason for support diagnostics via `raise notice`.

### lookup_user_by_email

```
lookup_user_by_email(p_email text) -> jsonb
```

Caller must be a platform admin OR own at least one agency. Returns `{ found: true, user_id, display_name }` if the email matches an `auth.users` row, else `{ found: false }`. Used by the agency portal "Add member" dialog and the super-admin "Provision agency" dialog. Never raises on missing email — returns `found: false` so the UX can show a clean "not found" message.

### is_agency_member, is_platform_admin

See "Helpers" above.

## Views

### space_members_view

Joins `space_members` with `auth.users` metadata to expose display name (from `raw_user_meta_data->full_name` or email) and email alongside membership records. Owner-defined view (`security_invoker = true` was dropped in migration 40 to allow reading `auth.users`); access is gated inside the view body via `has_space_access()`.

### tenant_members_view

Same pattern for tenant membership.

### agency_members_view

Joins `agency_members` with `auth.users` for the agency portal members table. Mirrors `tenant_members_view` shape but uses `SECURITY INVOKER` — RLS on `agency_members` is the access control. `grant select on public.agency_members_view to authenticated`.

## Edge Functions

### send-invite-email (`supabase/functions/send-invite-email/index.ts`)

Deno-runtime handler triggered by a Supabase database webhook on `INSERT` into `public.tenant_invites`. Delivers branded HTML + plain-text invite emails via Resend.

**Flow:**
1. Reject non-POST with 405
2. Compare the `webhook-signature` header to `EMAIL_WEBHOOK_SECRET` (length-then-equality); missing or wrong → 401 (no detail leak)
3. Parse Supabase webhook payload `{ type: "INSERT", table: "tenant_invites", record: { ... } }`
4. Service-role select on `public.tenants` for the tenant's brand columns (`app_display_name`, `logo_url`, `email_from_name`, `primary_color`, `subdomain`, `custom_domain`)
5. Build accept URL, preferring custom domain over subdomain over apex; always with `?code=<invite_code>`
6. Compose HTML + plain-text bodies (inline styles, brand color for the headline + button)
7. POST to `https://api.resend.com/emails` with `from: "Pfizer Trial Intel" <noreply@yourproduct.com>`, `to`, `subject`, `html`, `text`
8. On success → 200 `{ sent: true, id: <resend-id> }`. Logs minimal trace; never logs the recipient address or invite code (PII minimization)

**Required secrets** (`supabase secrets set`): `RESEND_API_KEY`, `EMAIL_WEBHOOK_SECRET`, `EMAIL_FROM` (defaults to `noreply@yourproduct.com`), `EMAIL_BASE_URL` (defaults to `https://yourproduct.com`). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the Supabase runtime.

**Idempotency:** the function accepts duplicate sends on webhook retries; sending an invite twice is acceptable for v1.

**Local emulator:** the Supabase local emulator does not support the dashboard's database-webhook configuration 1:1, so local invite flows continue to surface the invite code in the UI. The email path is exercised in the remote project. See `docs/runbook/12-deployment.md` for the production setup checklist.
