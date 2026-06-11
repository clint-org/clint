import type PptxGenJS from 'pptxgenjs';

import { GLYPH_RATIOS, type MarkerVisual } from '../models/marker-visual';

/** Minimal drawing surface: the pptxgenjs slide method the glyph uses. */
export type GlyphSurface = Pick<PptxGenJS.Slide, 'addShape'>;

const NLE_TRANSPARENCY = 70; // 30% opacity (pptxgenjs: 0 opaque .. 100 transparent)
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
  const maybeT: Record<string, number> = t > 0 ? { transparency: t } : {};
  const fill = filled ? { color, ...maybeT } : { color: 'FFFFFF', ...maybeT };
  const line = (w: number) => ({ color, width: w, ...maybeT });
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
        line: { color, width: 1, dashType: 'dash', ...maybeT },
      });
      drawNle(surface, visual, x, y, size);
      return;
    }
    case 'flag': {
      const poleX = x + size * r.flagPoleX;
      surface.addShape('line', { x: poleX, y, w: 0, h: size, line: line(1) });
      // The SVG flag is a curved banner (Bezier path) bounded by flagWidth/flagHeight.
      // OOXML has no equivalent path, so we approximate with a rect using the shared
      // flagBannerW/flagBannerH ratios so the canvas and PPTX renderers stay in sync.
      const bannerW = size * r.flagBannerW;
      const bannerH = size * r.flagBannerH;
      surface.addShape('rect', { x: poleX, y, w: bannerW, h: bannerH, fill, line: line(0.5) });
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

  drawInnerMark(surface, visual, cx, cy, size, markColor, maybeT);
  drawNle(surface, visual, x, y, size);
}

function drawInnerMark(
  surface: GlyphSurface,
  visual: MarkerVisual,
  cx: number,
  cy: number,
  size: number,
  markColor: string,
  maybeT: Record<string, number>
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
        fill: { color: markColor, ...maybeT },
      });
      break;
    }
    case 'dash':
      surface.addShape('line', {
        x: cx - size * (0.5 - r.circleDashX1),
        y: cy,
        w: size * (r.circleDashX2 - r.circleDashX1),
        h: 0,
        line: { color: markColor, width: 1.5, ...maybeT },
      });
      break;
    case 'check': {
      const [x1, y1, x2, y2, x3, y3] = r.checkPoints;
      const ox = cx - size / 2;
      const oy = cy - size / 2;
      const opts = { color: markColor, width: 1.25, ...maybeT };
      drawSegment(surface, ox + size * x1, oy + size * y1, ox + size * x2, oy + size * y2, opts);
      drawSegment(surface, ox + size * x2, oy + size * y2, ox + size * x3, oy + size * y3, opts);
      break;
    }
    case 'x': {
      const a = (size * (r.squareXMax - r.squareXMin)) / 2;
      const opts = { color: markColor, width: 1.25, ...maybeT };
      drawSegment(surface, cx - a, cy - a, cx + a, cy + a, opts);
      drawSegment(surface, cx + a, cy - a, cx - a, cy + a, opts);
      break;
    }
    default:
      break;
  }
}

/**
 * Draw a straight line between two arbitrary points. OOXML shape extents
 * (`a:ext cx/cy`) must be non-negative, so we normalize to a non-negative
 * bounding box and use `flipV` for segments whose direction reverses. Passing a
 * negative width/height straight to pptxgenjs emits a negative extent, which
 * PowerPoint treats as corrupt and strips ("repaired and removed it").
 */
function drawSegment(
  surface: GlyphSurface,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lineOpts: Record<string, unknown>
): void {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  // pptx draws a line from the top-left to the bottom-right corner of its box by
  // default. When the segment runs along the other diagonal (dx and dy have
  // opposite signs), flip vertically so it connects the correct corners.
  const flip = (x2 - x1) * (y2 - y1) < 0 ? { flipV: true } : {};
  surface.addShape('line', { x, y, w, h, ...flip, line: lineOpts });
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
