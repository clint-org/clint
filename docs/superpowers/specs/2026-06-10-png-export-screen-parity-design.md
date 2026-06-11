# PNG Export Screen Parity (Markers and Phase Bars)

- **Status:** Design approved, pending spec review
- **Date:** 2026-06-10
- **Related:** `docs/superpowers/specs/2026-06-10-timeline-image-excel-export-design.md`, `docs/superpowers/specs/2026-06-08-pptx-export-marker-fidelity-design.md`

## Problem

The PNG export's markers and phase bars visibly differ from the on-screen HTML/SVG rendering. The original export spec chose "PNG mirrors the PPTX data slide," so the canvas glyph renderer copied PowerPoint's approximations (rectangular flag banner, full-box diamond, thin square-capped strokes, always-stroked filled shapes). Users compare the PNG against the screen, not against the deck; the PNG should match the screen as closely as possible.

## Decisions (from brainstorming)

1. **The PNG now mirrors the screen, not the deck.** This supersedes decision 4 of the original export spec for glyph and bar painting only; the PNG's overall layout (header band, label columns, legend placement, footer) still follows the data-slide structure.
2. **The PowerPoint deck stays exactly as it is.** PowerPoint's native shapes cannot express the bezier flag or round-capped strokes; the deck keeps its current approximations. Its output must remain byte-identical.
3. **Approach: port the SVG geometry into the canvas renderer** (not rasterizing SVG markup into the canvas). Canvas 2D expresses everything the icons do; the renderer stays a synchronous pure function.

## Design

### Marker glyphs (`canvas-marker-glyph.ts`)

Match `src/client/src/app/shared/components/svg-icons/*` exactly:

- **Flag:** replace the rectangle banner with the pole + wavy-banner quadratic-bezier path from `flag-icon.component.ts` (pole at `flagPoleX`, banner `flagWidth` x `flagHeight` = 0.8 x 0.6, same control points). The `flagBannerW`/`flagBannerH` ratios remain for the PPTX renderer only; update their comment.
- **Diamond:** draw with `diamondHalfW`/`diamondHalfH` (0.42/0.48) instead of full-box vertices.
- **Fill/stroke rule:** filled glyphs get no outline; outline glyphs get a 1.5px stroke with white fill, matching the icons' `stroke-width: outline ? 1.5 : 0`.
- **Stroke weights and caps:** 1.5px for shape strokes, 2.5px for inner marks (dot is a fill, unaffected), 2.5px for the NLE strike, which spans exactly the glyph width (0 to size, no overhang). Round line caps and joins. Circle radius is `size / 2 - 1` so the stroke stays inside the box.
- **Absolute stroke widths at any glyph size.** The SVG icons use absolute px stroke-widths regardless of icon size, so the canvas does the same (no proportional scaling). The PNG legend's smaller glyphs therefore match the screen legend's look.
- **Dashed-line markers:** dash pattern 4,3 and the screen component's stroke width.
- **Single source of truth:** stroke numbers move into a shared `GLYPH_STROKES` constant in `core/models/marker-visual.ts`; the SVG icon components (circle, diamond, triangle, square, flag, plus the NLE overlay) switch to reading it. Zero visual change on screen; pure de-hardcoding.

### Phase bars (`png-export-renderer.ts`)

Match `phase-bar.component.*`:

- Bar height `min(14, rowH * 0.45)` logical px: normal exports get the screen's fixed 14px bar; crowded exports still shrink to fit.
- Border 1.2px, corner radius 3px.
- Label copied from the component: 9px semibold, same color, alignment, and padding, shown from 40px bar width (currently ~58px).

### What does not change

- PPTX deck output: byte-identical (`pptx-marker-glyph.ts` and `pptx-export.service.ts` untouched except the ratio comment).
- On-screen rendering: visually identical (icon components only swap hardcoded numbers for the shared constant).
- PNG layout: row heights, marker sizing and positions, date labels, legend placement, header, footer all unchanged. Only how each glyph and bar is painted.

## Testing

- `canvas-marker-glyph.spec.ts` updated and extended: filled shapes emit no stroke; diamond extents at 0.42/0.48; flag emits `quadraticCurveTo` ops with the icon's control points; dash pattern 4,3; NLE strike width 2.5 spanning exactly 0..size; round caps/joins set. The `CanvasGlyphSurface` type gains `quadraticCurveTo`, `lineCap`, `lineJoin`.
- `png-export-renderer.spec.ts`: pin the `min(14, rowH * 0.45)` bar height, 1.2px border, and 40px label threshold.
- Existing `pptx-marker-glyph.spec.ts` passing unchanged proves the deck is untouched.
- Existing Playwright export e2e covers the end-to-end flow; no changes needed.

## Non-goals

- No PPTX changes.
- No on-screen visual changes.
- No PNG layout changes (marker positioning, row metrics, legend flow).
- No rasterizing of SVG markup into the canvas.
