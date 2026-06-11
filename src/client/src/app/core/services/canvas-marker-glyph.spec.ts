import { describe, expect, it } from 'vitest';

import type { MarkerVisual } from '../models/marker-visual';
import { GLYPH_STROKES } from '../models/marker-visual';
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
    expect(ops).toContainEqual(['moveTo', 3, 1]);
    expect(ops).toContainEqual(['lineTo', 3, 19]);
    expect(ops).toContainEqual(['quadraticCurveTo', 11, 4.6, 19, 1]);
    expect(ops).toContainEqual(['lineTo', 19, 13]);
    expect(ops).toContainEqual(['quadraticCurveTo', 11, 9.4, 3, 13]);
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
    const restoreIdx = ops.findIndex((o) => o[0] === 'restore');
    const strikeIdx = ops.findIndex((o) => o[0] === 'moveTo' && o[1] === 0 && o[2] === 10);
    expect(restoreIdx).toBeGreaterThan(-1);
    expect(strikeIdx).toBeGreaterThan(restoreIdx);
    expect(ops.at(-1)?.[0]).toBe('restore');
  });
});
