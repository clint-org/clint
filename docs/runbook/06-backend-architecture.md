# Backend Architecture

[Back to index](README.md)

---

The backend is entirely managed by Supabase -- no custom server code.

## Supabase Services Used

| Service | Purpose |
|---|---|
| PostgreSQL 15 | Primary data store for all application data |
| PostgREST | Auto-generated REST API from the Postgres schema; used for CRUD operations |
| Supabase Auth | JWT-based auth with Google OAuth provider; 1-hour JWT expiry with refresh token rotation |
| Supabase JS 2.49 | Client library used by Angular to call all backend APIs |

## Database Functions (RPCs)

### get_dashboard_data

```
get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[],
  p_product_ids uuid[],
  p_therapeutic_area_ids uuid[],
  p_start_year int,
  p_end_year int,
  p_recruitment_statuses text[],
  p_study_types text[],
  p_phases text[]
)
```

The single most important function. Accepts a space ID and optional filter arrays, and returns a single nested JSON object:

```json
{
  "companies": [
    {
      "id": "...", "name": "...", "color": "...",
      "products": [
        {
          "id": "...", "name": "...",
          "trials": [
            {
              "id": "...", "name": "...",
              "therapeutic_area": { "name": "...", "abbreviation": "..." },
              "recruitment_status": "...", "study_type": "...", "phase": "...",
              "phases": [{ "phase_type": "...", "start_date": "...", "end_date": "..." }],
              "markers": [{ "event_date": "...", "marker_type": { "shape": "...", "color": "..." } }],
              "notes": [{ "content": "..." }]
            }
          ]
        }
      ]
    }
  ]
}
```

This eliminates N+1 query problems. The entire dashboard renders from a single RPC call. Uses `SECURITY INVOKER` so RLS policies apply to the calling user.

### create_tenant

```
create_tenant(p_name text, p_slug text) -> uuid
```

Creates a new tenant record and adds the calling user as the owner in `tenant_members` in a single transaction. Uses `SECURITY DEFINER` to bypass RLS bootstrapping issues.

### create_space

```
create_space(p_tenant_id uuid, p_name text, p_description text) -> uuid
```

Creates a new space and adds the calling user as the space owner. Verifies the caller is a member of the parent tenant before creation. Uses `SECURITY DEFINER`.

### seed_demo_data

```
seed_demo_data(p_space_id uuid)
```

Populates a space with pharmaceutical demo data -- companies (AstraZeneca, Eli Lilly, Novo Nordisk, etc.), products (Farxiga, Jardiance, Mounjaro, Ozempic), therapeutic areas, 8+ trials with phases and markers, and 20 events covering all entity levels, categories, threads, links, sources, and priorities. Idempotent (checks if user already has companies).

### has_space_access

```
has_space_access(p_space_id uuid, p_roles text[]) -> boolean
```

Helper function used in RLS policies. Returns true if the calling user is either:
- A member of the space with one of the given roles, or
- The owner of the parent tenant

### is_tenant_member

```
is_tenant_member(p_tenant_id uuid, p_roles text[]) -> boolean
```

Helper for tenant-level RLS. Returns true if the calling user has the specified role in the tenant.

## Views

### space_members_view

Joins `space_members` with `auth.users` metadata to expose display name (from `raw_user_meta_data->full_name` or email) and email alongside membership records. Uses `SECURITY INVOKER`.

### tenant_members_view

Same pattern for tenant membership.
