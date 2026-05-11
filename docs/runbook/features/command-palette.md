---
surface: Command Palette
spec: docs/superpowers/specs/2026-05-01-command-palette-design.md
---

# Command Palette (Cmd+K)

A power-user finder/navigator/command runner. Mounted once in `AppShellComponent` so it is available on every space-level page. Not mounted in agency portal, super-admin, or marketing surfaces.

**Open:** `Cmd+K` (or `Ctrl+K`); `/` also opens when focus is not in a text input.

**Empty state** (no query): Pinned (top 10), Recents (top 8), Commands (filtered by `when()` predicates). Recents are bumped on entity navigation by both a Router-event listener (matches `/manage/(trials|products|companies)/:id`) and an explicit `recents.touch()` call after the palette activates an entity row.

**Search:** debounced 80ms, minimum 2 chars. Backed by `search_palette` RPC which unions across companies, products, trials, markers (catalyst kind), and events using `pg_trgm` similarity + prefix-match boost + trial-identifier exact-match boost. When no prefix token is used, matching navigation commands are merged into the result list (typing `bullseye` finds the "Go to Bullseye" command without needing the `>` prefix).

**Prefix tokens:** `>` commands, `@` companies, `#` trials, `!` catalysts. Backspacing the lone token returns to all-kinds.

**Activation targets:**
- trial -> `/manage/trials/:id` (detail page)
- company -> `/manage/companies?selected=<id>` (list filtered to that company)
- product -> `/manage/products?selected=<id>` (list filtered to that product)
- catalyst -> `/catalysts?markerId=<id>` (detail panel opens on load)
- event -> `/events?eventId=<id>` (detail panel opens on load)
- command -> client-side `run()` handler (router navigate, sign-out, etc.)

**Pinned/Recents storage:** `palette_pinned(user_id, space_id, kind, entity_id, position)` and `palette_recents(user_id, space_id, kind, entity_id, last_opened_at)`. Both RLS-scoped to `user_id = auth.uid()`. Recents trimmed to last 25 inside `palette_touch_recent`.

**RPCs:** `search_palette`, `palette_empty_state`, `palette_touch_recent`, `palette_set_pinned`, `palette_unpin` -- all `SECURITY DEFINER`, all gate on `has_space_access(p_space_id)`.

## Capabilities

```yaml
- id: palette-open-shortcut
  summary: Open palette via Cmd+K, Ctrl+K, or slash key when focus is outside a text input.
  routes: []
  rpcs: []
  tables: []
  related: []
  user_facing: true
  role: viewer
  status: active
- id: palette-empty-state
  summary: No-query view shows top 10 pinned, top 8 recents, and predicate-filtered commands.
  routes: []
  rpcs:
    - palette_empty_state
  tables:
    - palette_pinned
    - palette_recents
  related:
    - palette-pinned
    - palette-recents
  user_facing: true
  role: viewer
  status: active
- id: palette-search
  summary: Trigram-similarity search across companies, products, trials, catalysts, and events with 80ms debounce and 2-char minimum.
  routes: []
  rpcs:
    - search_palette
  tables:
    - companies
    - products
    - trials
    - markers
    - events
  related: []
  user_facing: true
  role: viewer
  status: active
- id: palette-prefix-tokens
  summary: Prefix tokens scope search results, greater-than for commands, at for companies, hash for trials, bang for catalysts.
  routes: []
  rpcs:
    - search_palette
  tables: []
  related:
    - palette-search
  user_facing: true
  role: viewer
  status: active
- id: palette-activation-targets
  summary: Selecting a result routes to the entity detail page or opens the detail panel via query param.
  routes:
    - /t/:tenantId/s/:spaceId/manage/trials/:id
    - /t/:tenantId/s/:spaceId/manage/companies/:id
    - /t/:tenantId/s/:spaceId/manage/assets/:id
    - /t/:tenantId/s/:spaceId/catalysts
    - /t/:tenantId/s/:spaceId/events
  rpcs: []
  tables: []
  related:
    - palette-search
  user_facing: true
  role: viewer
  status: active
- id: palette-pinned
  summary: User-pinned entities (up to 10) persisted per space, surfaced in the empty state.
  routes: []
  rpcs:
    - palette_set_pinned
    - palette_unpin
  tables:
    - palette_pinned
  related:
    - palette-empty-state
  user_facing: true
  role: viewer
  status: active
- id: palette-recents
  summary: Recently visited entities (last 25) bumped on activation and on entity-detail navigation; surfaces top 8 in empty state.
  routes: []
  rpcs:
    - palette_touch_recent
  tables:
    - palette_recents
  related:
    - palette-empty-state
  user_facing: true
  role: viewer
  status: active
```
