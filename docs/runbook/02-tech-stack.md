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

## Full Version Inventory

```
Angular             19.x
TypeScript          5.6
RxJS                7.8
PrimeNG             19.x
@primeng/themes     19.x
Tailwind CSS        4.x
tailwindcss-primeui 0.6.1
@angular/cdk        19.x
Supabase JS         2.49
Supabase Edge Fns   Deno runtime (URL imports only, no npm)
Resend              transactional email API
pptxgenjs           4.0.1
FontAwesome Free    7.2
Node.js             (LTS)
PostgreSQL          15+ (via Supabase)
zone.js             0.15
tslib               2.6
```
