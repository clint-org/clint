import { GLYPH_RATIOS, type MarkerVisual } from '../models/marker-visual';

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
>;

const NLE_ALPHA = 0.3;
const STRIKE_COLOR = '#64748b';
const WHITE = '#ffffff';

/**
 * Render a MarkerVisual on a Canvas 2D context. Canvas counterpart to
 * drawMarkerGlyph (pptx-marker-glyph.ts); geometry comes from GLYPH_RATIOS so
 * screen SVG, PPTX, and PNG all agree. The flag banner uses the same
 * rect approximation as the deck, since the PNG mirrors the PPTX data slide.
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

  ctx.save();
  if (visual.isNle) ctx.globalAlpha = NLE_ALPHA;
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = filled ? color : WHITE;

  switch (visual.shape) {
    case 'dashed-line':
      ctx.beginPath();
      ctx.setLineDash([3, 2]);
      ctx.moveTo(cx, y);
      ctx.lineTo(cx, y + size);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    case 'flag': {
      const poleX = x + size * r.flagPoleX;
      ctx.beginPath();
      ctx.moveTo(poleX, y);
      ctx.lineTo(poleX, y + size);
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(poleX, y, size * r.flagBannerW, size * r.flagBannerH);
      ctx.fill();
      ctx.stroke();
      break;
    }
    // Full-box vertices to match the pptx native diamond shape, not the SVG 0.42/0.48 ratios.
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(x + size, cy);
      ctx.lineTo(cx, y + size);
      ctx.lineTo(x, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      drawInnerMark(ctx, visual, cx, cy, size, markColor);
      break;
    case 'triangle': {
      const [x1, y1, x2, y2, x3, y3] = r.trianglePoints;
      ctx.beginPath();
      ctx.moveTo(x + size * x1, y + size * y1);
      ctx.lineTo(x + size * x2, y + size * y2);
      ctx.lineTo(x + size * x3, y + size * y3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      drawInnerMark(ctx, visual, cx, cy, size, markColor);
      break;
    }
    case 'square':
      ctx.beginPath();
      ctx.rect(
        x + size * r.squareInset,
        y + size * r.squareInset,
        size * (1 - 2 * r.squareInset),
        size * (1 - 2 * r.squareInset)
      );
      ctx.fill();
      ctx.stroke();
      drawInnerMark(ctx, visual, cx, cy, size, markColor);
      break;
    case 'circle':
    default:
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawInnerMark(ctx, visual, cx, cy, size, markColor);
      break;
  }

  ctx.restore();

  if (visual.isNle) {
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = STRIKE_COLOR;
    ctx.lineWidth = 1;
    ctx.moveTo(x - size * 0.05, cy);
    ctx.lineTo(x + size * 1.05, cy);
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
      ctx.lineWidth = 1.5;
      ctx.moveTo(cx - size * (0.5 - r.circleDashX1), cy);
      ctx.lineTo(cx - size * (0.5 - r.circleDashX2), cy);
      ctx.stroke();
      break;
    case 'check': {
      const [x1, y1, x2, y2, x3, y3] = r.checkPoints;
      const ox = cx - size / 2;
      const oy = cy - size / 2;
      ctx.beginPath();
      ctx.strokeStyle = markColor;
      ctx.lineWidth = 1.25;
      ctx.moveTo(ox + size * x1, oy + size * y1);
      ctx.lineTo(ox + size * x2, oy + size * y2);
      ctx.lineTo(ox + size * x3, oy + size * y3);
      ctx.stroke();
      break;
    }
    case 'x': {
      const a = (size * (r.squareXMax - r.squareXMin)) / 2;
      ctx.beginPath();
      ctx.strokeStyle = markColor;
      ctx.lineWidth = 1.25;
      ctx.moveTo(cx - a, cy - a);
      ctx.lineTo(cx + a, cy + a);
      ctx.moveTo(cx + a, cy - a);
      ctx.lineTo(cx - a, cy + a);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}
