# PPTX Export Visual Fidelity: Markers, Phase Bars, Header Band

**Date:** 2026-06-08
**Status:** Design approved, pending spec review

## Problem

The PowerPoint export (`pptx-export.service.ts`) renders timeline markers and phase
bars that do not match the on-screen dashboard. Three concrete defects:

1. **Markers render as solid blobs.** The on-screen markers show outline/filled
   variants, inner marks (dot, ring/dash, check, x), and NLE dimming. The export's
   timeline markers are solid filled shapes with no inner marks, and several valid
   shapes draw nothing at all.
2. **Phase bars look wrong.** Web phase bars are a 12%-opacity tinted wash with a
   colored border and a short label (`PH 3`) in the phase color. The export draws a
   100%-opaque solid fill with the raw enum (`P3`) in white.
3. **Header band has a top gap.** The dark navy year-header band sits `0.06"` below
   the slide top, leaving a thin white margin. It should be flush to the top.

## Root cause

The web renderer is cleanly factored: `MarkerIconComponent` is driven by a small
semantic descriptor `{ shape, color, fillStyle, innerMark, isNle }`, and per-shape
geometry lives in dedicated icon components (`circle-icon`, `diamond-icon`, ...).

That descriptor is **derived inline in three independent places**, which drifted:

- Angular `marker.component.ts` (`effectiveFillStyle`, `isNle`) — correct.
- PPTX `renderLegendShape()` — a faithful port (correct shapes + inner marks).
- PPTX `renderMarkerShape()` — the timeline path; **stale**. It reads `fill_style`
  off the marker *type* (ignoring `projection`), draws no inner marks, branches on
  dead shape names (`arrow`/`x`/`bar`) that no longer exist in the shape enum, and
  has no handler for the real `triangle`/`square`/`dashed-line` shapes, which
  therefore draw nothing.

Phase bars diverge because the export keeps a **local `PHASE_COLORS` map** (missing
`PRECLIN`) and renders a solid fill with the raw `phase_type` label instead of
importing the canonical phase color map + short labels from
`core/models/phase-colors.ts`.

## Approach

Share the **semantic decision and geometry ratios**, not the literal rendering. The
two renderers necessarily speak different languages (SVG/CSS in the browser,
DrawingML/OOXML in the `.pptx`), so the drawing primitives stay separate. What gets
unified is *what* to draw.

Rejected alternative: rasterize each SVG marker to a PNG and embed it as an image
for pixel-identical output. This throws away the editable, movable, recolorable
native PowerPoint shapes that make a deck useful, and adds image-loading cost. Not
worth it. Shared ratios make the shapes match to the eye and stay structurally in
lockstep.

## Components

### 1. `core/models/marker-visual.ts` (new, framework-agnostic)

A pure module with no Angular imports, so both the Angular components and the PPTX
service can consume it.

- `interface MarkerVisual { shape: MarkerShape; color: string; fillStyle: FillStyle;
  innerMark: InnerMark; isNle: boolean; }`
- `resolveMarkerVisual(marker: Marker): MarkerVisual` — encodes the rules currently
  inline in `marker.component.ts`:
  - `fillStyle = marker.projection === 'actual' ? 'filled' : 'outline'`
  - `isNle = marker.no_longer_expected`
  - `shape`, `color`, `innerMark` passthrough from `marker.marker_types`.
  - Defensive defaults when `marker_types` is absent (callers already filter these
    out, but the function must not throw).
- `GLYPH_RATIOS` — named fractional geometry constants currently duplicated as magic
  numbers across the SVG icon components (e.g. inner-dot radius `0.15`, diamond
  half-width `0.42` / half-height `0.48`, square inset `0.1`, dash half-length,
  stroke widths). One source of truth for both the SVG icons and the PPTX glyph.

### 2. Angular side (consume, do not change rendering)

- `marker.component.ts`: `effectiveFillStyle` and `isNle` become thin wrappers over
  `resolveMarkerVisual(this.marker())`. No visual change — same values.
- Icon components (`circle-icon`, `diamond-icon`, `square-icon`, `triangle-icon`,
  `flag-icon`): import `GLYPH_RATIOS` instead of hardcoding the same fractions. Same
  values, so on-screen rendering is byte-for-byte unchanged. This is the low-risk
  half and is what makes future drift structurally impossible.

### 3. PPTX side: unify the two paths

Replace `renderMarkerShape()` and `renderLegendShape()` with a single shared
`drawMarkerGlyph(slide, visual: MarkerVisual, x, y, size)` used by **both** the
timeline and the legend. It:

- reads `fillStyle` from the resolved `MarkerVisual` (fixes "everything solid":
  outline markers get white fill + colored stroke, matching the SVG)
- draws the inner marks the timeline currently omits (dot / dash / check / x), using
  `GLYPH_RATIOS`
- handles `circle`, `diamond`, `flag`, `triangle`, `square`, `dashed-line`; deletes
  the dead `arrow` / `x` / `bar` branches
- applies NLE: `0.3` opacity (via shape `transparency`) plus the horizontal strike
  overlay
- `renderMarkers()` calls `drawMarkerGlyph(slide, resolveMarkerVisual(marker), ...)`
  instead of reading `fill_style`/`shape` ad hoc.

### 4. Phase bars

- Import the canonical phase color map and `phaseShortLabel()` from
  `core/models/phase-colors.ts`; delete the local `PHASE_COLORS` (which is missing
  `PRECLIN`).
- Render the bar as `roundRect` with **12%-opacity fill** (`transparency: 88`) +
  same-color border, matching the web wash instead of a solid fill.
- Label = short label (`PH 3`, `OBS`) in the **phase color**, shown when the bar is
  wide enough, matching the web.

### 5. Header band

- Make the navy band flush to the slide top by removing the `0.06"` top margin
  (`HEADER_Y`). Keep the band full width (`x: 0, w: SLIDE_W`). Adjust dependent
  offsets (`DATA_Y`) so the layout shifts cleanly with no overlap.

## Data flow

```
Marker (DB row + marker_types)
   │
   ▼
resolveMarkerVisual(marker) ──► MarkerVisual { shape, color, fillStyle, innerMark, isNle }
   │                                   │
   ▼ (Angular)                         ▼ (PPTX)
MarkerIconComponent inputs       drawMarkerGlyph(slide, visual, x, y, size)
   │                                   │
   ▼                                   ▼
per-shape SVG icons              OOXML shapes (ellipse/diamond/rect/triangle/line)
   (use GLYPH_RATIOS)               (use GLYPH_RATIOS)
```

## Error handling

- `resolveMarkerVisual` returns safe defaults if `marker_types` is missing rather
  than throwing; `renderMarkers` continues to pre-filter markers without a type.
- `drawMarkerGlyph` falls through to a no-op (with the outer shape only) for any
  unexpected shape value rather than crashing the export.

## Testing

- **Vitest** `marker-visual.spec.ts`: projection → fill (`actual` filled, others
  outline), NLE flag, passthrough of `shape`/`color`/`innerMark`, missing-type
  defaults.
- **Vitest** for the PPTX glyph dispatcher: every valid shape produces shape calls;
  no `arrow`/`x`/`bar` branches remain; outline vs filled differ; inner marks emit;
  NLE applies opacity + strike.
- **Playwright** export-and-inspect smoke using the existing local-auth + blob-capture
  pattern (see memory `reference_playwright_local_auth_export_verify`): export a
  deck, confirm it opens and markers/phase bars render with the new style.

## Out of scope

- Restyling the marker detail table or legend layout beyond the shared glyph.
- Any change to the on-screen dashboard appearance (web rendering must stay
  pixel-identical).
- Marker type schema / DB changes.
