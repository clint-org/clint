---
id: spec-2026-whitelabel
title: Whitelabel platform for consulting partners
slug: whitelabel
status: draft
created: 2026-04-27
updated: 2026-04-27
---

# Whitelabel Platform for Consulting Partners

## Summary

Turn the existing Clinical Trial Status Dashboard into a whitelabel SaaS that consulting firms can resell to their pharma clients (B-style reseller) or deliver as a custom-branded internal tool to a single large pharma client (C-style embedded). Each pharma client becomes its own tenant, with its own subdomain, brand, and isolated data. Consulting firms get an "agency" portal where they self-serve provision new pharma client tenants. The platform is multi-tenant, hosted by us, and supports custom domains as a sales-led upgrade.

## Goals

- Sell to consulting firms as the buyer; pharma clients are the end-users.
- Each pharma client gets a subdomain (`pfizer.yourproduct.com`) and a fully-branded experience: tenant name, logo, favicon, primary color, branded login, branded invite emails, branded PPT exports.
- Consultancies (agencies) self-serve provision new pharma client tenants via an agency portal at their own subdomain (`zs.yourproduct.com`).
- Custom domains (`competitive.pfizer.com`) supported on a sales-led upgrade path with manual ops.
- Auth: Google + Microsoft OAuth. Optional per-tenant email-domain allowlist for self-join. Thin platform super-admin role for support and bootstrapping.
- Existing direct customers on the apex (`yourproduct.com`) keep working unchanged; they can opt into a subdomain via tenant settings.

## Non-Goals

- Per-tenant SAML/SSO configuration (deferred to enterprise tier).
- Per-tenant custom sender email domain (e.g., `noreply@pfizer.com`) -- platform-wide sender for v1.
- Self-hosted on-prem deployments for clients without infrastructure to run their own SaaS -- everyone hosts with us.
- Pure self-serve marketing-driven signup (sales-led for both agency and tenant onboarding in v1).
- Custom fonts, terminology overrides ("space" -> "engagement"), pre-seeded marker types, per-tenant feature flags (Tier-D customization deferred).
- Branded Supabase auth emails (welcome, password-reset, magic-link) -- generic copy stays for v1.
- Automated custom-domain provisioning -- v1 is a manual ops checklist via super-admin.
- Billing, invoicing, plan upgrades from the UI -- contracts are out-of-band.

---

## Architecture Overview

### Hierarchy

```
agencies                                      ZS Associates (zs.yourproduct.com)
  +-- agency_members (owner | member)         consultancy users with cross-tenant access
  +-- tenants                                 pharma clients (each with own subdomain + brand)
        +-- tenant_members (owner | editor | viewer)
        +-- spaces                            (existing)
              +-- space_members
              +-- data tables
```

- A tenant has at most one `agency_id` (nullable -- direct C-style deals have none).
- **Agency owners** get full access (read + write) to all tenants in their agency -- equivalent to being a tenant owner on each. **Agency members** get viewer-equivalent (read-only) access to all tenants in their agency. Mirrors the existing pattern where tenant owners get implicit access to all spaces.
- A user can be a member of multiple agencies AND multiple tenants directly.

### Host-based runtime resolution

Every request resolves the visitor's identity from the host header before bootstrap:

| Host | Kind | Effect |
|---|---|---|
| `pfizer.yourproduct.com` (matches `tenants.subdomain`) | `tenant` | Renders tenant app, branded with that tenant |
| `competitive.pfizer.com` (matches `tenants.custom_domain`) | `tenant` | Same, via custom domain |
| `zs.yourproduct.com` (matches `agencies.subdomain`) | `agency` | Renders agency portal, branded with that agency |
| `admin.yourproduct.com` | `super-admin` | Reserved subdomain, super-admin only |
| `yourproduct.com` (apex) | `default` | Marketing landing; or fallback for direct customers using legacy `/t/:tenantId/...` |

A single public RPC `get_brand_by_host(p_host)` returns a small public shape with the kind, brand fields, and auth provider list.

### Domain strategy

- Wildcard subdomain `*.yourproduct.com` on Netlify (Pro plan required).
- One canonical OAuth callback at `auth.yourproduct.com/callback` that bounces back to the originating host via the `state` parameter -- avoids per-host Azure/Google redirect URI configuration.
- Custom domains are a sales-led upgrade: customer adds a CNAME, ops adds the domain alias in Netlify, super-admin sets `tenants.custom_domain`.

---

## Data Model

### New tables

#### `agencies`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | varchar(255) | "ZS Associates" |
| slug | varchar(100) unique | URL-safe |
| subdomain | varchar(63) unique | DNS-safe; `^[a-z][a-z0-9-]{1,62}$` |
| logo_url | text nullable | |
| favicon_url | text nullable | |
| app_display_name | varchar(100) | Defaults to `name` |
| primary_color | varchar(7) default `'#0d9488'` | Hex |
| accent_color | varchar(7) nullable | Hex |
| contact_email | varchar(255) | |
| plan_tier | varchar(50) default `'starter'` | `starter` / `growth` / `enterprise` |
| max_tenants | int default 5 | 0 = unlimited |
| custom_domain | varchar(255) unique nullable | Set by super-admin (sales-led upgrade); matches `agencies.custom_domain` for host resolution |
| created_at, updated_at | timestamptz | |

#### `agency_members`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| agency_id | uuid FK -> agencies | |
| user_id | uuid FK -> auth.users | |
| role | varchar(20) | `owner` or `member` |
| created_at | timestamptz | |

Unique on `(agency_id, user_id)`.

#### `platform_admins`

| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK FK -> auth.users | |
| created_at | timestamptz | |

Not exposed via PostgREST. Managed via SQL only.

### Modified `tenants`

Add columns:

| Column | Type | Notes |
|---|---|---|
| agency_id | uuid nullable FK -> agencies | Null = direct customer |
| subdomain | varchar(63) unique nullable | Required for live tenants; null for legacy apex customers |
| custom_domain | varchar(255) unique nullable | Set by super-admin |
| app_display_name | varchar(100) | Defaults to `name` |
| primary_color | varchar(7) default `'#0d9488'` | |
| accent_color | varchar(7) nullable | |
| favicon_url | text nullable | |
| email_from_name | varchar(100) | Defaults to `app_display_name` |
| email_domain_allowlist | text[] nullable | When set, only these email domains can be invited or self-join |
| email_self_join_enabled | boolean default false | When true and user matches allowlist, auto-create membership |
| suspended_at | timestamptz nullable | Read-only mode for non-payment / abuse |

### Helpers

```sql
create function public.is_agency_member(p_agency_id uuid, p_roles text[] default null)
returns boolean as $$ ... $$ language sql security definer stable;

create function public.is_platform_admin()
returns boolean as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$ language sql security definer stable;
```

`has_space_access` and `is_tenant_member` get two new disjuncts:

- **Agency owner of the parent agency:** passes regardless of `p_roles` (full access, equivalent to tenant owner).
- **Agency member of the parent agency:** passes only when `p_roles is null` or `'viewer' = any(p_roles)` (read-only).
- **Platform admin:** passes regardless of `p_roles` for SELECT; for write checks, platform admins still must call write RPCs explicitly (RLS exception is read-only by design).

### RLS

- `agencies` SELECT: `is_agency_member(id) OR is_platform_admin()`.
- `agencies` UPDATE: `is_agency_member(id, ['owner']) OR is_platform_admin()`.
- `agencies` INSERT: denied directly; only via `provision_agency()` RPC (callable by platform admins).
- `agency_members` SELECT: `is_agency_member(agency_id) OR is_platform_admin()`.
- `agency_members` INSERT/UPDATE/DELETE: `is_agency_member(agency_id, ['owner']) OR is_platform_admin()`.
- `platform_admins`: not exposed via PostgREST.
- `tenants` SELECT: existing extended with `is_agency_member(agency_id) OR is_platform_admin()` (any agency member can see all tenants in their agency).
- `tenants` UPDATE: existing extended with `is_agency_member(agency_id, ['owner']) OR is_platform_admin()` (only agency owners can mutate tenants -- including branding -- not regular agency members).
- `tenants` INSERT: denied directly; only via `provision_tenant()` RPC.
- Tenant child tables (companies, products, trials, etc.) inherit the SELECT extension so agency members can read across all tenants in their agency. Write access on child tables continues to gate on `has_space_access(space_id, ['owner', 'editor'])` -- agency *members* are not implicitly editors of child data, only agency *owners* are (via the tenant-owner extension already in `has_space_access`).

### Indexes

- `tenants(subdomain)` unique partial where `subdomain is not null`.
- `tenants(custom_domain)` unique partial where `custom_domain is not null`.
- `agencies(subdomain)` unique.
- `agencies(custom_domain)` unique partial where `custom_domain is not null`.
- `tenants(agency_id)`.
- `agency_members(user_id)`.

### Cross-table host uniqueness

Per-table unique constraints don't prevent a tenant subdomain colliding with an agency subdomain (or any subdomain colliding with a custom domain). Enforce via two `BEFORE INSERT OR UPDATE` triggers (`enforce_subdomain_unique_across_tables`, `enforce_custom_domain_unique_across_tables`) on both `tenants` and `agencies` that raise if `NEW.subdomain` (or `NEW.custom_domain`) already exists in the *other* table. The reserved-list check stays in the RPCs.

### Backfill (single migration after column adds)

- For each existing tenant: `subdomain = slug`, `app_display_name = name`, `primary_color = '#0d9488'`, all other new columns null/default.
- All existing solo users keep working: `agency_id = null`, no agency portal needed.

---

## Backend RPCs

### Public (pre-auth)

**`get_brand_by_host(p_host text) returns jsonb`** -- SECURITY DEFINER, callable by `anon` + `authenticated`. Looks up `p_host` against `tenants.custom_domain`, `agencies.custom_domain`, `tenants.subdomain`, `agencies.subdomain` in that order (custom domains take priority over subdomain matches). Returns:

```json
{
  "kind": "tenant" | "agency" | "super-admin" | "default",
  "id": "uuid",
  "app_display_name": "...",
  "logo_url": "...",
  "favicon_url": "...",
  "primary_color": "#hhhhhh",
  "accent_color": null,
  "auth_providers": ["google", "microsoft"],
  "email_domain_allowlist": ["pfizer.com"] | null,
  "email_self_join_enabled": false,
  "suspended": false
}
```

If no match, returns `kind: "default"` with the Clint defaults. Never returns sensitive data.

### Authenticated

**`provision_tenant(p_agency_id uuid, p_name text, p_subdomain text, p_brand jsonb) returns jsonb`** -- SECURITY DEFINER. Caller must be agency owner or platform admin. Validates agency hasn't hit `max_tenants`, subdomain regex (`^[a-z][a-z0-9-]{1,62}$`), reserved-list collision, uniqueness across `tenants.subdomain` and `agencies.subdomain`. Creates the tenant, applies any branding fields from `p_brand`, creates one default space named `"Workspace"` so the tenant has somewhere to land on first login.

**`update_tenant_branding(p_tenant_id uuid, p_branding jsonb) returns jsonb`** -- SECURITY DEFINER. Caller must be tenant owner, agency owner of the parent agency, or platform admin. Validates color hex shape and URL shape. Accepts only branding fields: `app_display_name`, `logo_url`, `favicon_url`, `primary_color`, `accent_color`, `email_from_name`. Other tenant settings (`email_domain_allowlist`, `email_self_join_enabled`, `subdomain`, `custom_domain`, `agency_id`, `suspended_at`) are managed by separate RPCs or admin paths and rejected if present in `p_branding`.

**`update_tenant_access(p_tenant_id uuid, p_settings jsonb) returns jsonb`** -- SECURITY DEFINER. Caller must be tenant owner, agency owner of the parent agency, or platform admin. Accepts: `email_domain_allowlist`, `email_self_join_enabled`. Validates domain shape (`^[a-z0-9.-]+\.[a-z]{2,}$`).

**`update_agency_branding(p_agency_id uuid, p_branding jsonb) returns jsonb`** -- SECURITY DEFINER. Caller must be agency owner or platform admin. Accepts only branding fields (`app_display_name`, `logo_url`, `favicon_url`, `primary_color`, `accent_color`, `contact_email`). Subdomain / custom_domain / plan_tier / max_tenants are not editable here; they go through `provision_agency`, `register_custom_domain`, or platform-admin direct UPDATE on `agencies`.

**`check_subdomain_available(p_subdomain text) returns boolean`** -- callable by authenticated users. Checks `tenants.subdomain`, `agencies.subdomain`, reserved list.

**`provision_agency(p_name text, p_slug text, p_subdomain text, p_owner_user_id uuid) returns jsonb`** -- SECURITY DEFINER. Platform admins only. Callable from `psql` during the bootstrap window (phase 6) before the super-admin UI exists (phase 9).

**`register_custom_domain(p_tenant_id uuid, p_custom_domain text) returns jsonb`** -- SECURITY DEFINER. Platform admins only.

**`self_join_tenant(p_subdomain text) returns jsonb`** -- SECURITY DEFINER. When the calling user's email is in `email_domain_allowlist` for that tenant and `email_self_join_enabled = true`, creates a `tenant_members` row at `viewer` role. Atomic, idempotent.

### Reserved subdomain list

Hardcoded in `provision_tenant` / `provision_agency` validation:
`www`, `app`, `api`, `admin`, `auth`, `mail`, `support`, `status`, `docs`, `blog`, `help`, `cdn`, `static`, `assets`, `noreply`, `email`, `smtp`.

---

## Theme Resolution

### Bootstrap order (`main.ts`)

1. Read `window.location.host`.
2. `await supabase.rpc('get_brand_by_host', { p_host: host })`.
3. Synchronously apply side effects:
   - `document.title = brand.app_display_name`.
   - Swap `<link rel="icon">` href to `brand.favicon_url`.
   - Set CSS variables on `:root`: `--brand-primary`, `--brand-accent`, plus `--brand-50` ... `--brand-950` from a generated scale.
4. Build PrimeNG preset dynamically: `definePreset(Aura, { semantic: { primary: scale } })` + `usePreset()`.
5. `bootstrapApplication(AppComponent, ...)` with the brand provided via `BrandContext` service.

If the RPC fails, fall back to the static default theme. Never block bootstrap.

### Color scale generator

A small helper (`~30 lines`) generates a 50-950 scale from a single hex seed using the same algorithm Tailwind v4 uses. Tested against expected output for known seeds (teal, blue, indigo).

### Tailwind v4 theme

`styles.css` adds an `@theme` block:

```css
@theme {
  --color-brand-50: var(--brand-50, #f0fdfa);
  --color-brand-100: var(--brand-100, #ccfbf1);
  /* ... through 950 */
}
```

A codemod replaces `bg-teal-X`, `text-teal-X`, `border-teal-X`, `ring-teal-X`, and gradient utilities (`from/via/to-teal-X`) with `bg-brand-X` etc. across the client. Defaults match the current teal scale -- existing tenants render identically.

Slate, red, amber, green stay hard-coded -- these are *data* colors (markers, phase bars, status indicators) and are not tenant-configurable.

### PrimeNG preset

Refactor `src/client/src/app/config/primeng-theme.ts` so every direct `{teal.X}` reference becomes `{primary.X}` (the preset already maps `primary` to teal at the top -- propagate that one indirection consistently).

Replace the static default export with a `buildBrandPreset(primaryScale?: ColorScale)` function. When called without an argument, returns the existing preset (with the teal-derived primary scale). When called with a scale, returns the same preset structure but with `semantic.primary` overridden. All other customizations (form fields, dialog, button, select, datatable, toast, message) carry over unchanged. Callers: `app.config.ts` for the static default; `main.ts` bootstrap for the dynamic per-tenant preset.

---

## Frontend

### `BrandContext` service (`src/client/src/app/core/services/brand-context.service.ts`)

Signal-based holder for the brand record. Provides `kind()`, `appDisplayName()`, `logoUrl()`, `primaryColor()`, etc. Written once at bootstrap; `refresh()` re-fetches after a brand edit.

### Routing restructure

Routes become host-aware -- `tenantId` is implicit from the host on tenant subdomains.

**Tenant host** (`pfizer.yourproduct.com`, `kind = tenant`):
- `/` -> redirect to last space or space list
- `/spaces` -- space list
- `/s/:spaceId` -- dashboard
- `/s/:spaceId/manage/*` -- manage pages
- `/onboarding?code=...` -- accept invite (calls `accept_invite()`) or self-join via domain allowlist (calls `self_join_tenant()`). On a tenant subdomain, `/onboarding` does NOT offer "create tenant" -- that flow is reserved for the legacy apex `kind=default` host.
- `/settings` -- tenant settings (owners only)
- `/login` -- branded login

**Agency host** (`zs.yourproduct.com`, `kind = agency`):
- `/` -> redirect to `/admin/tenants`
- `/admin/tenants` -- list
- `/admin/tenants/new` -- provision wizard
- `/admin/tenants/:id` -- tenant detail + branding edit + member management
- `/admin/members` -- agency members
- `/admin/branding` -- agency portal's own brand
- `/admin/settings`
- `/login`

**Super-admin host** (`admin.yourproduct.com`, `kind = super-admin`):
- `/agencies`, `/agencies/:id`
- `/tenants`, `/tenants/:id`
- `/domains`

**Default host** (`yourproduct.com`, `kind = default`):
- `/` -- marketing landing (placeholder static page for v1)
- `/login` -- generic "go to your workspace" (subdomain input -> redirect)
- `/onboarding` -- existing create-tenant / join-by-code flow for legacy direct customers (preserved unchanged from today)
- Legacy `/t/:tenantId/...` routes remain functional as redirect shims for 90 days post-cutover.

### Cross-subdomain auth handoff

Sessions are scoped per host (Supabase JS uses localStorage). Tenant switcher flow:

1. Source page calls `supabase.auth.getSession()` to grab `access_token` + `refresh_token`.
2. Redirects to `https://gsk.yourproduct.com/#access_token=...&refresh_token=...&type=switch`.
3. Destination's `auth-handoff.guard.ts` runs first on every route. If `location.hash` includes an `access_token`, it parses the hash, calls `supabase.auth.setSession({...})`, scrubs the hash via `history.replaceState`, then proceeds. Otherwise it's a no-op.

Tokens go in the URL hash, not query string -- browsers do not include the hash in `Referer`. Tokens are short-lived (1h). Custom domains do not share session state with the apex; users sign in fresh on those.

### Branded login screen

Single component, reads from `BrandContext`. Renders:
- Tenant/agency logo and `app_display_name`.
- One button per provider in `brand.auth_providers` (Google, Microsoft).
- If `brand.email_domain_allowlist` is set: hint copy "Use your @pfizer.com email".
- Accept-invite path: `/onboarding?code=...` validates via `accept_invite()`; routes to login first if unauthed.

### Agency portal components

Under `src/client/src/app/features/agency/`:

| Component | Purpose |
|---|---|
| `agency-dashboard.component.ts` | Tenant list with key metrics (member count, last active, status) |
| `agency-tenant-list.component.ts` | Filterable table; row click -> tenant detail |
| `agency-tenant-new.component.ts` | Wizard: subdomain availability check (live), brand picker (logo upload, color), first-user invite |
| `agency-tenant-detail.component.ts` | View / edit branding, list / add tenant members, "Open tenant" button (cross-subdomain redirect) |
| `agency-members.component.ts` | Invite agency members, change roles |
| `agency-branding.component.ts` | Edit the agency portal's own brand |

`agency.guard.ts` ensures the kind is `agency` and the user is an agency member.

### Super-admin components

Under `src/client/src/app/features/super-admin/`. Intentionally minimal UI -- PrimeNG tables and plain forms. `super-admin.guard.ts` checks `is_platform_admin()`; non-admins get 404 (do not leak existence of the area).

---

## Auth Providers

### Microsoft OAuth

- Register an Azure AD app. Single redirect URI: `auth.yourproduct.com/callback`. Same canonical pattern for Google.
- Enable Microsoft provider in `supabase/config.toml`.
- Login screen renders a button when `microsoft` is in `brand.auth_providers`.
- State-based bounce-back: callback receives `state` containing the originating host; redirects user back there post-auth.

### Domain allowlist + self-join

- Tenant settings: "Allow @pfizer.com employees to self-join" toggle. When enabled, owner adds domain(s) to the allowlist.
- On login, after auth, check: is the user already a member of this tenant? If not, but their email matches the allowlist and `email_self_join_enabled = true`, call `self_join_tenant(p_subdomain)` and continue.
- New users created at `viewer` role by default; owners can promote in tenant member management.

### Platform super-admin

- Bootstrap: `INSERT INTO platform_admins (user_id) VALUES ('your-uuid')` via SQL.
- No UI to add platform admins; deliberately auditable via DB.

---

## Email

### Branded invite emails

Today, `tenantService.inviteMember()` creates a `tenant_invites` row with an 8-character code; there is no email delivery. Owners share the code manually. This phase adds delivery.

New Supabase Edge Function `supabase/functions/send-invite-email/index.ts`:

- **Trigger:** Supabase database webhook on `INSERT` into `tenant_invites` (configured in `supabase/config.toml`).
- **Logic:** Read tenant brand (`app_display_name`, `logo_url`, `email_from_name`, `primary_color`, `subdomain`/`custom_domain`). Compose HTML + plain-text. POST to Resend.
- **Template:** tenant logo, headline in `primary_color`, "Accept invite" button to `https://{subdomain}.yourproduct.com/onboarding?code={code}`, expiry notice.
- **Resend:** sender domain `noreply@yourproduct.com` (one DKIM/SPF setup, platform-wide). Per-tenant display name via `From: "Pfizer Trial Intel" <noreply@yourproduct.com>`.
- **Secrets:** `RESEND_API_KEY` in Supabase function secrets.
- **Idempotency:** accept duplicate sends on webhook retries; invite emails are not catastrophic to send twice.
- **Manual fallback:** the existing manual code-sharing flow stays functional -- agency owners can copy the invite code from tenant settings if email delivery fails or the recipient's mail server bounces.

### Built-in Supabase Auth emails

Welcome, password reset, magic link -- keep on Supabase defaults with generic "Sign in to your workspace" copy. With OAuth-only auth, these barely fire. Per-tenant branding is deferred.

---

## PPT Exports

`src/client/src/app/core/services/pptx-export.service.ts` (existing) is wired to `BrandContext`:

- **Title slide / cover:** tenant `logo_url` (downloaded as base64 once at slide build), `app_display_name` as title.
- **Section headers:** tinted with `brand.primary_color`.
- **Footer (every slide):** `app_display_name` left, page number right.
- **Table accents:** derived light tint of `primary_color` for header / alternate rows.
- **Data colors:** slate, red, amber, green (markers, phase bars) stay hard-coded -- these are part of the product's information design.
- **Failure mode:** if `logo_url` download fails, fall back to text-only header; never fail the export.

---

## Migration & Rollout

### Pre-work

- Wildcard DNS `*.yourproduct.com` -> Netlify (Pro plan).
- Apex `yourproduct.com` separately.
- Resend account + sender domain DKIM/SPF.
- Microsoft Azure AD app registration.
- Single canonical OAuth callback at `auth.yourproduct.com/callback`.
- Reserved subdomain list finalized in `provision_tenant`.
- Supabase database webhooks enabled in `config.toml` (required for `send-invite-email` Edge Function trigger).

### Implementation phases

| # | Phase | Disruptive? | Verification |
|---|---|---|---|
| 1 | Migrations: new tables, RLS, helpers; add brand columns to `tenants`; backfill. | No | `supabase db reset` clean; existing UI unchanged |
| 2 | Theme refactor: `primeng-theme.ts` uses `{primary.X}`; Tailwind `@theme --color-brand-*` tokens; codemod `bg/text/border/ring-teal-*` -> `*-brand-*`. | Visual risk | Pixel diff on key screens |
| 3 | `BrandContext` + pre-bootstrap host fetch + dynamic CSS vars + dynamic PrimeNG preset (color-scale generator). | No (defaults match teal) | Edit a test tenant's `primary_color`, hit subdomain, see new color |
| 4 | Host-aware routing restructure; `/t/:tenantId/...` -> `/s/:spaceId/...` shim with redirects; cross-subdomain auth handoff. | Routing churn | Existing bookmarks redirect cleanly |
| 5 | Microsoft OAuth + branded login screen reading from `BrandContext`. | No | Sign in via MS on staging |
| 6 | Agency portal: 6 components, `agency.guard`, `provision_tenant`, `check_subdomain_available`, `update_tenant_branding`, `update_agency_branding` RPCs. | New surface | End-to-end: provision a test agency via `psql` (`select provision_agency(...)`) since super-admin UI is phase 9 -> log in to agency portal -> provision tenant -> brand it -> invite user -> accept invite |
| 7 | Branded emails: Resend + Edge Function + DB webhook; stop using Supabase invite emails. | New external dependency | Test invite renders in Gmail, Outlook, iOS Mail |
| 8 | Branded PPT exports -- wire `BrandContext` into `pptx-export.service`. | No | Export from two tenants, diff |
| 9 | Super-admin app on `admin.yourproduct.com`: agencies / tenants / domains tables; bootstrap your `platform_admins` row via SQL. | New surface, gated | Provision a new agency without touching DB directly |
| 10 | Custom domain support: `register_custom_domain` RPC + super-admin UI; manual Netlify alias workflow documented. | No (sales-led) | Custom domain serves the right tenant |
| 11 | Domain allowlist + self-join: tenant settings UI, `self_join_tenant` RPC, login flow handling. | New behavior, opt-in | Enable on a test tenant, fresh user signs in, gets membership |
| 12 | Marketing landing on apex; existing direct customers keep apex working with `kind=default`; nudge them to claim a subdomain via tenant settings. | Optional | Direct customers unaffected |

### Risk register

| Risk | Mitigation |
|---|---|
| Subdomain squatting on internal/reserved names | Validation in `provision_tenant` against the reserved list |
| Color-scale generator produces ugly tints for some seeds | Live preview in the brand editor; constrained algorithm (Tailwind v4's same math) |
| Cross-subdomain auth handoff leaks tokens via `Referer` | Hash, not query string -- not sent in `Referer`. Short-lived tokens. Document. |
| Microsoft Azure redirect URI explosion | Single canonical `auth.yourproduct.com/callback` with state-based bounce-back |
| PPT export logo download fails | Catch + use text fallback; never fail the whole export |
| Existing customers' shared links break | 301 redirects from `/t/:tenantId/...` to new tenant subdomain; shim for 90 days |
| Resend emails marked spam in pharma corporate inboxes | Warm up sender; document deliverability runbook; allow customers to allowlist |
| Tenant brand changes don't propagate to logged-in users (cached preset) | `BrandContext.refresh()` on save; eventual consistency for other users |
| Wildcard DNS / Netlify cost surprises | Confirm Netlify Pro plan and pricing before phase 1 |
| Subdomain claim race between agencies | Unique constraint on `tenants.subdomain` + `agencies.subdomain` enforced in DB |

### Verification checkpoints

- After phase 1: existing app fully works; only DB has new columns.
- After phase 3: a staging tenant with non-default `primary_color` renders correctly.
- After phase 6: a brand-new agency can self-serve provision a pharma client tenant end-to-end.
- After phase 9: you (platform admin) can provision a new agency without writing SQL.
- After phase 11: a sample pharma deal can sign up via domain allowlist self-join.

---

## Open Questions

None -- all decisions resolved during brainstorming.
