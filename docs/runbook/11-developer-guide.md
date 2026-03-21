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
ng serve        # Dev server at localhost:4200 (hot reload)
ng build        # Production build -> dist/client/browser/
ng lint         # ESLint
ng test         # Unit tests
```

## Adding a New Feature

1. **Create a migration** if database changes are needed
2. **Add/update models** in `src/app/core/models/`
3. **Add/update services** in `src/app/core/services/`
4. **Create feature components** in `src/app/features/<feature-name>/`
5. **Register the route** in `app.routes.ts` using `loadComponent`
6. Follow the Angular conventions: standalone, `inject()`, signals, new control flow, inline templates

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

The custom theme preset (`config/primeng-theme.ts`) configures Aura base with teal primary (11 shade ramp: 50-950) and slate surface neutrals.

## Verification

```bash
cd src/client
ng lint && ng build
```

Both must pass before committing.

## Environment Configuration

The app uses Supabase environment variables defined in `src/environments/environment.ts`. For production, these are baked into the build via Angular's environment system. The production environment points to the hosted Supabase project.
