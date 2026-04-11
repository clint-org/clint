# Clinical Trial Status Dashboard

## Tech Stack
- **Frontend:** Angular 19 (standalone components, no SSR) with PrimeNG + Tailwind CSS v4, deployed to Netlify
- **Backend:** Supabase (Auth, Database)
- **Database:** PostgreSQL via Supabase
- **Auth:** Google OAuth via Supabase Auth

## Design Context

`docs/brand.md` is the authoritative brand guide. This section is the short form that should shape every design decision.

### Users
Pharma executives and BD teams scanning competitive landscapes under time pressure. They review dozens of trials across multiple companies and make high-stakes investment, licensing, and partnership calls based on what they see. Context is dense, adversarial, and institutional -- the tool sits alongside Bloomberg Terminal, Evaluate Pharma, and Citeline in their workflow. Job to be done: extract the competitive read on a drug program in seconds, with enough certainty to act on it.

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

## Spec Location
- Active spec: `docs/specs/clinical-trial-dashboard/spec.md`
