# Integration tests (role-access matrix)

A Node-side test suite that encodes the role-access-checker matrix as executable assertions. Each test is "as <persona>, do <op>, expect <observable>" -- the same shape as `docs/test-plans/role-access-checker.md`. When the access model changes, you change one matrix row and CI tells you which other personas broke.

## What this catches that unit tests don't

- RPC permission gates (forgotten `security definer`, missing role check).
- RLS policy regressions (a SELECT policy that suddenly leaks rows).
- Trigger logic (the `enforce_*_member_guards` family, the `is_agency_backed` view column, etc.).
- Cross-RPC consistency (idempotent invites returning the same code, etc.).

These rules live in plpgsql and SQL, not in Angular code. Unit tests can't exercise them.

## Running locally

```bash
# Make sure local Supabase is up and migrations are applied:
supabase status        # confirm running
supabase db reset      # only if you want a clean slate (destroys local data)

# From src/client/:
npm run test:integration
```

The suite expects the local Supabase to be reachable on `127.0.0.1:54321`. Override with env vars:

| Var | Default |
|---|---|
| `SUPABASE_URL` | `http://127.0.0.1:54321` |
| `SUPABASE_ANON_KEY` | local anon key (hardcoded fallback) |
| `SUPABASE_SERVICE_ROLE_KEY` | local service-role key (required, no fallback) |
| `SUPABASE_JWT_SECRET` | `super-secret-jwt-token-with-at-least-32-characters-long` |

In CI, `supabase status -o env` exposes the values; the workflow passes them through.

## Architecture

```
integration/
  fixtures/
    personas.ts       # buildPersonas() seeds 7 auth.users + an agency/tenant/space
                      # graph + memberships, mints HS256 JWTs with the local secret,
                      # returns { jwts, ids, org }.
  harness/
    as.ts             # as(jwt) -> Supabase client preset with the JWT.
                      # Plus assertion helpers: expectCode, expectOk, expectCount.
  tests/
    role-access.spec.ts   # The matrix rows.
```

Each `.spec.ts` calls `buildPersonas()` in `beforeAll`. The fixture wipes prior test entities by email-suffix pattern so reruns are idempotent without `supabase db reset`.

## Why direct JWT signing

Production Supabase verifies JWTs with an asymmetric ES256 key whose private half lives only inside Supabase Auth -- you can't forge production JWTs. Local Supabase verifies with a known HMAC secret (`SUPABASE_JWT_SECRET`), so we sign tokens directly and skip the OAuth round-trip. This is a CI tool, not a way to bypass auth in the live app.
