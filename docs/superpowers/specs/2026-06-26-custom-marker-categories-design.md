# Custom Marker Categories

**Date:** 2026-06-26
**Status:** Approved, ready for implementation

## Problem

Analysts can create custom marker *types* (shape, fill, color, inner mark), but every
type is forced into one of 5 immutable system categories (Clinical Trial, Data,
Regulatory, Approval, Loss of Exclusivity). When none of those buckets fit a custom
marker, the analyst has no good option.

The `marker_categories` table is already space-scoped with an `is_system` flag, and RLS
already permits space owners/editors to insert, update, and delete their own custom
categories. **The capability is fully modeled in the database but not exposed in the
application.** `MarkerCategoryService` only has `list()`; the marker-type form can only
pick from existing categories; there is no management UI.

This work exposes the existing capability. It does not change the data model beyond one
small uniqueness guard.

## What category actually affects

Category is purely a grouping label. It is orthogonal to every other marker axis:

| Axis | Controlled by | Touched by category? |
| --- | --- | --- |
| Icon shape (circle/diamond/flag/triangle/square/dashed-line) | `marker_types.shape` | No |
| Icon fill + inner mark | `marker_types.fill_style`, `marker_types.inner_mark` | No |
| Color | `marker_types.color` (hex) | No |
| Status (actual/stout/company/primary, projected) | `markers.projection` (per instance) | No |
| Legend / markers-help grouping | category name = section header, sorted by `display_order` | **Yes — only this** |

The only user-visible surface category drives is the **legend** (and its mirror on the
markers-help page), which renders one section header per category, sorted by
`display_order`. Empty categories never render (the legend iterates over marker types
that exist, not over categories).

## Decisions

- **Both paths:** full custom categories AND inline create. (No catch-all bucket.)
- **Category stays required.** Nothing is pre-selected in the marker-type form; the
  analyst always makes a deliberate choice (system, existing custom, or new inline).
- **No catch-all / "Other" category.** With one-click inline creation, a zero-friction
  default bucket is unnecessary. The legend's existing `cat?.name ?? 'Other'` fallback
  stays as defensive code but is never exercised in normal flow.
- **No new RPCs.** Category writes mirror the sibling `MarkerTypeService`: direct
  PostgREST insert/update/delete relying on the existing `marker_categories` RLS
  policies (owner/editor only; system rows immutable).

## Design

### 1. Migration (one file)

`marker_categories` currently has no uniqueness guard on name. Add a partial unique
index so two custom categories can't collide within a space:

```sql
create unique index marker_categories_space_name_uniq
  on public.marker_categories (space_id, lower(name))
  where is_system = false;
```

- Scoped to `is_system = false`, so the 5 system rows (null `space_id`) are unaffected.
- Case-insensitive (`lower(name)`) so "Manufacturing" and "manufacturing" can't coexist.
- No table changes, no RLS changes, no RPC changes.

Run `npm run docs:arch` and `supabase db advisors --local --type all` after, per project
conventions.

### 2. `MarkerCategoryService` — add `create` / `update` / `delete`

Mirror `MarkerTypeService` exactly (direct PostgREST, `markers:types` cache tag):

- `create(spaceId, { name })`:
  - Computes next `display_order` as `max(display_order) + 1` over all categories visible
    to the space (system + this space's custom), so custom categories always sort after
    the 5 system ones (orders 1-5).
  - Inserts `{ name, space_id, is_system: false, display_order }`.
  - Invalidates `markers:types`.
  - Mirrors `MarkerTypeService.create`, which does not pass `created_by` (left to existing
    table behavior); keep that parity.
- `update(id, { name?, display_order? })`: direct update, invalidate tag.
- `delete(id)`: direct delete; catch the FK-violation Postgres error (a category still
  referenced by `marker_types.category_id`, which is `ON DELETE NO ACTION`) and rethrow a
  typed, human-readable error so the UI can show "in use, reassign first" instead of a raw
  Postgres message.

### 3. Dedicated management page — `features/manage/marker-categories/`

Follows the existing `manage/marker-types/` list shape and the `src/client/CLAUDE.md`
empty-state audit rules.

- Lists **system categories** (read-only, "System" lock badge) for context, then the
  space's **custom categories**.
- Custom-row actions:
  - **Rename** — inline edit; rejects blank and duplicate names (surfaces the unique-index
    violation as a field error).
  - **Reorder** — up/down, swapping `display_order` with the adjacent custom category.
    System categories are not reorderable.
  - **Delete** — disabled with a tooltip when the category has marker types
    (`"N marker types use this — reassign them first"`); enabled and confirmed otherwise.
- Viewer role: read-only, no action affordances (no greyed buttons, no post-click denial).
- Loading skeleton + named error state per the audit rules.
- Reachable from the marker-types management area (a "Manage categories" link) and/or its
  own route under `manage/`.

### 4. Inline create in the marker-type form

In `marker-type-form.component`, the category `p-select` gains a "New category" affordance
(footer action). Selecting it reveals a small inline name input + confirm. On confirm:

1. Call `MarkerCategoryService.create(spaceId, { name })`.
2. Refresh the `categories` signal.
3. Auto-select the newly created category (`categoryId.set(new.id)`).

Category remains required; nothing is pre-selected on form load. Duplicate/blank names
surface the same validation as the management page.

### 5. Legend / markers-help

No code change. Both already group by `marker_categories.name` sorted by `display_order`,
so new categories appear as new section headers automatically and empty categories don't
render.

### 6. Editorial note (markers-help)

The markers-help color-role section documents only the 5 system categories' brand colors.
Add one sentence noting that custom categories use analyst-chosen colors and carry no brand
color convention. No drift-hook (`runbook-review-guard.sh`) changes required.

## Testing

Vitest specs paired with each unit (no deferred test phase):

- **`MarkerCategoryService`**
  - `create` sets `is_system: false`, `space_id`, and a `display_order` greater than all
    existing (sorts after system categories).
  - `delete` on an in-use category surfaces the typed friendly error, not the raw FK error.
  - Duplicate custom name (case-insensitive) is rejected.
- **Management page component**
  - System rows render locked/read-only; custom rows render actions.
  - Delete is disabled when marker types reference the category.
  - Viewer role sees no action affordances.
- **Marker-type form inline create**
  - Creating a category inline refreshes the list and auto-selects the new category.
  - Submit stays blocked until a category is chosen.

## Out of scope

- Reassigning marker types between categories on category delete (v1 blocks delete-in-use
  instead).
- Editing or reordering system categories (immutable by RLS, intentionally).
- A catch-all / default category bucket.
- Any change to icon shape, fill, color, inner mark, or marker status.

## Blast radius

Entirely within markers: one migration (additive index), one service (3 new methods), one
new management page, one form enhancement, one help-page sentence. No change to the timeline
render path, icons, fills, or statuses.
