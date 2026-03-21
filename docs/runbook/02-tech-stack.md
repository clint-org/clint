# Tech Stack

[Back to index](README.md)

---

## Why These Choices

| Layer | Technology | Rationale |
|---|---|---|
| Frontend Framework | Angular 19 | Strong typing, predictable structure, signals-based reactivity, enterprise-grade |
| UI Components | PrimeNG 19 | Comprehensive component library; Aura preset supports custom teal/slate theming |
| Styling | Tailwind CSS v4 | Utility-first layout around PrimeNG; no custom CSS boilerplate |
| Backend / DB | Supabase | Managed Postgres + Auth + PostgREST in one; RLS provides tenant isolation |
| Auth | Google OAuth (via Supabase) | Zero-friction SSO for enterprise users; no password management |
| Export | pptxgenjs | Client-side PowerPoint generation; no server-side processing needed |
| Deployment | Netlify | Static SPA hosting with zero-config builds; CDN-distributed |

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
pptxgenjs           4.0.1
FontAwesome Free    7.2
Node.js             (LTS)
PostgreSQL          15+ (via Supabase)
zone.js             0.15
tslib               2.6
```
