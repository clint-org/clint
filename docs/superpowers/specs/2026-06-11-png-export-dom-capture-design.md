# PNG Export as DOM Capture

**Date:** 2026-06-11
**Status:** Approved
**Supersedes:** `2026-06-10-png-export-screen-parity-design.md` (canvas glyph parity; implemented but rejected, approximation could not match the app)

## Problem

The PNG export hand-draws the timeline onto a canvas (`png-export-renderer.ts`), laying it out like the PPTX deck and re-implementing each marker icon as canvas paths (`canvas-marker-glyph.ts`). Two rounds of glyph-parity fixes still do not match the on-screen rendering: stroke weights, glyph proportions, typography, and layout all read as approximations. The user expects the exported image to be a replica of the web app. PPTX is allowed to look like a deck; the PNG is not.

## Decision

Stop drawing. Capture the real DOM. The browser's own layout engine renders the export, so the PNG is the app, pixel for pixel: same SVG marker icons, same phase bars, same fonts, same today line.

Scoping decisions made during brainstorming:

1. **Full grid, app-styled.** The entire timeline grid (all rows, full configured year range, left label columns) regardless of scroll position. Image dimensions follow the grid, not a fixed 16:9 frame. The PPTX-style dark header band, legend strip, and branded footer frame are gone.
2. **Grid + legend + footer.** Below the grid, the image includes the marker legend and a branded footer (app name, agency attribution, export date) rendered in app styling.
3. **Capture as-is.** The PNG export drops the dialog options (year range, zoom, column toggles). The image shows the grid exactly as currently configured on screen. PPTX keeps its options.

## Architecture

### Capture mechanism

New dependency: `modern-screenshot` (MIT). It is the actively maintained html-to-image fork with Safari fixes. `domToCanvas(node, { scale })` clones the node, inlines computed styles, embeds webfonts and images as data URLs, serializes into `<svg><foreignObject>`, and rasterizes onto a canvas.

Node filtering: elements carrying a `data-export-exclude` attribute are filtered out of the capture via the library's `filter` option. The legend's help links get this attribute.

### Export snapshot host (new component)

`ExportSnapshotHostComponent` at `src/client/src/app/features/dashboard/export/export-snapshot-host.component.ts`. It is not routed and never visible. `PngExportService` creates it dynamically (`createComponent` + `ApplicationRef.attachView`), appends its host element to `document.body` positioned off-screen (`position: fixed; left: -100000px; top: 0`). It must not be `display: none`; layout has to run for capture.

The host stacks three sections in a single capture root:

1. `<app-dashboard-grid>` with the same inputs the live grid receives from `timeline-view`: companies, zoomLevel, startYear, endYear, and the column-hide flags. The host never scrolls, so the grid's internal `isScrolled()` stays false and the company column renders expanded even when the live view is scrolled.
2. `<app-legend [spaceId]>`, the real on-screen legend component (live-render single source of truth). Help links are marked `data-export-exclude` in the legend template; the attribute is inert on screen.
3. A footer block owned by the host template: tenant logo + app display name on the left, "Intelligence delivered by {agency}" when an agency brand is present, export date right-aligned. White background, slate text, dashboard typography. Content mirrors the current PPTX footer; styling is the app's, not the deck's.

### Service orchestration

`PngExportService.exportDashboard` is rewritten:

1. Create the host with a snapshot of grid state (see dialog section), attach to body.
2. Wait for readiness: `document.fonts.ready`, every `<img>` inside the host `complete` (logos), then two `requestAnimationFrame` ticks.
3. `domToCanvas(hostElement, { scale, filter })`.
4. `canvas.toBlob('image/png')`, then `saveBlob(blob, 'clinical-trial-dashboard.png')`.
5. Always destroy the component and zero the canvas dimensions in a `finally` block (Safari accounts canvas memory per page).

### Output sizing and scale clamp

Target scale is 2 for crisp output. A deeply zoomed multi-year grid can exceed browser canvas limits, which fail silently (blank image). Clamp:

```
scale = min(2, MAX_SIDE / width, MAX_SIDE / height, sqrt(MAX_AREA / (width * height)))
```

with `MAX_SIDE = 16384` and `MAX_AREA = 268435456` (the Safari per-canvas caps, the most restrictive mainstream limits). The clamp is a pure exported function with its own spec.

### Export dialog changes

`export-dialog.component.ts` already branches on `format`. Changes:

- When format is `png`, hide the year-range, zoom, and column-toggle controls. Show one line of copy: "The image matches the timeline exactly as shown on screen."
- `timeline-view` passes the dialog a snapshot of live grid state (zoomLevel plus the hide-column flags and spaceId, alongside the companies and resolved years it already passes). The dialog forwards that snapshot to `PngExportService` on confirm.
- PPTX path and its options are untouched.

### Deletions

- `png-export-renderer.ts` and its spec.
- `canvas-marker-glyph.ts` and its spec.
- PNG-only members of `export-common.util.ts` if any remain unused after deletion (`flattenTrials`, `buildLegendGroups`, `computeLeftColumns` stay; PPTX uses them).
- `GLYPH_RATIOS` in `marker-visual.ts` stays (SVG icons and PPTX glyph consume it). Any ratio entries documented as canvas-only lose that comment or move if unused.

## Error handling

Failures surface in the export dialog's existing error slot, as today. Known failure modes:

- **Logo CORS:** company and tenant logos must be fetchable for inlining. Supabase storage serves permissive CORS. If a fetch fails, the library throws; the dialog reports the export failed. No silent logo-less output.
- **Canvas allocation failure:** mitigated by the scale clamp; a residual failure (blank or null blob) reports through the same error path.
- **Empty grid:** exporting with zero companies stays a no-op, as today.

## Testing

Tests pair with each implementation task:

- **Vitest:** scale-clamp math (pure function); export dialog shows options for pptx and hides them with the replacement copy for png; snapshot host renders grid + legend + footer with forwarded inputs and `data-export-exclude` on legend help links (TestBed DOM assertions).
- **Playwright:** using the existing local-auth session injection and `URL.createObjectURL` hook pattern, trigger the PNG export, assert the blob has a PNG signature and dimensions equal to the host element's size times the chosen scale, and pixel-sample at least one marker location for its expected color.
- **Manual visual pass:** export side by side with the on-screen grid before merging.

## Out of scope

- PPTX export: unchanged, including its options and deck-style frame.
- Excel export: unchanged.
- Any change to the live dashboard grid's behavior or appearance beyond the inert `data-export-exclude` attributes.
