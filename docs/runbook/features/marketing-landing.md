---
surface: Marketing Landing
spec: docs/superpowers/specs/2026-04-27-whitelabel-design.md
---

# Marketing Landing

Minimal page at `/` on the default host (apex) for unauthenticated visitors. Shows the Clint logo, name, tagline ("Competitive intelligence for pharma"), and a "Find your workspace" form. The form takes a subdomain and redirects to `https://{subdomain}.{apex}/login` (production) or `/login?workspace={subdomain}` (dev where `apexDomain` is empty). Authenticated visitors continue through the existing `onboardingRedirectGuard`. Gated by `marketingLandingGuard`. Brand color is applied via the SVG logo's inner stroke and the tagline (`text-brand-700`).

## Capabilities

```yaml
- id: marketing-landing-page
  summary: Default-host page with logo, tagline, and Find your workspace form; gated by marketingLandingGuard.
  routes: []
  rpcs: []
  tables: []
  related:
    - whitelabel-host-kinds
  user_facing: true
  role: viewer
  status: active
- id: marketing-landing-workspace-finder
  summary: Subdomain-input form that redirects to the tenant subdomain login (or appends workspace param in dev).
  routes: []
  rpcs:
    - check_subdomain_available
  tables:
    - tenants
  related:
    - branded-login-workspace-hint
  user_facing: true
  role: viewer
  status: active
- id: marketing-landing-onboarding-redirect
  summary: Authenticated visitors are routed through onboardingRedirectGuard to their default workspace.
  routes:
    - /onboarding
  rpcs: []
  tables: []
  related: []
  user_facing: true
  role: viewer
  status: active
```
