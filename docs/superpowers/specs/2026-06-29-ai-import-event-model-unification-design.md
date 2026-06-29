# AI Import Event-Model Unification

Status: approved design (2026-06-29)
Branch: `feat/event-import-unify` (off `origin/develop`)
Parent spec: `docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md` (v1 scope: "AI import / extraction ... emit the unified Event model")
Related: dedup design `docs/superpowers/specs/2026-06-27-import-marker-event-dedup-design.md`; the C4 cutover migration header (`supabase/migrations/20260628280000_commit_source_import_emits_events.sql`)

## 1. Problem

The event-model cutover repointed the COMMIT path (`commit_source_import` emits unified
events via `create_event`) but deliberately FROZE the extraction / proposal / review half
on the legacy dual "markers + events" buckets, bridged by a lossy mapping. The C4 header
says the proposal "keeps its frozen dual markers+events extraction shape (Stage 3 will
unify it)" but Stage 3 does not own this (its spec/plan never mention import). This work
closes that gap.

Two lossy bridges in `commit_source_import` today:

- markers block: `event_type` resolved by `marker_type` NAME via a 3-tier fallback.
- events block: `category` NAME resolved to the category's "lead" `event_type` by
  `display_order` (picks the first type in the category, can mis-type).

Goal: extraction emits a SPECIFIC `event_type` (a stable name the prompt enumerates from
the live event_type taxonomy), a single unified `events` bucket, and
`commit_source_import` resolves `event_type` by exact name. No `display_order` guess, no
markers/events split.

### 1.1 The freeze is now actively degraded on develop

Because the cutover also dropped `marker_types` / `event_categories` and repointed
`get_space_inventory_snapshot` to emit `event_types` / `event_type_categories` / `events`
instances, the frozen extraction half is not merely frozen, it is broken in three ways the
unification repairs as a side effect:

1. The worker's `InventorySnapshot` type still names `marker_types` / `event_categories`,
   both `undefined` at runtime, so `prompt-builder.ts` silently falls back to a HARDCODED
   enum instead of the real taxonomy.
2. The snapshot no longer carries marker instances, so the validator's marker dedup
   (`inventory.markers`) is silently dead (every marker existing-match demoted to new).
3. The review page's per-leaf glyph calls `MarkerTypeService`, which queries the dropped
   `marker_types` table, errors, and always falls back to a generic icon.

Additionally, `commit_source_import` passes `p_significance = NULL` for BOTH blocks today,
so the AI-extracted `priority` is silently dropped on every import. Unification wires it
through.

## 2. Scope

In scope: the Claude extraction prompt (`prompt-builder.ts`, `nct-prompt-builder.ts`), the
worker zod contract (`types.ts`), the worker validator (`response-validator.ts`), the
proposal contract + review UI (`source-import/`), and the commit RPC
(`commit_source_import`). Plus a minimal canonical `core/services/event-type.service.ts`
read for the review-page glyph.

Out of scope (explicit deferrals):

- `tags`: stay in the extraction schema and in review / JSON download (no regression to the
  current behavior, which already drops them on commit). Tag restoration is a one-line
  `p_metadata:{tags}` fast-follow in `commit_source_import` once Stage 3's `p_metadata`
  (migration `20260629040000`) lands on develop. This work does NOT add `p_metadata`.
- Regulatory `pathway`: not AI-extracted (manual marker-form field only). Untouched.
- `create_event` / `update_event` / `get_event_detail`: Stage-3-owned. This work only CALLS
  `create_event` (it already takes `p_event_type_id` + `p_sources`); it never redefines
  them.

## 3. Field mapping (baked in, not to be re-derived)

| AI extraction field | Destination | Notes |
| --- | --- | --- |
| `event_type` (enumerated name) | `create_event` `p_event_type_id` | Resolved by exact name -> `lower(name)` -> system default. Replaces `marker_type` + `category`. |
| `significance` (`high`\|`low`) | `create_event` `p_significance` (native param) | Renamed from `priority`. Defaults to the resolved event_type's `default_significance` when omitted. |
| `anchor` `{level, ref}` | `p_anchor_type` + resolved `p_anchor_id` | Single anchor for every event. Replaces marker `trial_refs[]`. Space-level downgrade keeps the warning. |
| `event_date` / `end_date` / `projection` | `p_event_date` / `p_end_date` / `p_projection` | `event_date` coalesces to `current_date` (existing behavior). `projection` default `company` (existing behavior). |
| `description` | `p_description` | Unchanged. |
| `tags` (`string[]`) | (deferred) `events.metadata` | Kept in the schema + review; dropped on commit until `p_metadata` lands. |
| source document `source_url` | `p_sources` (one `event_sources` row) | Unchanged. |

## 4. Target shape

### 4.1 Worker contract (`src/client/worker/source-extract/types.ts`)

- Correct `InventorySnapshot` to the real RPC output: `event_types` (id, name),
  `event_type_categories` (id, name), `events` instances (id, anchor {level, id}, category,
  title, event_date). Remove `marker_types`, `event_categories`, and the `markers?`
  instance field.
- Collapse `MarkerSchema` + `EventSchema` into one unified `EventSchema`:
  `match` (existing|new), `event_type` (enumerated name string), `title`, `event_date`,
  `end_date`, `projection` (`actual`|`company`|`primary`), `significance` (`high`|`low`,
  optional), `description`, `tags` (`string[]`), `anchor` `{level, ref}`, `evidence`.
- Remove `markers` from `ExtractionResultSchema`; remove `'marker'` from `DroppedEntity.type`.

### 4.2 Prompt builders

- `prompt-builder.ts`: a single events section. Enumerate the available `event_type` names
  from `inventory.event_types` (fallback to the 12 system names when empty). Instruct the
  model to pick the most specific `event_type`, choose `anchor.level`
  (space|company|asset|trial) with a zero-based `ref`, set `significance`, and quote
  evidence. A trial milestone is just an event with `anchor.level: 'trial'`.
- `nct-prompt-builder.ts`: "the events array must be empty" (the NCT path resolves
  companies/assets/trials only; CT.gov timeline events arrive via `ctgov_sync`).

### 4.3 Validator (`response-validator.ts`)

- Drop all marker validation (bounds, name-grounding) and the dead marker-dedup block.
- Keep the event bounds check, the event existing-id dedup against `inventory.events`
  (id-in-inventory, anchor-match, one-to-one), and event name-grounding. This preserves
  PRs #132 / #135 on the unified bucket.
- Remove `markers` from the cleaned result.

### 4.4 Commit RPC (new migration, `20260629050000+`)

- `create or replace function public.commit_source_import(...)` authored from the LIVE
  `pg_get_functiondef` on develop (avoid inverted-version clobber). Single events block:
  - Resolve `event_type` by exact name -> `lower(name)` -> system default by `display_order`
    (same 3-tier shape as today's marker block, keyed on `event_type`).
  - `significance`: pass `p_significance` from the item; when null, look up the resolved
    event_type's `default_significance`.
  - Resolve `anchor {level, ref}` against the company/asset/trial maps; downgrade to space
    with the `event_anchored_to_space` warning when unresolvable.
  - Skip-existing dedup preserved: `match.kind = existing` + id valid in space ->
    `skipped.events`.
  - Call `create_event` (never redefine it), passing `p_source_doc_id` + `p_sources`.
- Return envelope collapses to `created.{companies, assets, trials, events}` +
  `skipped.{events}` + `warnings`.
- End with `notify pgrst, 'reload schema'`.
- Update the in-file prod-safe smoke to the unified proposal shape (one trial-anchored and
  one company-anchored event, both with a source_url; assert anchored events + 2
  `event_sources` citations; self-clean).

### 4.5 Frontend (`src/client/src/app/features/source-import/` + one core service)

- `source-import.service.ts`: drop `markers` from `SourceImportProposals`.
- `review-grid.logic.ts`: remove `markerLeafDisplay` / `pickMarkerType` / `MarkerTypeLite`;
  add `pickEventType` / `EventTypeLite` (same glyph fields, resolution mirrors the old
  marker resolver). Leaf display reads `event_type`. `defaultSelections` leaf set = `events`
  only.
- `review-page.component.ts`: drop the markers bucket, `orphanMarkers`, and the marker maps;
  route every leaf through the events path; replace `loadMarkerTypes` / `MarkerTypeService`
  with the new `EventTypeService`; render each leaf via `app-marker-icon` (the canonical
  glyph component used by the timeline, bullseye, and events page) from its resolved
  event_type glyph.
- `commit-summary.logic.ts`: `total` counts `events`; "View in timeline" when
  `events.length > 0`.
- `core/services/event-type.service.ts` (new, canonical): `list(spaceId)` returning the full
  event_type row (id, name, category_id, shape, color, fill_style, inner_mark,
  default_significance, is_system, display_order), reading `event_types` directly (granted
  to authenticated; RLS-scoped) via `RpcCache`, mirroring the now-deleted `MarkerTypeService`.
  Minimal (read only) by design; CRUD-extendable. Convergence note: Stage 3's taxonomy admin
  reads `event_types` inline; a later cleanup may converge its reads onto this service. No
  dependency is imposed now.

## 5. No-regression acceptance criteria

Besides the `tags` deferral, the unified pipeline must preserve every capability below.
These are acceptance checks for the plan.

Preserved identically:

- Company / asset / trial extraction, existing/new matching, fuzzy alternates, CT.gov
  enrichment, MOA/ROA merge, multi-asset (master protocol), multi-indication.
- Duplicate-source guard, inventory-drift warning, `ai_calls` provenance, `source_doc_id`,
  the `p_sources` citation, commit via the shared `create_event` RPC (no inline inserts).
- Skip-existing dedup on the unified `events` bucket (`skipped.events`); the review/validator
  event existing-id match against `inventory.events` (PRs #132 / #135) kept verbatim.
- Anchor resolution (space/company/asset/trial) and the space-level downgrade warning.
- NCT batch path (entities only; CT.gov events via `ctgov_sync`).
- Review tree, selection defaults (matched leaves deselected), evidence highlighting, JSON
  export, dropped-items panel, the duplicate-in-batch and no-asset commit gates.

Restored / improved (live regressions the cutover left behind):

- Prompt enumerates the real taxonomy, not a hardcoded fallback enum.
- Marker dedup (dead) restored as event dedup.
- Review per-leaf glyph (broken) restored via the event_type glyph.
- `priority` -> `significance` wired through (currently dropped on commit).
- Corporate events gain `end_date` + `projection` (the legacy events schema lacked both).

Two deliberate behavior nuances (accepted by the user during brainstorming):

1. Multi-trial marker nesting was DISPLAY-only; commit only ever created one event on the
   first `trial_ref`. The unified single `anchor` matches committed reality; the cosmetic
   multi-nesting is gone. No committed-data change.
2. "View in timeline" toast: today shows only when a marker landed; post-cutover everything
   is an event and the timeline renders events, so it shows when any event landed. Copy only.

## 6. Tests (paired per task, not deferred to a phase)

- Unit (`npm run test:units`): update `review-grid.logic.spec`, `review-edit.logic.spec`,
  `commit-summary.logic.spec`, `import-page.component.spec`, `review-page.duplicate.spec`,
  `response-validator.spec`, and worker fixtures to the unified shape; add a spec for
  `event-type.service` and `pickEventType`.
- Worker (`npm run test:worker`): prompt builders + validator on the unified contract.
- Integration (`npm run test:integration`, run in isolation around the parallel session):
  prove `commit_source_import` resolves `event_type` by exact name, sets significance, and
  that event dedup still matches existing events (no regression of #132 / #135).
- The commit migration carries its own in-file smoke (Section 4.4).

## 7. Guardrails and gates

- Branch `feat/event-import-unify` off `origin/develop`, own worktree
  `.worktrees/event-import-unify`, `src/client/node_modules` symlinked from the main
  checkout. Files are disjoint from the live Stage-3 session.
- Shared local Supabase Docker DB is the one hazard: do not `supabase db reset` or run
  integration tests while the Stage-3 session is mid-run. Serialize those moments; run
  integration specs in isolation.
- Migration numbering: Stage 3 has unmerged migrations at `20260629040000` /
  `20260629040100`. Number this work's migration at `20260629050000+` to avoid a
  duplicate-version collision on merge.
- Only CALL `create_event`; never redefine `create_event` / `update_event` /
  `get_event_detail`.
- Gates before merge/PR (from `src/client` unless noted): `ng lint`, `ng build`,
  `npm run test:units`, `npm run test:integration` (export `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o env`), `npm run test:worker`,
  `npm run grants:check`, `npm run features:check` (map the changed RPC), `npm run docs:arch`
  (migrations changed -> regen + commit), and `supabase db advisors --local --type all` from
  the repo root.
- Constraints: no emojis, no em-dashes, no Claude attribution (copy, comments, commits, PR).
- Do not push `feat/event-model` or `feat/event-model-stage-3`. When green, open a PR or
  merge to develop (no `gh pr merge --auto`; use `--merge` / `--admin`).
