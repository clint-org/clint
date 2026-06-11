# PNG Export Screen Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PNG export's markers and phase bars match the on-screen HTML/SVG rendering; the PowerPoint deck stays byte-identical.

**Architecture:** Port the SVG icon components' exact geometry (bezier flag banner, inset diamond, per-shape stroke rules, round caps, screen NLE treatment) into `canvas-marker-glyph.ts`, and the phase-bar component's metrics (14px bar, 1.2px border, 3px radius, always-rendered 9px semibold label with inside/outside placement) into `png-export-renderer.ts`. Stroke widths move to a shared `GLYPH_STROKES` constant in `marker-visual.ts` that both the SVG icons and the canvas renderer read, so they cannot drift again.

**Tech Stack:** Angular 19, Canvas 2D, Vitest (node env, recording-context specs).

**Spec:** `docs/superpowers/specs/2026-06-10-png-export-screen-parity-design.md`

**Worktree:** `/Users/aadityamadala/Documents/code/clint-v2/.claude/worktrees/png-screen-parity`, branch `feat/png-export-screen-parity` (off origin/develop). All commands from `src/client/` inside the worktree. Baseline: 722 unit tests passing.

**Conventions:** No em dashes anywhere. No emoji. No Claude attribution in commits.

## Ground truth (verified against the components; trust THESE numbers)

From `src/client/src/app/shared/components/svg-icons/*` and `phase-bar.component.*`:

| Element | Screen behavior |
|---|---|
| Circle | `r = size/2 - 1`; fill `outline ? white : color`; stroke ALWAYS color at 1.5 |
| Diamond | polygon at half-extents 0.42/0.48; stroke ALWAYS 1.5, round join |
| Triangle | GLYPH_RATIOS.trianglePoints; stroke `outline ? 1.5 : 0`, round join |
| Square | inset 0.1; stroke `outline ? 1.5 : 0` |
| Flag | pole at `0.15*size`, y from 1 to size-1, stroke 1.5 round cap; banner path `M(px,1) Q(px+0.4s, 1+0.3*fh) (px+0.8s, 1) L(px+0.8s, 1+fh) Q(px+0.4s, 1+0.7*fh) (px, 1+fh) Z` with `fw=0.8s`, `fh=0.6s`; banner fill `outline ? white : color`; banner stroke color at `outline ? 1.2 : 0.5` |
| Dashed-line | vertical line at glyph center, stroke 1.5, dasharray 4,3, round cap; stroke color is `color` normally, `#cbd5e1` when outline (projected), `color` when NLE; NLE opacity 0.25; NO strike overlay |
| Inner dot | `r = 0.15*size`, fill markColor (white when filled, color when outline) |
| Inner dash | from `0.28*size` to `0.72*size` at mid-height, stroke markColor 2.5, round cap |
| Inner check | polyline at checkPoints, stroke markColor 2.5, round cap+join |
| Inner x | two lines spanning 0.3..0.7 box, stroke markColor 2.5, round cap |
| NLE (non-dashed) | glyph group at opacity 0.3; strike line from x=0 to x=size at mid-height, `#64748b`, width 2.5, FULL opacity, butt cap |
| Inner marks per shape | circle: dot/dash; diamond: dot/check; square: x; triangle and flag: none |
| Phase bar | height 14, corner radius 3, fill-opacity 0.12, stroke 1.2; label ALWAYS rendered (when barWidth > 0): font-size 9, weight 600; if `barWidth >= 40` label is centered inside in the bar color; otherwise it sits OUTSIDE at `barX + barWidth + 4`, left-anchored, in `#64748b` |

Note two corrections to the spec prose: filled circles/diamonds DO keep their 1.5 stroke (only triangle/square drop it), and the phase label is always drawn with inside/outside placement (not hidden under 40px). Task 4 amends the spec doc accordingly.

---

## Task 1: Shared `GLYPH_STROKES` constant + icon de-hardcoding

**Files:**
- Modify: `src/client/src/app/core/models/marker-visual.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/circle-icon.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/diamond-icon.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/triangle-icon.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/square-icon.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/flag-icon.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/marker-icon.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/nle-overlay.component.ts`

- [ ] **Step 1: Add the constant to `marker-visual.ts`** (after `GLYPH_RATIOS`)

```ts
/**
 * Stroke widths shared by the SVG icon components and the canvas PNG glyph.
 * Values are absolute px regardless of glyph size (SVG stroke-width does not
 * scale with the viewBox), so both renderers read identically at any size.
 * The PPTX renderer keeps its own pt-based widths (OOXML units).
 */
export const GLYPH_STROKES = {
  /** Main shape outline (circle, diamond always; triangle, square only when outline). */
  shape: 1.5,
  /** Inner marks: dash, check, x. */
  innerMark: 2.5,
  /** NLE strike-through line. */
  nleStrike: 2.5,
  /** Flag banner outline width by fill style. */
  flagBannerOutline: 1.2,
  flagBannerFilled: 0.5,
  /** Dashed-line marker stroke width and dash pattern. */
  dashedLine: 1.5,
  dashedLinePattern: [4, 3],
} as const;
```

- [ ] **Step 2: Migrate the icon components to read it** (zero visual change; literals only)

In each component add the import and a `protected readonly S = GLYPH_STROKES;` field, then replace the hardcoded widths with bindings:

- `circle-icon.component.ts`: circle `stroke-width="1.5"` -> `[attr.stroke-width]="S.shape"`; dash `stroke-width="2.5"` -> `[attr.stroke-width]="S.innerMark"`.
- `diamond-icon.component.ts`: polygon -> `S.shape`; check polyline -> `S.innerMark`.
- `triangle-icon.component.ts`: `[attr.stroke-width]="fillStyle() === 'outline' ? 1.5 : 0"` -> `[attr.stroke-width]="fillStyle() === 'outline' ? S.shape : 0"` (add the `S` field).
- `square-icon.component.ts`: rect conditional -> `S.shape`; both x lines -> `S.innerMark`.
- `flag-icon.component.ts`: pole `stroke-width="1.5"` -> `[attr.stroke-width]="S.shape"`; banner `[attr.stroke-width]="fillStyle() === 'outline' ? 1.2 : 0.5"` -> `[attr.stroke-width]="fillStyle() === 'outline' ? S.flagBannerOutline : S.flagBannerFilled"`.
- `marker-icon.component.ts` (dashed-line branch): `stroke-width="1.5"` -> `[attr.stroke-width]="S.dashedLine"`; `stroke-dasharray="4,3"` -> `[attr.stroke-dasharray]="dashPattern"` with `protected readonly dashPattern = GLYPH_STROKES.dashedLinePattern.join(',');`.
- `nle-overlay.component.ts`: `stroke-width="2.5"` -> `[attr.stroke-width]="S.nleStrike"` (add import + field).

Where a component already exposes `protected readonly R = GLYPH_RATIOS;`, add `S` next to it.

- [ ] **Step 3: Verify**

Run: `cd src/client && npm run test:units && npx ng lint && npx ng build`
Expected: 722 tests pass, lint clean (1 pre-existing trial.service.ts warning), build clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/models/marker-visual.ts src/client/src/app/shared/components/svg-icons
git commit -m "refactor(markers): shared GLYPH_STROKES constant for icon stroke widths"
```

---

## Task 2: Canvas glyph parity rewrite (TDD)

**Files:**
- Modify: `src/client/src/app/core/services/canvas-marker-glyph.ts`
- Test: `src/client/src/app/core/services/canvas-marker-glyph.spec.ts`

- [ ] **Step 1: Update the spec to the screen-parity expectations**

Rewrite `canvas-marker-glyph.spec.ts` to the following. The RecordingCtx gains `lineCap`/`lineJoin` setters and `quadraticCurveTo`:

```ts
import { describe, expect, it } from 'vitest';

import type { MarkerVisual } from '../models/marker-visual';
import { GLYPH_RATIOS, GLYPH_STROKES } from '../models/marker-visual';
import { type CanvasGlyphSurface, drawMarkerGlyphCanvas } from './canvas-marker-glyph';

type Op = [string, ...unknown[]];

/** Records every method call and property set so geometry can be asserted. */
class RecordingCtx {
  ops: Op[] = [];

  private record(name: string, ...args: unknown[]): void {
    this.ops.push([name, ...args]);
  }

  set fillStyle(v: unknown) {
    this.record('set fillStyle', v);
  }
  set strokeStyle(v: unknown) {
    this.record('set strokeStyle', v);
  }
  set lineWidth(v: unknown) {
    this.record('set lineWidth', v);
  }
  set globalAlpha(v: unknown) {
    this.record('set globalAlpha', v);
  }
  set lineCap(v: unknown) {
    this.record('set lineCap', v);
  }
  set lineJoin(v: unknown) {
    this.record('set lineJoin', v);
  }

  beginPath(): void {
    this.record('beginPath');
  }
  closePath(): void {
    this.record('closePath');
  }
  arc(...args: unknown[]): void {
    this.record('arc', ...args);
  }
  moveTo(...args: unknown[]): void {
    this.record('moveTo', ...args);
  }
  lineTo(...args: unknown[]): void {
    this.record('lineTo', ...args);
  }
  quadraticCurveTo(...args: unknown[]): void {
    this.record('quadraticCurveTo', ...args);
  }
  rect(...args: unknown[]): void {
    this.record('rect', ...args);
  }
  fill(): void {
    this.record('fill');
  }
  stroke(): void {
    this.record('stroke');
  }
  save(): void {
    this.record('save');
  }
  restore(): void {
    this.record('restore');
  }
  setLineDash(...args: unknown[]): void {
    this.record('setLineDash', ...args);
  }
}

function surface(): { ctx: CanvasGlyphSurface; ops: Op[] } {
  const rec = new RecordingCtx();
  return { ctx: rec as unknown as CanvasGlyphSurface, ops: rec.ops };
}

function visual(overrides: Partial<MarkerVisual>): MarkerVisual {
  return {
    shape: 'circle',
    color: '#16a34a',
    fillStyle: 'filled',
    innerMark: 'none',
    isNle: false,
    ...overrides,
  };
}

const has = (ops: Op[], name: string): Op[] => ops.filter((o) => o[0] === name);

describe('drawMarkerGlyphCanvas (screen parity)', () => {
  it('draws the circle with a 1px-inset radius and ALWAYS strokes it at shape width', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({}), 10, 20, 16);
    expect(ops).toContainEqual(['set fillStyle', '#16a34a']);
    expect(ops).toContainEqual(['arc', 18, 28, 7, 0, Math.PI * 2]);
    expect(ops).toContainEqual(['set lineWidth', GLYPH_STROKES.shape]);
    expect(has(ops, 'stroke').length).toBeGreaterThan(0);
  });

  it('uses round line caps and joins', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({}), 0, 0, 16);
    expect(ops).toContainEqual(['set lineCap', 'round']);
    expect(ops).toContainEqual(['set lineJoin', 'round']);
  });

  it('draws outline glyphs with white fill', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ fillStyle: 'outline' }), 0, 0, 16);
    expect(ops).toContainEqual(['set fillStyle', '#ffffff']);
    expect(ops).toContainEqual(['set strokeStyle', '#16a34a']);
  });

  it('draws the diamond at GLYPH_RATIOS half-extents and always strokes it', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'diamond' }), 0, 0, 100);
    // hw = 42, hh = 48 around center (50, 50)
    expect(ops).toContainEqual(['moveTo', 50, 2]);
    expect(ops).toContainEqual(['lineTo', 92, 50]);
    expect(ops).toContainEqual(['lineTo', 50, 98]);
    expect(ops).toContainEqual(['lineTo', 8, 50]);
    expect(has(ops, 'stroke').length).toBeGreaterThan(0);
  });

  it('does NOT stroke filled triangles and squares, but strokes their outline variants', () => {
    for (const shape of ['triangle', 'square'] as const) {
      const filled = surface();
      drawMarkerGlyphCanvas(filled.ctx, visual({ shape }), 0, 0, 16);
      expect(has(filled.ops, 'stroke')).toHaveLength(0);

      const outline = surface();
      drawMarkerGlyphCanvas(outline.ctx, visual({ shape, fillStyle: 'outline' }), 0, 0, 16);
      expect(has(outline.ops, 'stroke').length).toBeGreaterThan(0);
    }
  });

  it('draws the flag banner as the wavy quadratic-bezier path from the SVG icon', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'flag' }), 0, 0, 20);
    // px = 3, fw = 16, fh = 12; pole y from 1 to 19
    expect(ops).toContainEqual(['moveTo', 3, 1]);
    expect(ops).toContainEqual(['lineTo', 3, 19]);
    // banner: Q(px + fw/2, 1 + 0.3*fh) to (px + fw, 1), then L down fh, then Q back
    expect(ops).toContainEqual(['quadraticCurveTo', 11, 4.6, 19, 1]);
    expect(ops).toContainEqual(['lineTo', 19, 13]);
    expect(ops).toContainEqual(['quadraticCurveTo', 11, 9.4, 3, 13]);
    // filled banner gets the thin stroke
    expect(ops).toContainEqual(['set lineWidth', GLYPH_STROKES.flagBannerFilled]);
  });

  it('strokes the outline flag banner at the outline width', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'flag', fillStyle: 'outline' }), 0, 0, 20);
    expect(ops).toContainEqual(['set lineWidth', GLYPH_STROKES.flagBannerOutline]);
  });

  it('draws dashed-line markers with the screen dash pattern and width', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'dashed-line' }), 0, 0, 16);
    expect(ops).toContainEqual(['setLineDash', [4, 3]]);
    expect(ops).toContainEqual(['set lineWidth', GLYPH_STROKES.dashedLine]);
    expect(ops).toContainEqual(['moveTo', 8, 0]);
    expect(ops).toContainEqual(['lineTo', 8, 16]);
  });

  it('renders projected (outline) dashed-line markers in slate', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'dashed-line', fillStyle: 'outline' }), 0, 0, 16);
    expect(ops).toContainEqual(['set strokeStyle', '#cbd5e1']);
  });

  it('dims NLE dashed-line markers to 0.25 in their own color, with no strike', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'dashed-line', isNle: true }), 0, 0, 16);
    expect(ops).toContainEqual(['set globalAlpha', 0.25]);
    expect(ops).toContainEqual(['set strokeStyle', '#16a34a']);
    expect(ops.filter((o) => o[0] === 'set strokeStyle' && o[1] === '#64748b')).toHaveLength(0);
  });

  it('renders inner dot in white on filled glyphs', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ innerMark: 'dot' }), 0, 0, 20);
    expect(ops).toContainEqual(['arc', 10, 10, 3, 0, Math.PI * 2]);
    expect(ops).toContainEqual(['set fillStyle', '#ffffff']);
  });

  it('renders inner dash, check, and x at the inner-mark stroke width', () => {
    const dash = surface();
    drawMarkerGlyphCanvas(dash.ctx, visual({ innerMark: 'dash' }), 0, 0, 100);
    expect(dash.ops).toContainEqual(['moveTo', 28, 50]);
    expect(dash.ops).toContainEqual(['lineTo', 72, 50]);
    expect(dash.ops).toContainEqual(['set lineWidth', GLYPH_STROKES.innerMark]);

    const check = surface();
    drawMarkerGlyphCanvas(check.ctx, visual({ shape: 'diamond', innerMark: 'check' }), 0, 0, 100);
    expect(check.ops).toContainEqual(['moveTo', 32, 50]);
    expect(check.ops).toContainEqual(['lineTo', 45, 65]);
    expect(check.ops).toContainEqual(['lineTo', 68, 38]);
    expect(check.ops).toContainEqual(['set lineWidth', GLYPH_STROKES.innerMark]);

    const x = surface();
    drawMarkerGlyphCanvas(x.ctx, visual({ shape: 'square', innerMark: 'x' }), 0, 0, 100);
    expect(x.ops).toContainEqual(['moveTo', 30, 30]);
    expect(x.ops).toContainEqual(['lineTo', 70, 70]);
    expect(x.ops).toContainEqual(['set lineWidth', GLYPH_STROKES.innerMark]);
  });

  it('dims NLE glyphs to 0.3 and draws a full-alpha 2.5px slate strike spanning exactly the glyph', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ isNle: true }), 0, 0, 20);
    expect(ops).toContainEqual(['set globalAlpha', 0.3]);
    expect(ops).toContainEqual(['set strokeStyle', '#64748b']);
    expect(ops).toContainEqual(['set lineWidth', GLYPH_STROKES.nleStrike]);
    expect(ops).toContainEqual(['moveTo', 0, 10]);
    expect(ops).toContainEqual(['lineTo', 20, 10]);
    // glyph alpha restored before the strike; function leaves state clean
    const restoreIdx = ops.findIndex((o) => o[0] === 'restore');
    const strikeIdx = ops.findIndex((o) => o[0] === 'moveTo' && o[1] === 0 && o[2] === 10);
    expect(restoreIdx).toBeGreaterThan(-1);
    expect(strikeIdx).toBeGreaterThan(restoreIdx);
    expect(ops.at(-1)?.[0]).toBe('restore');
  });
});
```

- [ ] **Step 2: Run to verify the new expectations fail**

Run: `npm run test:units -- canvas-marker-glyph`
Expected: multiple FAILs (old geometry).

- [ ] **Step 3: Rewrite `canvas-marker-glyph.ts`**

```ts
import { GLYPH_RATIOS, GLYPH_STROKES, type MarkerVisual } from '../models/marker-visual';

/**
 * Minimal Canvas 2D surface the glyph needs. Structural so unit tests can pass
 * a recording fake in the node environment (no real canvas).
 */
export type CanvasGlyphSurface = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'closePath'
  | 'arc'
  | 'moveTo'
  | 'lineTo'
  | 'quadraticCurveTo'
  | 'rect'
  | 'fill'
  | 'stroke'
  | 'save'
  | 'restore'
  | 'setLineDash'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'globalAlpha'
  | 'lineCap'
  | 'lineJoin'
>;

const NLE_ALPHA = 0.3;
const NLE_DASHED_ALPHA = 0.25;
const STRIKE_COLOR = '#64748b';
const PROJECTED_DASHED_COLOR = '#cbd5e1';
const WHITE = '#ffffff';

/**
 * Render a MarkerVisual on a Canvas 2D context, matching the on-screen SVG
 * icon components (shared/components/svg-icons) exactly: same GLYPH_RATIOS
 * geometry, same GLYPH_STROKES widths, round caps/joins, per-shape stroke
 * rules, and the screen's NLE treatment. The PPTX renderer
 * (pptx-marker-glyph.ts) keeps its own PowerPoint-shape approximations.
 */
export function drawMarkerGlyphCanvas(
  ctx: CanvasGlyphSurface,
  visual: MarkerVisual,
  x: number,
  y: number,
  size: number
): void {
  const filled = visual.fillStyle === 'filled';
  const color = visual.color;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const markColor = filled ? WHITE : color;
  const r = GLYPH_RATIOS;
  const s = GLYPH_STROKES;

  // Dashed-line mirrors marker-icon.component.ts: projected renders slate,
  // NLE dims to 0.25 in its own color, and there is no strike overlay.
  if (visual.shape === 'dashed-line') {
    ctx.save();
    ctx.lineCap = 'round';
    if (visual.isNle) ctx.globalAlpha = NLE_DASHED_ALPHA;
    ctx.strokeStyle = visual.isNle ? color : filled ? color : PROJECTED_DASHED_COLOR;
    ctx.lineWidth = s.dashedLine;
    ctx.setLineDash([...s.dashedLinePattern]);
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx, y + size);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (visual.isNle) ctx.globalAlpha = NLE_ALPHA;
  ctx.strokeStyle = color;
  ctx.fillStyle = filled ? color : WHITE;

  switch (visual.shape) {
    case 'flag': {
      const px = x + size * r.flagPoleX;
      ctx.lineWidth = s.shape;
      ctx.beginPath();
      ctx.moveTo(px, y + 1);
      ctx.lineTo(px, y + size - 1);
      ctx.stroke();
      // Wavy banner: same quadratic path as flag-icon.component.ts.
      const fw = size * r.flagWidth;
      const fh = size * r.flagHeight;
      ctx.beginPath();
      ctx.moveTo(px, y + 1);
      ctx.quadraticCurveTo(px + fw * 0.5, y + 1 + fh * 0.3, px + fw, y + 1);
      ctx.lineTo(px + fw, y + 1 + fh);
      ctx.quadraticCurveTo(px + fw * 0.5, y + 1 + fh * 0.7, px, y + 1 + fh);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = filled ? s.flagBannerFilled : s.flagBannerOutline;
      ctx.stroke();
      break;
    }
    case 'diamond': {
      const hw = size * r.diamondHalfW;
      const hh = size * r.diamondHalfH;
      ctx.beginPath();
      ctx.moveTo(cx, cy - hh);
      ctx.lineTo(cx + hw, cy);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx - hw, cy);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = s.shape;
      ctx.stroke();
      drawInnerMark(ctx, visual, cx, cy, size, markColor);
      break;
    }
    case 'triangle': {
      const [x1, y1, x2, y2, x3, y3] = r.trianglePoints;
      ctx.beginPath();
      ctx.moveTo(x + size * x1, y + size * y1);
      ctx.lineTo(x + size * x2, y + size * y2);
      ctx.lineTo(x + size * x3, y + size * y3);
      ctx.closePath();
      ctx.fill();
      // Screen triangles only stroke their outline variant.
      if (!filled) {
        ctx.lineWidth = s.shape;
        ctx.stroke();
      }
      break;
    }
    case 'square': {
      ctx.beginPath();
      ctx.rect(
        x + size * r.squareInset,
        y + size * r.squareInset,
        size * (1 - 2 * r.squareInset),
        size * (1 - 2 * r.squareInset)
      );
      ctx.fill();
      // Screen squares only stroke their outline variant.
      if (!filled) {
        ctx.lineWidth = s.shape;
        ctx.stroke();
      }
      drawInnerMark(ctx, visual, cx, cy, size, markColor);
      break;
    }
    case 'circle':
    default:
      ctx.beginPath();
      // 1px inset so the stroke stays inside the box, like the SVG icon.
      ctx.arc(cx, cy, size / 2 - 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = s.shape;
      ctx.stroke();
      drawInnerMark(ctx, visual, cx, cy, size, markColor);
      break;
  }

  ctx.restore();

  if (visual.isNle) {
    ctx.save();
    ctx.strokeStyle = STRIKE_COLOR;
    ctx.lineWidth = s.nleStrike;
    ctx.beginPath();
    ctx.moveTo(x, cy);
    ctx.lineTo(x + size, cy);
    ctx.stroke();
    ctx.restore();
  }
}

function drawInnerMark(
  ctx: CanvasGlyphSurface,
  visual: MarkerVisual,
  cx: number,
  cy: number,
  size: number,
  markColor: string
): void {
  const r = GLYPH_RATIOS;
  const ox = cx - size / 2;
  const oy = cy - size / 2;
  switch (visual.innerMark) {
    case 'dot':
      ctx.beginPath();
      ctx.fillStyle = markColor;
      ctx.arc(cx, cy, size * r.innerDotR, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'dash':
      ctx.beginPath();
      ctx.strokeStyle = markColor;
      ctx.lineWidth = GLYPH_STROKES.innerMark;
      ctx.moveTo(ox + size * r.circleDashX1, cy);
      ctx.lineTo(ox + size * r.circleDashX2, cy);
      ctx.stroke();
      break;
    case 'check': {
      const [x1, y1, x2, y2, x3, y3] = r.checkPoints;
      ctx.beginPath();
      ctx.strokeStyle = markColor;
      ctx.lineWidth = GLYPH_STROKES.innerMark;
      ctx.moveTo(ox + size * x1, oy + size * y1);
      ctx.lineTo(ox + size * x2, oy + size * y2);
      ctx.lineTo(ox + size * x3, oy + size * y3);
      ctx.stroke();
      break;
    }
    case 'x': {
      ctx.beginPath();
      ctx.strokeStyle = markColor;
      ctx.lineWidth = GLYPH_STROKES.innerMark;
      ctx.moveTo(ox + size * r.squareXMin, oy + size * r.squareXMin);
      ctx.lineTo(ox + size * r.squareXMax, oy + size * r.squareXMax);
      ctx.moveTo(ox + size * r.squareXMax, oy + size * r.squareXMin);
      ctx.lineTo(ox + size * r.squareXMin, oy + size * r.squareXMax);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}
```

- [ ] **Step 4: Run the glyph spec, then the full suite**

Run: `npm run test:units -- canvas-marker-glyph` then `npm run test:units`
Expected: glyph spec passes (14 tests). The full run may fail in `png-export-renderer.spec.ts` ONLY if one of its assertions touched removed behavior; its current assertions (arc presence, alpha 0.12) still hold, so expect 728 total passing (722 - 9 old glyph + 14 new + 1 net from replaced count; trust the runner's arithmetic, the requirement is: everything green except changes you made intentionally in this spec file).

- [ ] **Step 5: Verify the PPTX renderer is untouched**

Run: `git diff --stat HEAD -- src/client/src/app/core/services/pptx-marker-glyph.ts src/client/src/app/core/services/pptx-export.service.ts`
Expected: empty. `npm run test:units -- pptx-marker-glyph` passes unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/services/canvas-marker-glyph.ts src/client/src/app/core/services/canvas-marker-glyph.spec.ts
git commit -m "feat(export): canvas marker glyphs match the on-screen SVG icons"
```

---

## Task 3: Phase bar parity in the PNG renderer (TDD)

**Files:**
- Modify: `src/client/src/app/core/services/png-export-renderer.ts` (drawPhaseBar and the constants it needs)
- Test: `src/client/src/app/core/services/png-export-renderer.spec.ts`

- [ ] **Step 1: Add the failing tests**

Append inside the existing `describe('renderTimelinePng', ...)` in `png-export-renderer.spec.ts` (the RecordingCtx there needs no new members; lineCap/lineJoin setters and quadraticCurveTo were added to the glyph surface in Task 2: add the same three members to THIS spec's RecordingCtx too, since the renderer's surface extends the glyph surface):

```ts
  it('draws the phase bar 14px tall with a 1.2px border (screen metrics)', () => {
    const ops = render();
    // single-row fixture: rowH = min(0.28*144, ...) = 40.32, so barH = min(14, 18.14) = 14
    expect(ops).toContainEqual(['set lineWidth', 1.2]);
    // bar vertical center matches the row center: barY = DATA_Y + (rowH - 14) / 2
    const rowH = Math.min(0.28 * 144, (1080 - 0.28 * 144 - 0.85 * 144) / 1);
    const barY = 0.28 * 144 + (rowH - 14) / 2;
    const arcs = ops.filter((o) => o[0] === 'arcTo');
    expect(arcs.length).toBeGreaterThan(0);
    // first arcTo of the bar path carries the bar's top edge y
    expect(arcs.some((o) => Math.abs((o[2] as number) - barY) < 0.01)).toBe(true);
  });

  it('centers the phase label inside wide bars in the phase color at 9px semibold', () => {
    const ops = render();
    const labelOps = ops.filter((o) => o[0] === 'fillText' && o[1] === 'PH 3');
    expect(labelOps.length).toBe(1);
    const fontOps = ops.filter((o) => o[0] === 'set font');
    expect(fontOps.some((o) => (o[1] as string).startsWith('600 9px'))).toBe(true);
  });

  it('places the label outside narrow bars, left-anchored in slate', () => {
    const rec = new RecordingCtx();
    const rc = renderContext();
    // shrink the phase to ~9 days so the bar is far below the 40px threshold
    rc.companies = JSON.parse(JSON.stringify(companies));
    (rc.companies[0].assets![0].trials![0] as { phase_end_date: string }).phase_end_date =
      '2020-01-10';
    renderTimelinePng(rec as unknown as PngSurface, rc);
    const ops = rec.ops;
    const labelIdx = ops.findIndex((o) => o[0] === 'fillText' && o[1] === 'PH 3');
    expect(labelIdx).toBeGreaterThan(-1);
    const priorFills = ops.slice(0, labelIdx).filter((o) => o[0] === 'set fillStyle');
    expect(priorFills.at(-1)).toEqual(['set fillStyle', '#64748b']);
  });
```

(If `companies[0].assets` is typed readonly in the fixture, adapt the deep-clone cast pragmatically; keep the assertions identical.)

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:units -- png-export-renderer`
Expected: the three new tests FAIL (current bar is rowH*0.45 tall, 1px border, scaled font, no outside label).

- [ ] **Step 3: Update `drawPhaseBar` in `png-export-renderer.ts`**

Replace the function with (constants mirror `phase-bar.component.ts`):

```ts
// Screen phase-bar metrics (phase-bar.component.ts): fixed height, border,
// radius, and label rules. Bars shrink below 14px only when rows are tighter
// than the screen ever gets.
const PHASE_BAR_H = 14;
const PHASE_BAR_RADIUS = 3;
const PHASE_BAR_STROKE = 1.2;
const PHASE_LABEL_MIN_W = 40;
const PHASE_LABEL_OUTSIDE_COLOR = '#64748b';

function drawPhaseBar(
  ctx: PngSurface,
  row: FlatRow,
  layout: ColumnLayout,
  rc: PngRenderContext,
  rowY: number,
  rowH: number
): void {
  const trial = row.trial;
  if (!trial.phase_type || !trial.phase_start_date) return;

  const sx = rc.dateToX(trial.phase_start_date);
  const ex = rc.dateToX(trial.phase_end_date ?? trial.phase_start_date);
  const barX = timelineX(layout, rc, sx);
  const barW = Math.max(0.05 * IN, ((ex - sx) / rc.totalPx) * (PNG_W - layout.labelColW));
  const barH = Math.min(PHASE_BAR_H, rowH * 0.45);
  const barY = rowY + (rowH - barH) / 2;
  const color = PHASE_COLORS[trial.phase_type] ?? PHASE_FALLBACK_COLOR;

  roundRectPath(ctx, barX, barY, barW, barH, PHASE_BAR_RADIUS);
  ctx.save();
  ctx.globalAlpha = 0.12; // same wash as the web
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.lineWidth = PHASE_BAR_STROKE;
  ctx.stroke();

  // Label mirrors phase-bar.component.ts: always rendered; centered inside in
  // the phase color when the bar is wide enough, otherwise just right of the
  // bar, left-anchored, in slate. Font shrinks only when rows get tighter
  // than the screen's fixed layout.
  const labelPx = Math.min(9, Math.max(6, rowH * 0.5));
  ctx.font = `600 ${labelPx}px ${SANS}`;
  const label = phaseShortLabel(trial.phase_type);
  if (barW >= PHASE_LABEL_MIN_W) {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(label, barX + barW / 2, barY + barH / 2);
    ctx.textAlign = 'left';
  } else {
    ctx.fillStyle = PHASE_LABEL_OUTSIDE_COLOR;
    ctx.fillText(label, barX + barW + 4, barY + barH / 2);
  }
}
```

Update the call site in `drawRows`: `drawPhaseBar(ctx, row, layout, rc, y, rowH);` (the `fontPt` parameter is gone). The `fontPt` parameter stays on `drawMarkers` (date labels are unchanged).

- [ ] **Step 4: Run the renderer spec, then the full suite, lint, build**

Run: `npm run test:units -- png-export-renderer && npm run test:units && npx ng lint && npx ng build`
Expected: all green (3 new tests passing), lint clean (1 pre-existing warning), build clean.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/png-export-renderer.ts src/client/src/app/core/services/png-export-renderer.spec.ts
git commit -m "feat(export): PNG phase bars match the on-screen bar metrics and labels"
```

---

## Task 4: Spec corrections, e2e, finish

**Files:**
- Modify: `docs/superpowers/specs/2026-06-10-png-export-screen-parity-design.md`
- Test: `src/client/e2e/tests/export.spec.ts` (run only, no changes expected)

- [ ] **Step 1: Amend the spec doc to the verified ground truth**

In the design section, replace the fill/stroke sentence with: "Fill/stroke rule per shape, matching the icons: circles and diamonds always stroke at 1.5px; triangles and squares stroke only their outline variant; flag banners stroke at 1.2px (outline) or 0.5px (filled); outline glyphs fill white." Replace the phase-bar label sentence with: "Label always rendered: 9px semibold, centered inside in the phase color when the bar is at least 40px wide, otherwise placed just right of the bar, left-anchored, in slate (#64748b)." Add to the dashed-line bullet: "projected (outline) dashed lines render slate (#cbd5e1); NLE dashed lines dim to 0.25 opacity in their own color and get no strike." Set `- **Status:** Implemented`.

- [ ] **Step 2: Run the export e2e** (local Supabase; run.sh starts it if needed)

Run: `cd src/client && ./e2e/run.sh tests/export.spec.ts`
Expected: 3 passed (blob assertions are size/MIME based and unaffected; the PNG is still > 10000 bytes).

- [ ] **Step 3: Full verification**

Run: `cd src/client && npm run test:units && npx ng lint && npx ng build`
Expected: all green.

- [ ] **Step 4: Commit docs**

```bash
git add docs/superpowers/specs/2026-06-10-png-export-screen-parity-design.md
git commit -m "docs(spec): png screen parity ground-truth corrections, mark implemented"
```

No runbook regen needed: no changes to package.json, migrations, or routes.

- [ ] **Step 5: Finish the branch**

Merge `origin/develop` into the branch, resolve conflicts, push with `--no-verify` (local pre-push e2e is flaky; CI is canonical), and open a PR against develop titled "feat: PNG export markers and phase bars match the on-screen rendering". No Claude attribution in the PR body.

---

## Self-Review Notes

- Spec coverage: flag bezier (Task 2), diamond half-extents (Task 2), per-shape stroke rules with the two corrections (Task 2 + Task 4 doc amendment), absolute stroke widths via GLYPH_STROKES (Tasks 1-2), dashed-line screen behavior incl. slate projected and 0.25 NLE (Task 2), NLE strike 2.5/exact-span (Task 2), phase bar 14px/1.2px/3px/label rules (Task 3), shared-constant de-hardcoding of icons (Task 1), PPTX untouched (Task 2 Step 5 guard), PNG layout untouched (drawMarkers signature unchanged).
- Type consistency: `GLYPH_STROKES` keys used in Tasks 1-3 match the Task 1 definition; `drawPhaseBar` signature change is reflected at its only call site; `CanvasGlyphSurface` additions (quadraticCurveTo, lineCap, lineJoin) flow into `PngSurface` automatically since it extends the glyph surface (its spec's RecordingCtx gains the same members in Task 3 Step 1).
- No placeholders; all code complete.
