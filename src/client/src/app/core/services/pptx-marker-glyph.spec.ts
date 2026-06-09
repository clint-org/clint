import { describe, expect, it } from 'vitest';
import { drawMarkerGlyph, type GlyphSurface } from './pptx-marker-glyph';
import type { MarkerVisual } from '../models/marker-visual';

interface Recorded {
  shapes: { shape: string; opts: Record<string, unknown> }[];
}

function fakeSurface(): { surface: GlyphSurface; rec: Recorded } {
  const rec: Recorded = { shapes: [] };
  const surface = {
    addShape: (shape: string, opts: Record<string, unknown>) => {
      rec.shapes.push({ shape, opts });
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

  it('draws a dash inner mark as a single horizontal line', () => {
    const { surface, rec } = fakeSurface();
    drawMarkerGlyph(surface, visual({ innerMark: 'dash' }), 0, 0, 0.12);
    // outer ellipse + 1 inner dash line
    expect(rec.shapes.filter((s) => s.shape === 'line')).toHaveLength(1);
  });

  it('draws a check inner mark as two line segments', () => {
    const { surface, rec } = fakeSurface();
    drawMarkerGlyph(surface, visual({ shape: 'diamond', innerMark: 'check' }), 0, 0, 0.12);
    expect(rec.shapes.filter((s) => s.shape === 'line')).toHaveLength(2);
  });

  it('draws an x inner mark as two crossed lines', () => {
    const { surface, rec } = fakeSurface();
    drawMarkerGlyph(surface, visual({ shape: 'square', innerMark: 'x' }), 0, 0, 0.12);
    expect(rec.shapes.filter((s) => s.shape === 'line')).toHaveLength(2);
  });

  it('filled inner mark uses white, outline inner mark uses the color', () => {
    const filledRec = fakeSurface();
    drawMarkerGlyph(filledRec.surface, visual({ innerMark: 'dot', fillStyle: 'filled' }), 0, 0, 0.12);
    const filledDot = filledRec.rec.shapes.filter((s) => s.shape === 'ellipse')[1];
    expect((filledDot.opts['fill'] as { color: string }).color).toBe('FFFFFF');

    const outlineRec = fakeSurface();
    drawMarkerGlyph(outlineRec.surface, visual({ innerMark: 'dot', fillStyle: 'outline', color: '#16a34a' }), 0, 0, 0.12);
    const outlineDot = outlineRec.rec.shapes.filter((s) => s.shape === 'ellipse')[1];
    expect((outlineDot.opts['fill'] as { color: string }).color).toBe('16a34a');
  });
});
