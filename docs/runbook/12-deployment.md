# Deployment

[Back to index](README.md)

---

## Architecture

- **Frontend** -- Angular SPA deployed to Netlify as a static site
- **Backend** -- Supabase Cloud (managed PostgreSQL, Auth, PostgREST)
- No server-side processes; no custom backend infrastructure

## Netlify Setup

```toml
# netlify.toml
[build]
  base = "src/client"
  command = "ng build"
  publish = "dist/client/browser"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

The catch-all redirect is required for Angular's client-side routing to work correctly on page refresh.

## Build Output

The Angular build produces static files in `dist/client/browser/`. Netlify serves these from its CDN. No SSR is configured -- this is a pure client-side SPA.

## Deploying Schema Changes

```bash
# Push local migrations to remote Supabase project
supabase db push
```

Migrations are applied in timestamp order. This is the only supported way to make schema changes -- never modify the database directly via the Supabase dashboard.

## Rollback

Database rollbacks require creating a new down-migration (reverse SQL). There is no automated rollback -- follow the convention: "never edit existing migrations, always add new ones."

## Demo Data

The pharma demo data (Migration 12) was seeded at migration time -- it ran `seed_pharma_demo()` inline and then dropped the function. For new spaces, the `seed_demo_data(p_space_id)` RPC can populate sample companies, products, and trials for onboarding and testing.
