# Architecture Overview

[Back to index](README.md)

---

## System Diagram

```
+---------------------------------------------------------------------+
|                          Browser (User)                              |
|                                                                     |
|   +--------------------------------------------------------------+  |
|   |              Angular 19 SPA (src/client/)                    |  |
|   |                                                              |  |
|   |  +-------------+  +--------------+  +-------------------+   |  |
|   |  |  Dashboard  |  |    Manage    |  |  Auth / Onboard   |   |  |
|   |  |  (timeline) |  |  (CRUD UI)   |  |  (login, spaces)  |   |  |
|   |  +-------------+  +--------------+  +-------------------+   |  |
|   |                                                              |  |
|   |  Services layer: SupabaseService, DashboardService, etc.    |  |
|   +--------------------------------------------------------------+  |
|                         |  Supabase JS Client                       |
+-------------------------+-------------------------------------------+
                          | HTTPS
+-------------------------v-------------------------------------------+
|                         Supabase (Cloud)                            |
|                                                                     |
|  +--------------+  +--------------+  +--------------------------+  |
|  |   PostgREST  |  |     Auth     |  |       PostgreSQL 15      |  |
|  |  (auto REST  |  |  (Google     |  |                          |  |
|  |   from schema|  |   OAuth)     |  |  Tables, Functions, RLS  |  |
|  +--------------+  +--------------+  +--------------------------+  |
+---------------------------------------------------------------------+
```

## Data Flow

1. User signs in with Google -- Supabase Auth issues a JWT
2. Angular app stores the JWT in `SupabaseService.session` (signal)
3. All API calls from the Supabase JS client include the JWT automatically
4. Supabase PostgREST validates the JWT and applies Row Level Security
5. RLS policies check `auth.uid()` against `space_members` / `tenant_members` tables
6. Dashboard data is fetched via a single `get_dashboard_data()` RPC that returns nested JSON
7. Angular components consume reactive signals derived from service state

## Key Architectural Decisions

- **No custom backend** -- Supabase provides auth, database, and auto-generated API. All business logic is in PostgreSQL functions or Angular services.
- **Single RPC for dashboard** -- `get_dashboard_data()` returns the entire dashboard payload as nested JSON, eliminating N+1 queries.
- **RLS for security** -- Row Level Security is enforced at the Postgres level. Even if the API layer is bypassed, data isolation holds.
- **Client-side export** -- PowerPoint generation runs in the browser via `pptxgenjs`. No files are sent to a server.
- **No SSR** -- Pure client-side SPA. Static files served from Netlify CDN.
- **Signals over Observables** -- Angular signals (`signal()`, `computed()`, `resource()`) are used for reactive state instead of RxJS Observables in services.
