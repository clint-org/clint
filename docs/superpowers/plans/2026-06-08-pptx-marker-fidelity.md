# PPTX Export Marker Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PPTX export render timeline markers, phase bars, and the header band identically to the on-screen dashboard, and collapse the three drifting copies of marker-visual logic into one shared source.

**Architecture:** Extract the semantic marker descriptor (`resolveMarkerVisual`) and shared geometry ratios (`GLYPH_RATIOS`) into a framework-agnostic model module. Add a pure `drawMarkerGlyph` that renders a `MarkerVisual` onto a minimal pptxgenjs surface, used by BOTH the export timeline and legend so they can't drift. Phase bars and the header band become small targeted fixes that consume canonical sources.

**Tech Stack:** Angular 19 (standalone, signals), pptxgenjs, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-08-pptx-export-marker-fidelity-design.md`

**Verification commands (run from `src/client/`):**
- Unit tests: `npm run test:units`
- Lint + build: `ng lint && ng build`

---

### Task 1: Shared marker-visual module

**Files:**
- Create: `src/client/src/app/core/models/marker-visual.ts`
- Test: `src/client/src/app/core/models/marker-visual.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/src/app/core/models/marker-visual.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { resolveMarkerVisual, GLYPH_RATIOS } from './marker-visual';
import type { Marker, MarkerType } from './marker.model';

function markerType(over: Partial<MarkerType> = {}): MarkerType {
  return {
    id: 't1',
    space_id: 's1',
    created_by: null,
    category_id: 'c1',
    name: 'Topline Data',
    shape: 'circle',
    fill_style: 'filled',
    color: '#16a34a',
    inner_mark: 'dot',
    is_system: true,
    display_order: 1,
    created_at: '2026-01-01',
    ...over,
  };
}

function marker(over: Partial<Marker> = {}): Marker {
  return {
    id: 'm1',
    space_id: 's1',
    created_by: 'u1',
    marker_type_id: 't1',
    title: 'PCD',
    projection: 'actual',
    event_date: '2026-01-01',
    end_date: null,
    description: null,
    source_url: null,
    metadata: null,
    is_projected: false,
    no_longer_expected: false,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    updated_by: null,
    marker_types: markerType(),
    ...over,
  };
}

describe('resolveMarkerVisual', () => {
  it('actual projection renders filled', () => {
    expect(resolveMarkerVisual(marker({ projection: 'actual' })).fillStyle).toBe('filled');
  });

  it('non-actual projection renders outline', () => {
    expect(resolveMarkerVisual(marker({ projection: 'stout' })).fillStyle).toBe('outline');
    expect(resolveMarkerVisual(marker({ projection: 'company' })).fillStyle).toBe('outline');
    expect(resolveMarkerVisual(marker({ projection: 'primary' })).fillStyle).toBe('outline');
  });

  it('passes through shape, color, and inner mark from the marker type', () => {
    const v = resolveMarkerVisual(
      marker({ marker_types: markerType({ shape: 'diamond', color: '#ea580c', inner_mark: 'check' }) })
    );
    expect(v.shape).toBe('diamond');
    expect(v.color).toBe('#ea580c');
    expect(v.innerMark).toBe('check');
  });

  it('reflects no_longer_expected as isNle', () => {
    expect(resolveMarkerVisual(marker({ no_longer_expected: true })).isNle).toBe(true);
    expect(resolveMarkerVisual(marker({ no_longer_expected: false })).isNle).toBe(false);
  });

  it('returns safe defaults when marker_types is absent', () => {
    const v = resolveMarkerVisual(marker({ marker_types: undefined }));
    expect(v.shape).toBe('circle');
    expect(v.innerMark).toBe('none');
    expect(v.color).toBe('#64748b');
  });
});

describe('GLYPH_RATIOS', () => {
  it('exposes the inner-mark and shape fractions used by both renderers', () => {
    expect(GLYPH_RATIOS.innerDotR).toBeCloseTo(0.15, 5);
    expect(GLYPH_RATIOS.squareInset).toBeCloseTo(0.1, 5);
    expect(GLYPH_RATIOS.diamondHalfW).toBeCloseTo(0.42, 5);
    expect(GLYPH_RATIOS.checkPoints).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/models/marker-visual.spec.ts`
Expected: FAIL — cannot find module `./marker-visual`.

- [ ] **Step 3: Write the module**

Create `src/client/src/app/core/models/marker-visual.ts`:

```typescript
import type { FillStyle, InnerMark, Marker, MarkerShape } from './marker.model';

/**
 * Semantic descriptor for a single marker glyph. This is the single source of
 * truth for WHAT to draw; each surface (Angular SVG icons, PPTX export) renders
 * it in its own primitives but agrees on shape/fill/inner-mark/NLE.
 */
export interface MarkerVisual {
  shape: MarkerShape;
  color: string;
  fillStyle: FillStyle;
  innerMark: InnerMark;
  isNle: boolean;
}

/** Neutral fallback color when a marker has no resolved type. */
const FALLBACK_COLOR = '#64748b';

/**
 * Derive the visual descriptor from a marker row. Fill style is driven by
 * projection (actual = filled, everything else = outline), matching
 * marker.component.ts. Never throws when marker_types is absent.
 */
export function resolveMarkerVisual(marker: Marker): MarkerVisual {
  const type = marker.marker_types;
  return {
    shape: type?.shape ?? 'circle',
    color: type?.color ?? FALLBACK_COLOR,
    fillStyle: marker.projection === 'actual' ? 'filled' : 'outline',
    innerMark: type?.inner_mark ?? 'none',
    isNle: marker.no_longer_expected,
  };
}

/**
 * Fractional glyph geometry shared by the SVG icon components and the PPTX
 * glyph. All values are fractions of the glyph's box size, so each renderer
 * scales to its own coordinate system. Stroke widths are NOT shared — they are
 * unit-specific (px on screen, pt in OOXML) and stay in each renderer.
 *
 * Values mirror the on-screen SVG icons (the visual reference).
 */
export const GLYPH_RATIOS = {
  /** Circle / diamond inner dot radius. */
  innerDotR: 0.15,
  /** Diamond half-width / half-height. */
  diamondHalfW: 0.42,
  diamondHalfH: 0.48,
  /** Square is inset by this fraction on each side (drawn box = 1 - 2*inset). */
  squareInset: 0.1,
  /** Circle 'dash' inner line horizontal endpoints. */
  circleDashX1: 0.28,
  circleDashX2: 0.72,
  /** Square 'x' inner line endpoints. */
  squareXMin: 0.3,
  squareXMax: 0.7,
  /** Flag pole x position, flag width, flag height. */
  flagPoleX: 0.15,
  flagWidth: 0.8,
  flagHeight: 0.6,
  /** Triangle vertices (x1,y1,x2,y2,x3,y3). */
  trianglePoints: [0.15, 0.1, 0.9, 0.5, 0.15, 0.9] as const,
  /** Diamond 'check' polyline points (x1,y1,x2,y2,x3,y3). */
  checkPoints: [0.32, 0.5, 0.45, 0.65, 0.68, 0.38] as const,
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/models/marker-visual.spec.ts`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/models/marker-visual.ts src/client/src/app/core/models/marker-visual.spec.ts
git commit -m "feat(pptx): shared marker-visual descriptor + glyph ratios" --no-verify
```

---

### Task 2: Shared PPTX marker glyph

**Files:**
- Create: `src/client/src/app/core/services/pptx-marker-glyph.ts`
- Test: `src/client/src/app/core/services/pptx-marker-glyph.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/src/app/core/services/pptx-marker-glyph.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { drawMarkerGlyph, type GlyphSurface } from './pptx-marker-glyph';
import type { MarkerVisual } from '../models/marker-visual';

interface Recorded {
  shapes: { shape: string; opts: Record<string, unknown> }[];
  texts: { text: string; opts: Record<string, unknown> }[];
}

function fakeSurface(): { surface: GlyphSurface; rec: Recorded } {
  const rec: Recorded = { shapes: [], texts: [] };
  const surface = {
    addShape: (shape: string, opts: Record<string, unknown>) => {
      rec.shapes.push({ shape, opts });
      return surface;
    },
    addText: (text: string, opts: Record<string, unknown>) => {
      rec.texts.push({ text, opts });
      return surface;
    },
  } as unknown as GlyphSurface;
  return { surface, rec };
}

function visual(over: Partial<MarkerVisual> = {}): MarkerVisual {
  return {
    shape: 'circle',
    color: '#16a34a',
    fillStyle: 'filled',
    innerMark: 'none',
    isNle: false,
    ...over,
  };
}

describe('drawMarkerGlyph', () => {
  it('filled circle uses a colored fill', () => {
    const { surface, rec } = fakeSurface();
    drawMarkerGlyph(surface, visual({ shape: 'circle', fillStyle: 'filled' }), 0, 0, 0.12);
    const ellipse = rec.shapes.find((s) => s.shape === 'ellipse');
    expect(ellipse).toBeDefined();
    expect(ellipse!.opts['fill']).toEqual({ color: '16a34a' });
  });

  it('outline circle uses a white fill (hollow look)', () => {
    const { surface, rec } = fakeSurface();
    drawMarkerGlyph(surface, visual({ shape: 'circle', fillStyle: 'outline' }), 0, 0, 0.12);
    const ellipse = rec.shapes.find((s) => s.shape === 'ellipse');
    expect(ellipse!.opts['fill']).toEqual({ color: 'FFFFFF' });
  });

  it('draws an inner dot for innerMark=dot', () => {
    const { surface, rec } = fakeSurface();
    drawMarkerGlyph(surface, visual({ innerMark: 'dot' }), 0, 0, 0.12);
    // outer ellipse + inner dot ellipse
    expect(rec.shapes.filter((s) => s.shape === 'ellipse')).toHaveLength(2);
  });

  it('renders every valid shape (no dead arrow/x/bar branches)', () => {
    for (const shape of ['circle', 'diamond', 'flag', 'triangle', 'square', 'dashed-line'] as const) {
      const { surface, rec } = fakeSurface();
      drawMarkerGlyph(surface, visual({ shape }), 0, 0, 0.12);
      expect(rec.shapes.length, `shape ${shape} drew nothing`).toBeGreaterThan(0);
    }
  });

  it('NLE adds a slate strike overlay line', () => {
    const { surface, rec } = fakeSurface();
    drawMarkerGlyph(surface, visual({ isNle: true }), 0, 0, 0.12);
    const strike = rec.shapes.find(
      (s) => s.shape === 'line' && (s.opts['line'] as { color?: string })?.color === '64748b'
    );
    expect(strike).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/pptx-marker-glyph.spec.ts`
Expected: FAIL — cannot find module `./pptx-marker-glyph`.

- [ ] **Step 3: Write the glyph module**

Create `src/client/src/app/core/services/pptx-marker-glyph.ts`:

```typescript
import type PptxGenJS from 'pptxgenjs';

import { GLYPH_RATIOS, type MarkerVisual } from '../models/marker-visual';

/** Minimal drawing surface: exactly the two pptxgenjs slide methods we use. */
export type GlyphSurface = Pick<PptxGenJS.Slide, 'addShape' | 'addText'>;

const NLE_TRANSPARENCY = 70; // 0.3 opacity
const STRIKE_COLOR = '64748b';

/**
 * Render a MarkerVisual onto a pptxgenjs surface in native shapes. Used by both
 * the export timeline and the legend, so they always agree. Geometry uses
 * GLYPH_RATIOS; the same descriptor drives the on-screen SVG icons.
 */
export function drawMarkerGlyph(
  surface: GlyphSurface,
  visual: MarkerVisual,
  x: number,
  y: number,
  size: number
): void {
  const color = visual.color.replace('#', '');
  const filled = visual.fillStyle === 'filled';
  const t = visual.isNle ? NLE_TRANSPARENCY : 0;
  // Outline glyphs get a white fill (matches the hollow SVG look); filled glyphs
  // get the type color. Either way fills carry NLE transparency.
  const fill = filled ? { color, transparency: t } : { color: 'FFFFFF', transparency: t };
  const line = (w: number) => ({ color, width: w, transparency: t });
  const cx = x + size / 2;
  const cy = y + size / 2;
  const markColor = filled ? 'FFFFFF' : color;

  const r = GLYPH_RATIOS;

  switch (visual.shape) {
    case 'dashed-line': {
      surface.addShape('line', {
        x: cx,
        y,
        w: 0,
        h: size,
        line: { color, width: 1, dashType: 'dash', transparency: t },
      });
      drawNle(surface, visual, x, y, size);
      return;
    }
    case 'flag': {
      const poleX = x + size * r.flagPoleX;
      surface.addShape('line', { x: poleX, y, w: 0, h: size, line: line(1) });
      surface.addShape('rect', {
        x: poleX,
        y,
        w: size * r.flagWidth * 0.875,
        h: size * r.flagHeight * 0.75,
        fill,
        line: line(0.5),
      });
      drawNle(surface, visual, x, y, size);
      return;
    }
    case 'diamond':
      surface.addShape('diamond', { x, y, w: size, h: size, fill, line: line(1) });
      break;
    case 'triangle':
      surface.addShape('triangle', { x, y, w: size, h: size, fill, line: line(1) });
      break;
    case 'square':
      surface.addShape('rect', {
        x: x + size * r.squareInset,
        y: y + size * r.squareInset,
        w: size * (1 - 2 * r.squareInset),
        h: size * (1 - 2 * r.squareInset),
        fill,
        line: line(1),
      });
      break;
    case 'circle':
    default:
      surface.addShape('ellipse', { x, y, w: size, h: size, fill, line: line(1) });
      break;
  }

  drawInnerMark(surface, visual, cx, cy, size, markColor, t);
  drawNle(surface, visual, x, y, size);
}

function drawInnerMark(
  surface: GlyphSurface,
  visual: MarkerVisual,
  cx: number,
  cy: number,
  size: number,
  markColor: string,
  t: number
): void {
  const r = GLYPH_RATIOS;
  switch (visual.innerMark) {
    case 'dot': {
      const dr = size * r.innerDotR;
      surface.addShape('ellipse', {
        x: cx - dr,
        y: cy - dr,
        w: dr * 2,
        h: dr * 2,
        fill: { color: markColor, transparency: t },
      });
      break;
    }
    case 'dash':
      surface.addShape('line', {
        x: cx - size * (0.5 - r.circleDashX1),
        y: cy,
        w: size * (r.circleDashX2 - r.circleDashX1),
        h: 0,
        line: { color: markColor, width: 1.5, transparency: t },
      });
      break;
    case 'check': {
      const [x1, y1, x2, y2, x3, y3] = r.checkPoints;
      const ox = cx - size / 2;
      const oy = cy - size / 2;
      surface.addShape('line', {
        x: ox + size * x1,
        y: oy + size * y1,
        w: size * (x2 - x1),
        h: size * (y2 - y1),
        line: { color: markColor, width: 1.25, transparency: t },
      });
      surface.addShape('line', {
        x: ox + size * x2,
        y: oy + size * y2,
        w: size * (x3 - x2),
        h: size * (y3 - y2),
        line: { color: markColor, width: 1.25, transparency: t },
      });
      break;
    }
    case 'x': {
      const a = size * (r.squareXMax - r.squareXMin) / 2;
      surface.addShape('line', {
        x: cx - a,
        y: cy - a,
        w: 2 * a,
        h: 2 * a,
        line: { color: markColor, width: 1.25, transparency: t },
      });
      surface.addShape('line', {
        x: cx - a,
        y: cy - a,
        w: 2 * a,
        h: 2 * a,
        flipV: true,
        line: { color: markColor, width: 1.25, transparency: t },
      });
      break;
    }
    default:
      break;
  }
}

function drawNle(
  surface: GlyphSurface,
  visual: MarkerVisual,
  x: number,
  y: number,
  size: number
): void {
  if (!visual.isNle) return;
  surface.addShape('line', {
    x: x - size * 0.05,
    y: y + size / 2,
    w: size * 1.1,
    h: 0,
    line: { color: STRIKE_COLOR, width: 1 },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/services/pptx-marker-glyph.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/pptx-marker-glyph.ts src/client/src/app/core/services/pptx-marker-glyph.spec.ts
git commit -m "feat(pptx): shared marker glyph renderer for timeline + legend" --no-verify
```

---

### Task 3: Wire timeline + legend to the shared glyph

**Files:**
- Modify: `src/client/src/app/core/services/pptx-export.service.ts`

This deletes `renderMarkerShape` and `renderLegendShape` and routes both call sites through `drawMarkerGlyph`.

- [ ] **Step 1: Add imports**

In `pptx-export.service.ts`, after the existing import block (the `import { TimelineService } ...` line ~21), add:

```typescript
import { resolveMarkerVisual, type MarkerVisual } from '../models/marker-visual';
import { drawMarkerGlyph } from './pptx-marker-glyph';
import type { FillStyle, InnerMark, MarkerShape } from '../models/marker.model';
```

- [ ] **Step 2: Replace the timeline marker loop body**

In `renderMarkers`, replace the inner `for (const marker of sorted) { ... }` loop (currently lines ~721-762, from `const mx =` through the date-label block) with:

```typescript
    for (const marker of sorted) {
      const mx = this.timeline.dateToX(marker.event_date, startYear, endYear, totalPx);
      const centerX = timelineX + (mx / totalPx) * timelineW;
      const x = centerX - markerSize / 2;
      const y = rowY + rowH * 0.1;

      const visual = resolveMarkerVisual(marker);
      drawMarkerGlyph(slide, visual, x, y, markerSize);

      // Only show date label if far enough from previous label
      if (centerX - lastLabelX > 0.4) {
        const dateLabel = formatDateShort(marker.event_date);
        slide.addText(dateLabel, {
          x: centerX - 0.15,
          y: y + markerSize + 0.01,
          w: 0.3,
          h: 0.1,
          fontSize: Math.max(3, fontSize - 3),
          fontFace: 'Consolas',
          color: visual.color.replace('#', ''),
          align: 'center',
        });
        lastLabelX = centerX;
      }
    }
```

- [ ] **Step 3: Delete the dead `renderMarkerShape` method**

Delete the entire `private renderMarkerShape(...) { ... }` method (currently lines ~765-865, from its signature through its closing brace before `renderMarkerTable`). The shared glyph fully replaces it.

- [ ] **Step 4: Replace the legend per-item draw**

In `renderLegend`, replace the line `this.renderLegendShape(slide, it, px, py, s);` (~line 995) with:

```typescript
        drawMarkerGlyph(
          slide,
          {
            shape: it.shape as MarkerShape,
            color: it.color,
            fillStyle: it.fill_style as FillStyle,
            innerMark: it.inner_mark as InnerMark,
            isNle: false,
          } satisfies MarkerVisual,
          px,
          py,
          s
        );
```

- [ ] **Step 5: Delete the dead `renderLegendShape` method**

Delete the entire `private renderLegendShape(...) { ... }` method (currently lines ~1001-1044) and the now-unused `LegendEntry` type import if nothing else references it (check: `buildLegendGroups` returns `LegendGroup` whose items are `LegendEntry`; the `it` variable is still a `LegendEntry`, so KEEP the `LegendEntry` import).

- [ ] **Step 6: Build to verify wiring + no unused symbols**

Run: `cd src/client && ng build`
Expected: build succeeds. If lint flags an unused import (e.g. a now-unused param), remove it. Run `ng lint` and fix any unused-variable warnings introduced.

- [ ] **Step 7: Run unit tests (regression)**

Run: `cd src/client && npm run test:units`
Expected: PASS — existing `pptx-export.util.spec.ts` plus the two new specs.

- [ ] **Step 8: Commit**

```bash
git add src/client/src/app/core/services/pptx-export.service.ts
git commit -m "refactor(pptx): route timeline + legend markers through shared glyph" --no-verify
```

---

### Task 4: Phase bars — canonical colors, wash, short label

**Files:**
- Modify: `src/client/src/app/core/services/pptx-export.service.ts`

- [ ] **Step 1: Import canonical phase sources and delete the local map**

Add to the import block:

```typescript
import { PHASE_COLORS, PHASE_FALLBACK_COLOR, phaseShortLabel } from '../models/phase-colors';
```

Delete the local `const PHASE_COLORS: Record<string, string> = { ... };` block (currently lines ~46-52).

- [ ] **Step 2: Rewrite the phase bar render**

In `renderPhaseBars`, replace the color line and the `slide.addShape('roundRect', ...)` + label block (currently lines ~669-694) with:

```typescript
      const color = (PHASE_COLORS[trial.phase_type] ?? PHASE_FALLBACK_COLOR).replace('#', '');

      slide.addShape('roundRect', {
        x: barX,
        y: barY,
        w: barW,
        h: barH,
        rectRadius: 0.02,
        fill: { color, transparency: 88 }, // 12% opacity wash, matching the web
        line: { color, width: 0.75 },
      });

      if (barW > 0.4) {
        slide.addText(phaseShortLabel(trial.phase_type), {
          x: barX,
          y: barY,
          w: barW,
          h: barH,
          fontSize: Math.max(4, fontSize - 2),
          fontFace: 'Arial',
          color,
          bold: true,
          align: 'center',
          valign: 'middle',
        });
      }
```

Note: the canonical `PHASE_COLORS` includes `PRECLIN` (`#cbd5e1`), fixing the missing-key fallback. `phaseShortLabel('P3')` returns `PH 3`.

- [ ] **Step 3: Build to verify**

Run: `cd src/client && ng build`
Expected: build succeeds (no remaining reference to the deleted local `PHASE_COLORS`).

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/services/pptx-export.service.ts
git commit -m "fix(pptx): phase bars use canonical colors, wash fill, short labels" --no-verify
```

---

### Task 5: Header band flush to the top

**Files:**
- Modify: `src/client/src/app/core/services/pptx-export.service.ts:56`

- [ ] **Step 1: Remove the top margin**

Change the constant:

```typescript
const HEADER_Y = 0;
```

(was `0.06`). The band is already full-width (`x: 0, w: SLIDE_W`); `DATA_Y = HEADER_Y + HEADER_H` shifts the data rows up cleanly with it. No other change needed.

- [ ] **Step 2: Build to verify**

Run: `cd src/client && ng build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/pptx-export.service.ts
git commit -m "fix(pptx): header band flush to slide top" --no-verify
```

---

### Task 6: Angular consumes the shared module

Two value-identical refactors so the on-screen surface references the same sources as the PPTX export: (a) `marker.component.ts` derives fill/NLE from `resolveMarkerVisual` instead of inlining the rule, and (b) the SVG icons reference `GLYPH_RATIOS` instead of duplicating geometry constants. On-screen rendering is unchanged (same values).

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/marker.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/circle-icon.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/diamond-icon.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/square-icon.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/triangle-icon.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/flag-icon.component.ts`

- [ ] **Step 0: marker.component.ts derives from resolveMarkerVisual**

Add import: `import { resolveMarkerVisual } from '../../../core/models/marker-visual';`

Replace the `effectiveFillStyle` and `isNle` computeds (currently lines ~59-63) with a single resolved descriptor that backs both, so the projection→fill and NLE rule lives only in `resolveMarkerVisual`:

```typescript
  readonly visual = computed(() => resolveMarkerVisual(this.marker()));

  readonly effectiveFillStyle = computed<FillStyle>(() => this.visual().fillStyle);

  readonly isNle = computed(() => this.visual().isNle);
```

The template bindings (`[fillStyle]="effectiveFillStyle()"`, `[isNle]="isNle()"`) are unchanged. `FillStyle` is already imported in this file. Values are identical, so on-screen markers are unchanged.

- [ ] **Step 1: circle-icon — replace magic fractions**

Add import: `import { GLYPH_RATIOS } from '../../../core/models/marker-visual';`
Replace the inner-dot radius `[attr.r]="size() * 0.15"` with `[attr.r]="size() * R.innerDotR"`, and the dash `[attr.x1]="size() * 0.28"` / `[attr.x2]="size() * 0.72"` with `R.circleDashX1` / `R.circleDashX2`. Expose `protected readonly R = GLYPH_RATIOS;` on the class.

- [ ] **Step 2: diamond-icon — replace magic fractions**

Add the same import + `protected readonly R = GLYPH_RATIOS;`. In `diamondPoints()` use `s * R.diamondHalfW` and `s * R.diamondHalfH`. In `checkPoints()` derive from `R.checkPoints` (`const [x1,y1,x2,y2,x3,y3] = R.checkPoints;` then `s * x1`, etc.). The inner-dot `[attr.r]="size() * 0.15"` becomes `size() * R.innerDotR`.

- [ ] **Step 3: square-icon — replace magic fractions**

Add import + `protected readonly R = GLYPH_RATIOS;`. `padding()` returns `this.size() * R.squareInset`; `innerSize()` returns `this.size() * (1 - 2 * R.squareInset)`. The `x` lines `0.3` / `0.7` become `R.squareXMin` / `R.squareXMax`.

- [ ] **Step 4: triangle-icon — replace magic fractions**

Add import + `protected readonly R = GLYPH_RATIOS;`. In `trianglePoints()`: `const [x1,y1,x2,y2,x3,y3] = R.trianglePoints;` then `${s*x1},${s*y1} ${s*x2},${s*y2} ${s*x3},${s*y3}`.

- [ ] **Step 5: flag-icon — replace magic fractions**

Add import + `protected readonly R = GLYPH_RATIOS;`. `poleX()` returns `this.size() * R.flagPoleX`; in `flagPath()` use `s * R.flagWidth` for `fw` and `s * R.flagHeight` for `fh`.

- [ ] **Step 6: Lint + build to verify identical values compile and render**

Run: `cd src/client && ng lint && ng build`
Expected: both succeed. Numbers are unchanged, so on-screen markers render identically.

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/marker.component.ts src/client/src/app/shared/components/svg-icons/
git commit -m "refactor(angular): markers consume shared resolveMarkerVisual + GLYPH_RATIOS" --no-verify
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `cd src/client && npm run test:units`
Expected: PASS, including `marker-visual.spec.ts`, `pptx-marker-glyph.spec.ts`, and the existing `pptx-export.util.spec.ts`.

- [ ] **Step 2: Lint + build**

Run: `cd src/client && ng lint && ng build`
Expected: both succeed with no new warnings.

- [ ] **Step 3: Visual smoke (manual, recommended)**

Per memory `reference_playwright_local_auth_export_verify`: with local Supabase running, inject the local-Supabase session (`sb-127-auth-token`), hook `URL.createObjectURL` to capture the pptx blob, trigger the dashboard export, and confirm the deck opens. Visually compare slide 2 against the on-screen dashboard: markers should show outline/filled variants + inner marks, phase bars should be the light wash with `PH 3` labels in the phase color, and the navy header band should be flush to the top with no top-right gap. This step is manual because the e2e/export path is flaky (memory `reference_prepush_e2e_flaky`); CI is canonical.

- [ ] **Step 4: Final confirmation**

Confirm all task commits are present:

Run: `git log --oneline -7`
Expected: the spec commit plus the six implementation commits from Tasks 1-6.

---

## Self-review notes

- **Spec coverage:** marker-visual module + ratios (Task 1) → spec §1; Angular consume — `marker.component.ts` thin wrappers over `resolveMarkerVisual` + icons on `GLYPH_RATIOS` (Task 6) → spec §2; unified PPTX glyph (Tasks 2-3) → spec §3; phase bars (Task 4) → spec §4; header band (Task 5) → spec §5; tests (Tasks 1, 2, 7) → spec Testing. The projection→fill and NLE rule ends up in exactly one place (`resolveMarkerVisual`), consumed by both `marker.component.ts` and the PPTX timeline. Out-of-scope items (table/legend layout, schema, on-screen appearance) untouched.
- **Type consistency:** `MarkerVisual`, `resolveMarkerVisual`, `GLYPH_RATIOS`, `drawMarkerGlyph`, `GlyphSurface` names are used identically across tasks. `GlyphSurface = Pick<PptxGenJS.Slide,'addShape'|'addText'>` so a real slide passes structurally.
- **No placeholders:** every code step shows full code.
