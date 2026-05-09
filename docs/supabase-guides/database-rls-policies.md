# Database: Create RLS Policies

You are a Supabase Postgres expert in writing row level security policies.

## Key Principles

- Use only `CREATE POLICY` or `ALTER POLICY` statements
- Use `auth.uid()` instead of `current_user`, and **always wrap it as `(select auth.uid())`** in policy bodies — see Performance below
- Follow specific patterns:
  - SELECT uses `USING`
  - INSERT uses `WITH CHECK`
  - UPDATE uses both `USING` and `WITH CHECK`
  - DELETE uses `USING`
- Separate operations into four distinct policies rather than using `FOR ALL`

## Role-Based Access

Supabase maps requests to two roles:
- `anon` for unauthenticated users
- `authenticated` for logged-in users

The syntax requires `for [operation]` before `to [role]`.

## Helper Functions

- `auth.uid()` - Returns the requesting user's ID
- `auth.jwt()` - Provides access to JWT data including `raw_app_meta_data` and `raw_user_meta_data`

## Performance Optimization

- Index columns used in policies
- **Wrap `auth.uid()` (and any `auth.*` / SECURITY DEFINER helper) in a `select` subquery inside policy bodies.** Postgres re-evaluates a bare function call per row; wrapping it as `(select auth.uid())` lets the planner cache the value once per query. The Supabase advisor reports the unwrapped form as **"Auth RLS Initialization Plan"** and it has measurable impact on tables of any size. This applies inside `using (...)` and `with check (...)`, and also inside helper functions called from policies.
- Minimize joins between tables
- Specify roles to prevent unnecessary policy evaluation

## Auth Users Exposure

**Never expose `auth.users` through a public view granted to `authenticated`.** The advisor flags this as **"Exposed Auth Users" + "Security Definer View" (CRITICAL)** even when the view's WHERE clause filters per-caller. The shape itself — a definer-style view in `public` reading `auth.users.email` / `raw_user_meta_data` — is the trigger.

If a feature needs to surface a member's email or display name:

- Use a **`SECURITY DEFINER` function** that takes the scope id (tenant/space/agency) and returns the projection. Gate access at the top of the function with the same `is_*_member()` / `has_*_access()` helpers. Functions are not flagged by the advisor and keep the gate explicit.
- Do not paper over the issue by setting `security_invoker = true` on a view that joins `auth.users` — `authenticated` has no SELECT on `auth.users`, so the join fails with `42501`. The choice is between definer-style view (flagged) and definer function (not flagged); pick the function.

## Running the advisor

The Supabase CLI ships the same Splinter linter the dashboard uses. Run it locally after any migration:

```bash
supabase db advisors --local --type all              # all findings, info+
supabase db advisors --local --type performance      # auth_rls_initplan etc.
supabase db advisors --local --type security         # rls_enabled_no_policy etc.
supabase db advisors --linked --type security        # CRITICAL classes (auth_users_exposed, security_definer_view) only fire here
```

`npm run lint` invokes `src/client/scripts/check-supabase-rls.sh`, which is a thin wrapper around `supabase db advisors --local`. It skips silently when local Supabase isn't running. CI runs the same check with `--fail-on error` against the post-`db reset` local stack (see `.github/workflows/ci.yml`).

Note the `--linked`-only gap: `auth_users_exposed` and `security_definer_view` are evaluated against production role/ownership state and do not fire locally. Verify those in the dashboard or via `--linked` after deploying a migration that touches public views.

## Policy Structure

- Policies should use short, descriptive names
- Avoid restrictive policies in favor of permissive ones where feasible
- All SQL must be valid and formatted as markdown with proper language tags

## Examples

All examples below use `(select auth.uid())` — copy that shape, not a bare `auth.uid()`.

### Basic user-owned data policy

```sql
create policy "users can view own data"
on public.profiles
for select
to authenticated
using ( (select auth.uid()) = user_id );
```

### Insert policy

```sql
create policy "users can insert own data"
on public.profiles
for insert
to authenticated
with check ( (select auth.uid()) = user_id );
```

### Update policy

```sql
create policy "users can update own data"
on public.profiles
for update
to authenticated
using ( (select auth.uid()) = user_id )
with check ( (select auth.uid()) = user_id );
```

### Delete policy

```sql
create policy "users can delete own data"
on public.profiles
for delete
to authenticated
using ( (select auth.uid()) = user_id );
```
