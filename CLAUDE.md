# Clint -- Competitive Intelligence for Pharma

## Tech Stack
- **Frontend:** Angular 19 (standalone components, no SSR) with PrimeNG + Tailwind CSS v4, deployed to Cloudflare (Workers + static assets via `src/client/wrangler.jsonc`; SPA fallback handled by `not_found_handling: "single-page-application"`; security headers in `src/client/public/_headers`)
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
- **Palette:** Teal primary (hero accent, active states), slate neutrals (never pure gray), phase bars use a muted slate -> cyan -> teal -> violet -> amber progression so P3 pivotal trials read as the hero color. Markers are the visual foreground: green (data), slate (trial milestones), orange (regulatory), blue (approval), violet (launch), amber (loss of exclusivity). See `docs/brand.md` for exact role-to-color mapping.
- **Typography:** Mono/tabular for timeline headers (data-instrument feel). Company names uppercase and tracked as structural labels. No display typography, no hero fonts.
- **Theme:** Light mode only. Dark mode is explicitly disabled in the PrimeNG preset (`src/client/src/app/config/primeng-theme.ts`).
- **References (aim for):** Bloomberg Terminal (data density, gravity), Evaluate Pharma / Citeline (domain familiarity), Linear / Notion (modern craft, interaction polish, typographic discipline).
- **Anti-references (never look like):** Consumer SaaS dashboards, playful startup aesthetics, generic indigo-600 accents, pure grays, dark mode, glassmorphism, gradient text, pastel gradients, rounded-everything, decorative illustrations.
- **Accessibility baseline:** WCAG 2.1 AA. Keyboard navigable with visible focus, semantic HTML, ARIA labels, aria-live for dynamic content, modal focus trapping and Escape-to-close. Contrast must hold on both interactive elements and data marks.

### Design Principles
1. **Data density over decoration.** Maximize information per screen. If a pixel doesn't carry meaning or grouping, remove it.
2. **Instant visual parsing.** Markers pop, phase bars recede into the backdrop, company/asset grouping structures the left rail. The eye should land on the answer, not hunt for it.
3. **Tinted neutrals, not flat grays.** Slate gives warmth and depth without introducing color noise. Never reach for generic gray-* or indigo-* utilities.
4. **Authority through restraint.** Premium feel comes from precision alignment, consistent spacing, and typographic discipline -- not from effects, gradients, or animation. Motion is purposeful and small.
5. **Accessibility as baseline, not polish.** WCAG AA is a hard floor; it is checked during the feature, not after.

## Angular / PrimeNG / Tailwind / a11y

Rules and conventions for Angular components, PrimeNG, Tailwind, accessibility, security, and performance live in `src/client/CLAUDE.md`. That file applies to all Angular work in `src/client/`, including edits to existing files.

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
- Every Tier 1 admin/security/governance RPC (provisioning, branding, access, membership, invites, custom domains, space lifecycle, platform-admin grants) must call `record_audit_event()` and carry the `-- @audit:tier1` marker comment in its body. The `20260510002000_audit_coverage_smoke.sql` migration enforces this. See `docs/superpowers/specs/2026-05-10-audit-log-design.md`.

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

After any migration change, also run the Supabase advisor against local — same Splinter engine the dashboard uses, with remediation links:

```bash
supabase db advisors --local --type all
```

CI and `npm run lint` both gate on `--fail-on warn` (see `.github/workflows/ci.yml` and `src/client/scripts/check-supabase-rls.sh`). Set `CHECK_SUPABASE_RLS_RELAX=1` to downgrade the local gate to ERROR-level for an emergency fix; CI does not honor that flag. The two dashboard CRITICAL classes (`auth_users_exposed`, `security_definer_view`) only fire against `--linked`; treat the dashboard as the canonical view for those after deploy.

## Documentation Conventions

The runbook at `docs/runbook/` is the single source of truth for architecture, schema, and operational knowledge. Two rules govern how it stays current:

1. **All diagrams and charts use Mermaid.** Never ASCII box-drawing, never tree art with `+--` connectors. Mermaid renders natively in GitHub, VS Code, and the docs viewer; ASCII does not. File and route trees inside fenced code blocks (e.g. the `Project Structure` block in `05-frontend-architecture.md`) are listings, not diagrams, and may stay as text. Anything that depicts relationships, flows, or sequences is a diagram and must be Mermaid (`flowchart`, `erDiagram`, `sequenceDiagram`).

2. **Auto-gen blocks are regenerated from live state.** Sections wrapped in `<!-- AUTO-GEN:NAME -->` ... `<!-- /AUTO-GEN:NAME -->` are produced by `src/client/scripts/gen-architecture.mjs` (run via `npm run docs:arch` from `src/client/`). Never hand-edit inside the markers — your edits will be overwritten on the next regen. Surrounding prose stays hand-written and is the canonical context for the generated block. Run `npm run docs:arch` after any change to `supabase/migrations/`, `src/client/src/app/app.routes.ts`, or `src/client/package.json`, and commit the regen in the same PR.

The script regenerates: `02-tech-stack.md` (versions + drift), `03-features.md` (drift), `05-frontend-architecture.md` (route tree + drift), `06-backend-architecture.md` (RPC→table matrix + drift), `07-database-schema.md` (Mermaid ER + drift), `08-authentication-security.md` (RLS coverage + guard drift), `09-multi-tenant-model.md` (helper drift). It requires local Supabase to be running (`supabase start`).

## In-app Help Pages

User-facing help pages live under `src/client/src/app/features/help/` and follow the same two-layer drift-prevention rules as the runbook:

1. **Live render where there is a single source of truth.** The page imports the same data the live UI uses, never duplicates it. `markers-help` queries `MarkerTypeService` (same as the legend); `phases-help` imports `PHASE_DESCRIPTORS` from `core/models/phase-colors.ts` (same as `phase-bar.component`). When the underlying data or token changes, the help page changes with it -- no regen step.

2. **Stop-hook flags editorial drift.** `.claude/hooks/runbook-review-guard.sh` maps changed paths to help pages whose FAQ or prose may need updating (e.g. changes to `marker_types`, `phase-colors`, or `space-members` flag the matching help page). Extend the `helpRules` map there when a new help page is added.

Each help page is reachable via an inline link near the surface it explains -- keep that link short and uppercase-tracked so it reads as a reference affordance, not a CTA. The shape is consistent: header + summary + capability or descriptor table + FAQ + back link.

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
