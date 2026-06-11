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
 * Snap a ratio-derived coordinate to 1e-6 px. The shared GLYPH_RATIOS decimals
 * carry IEEE noise (e.g. 100 * 0.28 = 28.000000000000004); the SVG icons emit
 * that noise harmlessly into attribute strings, and canvas coordinates at
 * 1e-6 px are visually identical. Snapping keeps the geometry deterministic.
 */
const snap = (v: number): number => Math.round(v * 1e6) / 1e6;

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
  // Per-op alpha approximates the screen's group opacity (the SVG fades the
  // composed glyph); overlapping primitives composite slightly differently,
  // which is negligible at 0.3 on glyph-sized shapes.
  if (visual.isNle) ctx.globalAlpha = NLE_ALPHA;
  ctx.strokeStyle = color;
  ctx.fillStyle = filled ? color : WHITE;

  switch (visual.shape) {
    case 'flag': {
      const px = snap(x + size * r.flagPoleX);
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
      ctx.quadraticCurveTo(snap(px + fw * 0.5), snap(y + 1 + fh * 0.3), snap(px + fw), y + 1);
      ctx.lineTo(snap(px + fw), snap(y + 1 + fh));
      ctx.quadraticCurveTo(snap(px + fw * 0.5), snap(y + 1 + fh * 0.7), px, snap(y + 1 + fh));
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
      ctx.moveTo(cx, snap(cy - hh));
      ctx.lineTo(snap(cx + hw), cy);
      ctx.lineTo(cx, snap(cy + hh));
      ctx.lineTo(snap(cx - hw), cy);
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
      ctx.moveTo(snap(x + size * x1), snap(y + size * y1));
      ctx.lineTo(snap(x + size * x2), snap(y + size * y2));
      ctx.lineTo(snap(x + size * x3), snap(y + size * y3));
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
        snap(x + size * r.squareInset),
        snap(y + size * r.squareInset),
        snap(size * (1 - 2 * r.squareInset)),
        snap(size * (1 - 2 * r.squareInset))
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
    // Butt cap like the SVG overlay default, so the strike spans exactly the
    // glyph regardless of ambient caller state.
    ctx.lineCap = 'butt';
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
      ctx.arc(cx, cy, snap(size * r.innerDotR), 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'dash':
      ctx.beginPath();
      ctx.strokeStyle = markColor;
      ctx.lineWidth = GLYPH_STROKES.innerMark;
      ctx.moveTo(snap(ox + size * r.circleDashX1), cy);
      ctx.lineTo(snap(ox + size * r.circleDashX2), cy);
      ctx.stroke();
      break;
    case 'check': {
      const [x1, y1, x2, y2, x3, y3] = r.checkPoints;
      ctx.beginPath();
      ctx.strokeStyle = markColor;
      ctx.lineWidth = GLYPH_STROKES.innerMark;
      ctx.moveTo(snap(ox + size * x1), snap(oy + size * y1));
      ctx.lineTo(snap(ox + size * x2), snap(oy + size * y2));
      ctx.lineTo(snap(ox + size * x3), snap(oy + size * y3));
      ctx.stroke();
      break;
    }
    case 'x': {
      ctx.beginPath();
      ctx.strokeStyle = markColor;
      ctx.lineWidth = GLYPH_STROKES.innerMark;
      ctx.moveTo(snap(ox + size * r.squareXMin), snap(oy + size * r.squareXMin));
      ctx.lineTo(snap(ox + size * r.squareXMax), snap(oy + size * r.squareXMax));
      ctx.moveTo(snap(ox + size * r.squareXMax), snap(oy + size * r.squareXMin));
      ctx.lineTo(snap(ox + size * r.squareXMin), snap(oy + size * r.squareXMax));
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}
