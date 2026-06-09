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

- **Legal content model:** platform-owned documents, attributed to Clint (the
  platform operator), NOT brand-swapped in the legal body. The same Privacy
  Policy + Terms render on every host and plainly name "Clint" and describe its
  role (operator / sub-processor). Agencies are responsible for their own
  customer-facing legal docs off-platform. This is structure "A" from the
  whitelabel-responsibility analysis; the rejected "brand-filled template"
  (structure "C") would have authored legal commitments in a third party's name
  for text they never reviewed. Per-agency uploaded docs ("B") are a future
  feature, out of scope. Rationale: the agency layer is, for now, largely the
  platform owner operating under different brands, so platform-owned docs are
  both the safest and the most accurate.
- **Host-aware scope (clarified):** only the *chrome* is host-aware -- footer
  styling, brand logo, brand name in the footer copyright line, and page layout.
  The legal *text*, the named responsible entity, and the contact address are
  NOT brand-swapped; they are Clint's.
- **Contact:** no dedicated contact page or form. A footer `mailto:` only.
- **Contact email source:** a single static platform constant
  (`privacy@clintapp.com` for legal pages / footer). This removes the previously
  planned `get_brand_by_host` migration, the `Brand.contact_email` field, the
  `BrandContextService` / `brand-bootstrap` changes, and the `docs:arch` regen.
  There is no DB or migration work in this spec anymore.
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

### Why platform-owned docs (whitelabel responsibility)

In a whitelabel chain (platform owner -> agency -> pharma client), legal
responsibility splits by document and by data-protection role:

- **Terms of Service** are two separate contracts: platform owner <-> agency
  (yours) and agency <-> their end users (the agency's). You only own the first.
- **Privacy / data protection** follows controller vs processor roles: the
  pharma client is typically the controller, the agency a processor, and the
  platform a sub-processor. The customer-facing privacy policy belongs to the
  party the user perceives as running the service.

Three possible structures were considered:
- **A (chosen):** the platform publishes its own Privacy + Terms, attributed to
  Clint, rendered on every host. Safest and most accurate: you only ever speak
  for yourself. Fits the current reality that the agency layer is largely the
  platform owner under different brands.
- **B (future):** each agency supplies its own legal docs, shown on its
  subdomain. Correct for full third-party whitelabel; heavier (DB-backed +
  editor); the content and liability are the agency's. Out of scope.
- **C (rejected):** one template brand-swapped into the agency's name. Authors
  legal commitments in a third party's name for text they never reviewed. Muddy
  liability. Not built.

## Architecture

Five independent units. The footer and 404 read `BrandContextService` for
host-aware chrome; the legal pages use it only for surrounding chrome (logo /
footer), not for their body text. Units are otherwise uncoupled and can be
built/tested in isolation.

### 1. PublicFooterComponent
- Path: `src/client/src/app/shared/components/public-footer.component.ts`
- Standalone, `ChangeDetectionStrategy.OnPush`.
- Reads `BrandContextService`: `appDisplayName` (chrome only).
- Renders: `© {year} {appDisplayName}`, `Privacy` (`routerLink="/privacy"`),
  `Terms` (`routerLink="/terms"`), and a contact `mailto:` to the static
  platform constant `privacy@clintapp.com` (exported from a shared
  `legal-content.ts` so the footer and legal pages reference one value).
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
- `legal-content.ts` exports the section text as data plus the constants
  `PLATFORM_OPERATOR = 'Clint'`, `PLATFORM_LEGAL_EMAIL = 'privacy@clintapp.com'`,
  and `LAST_UPDATED`. The legal body names Clint as the operator/sub-processor;
  it is NOT brand-swapped to the host's display name.
- Host-aware chrome only: the surrounding page uses the brand logo/footer, but
  the document text reads as Clint's platform terms regardless of host.
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

### 4. Host-aware robots.txt (Worker)
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

### 5. SEO meta + OG image
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

- `public-footer.component.spec.ts`: renders brand name in the copyright line;
  renders the `privacy@clintapp.com` mailto and the Privacy/Terms links.
- `privacy-policy.component.spec.ts` / `terms-of-service.component.spec.ts`:
  the body names "Clint" as operator and renders the platform legal email; it is
  NOT brand-swapped (a non-default brand display name does not appear in the
  legal body).
- `not-found.component.spec.ts`: renders home + login links.
- `worker/robots.spec.ts` (Vitest, pure function): `buildRobots` returns the
  apex body for an apex host and `Disallow: /` for a subdomain host.

## Verification

- `cd src/client && ng lint && ng build`
- Worker/unit tests: `npm run test:units`
- (No migration in this spec, so no `supabase db advisors` / `docs:arch` regen.)
- Manual: load `/privacy`, `/terms`, an unknown path (404), and `/robots.txt`
  on apex vs a `?wl_kind=tenant&wl_id=<uuid>` dev override; eyeball `og-image.png`.

## Out of scope (YAGNI)

- Per-agency uploaded/editable legal docs + editor UI (structure "B").
- Contact form + email-sending backend.
- Sitemap.xml.
- Cookie-consent banner (separate follow-up if EU/UK consent is required).
- Per-subdomain OG cards (subdomains are not indexed/shared publicly).
