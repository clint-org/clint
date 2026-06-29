/**
 * Glyph shape-coverage guard.
 *
 * Every shape in the `MarkerShape` union must have a rendering path in each surface
 * that draws an event glyph. The canonical renderer is `MarkerIconComponent`, but the
 * timeline legend and the Event glyphs help page each keep their own inline @switch
 * (different sizing). When a new shape was added (e.g. `hexagon` for Distribution) it
 * was wired into MarkerIconComponent but NOT the two copies, so the Distribution glyph
 * rendered blank in the legend and help page. This guard fails if any glyph surface is
 * missing a shape, so the copies cannot drift from the enum again.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// vitest runs with cwd = src/client.
const MODEL = readFileSync('src/app/core/models/marker.model.ts', 'utf8');

const SHAPES = (() => {
  const block = /export type MarkerShape =([\s\S]*?);/.exec(MODEL);
  if (!block) throw new Error('could not locate the MarkerShape union in marker.model.ts');
  return [...block[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
})();

// Surfaces that render an event glyph by shape. dashed-line is rendered by a dedicated
// `=== 'dashed-line'` branch rather than a @case, so it is matched separately.
const SURFACES = [
  'src/app/shared/components/svg-icons/marker-icon.component.ts',
  'src/app/features/dashboard/legend/legend.component.html',
  'src/app/features/help/markers-help.component.ts',
];

describe('glyph shape coverage', () => {
  it('enumerates every MarkerShape (sanity)', () => {
    expect(SHAPES).toContain('hexagon');
    expect(SHAPES).toContain('dashed-line');
  });

  for (const surface of SURFACES) {
    it(`${surface} renders every MarkerShape`, () => {
      const src = readFileSync(surface, 'utf8');
      const missing = SHAPES.filter((shape) => {
        if (shape === 'dashed-line') return !src.includes(`'dashed-line'`);
        return !src.includes(`@case ('${shape}')`);
      });
      expect(missing, `${surface} is missing a render path for: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
