# Authentication & Security

[Back to index](README.md)

---

## Auth Flow

```
1.  User navigates to /login
2.  Clicks "Sign in with Google"
3.  SupabaseService.signInWithGoogle() opens Google OAuth redirect
4.  User authenticates with Google
5.  Google redirects back to /auth/callback
6.  AuthCallbackComponent: Supabase exchanges auth code for a session
7.  Supabase issues a JWT containing auth.uid() (1-hour expiry, refresh token rotation)
8.  SupabaseService stores session in signals (currentUser, session)
9.  SupabaseService.waitForSession() resolves
10. Angular router guards (authGuard) check currentUser signal
11. onboardingRedirectGuard checks for tenant membership:
    - No tenants -> redirects to /onboarding
    - Has tenants -> checks localStorage for lastTenantId
    - Redirects to /t/{tenantId}/spaces
```

## Row Level Security (RLS)

Every data table has RLS enabled. Policies are enforced at the Postgres level -- bypassing the API layer is not possible.

### Data Tables

`companies`, `products`, `trials`, `trial_phases`, `trial_markers`, `trial_notes`, `therapeutic_areas` use:

```sql
-- SELECT: user has any access to the space
has_space_access(space_id, ARRAY['owner', 'editor', 'viewer'])

-- INSERT/UPDATE/DELETE: user has write access to the space
has_space_access(space_id, ARRAY['owner', 'editor'])
```

### Marker Types

- System types (`is_system = true`) are readable by all authenticated users
- User-created types are scoped to their space with standard space access checks

### Tenant Tables

Use `is_tenant_member()` checks for membership-based access.

### Bootstrapping

Special RLS policies allow users to add themselves as the first member when creating a tenant or space (fixes the chicken-and-egg problem where you need to be a member to add members, but the first member doesn't exist yet).

## Route Guards

### authGuard

Async guard that calls `waitForSession()` and redirects to `/login` if no session exists.

### onboardingRedirectGuard

Applied on the root path `/`. Checks if the user has any tenant memberships:
- **No tenants** -- redirects to `/onboarding`
- **Has tenants** -- retrieves `lastTenantId` from localStorage (or defaults to first tenant) and redirects to `/t/{tenantId}/spaces`
