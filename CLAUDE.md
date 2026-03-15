# Clinical Trial Status Dashboard

## Tech Stack
- **Frontend:** Angular 19 (standalone components, no SSR) with Tailwind CSS v4, deployed to Netlify
- **Backend:** Supabase (Auth, Database)
- **Database:** PostgreSQL via Supabase
- **Auth:** Google OAuth via Supabase Auth

## Brand & Design

Follow `docs/brand.md` for all visual decisions. Key points:
- **Personality:** Clinical precision -- serious analytical tool for pharma executives
- **Palette:** Teal accent, slate neutrals (not generic gray or indigo)
- **Visual hierarchy:** Markers pop > phase bars are subtle backdrop > company/product grouping structures the left
- **Anti-patterns:** No indigo-600, no pure grays, no dark mode, no glassmorphism, no gradient text

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

## Tailwind CSS Conventions

- Use **Tailwind CSS v4** with the PostCSS plugin (`.postcssrc.json`)
- Import via `@import "tailwindcss"` in `src/styles.css`
- Use utility classes directly in templates -- avoid custom CSS unless absolutely necessary
- No component library (no Angular Material, no DaisyUI) -- pure Tailwind utilities
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
    shared/         # Reusable components (modal, multi-select, svg-icons)
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
