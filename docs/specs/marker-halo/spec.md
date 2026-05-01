# Marker Halo: surface analyst-curated markers

## Goal

Show users which markers carry Stout's analyst commentary at a glance, without changing the marker's category color or shape. Today, a marker entered by an analyst with a thoughtful description renders identically to a CT.gov-derived marker with no description. The halo is the visual cue that closes that gap.

## Trigger

A marker shows the halo iff `marker.description` is non-empty after trimming. No new schema field. No `curated_by_role` enum. The presence of analyst commentary is the signal.

This means a CT.gov-synced marker upgrades to a haloed marker the moment an analyst writes a description on it. The same field powers the tooltip body and the halo, so they stay in sync.

## Visual treatment

- Brand-700 ring (`#0f766e`)
- 1px stroke
- 0.85 opacity
- Offset 3px outside the marker's bounding box (radius `iconSize / 2 + 3`)
- Z-order: rendered before the marker shape so the shape sits inside the ring

Reference sketch: `src/client/public/internal/marker-treatments.html` variant B.

## Surfaces

Apply the halo wherever a marker renders, in priority order:

1. Timeline grid (`src/client/src/app/features/dashboard/grid/marker.component.html`)
2. Trial detail markers table (when the redesigned trial detail ships, per `docs/specs/marker-halo/spec.md`)
3. Catalyst feed marker icons (when that surface ships)
4. Engagement landing notice icons (when that surface ships)

Only #1 is in scope for this spec. The other surfaces will pick up the halo when they're built; this spec defines the primitive they reuse.

## Implementation

### 1. Add `hasDescription` computed to the marker component

In `src/client/src/app/features/dashboard/grid/marker.component.ts`:

```ts
hasDescription = computed(() => {
  const desc = this.marker().description;
  return !!desc && desc.trim().length > 0;
});
```

### 2. Render the halo before the existing shape

In `src/client/src/app/features/dashboard/grid/marker.component.html`, inside the existing `<svg>` wrapper but before the shape `<g>`:

```html
@if (hasDescription() && !isDashedLine()) {
  <svg:circle
    [attr.cx]="iconSize / 2"
    [attr.cy]="iconSize / 2"
    [attr.r]="iconSize / 2 + 3"
    fill="none"
    stroke="#0f766e"
    stroke-width="1"
    [attr.opacity]="0.85 * nleOpacity()"
  />
}
```

`nleOpacity()` is multiplied so an NLE marker with commentary still gets a faded halo, consistent with the dimming applied to the shape itself.

### 3. SVG viewport

The halo extends 3px beyond the existing 16px icon box. The current SVG already uses `class="overflow-visible"`, so no viewBox change is needed. Verify in the browser that the halo renders past the SVG edge.

### 4. Tooltip indication

In `src/client/src/app/features/dashboard/grid/marker-tooltip.component.ts`, give the description block the same brand-700 left rail used in the briefing surfaces, so the tooltip body matches the timeline cue:

```html
@if (description()) {
  <div class="border-l-2 border-brand-600 pl-3 mt-1.5">
    <p class="text-[11px] text-slate-500 leading-relaxed">{{ description() }}</p>
  </div>
}
```

This replaces the current plain `<p>` rendering.

## Edge cases

- **NLE marker with description.** The halo opacity is multiplied by `nleOpacity()` so it dims with the marker.
- **Empty-string description.** `hasDescription()` trims and returns false. No halo.
- **Description added or removed at runtime.** `hasDescription()` is a computed signal; the halo updates reactively without intervention.
- **Dashed-line markers.** Skipped in v1 because the geometry is not a bounding circle. Document as known gap; revisit if analysts start commenting on dashed-line markers in real use.
- **Adjacent markers in dense timelines.** The halo adds 3px to the marker footprint. With current `MARKER_ICON_SIZE = 16` and typical row spacing, halos do not visually collide. Verify in dense rows during QA.

## Out of scope

- Halo on dashed-line markers
- Halo color customization per agency brand (always brand-700; whitelabel parametrization later)
- Animation on halo appearance / removal
- Applying the halo to non-timeline surfaces (separate work, but reuses the same `hasDescription` computation and SVG primitive)

## No migration

The `description` column already exists on the `markers` table. No SQL change.

## Files touched

- `src/client/src/app/features/dashboard/grid/marker.component.ts` (add computed)
- `src/client/src/app/features/dashboard/grid/marker.component.html` (add halo SVG)
- `src/client/src/app/features/dashboard/grid/marker-tooltip.component.ts` (style description block with brand rail)

Estimated diff: 30-60 lines.

## Test plan

1. Existing marker with no description: no halo on timeline. Tooltip renders description as null/empty, no rail.
2. Add a description to that marker: halo appears on timeline. Tooltip shows description with brand rail.
3. Remove the description: halo disappears.
4. Test all shape variants (circle, diamond, flag, triangle, square). Halo renders correctly around each.
5. Dashed-line marker with description: no halo (expected gap). Tooltip rail still shows.
6. NLE marker with description: halo renders at reduced opacity, matching the dimmed marker.
7. Lint and build pass: `cd src/client && ng lint && ng build`.

## Branch

`feat/marker-halo`. One PR.
