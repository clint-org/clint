# Timeline Notes Count Badge

## Problem

The timeline view's notes column shows a single truncated line per trial row. When a trial has multiple notes, only the first is visible with no visual indicator that more exist. Users must click every row to discover whether additional notes are present -- a poor experience when scanning a dense landscape.

## Context

- Notes are rare: most trials have 0-1 notes, occasionally 2-5.
- The notes column is a fixed 192px-wide (`w-48`) right-side pane, visible on `lg` breakpoints and above.
- Each row is 36px tall. The current `row-notes.component.ts` shows truncated text and opens a `p-popover` on click.
- Two note sources exist: a legacy `trial.notes` string field and a `trial.trial_notes[]` array of `TrialNote` objects.

## Design

### Count badge

When the total number of notes for a trial exceeds 1, display a small count badge right-aligned in the notes cell.

**Total count logic:**
- Count = (1 if `trialNotes` is non-null and non-empty, else 0) + `notes.length`
- Badge visible only when count > 1

**Badge styling:**
- `text-[10px] font-medium` -- matches the sizing conventions used elsewhere in the grid (MOA/ROA "+N" badges)
- `bg-slate-200 text-slate-600 rounded-full px-1.5 py-0.5` -- slate pill, no color noise
- Flex-none so it doesn't shrink; the truncated note text absorbs the space reduction
- Right-aligned via `ml-auto` or flex layout with `justify-between`

**Layout change to the cell:**
- The existing `flex items-center gap-1` container gets the note text span set to `min-w-0 truncate flex-1` and the badge as a `flex-none` element after it
- No change to row height (36px), column width (w-48), or overall grid layout

### Popover header

When the popover opens and `totalCount > 1`, add a header line:
- Text: `"{count} notes"` (e.g., "3 notes")
- Styled as `text-xs text-slate-400 mb-2`
- Placed above the existing note list content

### What does not change

- Row height (36px)
- Column width (w-48)
- Click/keyboard interaction to open popover
- Tooltip behavior (still shows concatenated preview on hover)
- Popover max-height (300px) and scroll behavior
- Styling of individual notes inside the popover
- Behavior when there are 0 or 1 notes (identical to current)

## Component changes

All changes are isolated to `row-notes.component.ts`:

1. **New computed signal:** `totalCount` -- derives the combined count from both note sources
2. **Template update:** Add conditional badge element after the truncated text span
3. **Popover template update:** Add conditional header line above existing content

No new components, services, or modules needed.

## Accessibility

- Badge is purely visual (decorative) -- the tooltip and popover already convey the full content
- The existing `role="button"`, `tabindex`, and `aria-label` on the popover are unchanged
- Badge gets `aria-hidden="true"` since the tooltip text already includes all note content
