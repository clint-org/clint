---
surface: In-app Help Pages
spec: docs/specs/clinical-trial-dashboard/spec.md
---

# In-app Help Pages

User-facing reference pages explain conventions and assumptions that are not derivable from the UI alone (editorial color rules, role-permission matrices, projection conventions). Three pages are live:

- `help/roles` -- role/permission breakdown for space membership. Linked from the Space Members page.
- `help/markers` -- marker semantics (color rule, projection convention, full marker-type list). Live-rendered from `MarkerTypeService` so the type list always matches the space's actual configuration. Linked from the dashboard legend strip and the Settings > Marker Types page.
- `help/phases` -- phase bar color semantics. Driven by the shared `PHASE_DESCRIPTORS` map in `core/models/phase-colors.ts`, which `phase-bar.component` also imports -- the help page and the chart can never disagree on color. Linked from the dashboard legend strip.

Pages follow a consistent shape (header + summary + descriptor table + FAQ + back link) and use `ManagePageShellComponent` for layout. Drift prevention has two layers: live render for state-derived content (markers list, phase color tokens), and the `runbook-review-guard.sh` stop hook surfaces the matching help page for editorial review when a related source path changes (FAQ/prose are not auto-updated).

**Agency-name substitution.** Help-page copy refers to the editorial actor by name when the workspace is provisioned by an agency. Each help component injects `BrandContextService` and reads `agency()?.name`; when present, the value replaces "the analyst" / "analysts" inside FAQ entries, header summaries, and (for `phases-help`) the `OBS` phase descriptor (transformed at render time so `PHASE_DESCRIPTORS` itself stays a single shared const). When `agency()` is null (default brand or direct-tenant workspace), the prose falls back to the generic "analyst" wording. Where the slot refers to an individual person rather than the editorial actor, the substitution becomes "{agency} teammate(s)" instead of the agency name alone (used in `roles-help` and the `drafts-widget` empty state).

## Capabilities

```yaml
- id: in-app-help-roles
  summary: Tenant-scoped help page describing space-membership roles and permissions; linked from the Space Members page.
  routes:
    - /t/:tenantId/help/roles
  rpcs: []
  tables: []
  related:
    - space-membership
  user_facing: true
  role: viewer
  status: active
- id: in-app-help-markers
  summary: Help page describing marker semantics (color, projection, full type list) live-rendered from MarkerTypeService.
  routes:
    - /t/:tenantId/s/:spaceId/help/markers
  rpcs: []
  tables:
    - marker_types
    - marker_categories
  related:
    - manage-marker-types
    - timeline-legend
  user_facing: true
  role: viewer
  status: active
- id: in-app-help-phases
  summary: Help page describing phase bar color semantics, driven by the shared PHASE_DESCRIPTORS const used by phase-bar.component.
  routes:
    - /t/:tenantId/help/phases
  rpcs: []
  tables: []
  related:
    - timeline-phase-bars
    - timeline-legend
  user_facing: true
  role: viewer
  status: active
- id: in-app-help-agency-substitution
  summary: BrandContextService swaps the analyst editorial label for the agency name in FAQ entries, header summaries, and the OBS phase descriptor.
  routes: []
  rpcs:
    - get_brand_by_host
  tables:
    - agencies
  related:
    - whitelabel-tenant-branding
  user_facing: true
  role: viewer
  status: active
```
