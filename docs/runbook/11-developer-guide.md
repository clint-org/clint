# Developer Guide

[Back to index](README.md)

---

## Prerequisites

- Node.js (LTS)
- Angular CLI 19: `npm install -g @angular/cli`
- Supabase CLI: `npm install -g supabase`
- Docker (for local Supabase)

## Initial Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd clint-v2

# 2. Install frontend dependencies
cd src/client
npm install

# 3. Start local Supabase stack
cd ../../
supabase start
# -> outputs local API URL and anon key

# 4. Configure environment
# Edit src/client/src/environments/environment.ts:
export const environment = {
  production: false,
  supabaseUrl: 'http://localhost:54321',
  supabaseAnonKey: '<anon-key-from-supabase-start>'
};

# 5. Start the dev server
cd src/client
ng serve
# -> http://localhost:4200
```

## Supabase Local Config

`supabase/config.toml` configures:
- **Ports**: API 54321, DB 54322, Studio 54323, Inbucket 54324
- **Auth**: Google OAuth enabled, email signup enabled (confirmations disabled), JWT expiry 3600s, refresh token rotation enabled
- **Migrations**: Auto-run on `supabase start`
- **Seed**: Runs `./seed.sql` after migrations

## Database Commands

```bash
supabase start            # Start local Postgres + Auth stack
supabase stop             # Stop local stack
supabase db reset         # Re-apply all migrations + seed.sql (clean rebuild)
supabase migration new <name>  # Create a new empty migration file
supabase db push          # Push local migrations to remote Supabase project
```

## Adding a Database Migration

1. Create the file: `supabase migration new <short_description>`
   - This creates `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`
2. Write your SQL in the new file
3. Apply it locally: `supabase db reset` (full rebuild) or restart
4. **Never edit an existing migration** -- always create a new one
5. Follow the SQL style guide in `docs/supabase-guides/sql-style-guide.md`

## Supabase SQL Guidelines

Four reference guides in `docs/supabase-guides/`:
- **database-rls-policies.md** -- USING/WITH CHECK syntax, role-based access patterns, performance tips
- **database-functions.md** -- SECURITY INVOKER default, set search_path, typed parameters, trigger examples
- **database-create-migration.md** -- File naming, destructive command comments, RLS requirements
- **sql-style-guide.md** -- snake_case naming, plural table names, query formatting, CTE conventions

## Frontend Development

```bash
cd src/client
ng serve            # Dev server at localhost:4200 (hot reload)
ng build            # Production build -> dist/client/browser/
ng lint             # ESLint
npm run lint        # ESLint + scripts/check-no-banana-ngmodel.sh (see Forms)
ng test             # Unit tests
```

## Adding a New Feature

1. **Create a migration** if database changes are needed
2. **Add/update models** in `src/app/core/models/`
3. **Add/update services** in `src/app/core/services/`
4. **Create feature components** in `src/app/features/<feature-name>/`
5. **Register the route** in `app.routes.ts` using `loadComponent`
6. Follow the Angular conventions: standalone, `inject()`, signals, new control flow, inline templates

## Forms (signal-only pattern)

Two-way `[(ngModel)]` is **not** allowed for new form fields. Bind one-way to a signal instead:

```ts
readonly email = signal('');

readonly canSubmit = computed(() => EMAIL_RE.test(this.email()));
```

```html
<input [ngModel]="email()" (ngModelChange)="email.set($event)" />
```

**Why:** `[(ngModel)]` writes to a plain class property. Plain properties are invisible to Angular's signal reactivity — any `computed()` that reads the property never re-evaluates when the user types, leaving Save/Submit buttons stuck at their initial value. Hit four times in this codebase before the rule was added. `scripts/check-no-banana-ngmodel.sh` (run by `npm run lint`) flags any `[(ngModel)]` in `src/`. Soft mode by default; flip to hard mode with `CHECK_NGMODEL_HARD=1` once the legacy files listed in the warning are migrated.

### Required fields and constraint errors

For every field that maps to a `NOT NULL` or FK column, do all three:

1. **Visual + a11y.** Render an asterisk via `<app-form-field [required]="true">` (or, for inline-template forms, an inline `<span aria-hidden="true" class="text-red-600">*</span>` next to the label). On the input itself, set `[attr.aria-required]="true"`.
2. **Block submit.** Expose a `canSubmit` getter or `computed()` that ANDs every required field, then bind it to the submit button's `disabled`. `FormActionsComponent` exposes a `[disabled]` input for the standard Cancel/Save pair; inline `<p-button>` instances bind `[disabled]="!canSubmit"` directly. The form's `onSubmit` should also short-circuit on `if (!canSubmit) return;` so Enter-key submits stay consistent.
3. **Map DB errors as defense-in-depth.** Wrap the catch with `extractConstraintMessage` from `src/app/core/util/db-error.ts`. Pass a per-form column→label map (e.g. `{ product_id: 'Product', therapeutic_area_id: 'Therapeutic area' }`). The helper recognizes Postgres `23502` (NOT NULL) and `23503` (FK) and returns `"<Field> is required."`; fall through to the form's existing generic copy when it returns null. Catches future schema changes that add NOT NULL columns the client doesn't yet know about, and stale-FK picks (e.g. a deleted parent row).

Surface the resulting message in the existing in-form `<p-message severity="error">` banner — banners are reserved for in-dialog validation; transient action errors elsewhere should toast (see follow-ups #1).

## PrimeNG Usage

Import PrimeNG modules directly in component `imports` arrays:

```typescript
@Component({
  standalone: true,
  imports: [ButtonModule, TableModule, DialogModule, InputTextModule],
  ...
})
```

Use PrimeNG form components over native HTML:
- `pInputText` for text inputs
- `p-select` for dropdowns
- `p-colorpicker` for color selection
- `p-checkbox` for checkboxes
- `p-inputnumber` for numeric inputs
- `pTextarea` for textareas

The theme preset (`config/primeng-theme.ts`) is brand-aware. It exports `buildBrandPreset(scale?: BrandScale)` — called with no arg, returns the default teal-derived preset; called with a scale, overrides `semantic.primary`. All component overrides reference `{primary.X}` (never `{teal.X}`) so the override propagates.

## Theme Conventions

The app is whitelabel — primary color is per-tenant at runtime. There are three layers:

- **CSS variables on `:root`.** `main.ts` sets `--brand-50` … `--brand-950` from `generateBrandScale(brand.primary_color)` before bootstrapping Angular.
- **Tailwind brand-* utilities.** `styles.css` declares `@theme { --color-brand-50: var(--brand-50, #f0fdfa); ... }`. Use `bg-brand-*`, `text-brand-*`, `border-brand-*`, `ring-brand-*`, `from-brand-*`, `via-brand-*`, `to-brand-*` (and the rest of the tailwind color modifiers). Never use `bg-teal-*` or any literal teal class — that pins to the platform default.
- **`BrandContextService`.** Inject when you need the brand fields directly (logo URL, app display name, primary color, kind, has_self_join, suspended). Read via `brand.appDisplayName()`, `brand.logoUrl()`, etc. — all signals.

Slate, red, amber, green, cyan, violet remain hard-coded. Those are *data* colors (markers, phase bars, status indicators) and are not tenant-configurable. The codemod that swept the codebase during the rollout intentionally left them alone.

## Dev Brand Override

In non-production builds, `main.ts` honors a query-string override so you can smoke-test agency / super-admin / tenant flows on `localhost:4200` without DNS:

```
http://localhost:4200/?wl_kind=agency&wl_id=<agency-uuid>
http://localhost:4200/?wl_kind=tenant&wl_id=<tenant-uuid>
http://localhost:4200/?wl_kind=super-admin
```

When the param is present, `fetchBrand()` short-circuits to a synthetic `Brand` and skips the `get_brand_by_host` RPC. `kind === 'super-admin'` does NOT auto-elevate platform-admin status — you still need a real `platform_admins` row. The override only changes brand resolution.

For super-admin specifically, the override is no longer required: the RPC recognizes any `admin.<anything>` host (e.g. `admin.localhost:4200`) and returns `kind: "super-admin"` natively. The override remains useful for agency / tenant kinds where you want to point at a real DB row without DNS.

## Platform Admin Bootstrap

`platform_admins` is not exposed via PostgREST. There is no UI to add platform admins. To bootstrap yourself locally:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  INSERT INTO public.platform_admins (user_id) VALUES ('<your-auth-uid>')
  ON CONFLICT DO NOTHING;
"
```

Find your auth uid by signing in once, then:

```sql
SELECT id, email FROM auth.users ORDER BY created_at DESC LIMIT 5;
```

For production, run the same INSERT against the remote database via the Supabase SQL editor or `supabase db remote sql ...`.

## Membership Tables Reference

There are three membership tables. Pay attention to the role constraints:

| Table | Roles | Purpose |
|---|---|---|
| `agency_members` | `owner` \| `member` | Cross-tenant access. Owners do all writes and provisioning; members get read-only across the agency's tenants |
| `tenant_members` | `owner` \| `member` (NOT `viewer`) | Tenant-level membership. Tenant members get implicit editor/viewer space access via `has_space_access` |
| `space_members` | `owner` \| `editor` \| `viewer` | Per-space role. Where `viewer` actually lives. Explicit space rows take precedence over implicit tenant-member access |

If you find yourself wanting to write `tenant_members.role = 'viewer'`, use `space_members.role = 'viewer'` instead, and add the user to `tenant_members` at `member` role.

## Adding a New SECURITY DEFINER RPC

Pattern reference: `supabase/migrations/20260428021559_security_fixes_invites_and_tenant_quota.sql` (`accept_invite()` is the canonical example). Every whitelabel RPC follows this pattern.

Required:

- `language plpgsql` (or `language sql` for read-only helpers)
- `security definer`
- `set search_path = ''` (prevents schema-resolution attacks)
- All object references fully-qualified (`public.tenants`, `auth.uid()`, never bare `tenants`)
- First-line auth check: `if auth.uid() is null then raise exception 'Must be authenticated' using errcode = '28000'; end if;` (skip only for intentionally anon-callable RPCs like `get_brand_by_host` and `check_subdomain_available`)
- Authorization via helper functions (`is_agency_member`, `is_tenant_member`, `has_space_access`, `is_platform_admin`) — never trust caller-supplied IDs without DB verification
- Specific error codes: `28000` (auth), `42501` (permission), `P0001`/`P0002` (state), `53400` (quota), `23505` (uniqueness)
- Permissions: `revoke execute ... from public; revoke ... from anon; grant execute ... to authenticated;` (or `to anon` only when explicitly intended)
- A `comment on function` documenting purpose + SECURITY DEFINER rationale

## Reserved Subdomain List Maintenance

The reserved-subdomain blocklist lives inline in `provision_tenant` and `provision_agency`. Current entries:

```
www app api admin auth mail support status docs blog help cdn static assets noreply email smtp
```

If you add a new operational subdomain (e.g. `metrics`, `api-v2`, `cdn-eu`) anywhere — DNS, Cloudflare Worker custom domains, marketing, anything — you MUST add it to the reserved list in both `provision_tenant` and `provision_agency` via a new migration. Without this, a tenant could register the same subdomain and host a phishing page that reads authenticated cookies (apex-scoped session storage means all `*.<apex>` subdomains share the session).

## Extending the change feed

The change feed pipeline is: CT.gov snapshot -> `_compute_field_diffs` (jsonb path diff) -> `_classify_change` (turns each diff into a typed event row) -> `change_events` -> RPCs (`get_activity_feed`, `get_trial_activity`, `get_marker_history`) -> Angular row components.

### Adding a new event type

1. Add the JSON path to the `_compute_field_diffs` watch list in `supabase/migrations/20260502120400_ctgov_helper_functions.sql`. Modify in a follow-up migration that drops + recreates the helper -- never edit an applied migration.
2. Add the case to `_classify_change` with the new `event_type` string and a payload builder that extracts the before/after values into the event's `payload jsonb`.
3. Update the `ChangeEventType` union in `src/client/src/app/core/models/change-event.model.ts`.
4. Add `iconFor` / `summaryFor` cases in `src/client/src/app/shared/components/change-event-row/change-event-row.component.ts` and `src/client/src/app/shared/utils/change-event-summary.ts` so the row renders.
5. Backfill historical events: `select recompute_trial_change_events(trial_id)` for any trial whose history should pick up the new event. Snapshots are the source of truth; no CT.gov re-poll required.

### Adding a new CT.gov field to the catalogue

1. Add an entry to `CTGOV_FIELD_CATALOGUE` in `src/client/src/app/core/models/ctgov-field.model.ts` (key, label, category, surfaces it can appear on).
2. Per-space owners can then add it to any surface via `/t/:tenantId/s/:spaceId/settings/fields`. No migration needed -- the catalogue is the registry; per-space `ctgov_field_visibility` rows reference its keys.

### Worker secret rotation

See `08-authentication-security.md`'s "Worker secret model" section.

### Manual backfill

`POST /admin/ctgov-backfill` on the Worker with `{nct_ids: ["NCT01234567", ...]}` and a platform-admin JWT. Pulls fresh snapshots for the listed NCTs and re-runs the diff/classify pipeline. Used by the trial-detail "Sync from CT.gov" button (scoped to one NCT) and by ops when a bulk re-poll is needed.

## Verification

```bash
cd src/client
ng lint && ng build
```

Both must pass before committing.

## Environment Configuration

The app uses Supabase environment variables defined in `src/environments/environment.ts`. For production, these are baked into the build via Angular's environment system. The production environment points to the hosted Supabase project.

| Field | Dev default | Prod | Purpose |
|---|---|---|---|
| `supabaseUrl` | local emulator URL | hosted Supabase URL | API target |
| `supabaseAnonKey` | local anon key | hosted anon key | Anon JWT |
| `apexDomain` | `''` (empty = disable cookie session storage; localStorage path) | `'yourproduct.com'` (e.g.) | Enables `Domain=.<apex>` cookie storage when current host is on the apex; required for cross-subdomain auth in production |
