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
  const maybeT = t > 0 ? { transparency: t } : {};
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
      // OOXML has no equivalent path here, so we approximate with a rect trimmed to
      // ~0.7w x 0.45h of the box so it reads as a banner without overrunning the pole.
      const bannerW = size * 0.7;
      const bannerH = size * 0.45;
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
      surface.addShape('line', {
        x: ox + size * x1,
        y: oy + size * y1,
        w: size * (x2 - x1),
        h: size * (y2 - y1),
        line: { color: markColor, width: 1.25, ...maybeT },
      });
      surface.addShape('line', {
        x: ox + size * x2,
        y: oy + size * y2,
        w: size * (x3 - x2),
        h: size * (y3 - y2),
        line: { color: markColor, width: 1.25, ...maybeT },
      });
      break;
    }
    case 'x': {
      const a = (size * (r.squareXMax - r.squareXMin)) / 2;
      surface.addShape('line', {
        x: cx - a,
        y: cy - a,
        w: 2 * a,
        h: 2 * a,
        line: { color: markColor, width: 1.25, ...maybeT },
      });
      surface.addShape('line', {
        x: cx - a,
        y: cy - a,
        w: 2 * a,
        h: 2 * a,
        flipV: true,
        line: { color: markColor, width: 1.25, ...maybeT },
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
