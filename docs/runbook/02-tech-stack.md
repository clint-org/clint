# Tech Stack

[Back to index](README.md)

---

## Why These Choices

| Layer | Technology | Rationale |
|---|---|---|
| Frontend Framework | Angular 19 | Strong typing, predictable structure, signals-based reactivity, enterprise-grade |
| UI Components | PrimeNG 19 | Comprehensive component library; Aura preset supports custom teal/slate theming, dynamic per-tenant primary scale |
| Styling | Tailwind CSS v4 | Utility-first layout around PrimeNG; `@theme` brand-* tokens drive per-tenant primary color at runtime via CSS variables |
| Backend / DB | Supabase | Managed Postgres + Auth + PostgREST in one; RLS provides tenant + agency isolation |
| Auth | Google + Microsoft (Azure AD) OAuth via Supabase | Zero-friction SSO for enterprise users; provider list per-tenant via `brand.auth_providers` |
| Edge runtime | Supabase Edge Functions (Deno) | `send-invite-email` handler triggered by a database webhook on `tenant_invites` insert |
| Email | Resend | Branded transactional email (invite emails) via a single platform-wide sender domain with DKIM/SPF; per-tenant display name and brand in the body |
| Export | pptxgenjs | Client-side PowerPoint generation; brand-aware cover, footer, and accent colors |
| Deployment | Cloudflare Workers (static assets binding via `src/client/wrangler.jsonc`) | Static SPA hosting with `not_found_handling: "single-page-application"` for client-side routing; free wildcard subdomain SSL on the `*.<apex>` zone; security headers via `src/client/public/_headers` |
| Storage | Cloudflare R2 (S3-compatible object store) | Engagement materials (briefings, PDFs, decks) are stored in the `clint-materials` R2 bucket. The same Cloudflare Worker that serves the SPA also exposes two presign endpoints (`POST /api/materials/sign-upload` and `POST /api/materials/sign-download`). The Worker forwards the user JWT to Supabase RPCs for access decisions, then signs short-lived URLs using `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. The Angular client never touches R2 directly. |

## Full Version Inventory

The table below is auto-generated from `src/client/package.json`. Edit the curated list in `src/client/scripts/gen-architecture.mjs` to surface or hide a dep. Versions outside the package (Node LTS, PostgreSQL 15+ via Supabase, Resend, Supabase Edge Functions Deno runtime) are external and not tracked here.

<!-- AUTO-GEN:VERSIONS -->
| Package | Version |
|---|---|
| `@angular/core` | ^19.0.0 |
| `@angular/cdk` | ^19.2.19 |
| `typescript` | ~5.6.0 |
| `rxjs` | ~7.8.0 |
| `zone.js` | ~0.15.0 |
| `tslib` | ^2.6.0 |
| `primeng` | ^19.1.4 |
| `@primeng/themes` | ^19.1.4 |
| `tailwindcss` | ^4.0.0 |
| `tailwindcss-primeui` | ^0.6.1 |
| `@supabase/supabase-js` | ^2.49.0 |
| `pptxgenjs` | ^4.0.1 |
| `prosemirror-state` | ^1.4.4 |
| `prosemirror-view` | ^1.41.8 |
| `prosemirror-model` | ^1.25.4 |
| `@fortawesome/fontawesome-free` | ^7.2.0 |
<!-- /AUTO-GEN:VERSIONS -->

## Documentation Drift

Auto-generated. Lists top-level dependencies declared in `src/client/package.json` whose package name does not appear anywhere in this file. Add prose context for any flagged dependency, or remove it from `package.json` if unused. Angular sub-packages (other than `@angular/core` and `@angular/cdk`) are intentionally suppressed.

<!-- AUTO-GEN:DRIFT -->
- `@angular/cdk`
- `@angular/core`
- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`
- `@fortawesome/fontawesome-free`
- `@primeng/themes`
- `@supabase/supabase-js`
- `primeng`
- `prosemirror-commands`
- `prosemirror-history`
- `prosemirror-inputrules`
- `prosemirror-keymap`
- `prosemirror-markdown`
- `prosemirror-model`
- `prosemirror-schema-basic`
- `prosemirror-schema-list`
- `prosemirror-state`
- `prosemirror-view`
- `rxjs`
- `tailwindcss-primeui`
- `tslib`
- `zone.js`
- `@cloudflare/vitest-pool-workers`
- `@cloudflare/workers-types`
- `@playwright/test`
- `@tailwindcss/postcss`
- `@types/jsonwebtoken`
- `@types/pg`
- `angular-eslint`
- `eslint`
- `jsonwebtoken`
- `pg`
- `prettier`
- `tailwindcss`
- `typescript`
- `typescript-eslint`
- `vitest`
<!-- /AUTO-GEN:DRIFT -->
