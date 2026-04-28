# Clint -- Competitive Intelligence for Pharma

## Tech Stack
- **Frontend:** Angular 19 (standalone components, no SSR) with PrimeNG + Tailwind CSS v4, deployed to Netlify
- **Backend:** Supabase (Auth, Database)
- **Database:** PostgreSQL via Supabase
- **Auth:** Google OAuth via Supabase Auth

## Design Context

`docs/brand.md` is the authoritative brand guide. This section is the short form that should shape every design decision.

### Product positioning
**Competitive intelligence for pharma.** The product covers pipeline intelligence, catalyst tracking, clinical trial timelines, and portfolio analysis -- the four cuts that pharma CI professionals use most. Sub-disciplines it serves: pipeline intelligence, asset/scientific intelligence, catalyst tracking, portfolio intelligence, early signal analysis.

### Users
Pharma competitive intelligence professionals and the teams they support -- business development, strategy, portfolio, licensing, and executive leadership. They review dozens of trials, catalysts, and pipelines across multiple companies under time pressure and make high-stakes investment, licensing, and partnership calls based on what they see. Context is dense, adversarial, and institutional -- the tool sits alongside Bloomberg Terminal, Evaluate Pharma, and Citeline in their workflow. Job to be done: extract the competitive read on a drug program in seconds, with enough certainty to act on it.

### Brand Personality
**Precise. Authoritative. Premium.** The interface should feel like a serious analytical instrument built by people who understand clinical data -- closer to a medical journal or a regulatory document than a consumer SaaS product. Emotional goals: confidence in the data, institutional authority, efficiency without clutter. Voice is terse and factual; there is no playfulness, no cheerleading, no emoji.

### Aesthetic Direction
- **Visual tone:** Minimal, data-dense, structured. Every pixel earns its place. White space is used for grouping, not decoration.
- **Palette:** Teal primary (hero accent, active states), slate neutrals (never pure gray), phase bars use a muted slate -> cyan -> teal -> violet -> amber progression so P3 pivotal trials read as the hero color. Markers are the visual foreground: green (data), red (regulatory), blue (approval/launch), orange (change). See `docs/brand.md` for exact role-to-color mapping.
- **Typography:** Mono/tabular for timeline headers (data-instrument feel). Company names uppercase and tracked as structural labels. No display typography, no hero fonts.
- **Theme:** Light mode only. Dark mode is explicitly disabled in the PrimeNG preset (`src/client/src/app/config/primeng-theme.ts`).
- **References (aim for):** Bloomberg Terminal (data density, gravity), Evaluate Pharma / Citeline (domain familiarity), Linear / Notion (modern craft, interaction polish, typographic discipline).
- **Anti-references (never look like):** Consumer SaaS dashboards, playful startup aesthetics, generic indigo-600 accents, pure grays, dark mode, glassmorphism, gradient text, pastel gradients, rounded-everything, decorative illustrations.
- **Accessibility baseline:** WCAG 2.1 AA. Keyboard navigable with visible focus, semantic HTML, ARIA labels, aria-live for dynamic content, modal focus trapping and Escape-to-close. Contrast must hold on both interactive elements and data marks.

### Design Principles
1. **Data density over decoration.** Maximize information per screen. If a pixel doesn't carry meaning or grouping, remove it.
2. **Instant visual parsing.** Markers pop, phase bars recede into the backdrop, company/product grouping structures the left rail. The eye should land on the answer, not hunt for it.
3. **Tinted neutrals, not flat grays.** Slate gives warmth and depth without introducing color noise. Never reach for generic gray-* or indigo-* utilities.
4. **Authority through restraint.** Premium feel comes from precision alignment, consistent spacing, and typographic discipline -- not from effects, gradients, or animation. Motion is purposeful and small.
5. **Accessibility as baseline, not polish.** WCAG AA is a hard floor; it is checked during the feature, not after.

## Angular Conventions

- Use **standalone components** exclusively (no NgModules)
- Use the `inject()` function for dependency injection, not constructor injection
- Use **signals** for reactive state where possible (`signal()`, `computed()`, `effect()`)
- Use the new control flow syntax: `@if`, `@for`, `@switch` (not `*ngIf`, `*ngFor`)
- Lazy-load feature routes via `loadComponent` / `loadChildren`
- No SSR -- static client-side build only
- Keep components lean; business logic belongs in services

## Accessibility

- All interactive elements must be keyboard navigable with visible focus indicators
- Use semantic HTML, proper ARIA labels, and `aria-live` for dynamic content
- Forms need associated labels, `aria-required`, `aria-invalid`, and error descriptions
- Modals need focus trapping and Escape to close

## Component Patterns

- **Page components** handle routing, data fetching, and layout
- **Presenter components** are pure UI -- receive data via inputs, emit events via outputs
- Keep data access logic in services, not components
- Cross-cutting validation logic goes in shared services, not inline in components

## PrimeNG Conventions

- Use **PrimeNG 19** as the baseline UI component library
- Custom theme preset in `src/app/config/primeng-theme.ts` (Aura base, teal primary, slate surface)
- Import PrimeNG components directly in standalone component `imports` arrays (e.g., `TableModule`, `ButtonModule`, `Dialog`)
- Use `p-table` for all data tables, `p-dialog` for modals, `p-button` for buttons
- Use PrimeNG form components (`pInputText`, `p-inputnumber`, `p-select`, `p-colorpicker`, `pTextarea`, `p-checkbox`) over native HTML inputs
- Use design tokens for theming -- do not override PrimeNG colors with inline Tailwind color classes
- Domain-specific visualization components (SVG timeline, phase bars, markers) remain custom

## Tailwind CSS Conventions

- Use **Tailwind CSS v4** with the PostCSS plugin (`.postcssrc.json`)
- Import via `@import "tailwindcss"` in `src/styles.css`
- Use utility classes for layout (`flex`, `grid`, `gap`, `p-*`, `m-*`), spacing, and responsive design
- Tailwind handles layout around PrimeNG components; PrimeNG handles interactive component styling
- Responsive design via Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`)

## Supabase Local Development

All database work uses **migrations** (not declarative schema). This allows fully automated local setup and teardown.

### Key Commands
```bash
supabase start          # Start local Supabase stack (Postgres, Auth, etc.)
supabase db reset       # Tear down and rebuild: re-runs all migrations + seed.sql
supabase migration new <name>  # Create a new empty migration file
supabase db push        # Push migrations to remote Supabase project
supabase stop           # Stop local stack
```

### Workflow
1. All schema changes go in `supabase/migrations/` as timestamped SQL files
2. Seed data goes in `supabase/seed.sql` -- executed after migrations on `start` and `reset`
3. To rebuild from scratch: `supabase db reset` (re-applies all migrations + seed)
4. Never edit migration files after they've been applied -- create new migrations instead
5. Migration files follow naming: `YYYYMMDDHHmmss_short_description.sql`

### Supabase SQL Guidelines
Follow these guides for all database work:
- [RLS Policies](docs/supabase-guides/database-rls-policies.md) - Row Level Security policy patterns
- [Database Functions](docs/supabase-guides/database-functions.md) - PostgreSQL function best practices
- [Create Migration](docs/supabase-guides/database-create-migration.md) - Migration file naming and SQL guidelines
- [SQL Style Guide](docs/supabase-guides/sql-style-guide.md) - SQL formatting and naming conventions

## Project Structure

```
src/client/
  src/app/
    core/           # Auth, services, models
    features/       # Feature modules (auth, dashboard, manage)
    shared/         # Reusable components (svg-icons)
    config/         # App configuration (PrimeNG theme preset)
supabase/
  migrations/       # Timestamped migration SQL files (source of truth for schema)
  seed.sql          # Marker types + demo data (run after migrations)
  config.toml       # Supabase local config (Google OAuth enabled)
  .env              # Local secrets (not committed)
docs/
  brand.md          # Brand guide and design decisions
  specs/            # Feature specifications
  supabase-guides/  # Supabase development guidelines
```

## Verification

```bash
cd src/client && ng lint && ng build
```

## Whitelabel Architecture (host-aware brand resolution)

The app is a multi-tenant whitelabel platform. Hierarchy: **agency** (consultancy) → **tenant** (pharma client) → **space** (engagement).

- **Pre-bootstrap brand fetch.** `main.ts` reads `window.location.host`, calls the anon-callable RPC `public.get_brand_by_host(p_host)`, sets `--brand-50..950` CSS vars + `document.title` + favicon, builds a dynamic PrimeNG preset via `buildBrandPreset(scale)`, then bootstraps Angular. `BrandContextService` holds the brand record after bootstrap.
- **Brand kinds.** `tenant` (matches `tenants.subdomain` or `tenants.custom_domain`), `agency` (matches `agencies.subdomain`), `super-admin` (e.g. `admin.yourproduct.com`), `default` (apex / unknown — falls back to the static teal preset).
- **Tenant role constraint.** `tenant_members.role` is `owner | member` — never `viewer`. Space-level roles (`owner | editor | viewer`) live on `space_members`. Tenant members get implicit editor/viewer space access via `has_space_access()`.
- **Feature areas.** Agency portal at `/admin/*` (gated by `agencyGuard`); super-admin at `/super-admin/*` (gated by `superAdminGuard`, kind === `super-admin`); marketing landing at `/` on default host.
- **Theme conventions.** Use Tailwind `bg-brand-*` / `text-brand-*` / `border-brand-*` / `ring-brand-*` utilities — never `bg-teal-*`. PrimeNG tokens reference `{primary.X}`, never `{teal.X}`. Slate / red / amber / green / cyan / violet stay hard-coded — those are data colors, not brand.
- **Dev brand override.** In non-prod, append `?wl_kind=tenant&wl_id=<uuid>`, `?wl_kind=agency&wl_id=<uuid>`, or `?wl_kind=super-admin` to the URL to short-circuit `fetchBrand()` to a synthetic brand for local smoke testing without DNS.
- **Cross-subdomain auth.** When `environment.apexDomain` is set and the current host is on the apex, Supabase JS uses cookie-based session storage with `Domain=.<apex>`. Otherwise localStorage (dev default). Custom domains are a separate trust boundary — fresh sign-in on each.
- **Whitelabel RPCs.** `get_brand_by_host`, `check_subdomain_available`, `provision_agency`, `provision_tenant`, `update_tenant_branding`, `update_tenant_access`, `get_tenant_access_settings`, `update_agency_branding`, `register_custom_domain`, `self_join_tenant`, `lookup_user_by_email` — all SECURITY DEFINER, modeled on `accept_invite()`.
- **Reserved subdomains.** `www app api admin auth mail support status docs blog help cdn static assets noreply email smtp` — enforced in `provision_tenant` / `provision_agency`.

## Spec Location
- Active spec: `docs/specs/clinical-trial-dashboard/spec.md`
- Whitelabel design: `docs/superpowers/specs/2026-04-27-whitelabel-design.md`
