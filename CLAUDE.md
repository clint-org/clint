# Executive Assessment Simulator

## Tech Stack
- **Frontend:** Angular 19 (standalone components, no SSR) with Tailwind CSS v4, deployed to Netlify
- **Backend:** Supabase (Auth, Database, Edge Functions)
- **Database:** PostgreSQL via Supabase

## Angular Conventions

- Use **standalone components** exclusively (no NgModules)
- Use the `inject()` function for dependency injection, not constructor injection
- Use **signals** for reactive state where possible (`signal()`, `computed()`, `effect()`)
- Use the new control flow syntax: `@if`, `@for`, `@switch` (not `*ngIf`, `*ngFor`)
- Lazy-load feature routes via `loadComponent` / `loadChildren`
- Write unit tests for each feature (components and services) -- verify with `ng lint`, `ng test`, and `ng build`
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
- Use Tailwind's built-in dark mode, spacing, typography, and color utilities
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
2. Seed data (question bank) goes in `supabase/seed.sql` -- executed after migrations on `start` and `reset`
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
src/app/
  core/           # Auth, services, models
  features/       # Feature modules (auth, dashboard, test-config, test-session, results)
  shared/         # Reusable components
supabase/
  migrations/     # Timestamped migration SQL files (the source of truth for schema)
  seed.sql        # Question bank seed data (run after migrations)
docs/
  specs/          # Feature specifications
  supabase-guides/ # Supabase development guidelines
```

## UI Development Flow

After building or modifying any UI component (template, styles, layout), automatically run these steps before considering the work done:

1. **Build** -- run `/audit` on the changed component to check accessibility, performance, and responsiveness
2. **Review** -- run `/critique` on the changed component for UX design quality
3. **Present findings** -- summarize the audit and critique results, then ask the user which issues to fix
4. **Fix** -- apply the agreed-upon changes
5. **Polish** -- run `/polish` as a final pass, ask the user to confirm the result

Do not skip these steps or wait to be asked. This is part of the standard workflow for any UI work.

## Verification

```bash
ng lint && ng build && ng test --watch=false
```

## Spec Location
- Active spec: `docs/specs/ea-simulator/spec.md`
