import { describe, expect, it } from 'vitest';

import { GLYPH_RATIOS, type MarkerVisual } from '../models/marker-visual';
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

describe('drawMarkerGlyphCanvas', () => {
  it('draws a filled circle: fill color set to marker color, arc at center with r=size/2', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({}), 10, 20, 16);
    expect(ops).toContainEqual(['set fillStyle', '#16a34a']);
    expect(ops).toContainEqual(['arc', 18, 28, 8, 0, Math.PI * 2]);
    expect(has(ops, 'fill').length).toBeGreaterThan(0);
    expect(has(ops, 'stroke').length).toBeGreaterThan(0);
  });

  it('draws an outline circle with white fill', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ fillStyle: 'outline' }), 0, 0, 16);
    expect(ops).toContainEqual(['set fillStyle', '#ffffff']);
    expect(ops).toContainEqual(['set strokeStyle', '#16a34a']);
  });

  it('insets the square by GLYPH_RATIOS.squareInset', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'square' }), 0, 0, 10);
    // inset 0.1 of size 10 => rect(1, 1, 8, 8)
    expect(ops).toContainEqual(['rect', 1, 1, 8, 8]);
  });

  it('draws the diamond as a 4-point path', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'diamond' }), 0, 0, 10);
    expect(ops).toContainEqual(['moveTo', 5, 0]);
    expect(ops).toContainEqual(['lineTo', 10, 5]);
    expect(ops).toContainEqual(['lineTo', 5, 10]);
    expect(ops).toContainEqual(['lineTo', 0, 5]);
  });

  it('uses a dashed vertical line for dashed-line markers', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'dashed-line' }), 0, 0, 16);
    expect(has(ops, 'setLineDash').length).toBeGreaterThanOrEqual(2); // set + reset
    expect(ops).toContainEqual(['moveTo', 8, 0]);
    expect(ops).toContainEqual(['lineTo', 8, 16]);
  });

  it('renders inner dot in white on filled glyphs', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ innerMark: 'dot' }), 0, 0, 20);
    // innerDotR 0.15 of 20 => r=3 at center 10,10
    expect(ops).toContainEqual(['arc', 10, 10, 3, 0, Math.PI * 2]);
    expect(ops).toContainEqual(['set fillStyle', '#ffffff']);
  });

  it('renders the check inner mark as two segments', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'diamond', innerMark: 'check' }), 0, 0, 100);
    // checkPoints [0.32,0.5, 0.45,0.65, 0.68,0.38] on size 100
    expect(ops).toContainEqual(['moveTo', 32, 50]);
    expect(ops).toContainEqual(['lineTo', 45, 65]);
    expect(ops).toContainEqual(['lineTo', 68, 38]);
  });

  it('dims NLE glyphs to 0.3 alpha and draws a full-alpha slate strike', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ isNle: true }), 0, 0, 20);
    expect(ops).toContainEqual(['set globalAlpha', 0.3]);
    expect(ops).toContainEqual(['set strokeStyle', '#64748b']);
    // strike spans size*1.1 centered: from x-1 to x+21 at mid-height
    expect(ops).toContainEqual(['moveTo', -1, 10]);
    expect(ops).toContainEqual(['lineTo', 21, 10]);
    // glyph alpha is restored before the strike
    const restoreIdx = ops.findIndex((o) => o[0] === 'restore');
    const strikeIdx = ops.findIndex((o) => o[0] === 'moveTo' && o[1] === -1);
    expect(restoreIdx).toBeGreaterThan(-1);
    expect(strikeIdx).toBeGreaterThan(restoreIdx);
    // strike block is wrapped in its own save/restore so callers see no state leak
    expect(ops.at(-1)?.[0]).toBe('restore');
  });

  it('draws the flag pole and banner using shared GLYPH_RATIOS banner dimensions', () => {
    const { ctx, ops } = surface();
    const r = GLYPH_RATIOS;
    // size=20, x=0,y=0: poleX = 20*0.15 = 3
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'flag' }), 0, 0, 20);
    const poleX = 20 * r.flagPoleX; // 3
    expect(ops).toContainEqual(['moveTo', poleX, 0]);
    expect(ops).toContainEqual(['lineTo', poleX, 20]);
    // banner: rect(poleX, 0, flagBannerW*20, flagBannerH*20) = rect(3, 0, 14, 9)
    expect(ops).toContainEqual(['rect', poleX, 0, r.flagBannerW * 20, r.flagBannerH * 20]);
  });
});
