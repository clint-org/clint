# Whitelabel Marketing Landing Implementation Plan

> Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship Unit 12 of the whitelabel rollout: a placeholder marketing
landing for visitors hitting the apex domain (`BrandContext.kind() === 'default'`)
who are not authenticated. The landing exposes a "Find your workspace" form
that redirects users to `https://{subdomain}.{apex}/login` (production) or
`/login?workspace={subdomain}` in dev. Authenticated visitors on the apex
continue through the existing legacy onboarding redirect flow.

**Scope contract:**
- Brand resolution is already wired in `main.ts` via `get_brand_by_host`.
  `BrandContextService.kind()` is reliable by the time the router runs.
- `environment.apexDomain` is empty in dev/non-prod and will be set in
  production builds. The landing falls back to a same-host query-param
  redirect when apex is unset so dev still produces a usable flow.
- This is a placeholder marketing page -- copy is short and factual.
  No demo funnel, no signup CTA, no marketing pass on hierarchy. A real
  marketing site is out of scope for this rollout.
- Login already shows brand-driven providers; we add a small workspace
  hint (`Signing in to {workspace}.{apex}`) when the `?workspace=` query
  param is present and `kind === 'default'` so the dev-mode redirect
  reads correctly.
- Legacy `/t/:tenantId/*` routes are NOT being aliased to `/s/:spaceId/*`
  in this unit -- per the spec, that URL simplification is deferred.

**Tech:** Angular 19 standalone, PrimeNG 19 (`pInputText`, `p-button`),
Tailwind v4, signals, `RouterLink` for in-app links.

---

## File structure

```
src/client/src/app/features/marketing/
  marketing-landing.component.ts        # NEW - placeholder landing + form
src/client/src/app/core/guards/
  marketing-landing.guard.ts            # NEW - render or fall through
src/client/src/app/app.routes.ts        # MODIFIED - root route choice
src/client/src/app/features/auth/
  login.component.ts                    # MODIFIED - workspace hint
docs/superpowers/plans/
  2026-04-28-whitelabel-marketing-landing.md  # this file
```

## Tasks

- [ ] **Task 1:** Plan + `MarketingLandingComponent` with form, validation,
      and dev-vs-prod redirect logic. Commit
      `feat(marketing): plan + landing component for default-host visitors`.
- [ ] **Task 2:** Wire marketing into `app.routes.ts` as the root path for
      unauthenticated default-host visitors. Authenticated visitors continue
      through `onboardingRedirectGuard`. Commit
      `feat(marketing): route default-host unauthenticated visitors to /`.
- [ ] **Task 3:** Update `LoginComponent` to surface a workspace hint when
      `?workspace=` is present and `kind === 'default'`. Commit
      `feat(login): show workspace hint when ?workspace= param is present`.
- [ ] **Task 4:** `ng lint` + `ng build`; commit any final fixes.

## Self-review checklist

- Build + lint pass cleanly.
- Signed-out visit to `/` on default host renders marketing.
- Signed-in visit to `/` on default host still hits onboarding redirect.
- Subdomain form sanitizes input, validates pattern, and either redirects
  cross-subdomain (prod) or routes within the same host with a query
  param (dev).
- Login surfaces the workspace hint only on the default host.
