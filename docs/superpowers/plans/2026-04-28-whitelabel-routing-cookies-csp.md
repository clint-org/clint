# Whitelabel Routing + Cookies + CSP Implementation Plan

> Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the routing skeletons for agency-host (`/admin/*`) and super-admin-host (`/super-admin/*`) experiences; switch Supabase JS to cookie-based session storage with a configurable apex domain (so prod subdomain installs share auth); ship a Content-Security-Policy header from Netlify.

**Scope contract:**
- **Existing `/t/:tenantId/*` routes are preserved unchanged.** No URL simplification in this plan.
- New empty placeholder components for `/admin` and `/super-admin` (real UI in plans 6 + 9).
- Auth callback respects `BrandContext.kind()` to route post-login: agency host → `/admin`; super-admin host → `/super-admin`; default/tenant host → existing onboarding flow.
- Cookie session storage is enabled only when `WL_APEX_DOMAIN` env var is non-empty AND `window.location.host` ends with `.<WL_APEX_DOMAIN>`. Otherwise default localStorage. Means: dev `localhost:4200` keeps localStorage; prod `pfizer.yourproduct.com` uses cookies with `Domain=.yourproduct.com`.
- CSP header on every Netlify response: `default-src 'self'`, `connect-src 'self' https://*.supabase.co wss://*.supabase.co`, `script-src 'self' 'unsafe-inline'` (Angular build inlines critical bootstrap), `frame-ancestors 'none'`, `style-src 'self' 'unsafe-inline'`. Conservative; loosen if specific integrations break.

**Tech:** Angular 19, Supabase JS 2.49, Netlify config.

---

### Task 1: Add `WL_APEX_DOMAIN` to environment files

**Files:**
- Modify: `src/client/src/environments/environment.ts`
- Modify: `src/client/src/environments/environment.development.ts`

Add an `apexDomain` field. In dev, set to `''` (empty = disabled). In prod, set to `''` for now (will be filled in once user provisions DNS — for now, stays empty so behavior is identical to current localStorage).

- [ ] **Step 1:** Open both env files. Add `apexDomain: ''` (string) field.
- [ ] **Step 2:** `cd src/client && npx ng build` succeeds.
- [ ] **Step 3:** Commit `feat(env): add apexDomain config (empty default disables cookie-storage)`.

---

### Task 2: Cookie session storage adapter

**Files:**
- Create: `src/client/src/app/core/util/cookie-session-storage.ts`
- Modify: `src/client/src/app/core/services/supabase.service.ts`

Implement a minimal cookie-storage adapter that conforms to Supabase JS `SupportedStorage`:

```typescript
// cookie-session-storage.ts
export interface CookieStorageOptions {
  domain?: string;   // e.g. ".yourproduct.com" or undefined for current host only
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAgeSeconds: number;
}

export function createCookieStorage(options: CookieStorageOptions) {
  return {
    getItem(key: string): string | null {
      const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + escapeRe(key) + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    },
    setItem(key: string, value: string): void {
      const parts: string[] = [
        `${key}=${encodeURIComponent(value)}`,
        `Max-Age=${options.maxAgeSeconds}`,
        `Path=${options.path}`,
        `SameSite=${capitalize(options.sameSite)}`,
      ];
      if (options.domain) parts.push(`Domain=${options.domain}`);
      if (options.secure) parts.push('Secure');
      document.cookie = parts.join('; ');
    },
    removeItem(key: string): void {
      const parts: string[] = [
        `${key}=`,
        'Max-Age=0',
        `Path=${options.path}`,
      ];
      if (options.domain) parts.push(`Domain=${options.domain}`);
      document.cookie = parts.join('; ');
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
```

Then in `supabase.service.ts`, conditionally wire it up:

```typescript
import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { createCookieStorage } from '../util/cookie-session-storage';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly supabase: SupabaseClient;
  readonly currentUser = signal<User | null>(null);
  readonly session = signal<Session | null>(null);
  private sessionReady: Promise<void>;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: this.buildAuthConfig(),
    });
    this.sessionReady = this.supabase.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
      this.currentUser.set(data.session?.user ?? null);
    });
    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
      this.currentUser.set(session?.user ?? null);
    });
  }

  private buildAuthConfig() {
    const apex = environment.apexDomain;
    if (!apex) {
      // Default behavior: localStorage. Used in dev (localhost) and any time no apex is configured.
      return undefined;
    }
    const host = window.location.host;
    // Only use cookies when the current host is on the apex (e.g. tenant.yourproduct.com matches yourproduct.com).
    // Custom domains (acme.competitive.com) won't end with .yourproduct.com -> falls back to localStorage.
    const onApex = host === apex || host.endsWith('.' + apex);
    if (!onApex) return undefined;
    return {
      storage: createCookieStorage({
        domain: '.' + apex,
        secure: window.location.protocol === 'https:',
        sameSite: 'lax' as const,
        path: '/',
        maxAgeSeconds: 60 * 60 * 24 * 30, // 30d, refresh-token-bound
      }),
      storageKey: 'sb-auth',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    };
  }

  // ... rest unchanged: waitForSession, get client, signInWithGoogle, signOut
}
```

- [ ] **Step 1:** Create `cookie-session-storage.ts`.
- [ ] **Step 2:** Modify `supabase.service.ts` to conditionally use it. Preserve the existing public API (`waitForSession`, `client`, `signInWithGoogle`, `signOut`, `currentUser`, `session`).
- [ ] **Step 3:** `cd src/client && npx ng build` — success.
- [ ] **Step 4:** Sanity check in dev: `npx ng serve`, sign in, refresh page → still signed in (uses localStorage path because `apexDomain` is empty).
- [ ] **Step 5:** Commit `feat(auth): cookie session storage when apexDomain is configured`.

---

### Task 3: Placeholder routes for `/admin/*` and `/super-admin/*`

**Files:**
- Create: `src/client/src/app/features/agency/agency-placeholder.component.ts`
- Create: `src/client/src/app/features/super-admin/super-admin-placeholder.component.ts`
- Create: `src/client/src/app/core/guards/agency.guard.ts`
- Create: `src/client/src/app/core/guards/super-admin.guard.ts`
- Modify: `src/client/src/app/app.routes.ts`

**Placeholder components** are minimal — they just render a "coming soon" panel and verify the guard runs. Real components land in plans 6 and 9.

```typescript
// agency-placeholder.component.ts
import { Component, inject } from '@angular/core';
import { BrandContextService } from '../../core/services/brand-context.service';

@Component({
  selector: 'app-agency-placeholder',
  standalone: true,
  template: `
    <div class="p-8">
      <h1 class="text-xl font-semibold text-slate-900">{{ brand.appDisplayName() }} agency portal</h1>
      <p class="mt-2 text-sm text-slate-600">Agency portal coming in plan 6.</p>
    </div>
  `,
})
export class AgencyPlaceholderComponent {
  protected readonly brand = inject(BrandContextService);
}
```

```typescript
// super-admin-placeholder.component.ts (same shape; "Super-admin portal coming in plan 9")
```

**Guards** check `BrandContext.kind()`. Non-matching kind → 404 (return `false` and redirect to `/`).

```typescript
// agency.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BrandContextService } from '../services/brand-context.service';

export const agencyGuard: CanActivateFn = () => {
  const brand = inject(BrandContextService);
  const router = inject(Router);
  if (brand.kind() !== 'agency') {
    return router.createUrlTree(['/']);
  }
  return true;
};
```

```typescript
// super-admin.guard.ts (same shape; checks kind === 'super-admin')
```

**Routes** add these at the top of the children array:

```typescript
// app.routes.ts (additions)
{
  path: 'admin',
  canActivate: [agencyGuard, authGuard],
  loadComponent: () =>
    import('./features/agency/agency-placeholder.component').then((m) => m.AgencyPlaceholderComponent),
},
{
  path: 'super-admin',
  canActivate: [superAdminGuard, authGuard],
  loadComponent: () =>
    import('./features/super-admin/super-admin-placeholder.component').then(
      (m) => m.SuperAdminPlaceholderComponent
    ),
},
```

- [ ] **Step 1:** Create both placeholder components and both guards.
- [ ] **Step 2:** Add the two new top-level routes to `app.routes.ts`.
- [ ] **Step 3:** `cd src/client && npx ng build` succeeds.
- [ ] **Step 4:** Commit `feat(routing): /admin and /super-admin placeholder routes gated by host kind`.

---

### Task 4: Auth callback redirects based on `BrandContext.kind()`

**Files:**
- Modify: `src/client/src/app/features/auth/auth-callback.component.ts`

After OAuth callback, currently the app routes to `/onboarding` (or last tenant). Update to consult `BrandContext.kind()`:

- `kind === 'agency'` → `/admin`
- `kind === 'super-admin'` → `/super-admin`
- `kind === 'tenant'` → existing flow (probably `/t/:tenantId/...` based on tenant id in brand)
- `kind === 'default'` → existing flow (onboarding redirect guard)

For `kind === 'tenant'`, the brand record has `id` (tenant uuid). Route to `/t/{id}/spaces` (the existing space-list route within that tenant).

**Read the existing `auth-callback.component.ts`** before editing. Match its style. Don't break the existing default-host flow.

- [ ] **Step 1:** Read existing file. Identify the post-callback navigation logic.
- [ ] **Step 2:** Inject `BrandContextService`. Switch on `brand.kind()` to choose the redirect target.
- [ ] **Step 3:** `cd src/client && npx ng build` succeeds.
- [ ] **Step 4:** Sanity: in dev (`localhost`, `kind === 'default'`), the existing flow is unchanged.
- [ ] **Step 5:** Commit `feat(auth): post-callback redirect honors brand.kind()`.

---

### Task 5: CSP header in Netlify

**Files:**
- Modify: `netlify.toml`

Add a Content-Security-Policy line under the existing `[[headers]]` block. Conservative starting policy:

```toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Content-Security-Policy = "default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https: blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
```

`'unsafe-inline'` for `script-src` is required by Angular's bootstrap inline scripts. `'unsafe-inline'` for `style-src` covers PrimeNG runtime styles. `img-src` allows tenant logos hosted on Supabase Storage public URLs (which can be on a different domain). `connect-src` allows the Supabase REST/realtime endpoints. Adjust if a future integration breaks.

- [ ] **Step 1:** Edit `netlify.toml`, append `Content-Security-Policy` value.
- [ ] **Step 2:** Commit `feat(netlify): add Content-Security-Policy header`.
- [ ] **Step 3:** Note: cannot test CSP locally without deploying. The build doesn't change. Defer in-browser verification to first deploy.

---

### Task 6: Final verification

- [ ] **Step 1:** `cd src/client && npx ng lint` — no new errors (pre-existing OK).
- [ ] **Step 2:** `cd src/client && npx ng build` — succeeds.
- [ ] **Step 3:** Smoke in dev: app loads, login works (Google OAuth still functional), navigating to `/admin` or `/super-admin` shows the placeholder when `BrandContext.kind()` matches; on default host, redirects to `/`.
- [ ] **Step 4:** No final commit needed; previous task commits constitute the plan.

---

## Out of scope (deferred)

- `/s/:spaceId/*` URL simplification (existing `/t/:tenantId/*` paths preserved)
- Microsoft OAuth (plan 5)
- Cross-host tenant switcher (plan 12 polish)
- Real agency portal UI (plan 6)
- Real super-admin UI (plan 9)
- Verifying CSP doesn't break PrimeNG/PptxGenJS runtime (defer until first prod deploy; user can adjust as needed)

## What ships when this plan merges

- App still works exactly as before in dev (apexDomain empty → localStorage path).
- When user later sets `apexDomain` to e.g. `'yourproduct.com'`, cookie storage automatically activates on prod subdomain hosts.
- New `/admin` and `/super-admin` paths exist but only render their guards' redirects in dev (kind='default'); on actual agency/super-admin hosts they'd render the placeholder panel.
- CSP header ships in production.
