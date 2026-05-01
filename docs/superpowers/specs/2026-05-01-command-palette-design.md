---
id: spec-2026-command-palette
title: Command Palette (Cmd+K)
slug: command-palette
status: draft
created: 2026-05-01
updated: 2026-05-01
---

# Command Palette (Cmd+K)

## Summary

A power-user command palette opened with `Cmd+K` (also `Ctrl+K`, `/`) that lets pharma CI analysts find entities (companies, products, trials, catalysts, events), navigate to pages, and run commands without leaving the keyboard. Search runs server-side against `pg_trgm` indexes via a single `search_palette` RPC. The empty state shows the user's pinned items, recently opened entities, and top commands. Scope is the current space; the affordance to widen to all spaces is wired in the UI but server-side support is deferred to v2.

## Goals

- Sub-200ms end-to-end keystroke-to-result paint on a typical space (~1k entities).
- Single-keystroke access to any first-class entity in the current space.
- Single-keystroke access to navigation targets and common commands.
- Cross-device persistence of pinned items and recents.
- Accessible by default: focus trap, screen-reader announcements, full keyboard control.
- Architectural seam that lets us add agency-portal and super-admin palettes later without rewriting.

## Non-Goals (v1)

- Searching across multiple spaces server-side. The UI affordance is built; the RPC is current-space-only.
- Mounting the palette in agency portal, super-admin, tenant-settings, or marketing surfaces.
- Filter-applier behavior (typing "PD-1" does not apply a filter to the bullseye view; it returns no result for MoA terms).
- Side preview pane on the highlighted result.
- AI / natural-language queries (lives with the AI inventory work, separate spec).
- Mobile / touch-optimized layout. Renders but is not the design target.
- Inline previews, hover cards, or scoped-shortcut chords (e.g., `Cmd+P` for jump-to-page).

## Decisions Log

The brainstorm produced seven decisions. Each one is enumerated here so reviewers can see what was rejected, not just what shipped.

### D1. Palette is a finder, navigator, and command runner

Three classes of result coexist in one ranked list: entity rows (jump to detail), navigation rows (jump to page), and command rows (invoke a verb such as "Switch space", "Sign out", "Create event"). Rejected: pure-finder (Linear "Open issue"); AI-augmented natural-language search.

### D2. Hybrid scope, default current space

Default scope is the current space. The input shows a scope chip on the left ("Oncology"). `Tab` toggles to "All spaces" but the v1 RPC ignores this scope and continues to query the current space, with an inline note that all-spaces search ships in v2. This previews the affordance without shipping a half-feature. Rejected: current-space-only with no expansion UI; cross-tenant search by default.

### D3. Tier 1 entities are companies, products, trials, catalysts, events

Trials are searchable both by name and by trial identifier (exact-match on `trials.identifier` gets a +0.5 ranking boost). Mechanisms of action, routes of administration, and therapeutic areas are explicitly **not** indexed as result rows. The palette is a finder, not a filter-applier.

**Schema mapping note:** "Catalyst" is the user-facing label; the underlying data is `public.markers`. Every marker is a catalyst from the user's perspective, so palette searches under the catalyst kind hit `markers.title` and the secondary line shows the marker's category and linked trial. Trial titles live in `trials.name` and the identifier in `trials.identifier` (not the spec's earlier-named `title`/`nct_id`).

### D4. Empty state has Pinned, Recents, and Commands sections

Three labeled sections in this order. Pinned only renders when the user has at least one pin. Recents shows up to 8 entries trimmed by `last_opened_at`. Commands shows up to 8 entries filtered by `when()` predicates. Rejected: recents-only minimalism; fully-empty-until-typed Spotlight style.

### D5. Two-line, unified ranking

Each result row is two lines: the entity's primary name on top, a pre-rendered secondary context line below (e.g., `Ph3 · NSCLC · Merck · NCT02578680`). Results from different kinds are ranked together in one list. Rejected: single-line rows (don't carry enough context for pharma trial names); section-grouped results (loses cross-kind ranking); side preview pane (heavyweight, deferred).

### D6. Three keyboard surfaces: open shortcut, slash-open, prefix tokens

`Cmd+K` and `Ctrl+K` open. `/` also opens (suppressed when focus is in any text input). Inside the palette, four prefix tokens scope the search:

| Token | Scope     |
|-------|-----------|
| `>`   | commands  |
| `@`   | companies |
| `#`   | trials    |
| `!`   | catalysts |

Backspacing the lone token returns to all-kinds. `↑/↓` to navigate, `Enter` to invoke, `Cmd+Enter` to open in a new tab, `Esc` to close, `Cmd+Shift+P` to toggle pin on the highlighted row.

### D7. Space-level only for v1

The palette is mounted exclusively in the space shell (`/t/:tenantId/s/:spaceId/...`). Outside that, no palette. Agency portal, super-admin, and tenant-level pages are deferred to a future spec.

## Architecture

### Where it lives

A single `CommandPaletteComponent` is mounted once in `AppShellComponent`. A root-provided `PaletteHotkeyService` listens at the `document` level for global keys, filters out events targeting text inputs, and toggles the open signal on the palette component. Outside `/t/:tenantId/s/:spaceId/...` the component is never instantiated.

### Data flow

```
Keystroke ─► PaletteHotkeyService ─► PaletteService.open()
                                            │
                                            ▼
                              palette_empty_state RPC ──► populate signals
                                            │
                                            │ (user types)
                                            ▼
                                  parsePrefixToken(query)
                                            │
                                            ▼
                          search_palette RPC (debounced 80ms)
                                            │
                                            ▼
                                  results signal updates
                                            │
                                            ▼
                                  Enter ─► Router.navigate
                                            │
                                            ▼
                          NavigationEnd ─► PaletteRecentsService
                                            │
                                            ▼
                            palette_touch_recent RPC fires
```

### Why server-side search

`pg_trgm` with GIN indexes is fast on the bounded entity counts a single space holds (a few thousand rows at the high end). Driving search server-side gives us four wins relative to a client-side fuzzy index:

1. RLS automatically scopes results to what the caller can see, so we can never accidentally leak across tenants or spaces.
2. The "All spaces" follow-up is a one-parameter change to the same RPC instead of a new code path.
3. Pharma data is high-stakes and changes frequently; stale local indexes are a worse failure mode than 100ms of server latency.
4. Adding a new entity type is a migration to the RPC's union, not a new client codepath.

The trade-off is per-keystroke latency. We mitigate with an 80ms input debounce and a 250ms delay before the inline spinner appears, so the perceived experience is "instant after a brief pause" rather than "loading on every key".

## Data Layer

### Migration: `20260501120000_palette_search.sql`

```sql
create extension if not exists pg_trgm;

-- Most of these indexes already exist from prior migrations; CREATE...IF NOT EXISTS is idempotent.
create index if not exists companies_name_trgm    on companies using gin (name         gin_trgm_ops);
create index if not exists products_name_trgm     on products  using gin (name         gin_trgm_ops);
create index if not exists products_generic_trgm  on products  using gin (generic_name gin_trgm_ops);
create index if not exists trials_name_trgm       on trials    using gin (name         gin_trgm_ops);
create index if not exists trials_identifier_trgm on trials    using gin (identifier   gin_trgm_ops);
create index if not exists markers_title_trgm     on markers   using gin (title        gin_trgm_ops);
create index if not exists events_title_trgm      on events    using gin (title        gin_trgm_ops);

create table palette_pinned (
  user_id    uuid not null references auth.users on delete cascade,
  space_id   uuid not null references spaces     on delete cascade,
  kind       text not null check (kind in ('company','product','trial','catalyst','event')),
  entity_id  uuid not null,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, space_id, kind, entity_id)
);
create index palette_pinned_user_space on palette_pinned (user_id, space_id, position);

create table palette_recents (
  user_id        uuid not null references auth.users on delete cascade,
  space_id       uuid not null references spaces     on delete cascade,
  kind           text not null check (kind in ('company','product','trial','catalyst','event')),
  entity_id      uuid not null,
  last_opened_at timestamptz not null default now(),
  primary key (user_id, space_id, kind, entity_id)
);
create index palette_recents_user_space_time
  on palette_recents (user_id, space_id, last_opened_at desc);

alter table palette_pinned  enable row level security;
alter table palette_recents enable row level security;

create policy palette_pinned_owner
  on palette_pinned  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy palette_recents_owner
  on palette_recents for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

`palette_pinned.entity_id` and `palette_recents.entity_id` reference different tables depending on `kind`; we deliberately do not declare polymorphic FKs. Stale rows are pruned lazily by `search_palette` left-joins, which simply omit pin/recent rows whose target entity no longer exists.

### RPC contract

```sql
create or replace function search_palette (
  p_space_id uuid,
  p_query    text,
  p_limit    int default 25
) returns table (
  kind        text,
  id          uuid,
  name        text,
  secondary   text,        -- pre-rendered second-line context
  score       real,        -- similarity rank, 0..1.5+ with boosts
  pinned      boolean,
  recent_at   timestamptz
) language sql stable security definer set search_path = public;

create or replace function palette_empty_state (
  p_space_id uuid
) returns jsonb language sql stable security definer set search_path = public;
-- returns { pinned: [...], recents: [...] }
-- commands list is client-side, not in this payload

create or replace function palette_touch_recent (
  p_space_id  uuid,
  p_kind      text,
  p_entity_id uuid
) returns void language plpgsql security definer set search_path = public;
-- upsert; trims to last 25 per (user_id, space_id) by oldest last_opened_at

create or replace function palette_set_pinned (
  p_space_id  uuid,
  p_kind      text,
  p_entity_id uuid,
  p_position  int
) returns void language plpgsql security definer set search_path = public;

create or replace function palette_unpin (
  p_space_id  uuid,
  p_kind      text,
  p_entity_id uuid
) returns void language plpgsql security definer set search_path = public;
```

All five RPCs short-circuit on `not has_space_access(p_space_id)` and return empty / no-op.

### Ranking

- Base: `similarity(name, query)` from `pg_trgm`.
- **Prefix boost:** `+0.3` if `name ILIKE query || '%'`.
- **Trial identifier exact match:** `+0.5` if `kind = 'trial' AND upper(identifier) = upper(query)`.
- **Pinned items** sort above all matches via a separate sort key; their score is preserved for ordering within the pinned group.
- **Recency tiebreaker:** when scores are within 0.05, prefer the more recently opened item (`recent_at desc nulls last`).
- Final order: `pinned desc, score desc, recent_at desc nulls last, name asc`.
- Hard limit: `p_limit` rows, default 25.

### Secondary text (server-rendered)

| Kind     | Secondary template                                                         | Source                                                |
|----------|----------------------------------------------------------------------------|-------------------------------------------------------|
| company  | `<count> products` (computed)                                              | `products` joined on `company_id`                     |
| product  | `<company.name> · <generic_name>`                                          | `products` join `companies`                           |
| trial    | `Ph<phase> · <conditions[1]> · <product.company.name> · <identifier>`      | `trials` join `products` join `companies`             |
| catalyst | `<event_date> · <marker_category.name> · <linked_trial.name>`              | `markers` join `marker_types` join `marker_categories` join `marker_assignments` join `trials` |
| event    | `<event_date> · <event_category.name> · <linked_company.name>`             | `events` join `event_categories` (and optional `companies`) |

`null` segments are dropped with their separator. Computed in SQL once per row, not per render.

## Components & Services

### Component tree

```
AppShellComponent
└── CommandPaletteComponent          // mounted once, signal-driven open
    ├── PaletteSearchInputComponent  // input, scope chip, prefix-token detection
    ├── PaletteEmptyStateComponent   // when query.length === 0
    │   ├── PaletteSection (Pinned)
    │   ├── PaletteSection (Recent)
    │   └── PaletteSection (Commands)
    └── PaletteResultListComponent   // when query.length > 0
        └── PaletteResultRowComponent (×N)   // pure presenter
```

All components are standalone, use `inject()` for DI, and use the new control flow syntax.

### Services

| Service                   | Responsibility                                                                 |
|---------------------------|--------------------------------------------------------------------------------|
| `PaletteHotkeyService`    | Document-level keydown listener, filters text inputs, toggles `isOpen`.        |
| `PaletteService`          | Central state. Signals: `isOpen`, `query`, `scope`, `selectedIndex`, `isLoading`, `results`, `emptyState`. Debounced effect that calls `search_palette`. |
| `PaletteCommandRegistry`  | Static typed list of commands with `when()` predicates and `run()` handlers.  |
| `PaletteRecentsService`   | Subscribes to `Router.events` (`NavigationEnd`), parses entity routes, calls `palette_touch_recent`. Single source of truth for recents bumps. |
| `PalettePinService`       | `pin`, `unpin`, `reorder` calls and a `pinned()` signal for the empty state.  |

### Signals & state shape

```ts
// PaletteService
readonly isOpen = signal(false);
readonly query = signal('');
readonly scope = signal<'space' | 'all-spaces'>('space');  // 'all-spaces' is UI-only in v1
readonly selectedIndex = signal(0);
readonly isLoading = signal(false);

readonly parsedQuery = computed(() => parsePrefixToken(this.query()));
//   ─► { token: '>' | '@' | '#' | '!' | null, term: string }

readonly results = signal<PaletteItem[]>([]);
readonly emptyState = signal<EmptyState>({ pinned: [], recents: [], commands: [] });
```

### Prefix-token parser

Pure function in `core/util/parse-prefix-token.ts`:

| Input    | Output                              |
|----------|-------------------------------------|
| `>foo`   | `{ token: '>', term: 'foo' }`       |
| `@bms`   | `{ token: '@', term: 'bms' }`       |
| `#KEY`   | `{ token: '#', term: 'KEY' }`       |
| `!q3`    | `{ token: '!', term: 'q3' }`        |
| `foo`    | `{ token: null, term: 'foo' }`      |
| `>` only | `{ token: '>', term: '' }`          |
| `''`     | `{ token: null, term: '' }`         |

The token is forwarded to `search_palette` as a kind filter via a server-side `case` on the kind union.

### Modal shell

`@angular/cdk/overlay` (already in deps, v19.2.19) with `OverlayPositionBuilder.global().centerHorizontally().top('15vh')`, `hasBackdrop: true`, `backdropClass: 'palette-backdrop'`, `panelClass: 'palette-panel'`. CDK `FocusTrap` wraps the input + result list. Backdrop click and `Esc` close. Not a `p-dialog`; the palette has too many bespoke keyboard rules to live happily inside PrimeNG's dialog.

### Brand-aligned styling

Light mode only. Modal panel: `bg-white border border-slate-200 rounded-md shadow-2xl`, `max-width: 560px`, mounted at `top: 15vh`. Input uses monospace 14px slate-900 (instrument-feel). Section labels are 10px uppercase tracked, slate-500. Selected row uses `bg-slate-100`; no ring, no glow, no gradient. Per-kind icon swatches use the brand's data colors:

| Kind     | Color               |
|----------|---------------------|
| trial    | teal (`#0f766e`)    |
| product  | cyan (`#0891b2`)    |
| company  | slate (`#475569`)   |
| event    | orange (`#ea580c`)  |
| catalyst | green (`#16a34a`)   |
| command  | violet (`#7c3aed`)  |

These match the existing data-mark roles defined in `docs/brand.md`. They do not use `--brand-*` tokens because they convey kind, not brand.

### File locations

```
src/client/src/app/core/layout/command-palette/
  command-palette.component.ts
  palette-search-input.component.ts
  palette-empty-state.component.ts
  palette-result-list.component.ts
  palette-result-row.component.ts
src/client/src/app/core/services/
  palette.service.ts
  palette-hotkey.service.ts
  palette-recents.service.ts
  palette-pin.service.ts
  palette-command.registry.ts
src/client/src/app/core/util/
  parse-prefix-token.ts
src/client/src/app/core/models/
  palette.model.ts
```

## UX Behavior

### Open / close

- `Cmd+K`, `Ctrl+K`, `/` open; suppressed when focus is in any `<input>`, `<textarea>`, or `[contenteditable]`.
- Re-firing the open key while open is a no-op.
- `Esc` closes; backdrop click closes; navigating closes.
- On open, input gets focus, `selectedIndex` resets to 0, `query` resets to empty. The `palette_empty_state` RPC fires in parallel with the open animation (~160ms) so by the time the modal lands the recents/pins are populated.

### Result navigation

- `↑/↓` move `selectedIndex`; wraps at top and bottom.
- `Home`/`End` jump to first/last result.
- `Enter` runs the selected item: navigate (entity row, nav row) or invoke (command row).
- `Cmd+Enter` opens entity rows in a new tab via `window.open(url, '_blank', 'noopener')`. Commands ignore this modifier.
- `Cmd+Shift+P` toggles pin on the highlighted entity row.
- Mouse hover updates `selectedIndex`; click invokes.

### Prefix tokens

- Typing `>`, `@`, `#`, or `!` as the first character switches scope immediately. The chip in the input updates: e.g., `Oncology · Trials`.
- `Backspace` over the token (when the term portion is empty) removes the token and returns to all-kinds.
- Empty state for a token (e.g., `>` alone) shows all available results of that kind: every command for `>`, recent companies for `@`, etc.

### Scope chip

- Default chip shows the current space's short name.
- `Tab` (when input is focused) toggles between `space` and `all-spaces`.
- Visual: chip widens and reads `· All spaces`.
- v1 behavior: the toggle is wired in the UI but the RPC ignores `all-spaces` and always returns current-space results, with a small inline note "All-spaces search ships in v2." Previewing the affordance without shipping the back-end avoids a useless control while telegraphing the intent.

### Empty state interactions

- **Pinned:** appears only if the user has at least one pin. Shows up to 10 entries ordered by `position`. A small `pin-off` icon is revealed on row hover. `Cmd+Shift+P` toggles pin on the highlighted row.
- **Recents:** read-only list, max 8 items. Bumped on entity open from anywhere in the app, not just from the palette.
- **Commands:** static list, max 8 items, filtered by `when()` predicates (e.g., "Switch space" hidden when the user has only one space). Each command row shows its hotkey on the right when one exists.

### Loading & no-results

- Input changes are debounced 80ms before the RPC fires.
- Inline spinner appears only after 250ms of pending request, avoiding flicker on fast responses.
- Minimum query length: 2 characters before the RPC fires. Below that, the palette stays in empty-state.
- No-results: a single muted row, "No matches in `<space name>`. Press Tab to search all spaces." (Tab affordance is text-only until v2.)

### Error handling

- RPC failure: a single muted error row, "Search unavailable - retry", with `Enter` re-running the last query.
- Errors are reported once per session to the existing logger, not as a toast.
- Network offline: same row text but with a parenthetical "(offline)" suffix when `navigator.onLine === false`.

### Accessibility

- `role="dialog"` on the panel, `aria-modal="true"`, `aria-labelledby` pointing to a visually-hidden `<h2>Search</h2>`.
- Input has `aria-controls="palette-results"` and `aria-activedescendant` reflecting the current result row's id.
- Result list is `role="listbox"`; rows are `role="option"` with `aria-selected`.
- A live region (`aria-live="polite"`) announces "N results" after each query settles.
- All interactive elements keyboard-reachable; CDK enforces the focus trap.
- Visible focus ring on all interactive elements; no relying on hover.

## Testing Strategy

No Playwright e2e in v1. Coverage = SQL tests against existing seed data + unit tests for pure logic.

### Database tests (`supabase/tests/palette/*.sql`)

Run via `supabase test db`. They exercise the RPC against the existing pharma seed migrations (`20260315192926_seed_pharma_demo_data`, `20260415160000_seed_real_companies`, etc.) — no separate fixtures.

- `search_palette_ranking.test.sql` — assert top-3 ordering for queries like `key`, `KEYNOTE`, `pd-1`, `nct02578680`. Validates similarity + prefix boost + NCT exact match.
- `search_palette_rls.test.sql` — caller without a `space_members` row for `p_space_id` gets zero rows; with `viewer` role they still get all matches.
- `palette_pinned_rls.test.sql` — user A cannot read or write user B's pins.
- `palette_recents_rls.test.sql` — same isolation; `palette_touch_recent` only writes for `auth.uid()`.
- `search_palette_explain.test.sql` — `EXPLAIN (FORMAT JSON)` of a representative query asserts the plan uses `Bitmap Index Scan` on a `*_trgm` index. Regression guard against query rewrites that bypass the index.

### Unit tests (Playwright unit runner, same as the rest of the codebase)

- `parse-prefix-token.spec.ts` — `>foo`, `@bms`, `#KEY`, `!q3`, plain `foo`, edge cases (empty, only token, multi-char prefix attempts).
- `palette-hotkey.service.spec.ts` — `Cmd+K` opens; `Cmd+K` inside `<input>` does nothing; `/` opens; `/` inside `<textarea>` does nothing.
- `palette.service.spec.ts` — debounce coalesces rapid keystrokes into one RPC; prefix tokens dispatch the correct kind filter; `selectedIndex` clamps within results length.
- `palette-command.registry.spec.ts` — `when()` predicates filter correctly; "Switch space" hidden when user has one space.

### Manual QA pass

Before merge: open the palette in the seeded demo space, exercise each decision (D1-D7) once, confirm the keyboard model, confirm pin/unpin persists across reload, confirm the focus trap.

## Rollout

1. Migration `20260501120000_palette_search.sql`: extension, indexes, tables, RLS policies, RPCs.
2. SQL tests against seed.
3. Client: `parsePrefixToken` + unit tests; `PaletteHotkeyService` + unit tests; `PaletteService` + unit tests.
4. Client: `CommandPaletteComponent` and sub-components, mounted in `AppShellComponent`.
5. Client: `PaletteCommandRegistry`, `PaletteRecentsService`, `PalettePinService`.
6. Manual QA in the seeded demo space.
7. Single ship; no feature flag. The palette is additive: if it breaks, `Cmd+K` does nothing and the rest of the app is unaffected.

### Success criteria

- p95 `search_palette` server time under 80ms on the local seed (~1k entities).
- End-to-end keystroke-to-result paint under 200ms.
- Empty state populates within 250ms after `Cmd+K`.
- All seven decisions implemented as specified.
- Manual QA confirms keyboard-only flow lands on a result and activates it.
- Screen reader announces result count after each settled query.

## Risks & Mitigations

| Risk                                                  | Mitigation                                                                                          |
|-------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| Recents table grows unbounded                         | Hard cap at 25 rows per `(user_id, space_id)`; oldest evicted inside `palette_touch_recent`.        |
| Trigram false-positives on single-char queries        | Minimum 2 chars before firing the RPC; below that, palette stays in empty-state.                    |
| Pinned references stale entities (deleted trial, etc.)| `entity_id` is not a polymorphic FK; `search_palette` left-joins and skips rows whose entity is gone; pruning is lazy. |
| Per-keystroke RPC load on Postgres                    | 80ms input debounce + 2-char minimum; expected QPS per active user ≈ 4-6 during burst typing.       |
| RPC swallows an entity kind on a typo                 | DB tests pin a stable ranking shape on canonical queries; bypass-index regression guard via `EXPLAIN`. |

## Follow-ups (out of scope)

- **All-spaces scope (v2).** Tab-to-widen UI is built; the RPC accepts a new `p_scope text` parameter that unions across the caller's `space_members`. Additive change.
- **Surface expansion.** Mount palette in agency portal and super-admin shells with their own `PaletteRegistry` providers. Same architecture, different index source.
- **Side preview pane.** Adds a detail card for the highlighted result. Hold until users ask.
- **AI / NL queries.** Belongs with the AI inventory work (`docs/superpowers/specs/2026-04-28-ai-inventory-design.md`).
- **Mobile bottom-sheet styling.** Defer; power users live on desktop.
- **Filter-applier mode.** Explicitly rejected in D3. Do not add without a fresh decision.
