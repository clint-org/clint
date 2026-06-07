# Host-aware public site pages (footer, legal, 404, robots, SEO)

Status: approved (design), pending implementation
Date: 2026-06-06
Author: brainstorming session

## Problem

Clint's public surface is a single marketing landing page plus login/auth. It is
missing the standard "regular website" furniture that a paid, multi-tenant B2B
pharma product is expected to have:

- No footer (and therefore nowhere for legal/contact links to live).
- No privacy policy or terms of service. This is a real procurement/legal gap:
  the app sets cross-subdomain auth cookies and loads Cloudflare Insights, so it
  processes personal data, and pharma client security reviews will ask for these.
- No cookie/contact affordance.
- No custom 404 (the wildcard route silently redirects everything to home).
- No `robots.txt`, so search engines could index tenant workspaces and leak the
  client list.
- Stale SEO meta: `<title>` still reads "Clinical Trial Dashboard", and there are
  no description / Open Graph / Twitter tags, so shared links render as bare URLs.

Everything must be **host-aware**: the app is a whitelabel platform
(agency -> tenant -> space) where brand resolution already happens pre-bootstrap
via `get_brand_by_host` and `BrandContextService`.

## Decisions (locked)

- **Legal content model:** one platform-authored template, brand-filled. Same
  legal text on every host; only the brand name, logo, operator reference, and
  contact email swap per host. No DB-stored per-agency legal text, no editor UI
  (YAGNI for now). Caveat recorded below.
- **Contact:** no dedicated contact page or form. A footer `mailto:` only,
  resolved per host.
- **Contact email source:** host-aware. Extend `get_brand_by_host` to project a
  `contact_email` (the agency's existing `contact_email` for agency/tenant hosts;
  null on apex/super-admin), surfaced through the `Brand` model +
  `BrandContextService`. Footer falls back to a platform constant
  (`support@clintapp.com`) when null.
- **robots.txt:** host-aware, served by the Worker. Apex (marketing) host allows
  indexing but disallows app/auth paths; every subdomain returns
  `Disallow: /` so client workspaces are never indexed.
- **Sitemap:** skipped. Low value for an auth-gated app.
- **SEO meta:** fix `index.html` static tags (title, description, OG, Twitter)
  to Clint platform-marketing defaults; these are the crawler/apex fallback.
- **OG image:** generated from the existing logo + brand design (not AI imagery,
  which is off-brand). Composed as HTML, rendered to PNG via the project's
  Chromium at `deviceScaleFactor: 2` (output 2400x1260). HTML source kept in repo
  for reproducibility.
- **Footer placement:** public/unauthenticated surface only (marketing landing,
  login, legal pages, 404). The authenticated app shell keeps its existing
  internal footer; the data-dense app chrome is left untouched.

### Legal caveat (not legal advice)

The generated privacy policy and terms of service are a generic, reasonable
starting template. They are not legal advice and have not been reviewed by
counsel. The product owner must have qualified legal review before relying on
them. This caveat lives in the spec, not on the live page.

## Architecture

Six independent units. They share `BrandContextService` for host-aware values but
otherwise have no coupling and can be built/tested in isolation.

### 1. PublicFooterComponent
- Path: `src/client/src/app/shared/components/public-footer.component.ts`
- Standalone, `ChangeDetectionStrategy.OnPush`.
- Reads `BrandContextService`: `appDisplayName`, `contactEmail` (new).
- Renders: `© {year} {appDisplayName}`, `Privacy` (`routerLink="/privacy"`),
  `Terms` (`routerLink="/terms"`), and a contact `mailto:` using
  `contactEmail() ?? 'support@clintapp.com'`.
- Year: a static constant computed at build/run is fine; use
  `new Date().getFullYear()` is disallowed in some contexts but is fine in a
  component (not in workflow scripts). Acceptable here.
- Styling: slate tokens, thin top border, mono uppercase tracked link labels,
  no decoration. Brand-utility classes only (`text-brand-*`), never `text-teal-*`.
- a11y: `<footer>` landmark, visible focus on links.

### 2. Legal pages
- Paths:
  - `src/client/src/app/features/legal/privacy-policy.component.ts`
  - `src/client/src/app/features/legal/terms-of-service.component.ts`
  - `src/client/src/app/features/legal/legal-content.ts` (shared section text +
    interpolation helper; single source of truth, mirrors the help-page pattern)
- Routes: top-level `/privacy` and `/terms`, available on every host.
- `legal-content.ts` exports the templated sections as data; each component
  interpolates `{brandName}` (from `appDisplayName`), the platform operator
  name ("Clint"), `{contactEmail}`, and a `LAST_UPDATED` constant date.
- Page shape mirrors existing help pages: header + summary + section list +
  back link, with `PublicFooterComponent` at the bottom.

### 3. NotFoundComponent
- Path: `src/client/src/app/features/not-found/not-found.component.ts`
- Replaces `{ path: '**', redirectTo: '' }` in `app.routes.ts` with
  `{ path: '**', loadComponent: ... }`.
- Renders brand logo/name (via `BrandContextService` + existing
  `BrandLogoComponent`), "Page not found", links to home and `/login`, plus the
  footer.
- Note: SPA fallback (`not_found_handling: single-page-application`) already
  serves `index.html` for unknown paths; Angular's wildcard then renders this.

### 4. Contact email plumbing (DB + model)
- Migration: recreate `public.get_brand_by_host(text)` to add `contact_email` to
  the returned JSON. Source it from `agencies.contact_email`:
  - tenant brand: the tenant's agency's `contact_email`
  - agency brand: that agency's `contact_email`
  - super-admin / default: null
- The RPC is anon-callable and read-only (NOT a Tier-1 audit RPC), so no
  `record_audit_event` / `@audit:tier1` marker needed.
- End the migration with `notify pgrst, 'reload schema';` (per project rule:
  PostgREST reload after RPC signature change) and keep the in-migration smoke
  consistent.
- Update `Brand` model (`brand.model.ts`): add `contact_email: string | null`.
- Update `DEFAULT_BRAND` and `BrandContextService`: add `contactEmail` computed.
- Update `brand-bootstrap.ts`: parse `contact_email` from the RPC response.
- Run `npm run docs:arch` after the migration (regenerates the RPC->table matrix
  and schema docs) and commit the regen in the same change set.

### 5. Host-aware robots.txt (Worker)
- File: `src/client/worker/index.ts`.
- Add a handler before the `env.ASSETS.fetch` fallback:
  - `if (url.pathname === '/robots.txt')` -> `text/plain` response.
  - Determine apex vs subdomain: host is an apex if it exactly equals one of
    `env.ALLOWED_APEXES` (comma-split). Otherwise treat as a subdomain.
  - Apex body: allow crawl of marketing, `Disallow: /login`, `/auth`, `/app`,
    `/admin`, `/super-admin`. (No `Sitemap:` line; none exists.)
  - Subdomain body: `User-agent: *\nDisallow: /`.
- New file `src/client/worker/robots.ts` holding a pure
  `buildRobots(host, apexes): string` so it is unit-testable without a Request.

### 6. SEO meta + OG image
- `src/client/src/index.html`: set `<title>` to
  "Clint: Competitive intelligence for pharma" (em dash is banned in our content,
  so use a colon/hyphen, never an em dash), add `meta name="description"`,
  `og:title`, `og:description`,
  `og:type`, `og:image` (absolute URL `https://clintapp.com/og-image.png`),
  `og:url`, and `twitter:card=summary_large_image` + twitter title/description/
  image.
- `main.ts` already overrides `document.title`/favicon per-brand at runtime; the
  static tags are the crawler/apex fallback and are intentionally Clint-branded.
- OG image generation:
  - Source HTML: `src/client/scripts/og-image/og-image.html` (inline logo SVG,
    brand tokens, "CLINT" wordmark, "COMPETITIVE INTELLIGENCE FOR PHARMA" mono
    uppercase tagline, thin teal accent rule, slate-50/white background, no
    gradients/illustrations per brand guide).
  - Render script: `src/client/scripts/og-image/render.mjs` using the installed
    Chromium (`playwright`), viewport 1200x630, `deviceScaleFactor: 2`, PNG,
    output `src/client/public/og-image.png` (2400x1260 physical).
  - Add an npm script (e.g. `og:image`) so the banner is regenerable.

## Testing (Vitest, inline per task)

Each unit ships its spec in the same change set (project rule: tests paired with
each task, never deferred to a phase):

- `public-footer.component.spec.ts`: renders brand name; renders contact mailto
  with agency email when present; falls back to `support@clintapp.com` when null.
- `privacy-policy.component.spec.ts` / `terms-of-service.component.spec.ts`:
  brand-name interpolation appears; contact email rendered.
- `not-found.component.spec.ts`: renders home + login links.
- `worker/robots.spec.ts` (Vitest, pure function): `buildRobots` returns the
  apex body for an apex host and `Disallow: /` for a subdomain host.
- `brand-bootstrap.spec.ts`: extend to assert `contact_email` is parsed into the
  Brand (and defaults to null when absent).

## Verification

- `cd src/client && ng lint && ng build`
- Worker/unit tests: `npm run test:units`
- `supabase db advisors --local --type all` after the migration
- `npm run docs:arch` regen committed
- Manual: load `/privacy`, `/terms`, an unknown path (404), and `/robots.txt`
  on apex vs a `?wl_kind=tenant&wl_id=<uuid>` dev override; eyeball `og-image.png`.

## Out of scope (YAGNI)

- Per-agency editable legal text + editor UI.
- Contact form + email-sending backend.
- Sitemap.xml.
- Cookie-consent banner (separate follow-up if EU/UK consent is required).
- Per-subdomain OG cards (subdomains are not indexed/shared publicly).
