# Multi-Tenant Model

[Back to index](README.md)

---

## Hierarchy

```
Tenant (Organization)
  +-- TenantMembers (role: owner | member)
  +-- TenantInvites (7-day expiry invite codes)
  +-- Spaces (Projects)
        +-- SpaceMembers (role: owner | editor | viewer)
        +-- Data (companies, products, trials, ...)
```

## Roles & Permissions

| Role | Scope | Can Do |
|---|---|---|
| Tenant Owner | Tenant | Manage members, create spaces, manage invites, full access to all spaces in the tenant |
| Tenant Member | Tenant | View tenant, join spaces, view assigned spaces |
| Space Owner | Space | Full CRUD on space data, manage space members |
| Space Editor | Space | Create/edit/delete data within the space |
| Space Viewer | Space | Read-only access to space data |

Tenant owners automatically have access to all spaces within their tenant (enforced by the `has_space_access()` function).

## Onboarding Flow

New users land at `/onboarding` after first sign-in. The `OnboardingComponent` provides two tabs:

### Create Organization

1. Text input for organization name
2. Slug auto-generated (lowercase, alphanumeric + hyphens only)
3. Calls `create_tenant()` RPC -- atomically creates tenant + adds caller as owner
4. Stores `lastTenantId` in localStorage
5. Redirects to `/t/{tenantId}/spaces`

### Join with Invite Code

1. Text input for 8-character invite code
2. Calls `tenantService.joinByCode(code)` -- validates code, checks expiry, adds user as member
3. Stores `lastTenantId` in localStorage
4. Redirects to `/t/{tenantId}/spaces`

## Tenant Settings

The `TenantSettingsComponent` provides:

- **Members table**: lists all members with name, email, role; remove button per member (with confirmation)
- **Pending invites table**: shows invite code, email, role, expiration
- **Invite dialog**: email + role dropdown to generate new invite codes

## Data Isolation

All data tables include a `space_id` column. RLS policies enforce that users can only access data in spaces where they are members (or in any space within a tenant they own). There is no way to query across spaces or tenants -- isolation is enforced at the database level.
