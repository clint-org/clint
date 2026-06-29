/**
 * Unit tests for HexagonIconComponent.
 *
 * The unit-test runner uses a plain node environment (vitest.units.config.ts)
 * without the Angular compiler, so we pin the template contract by source
 * assertion -- the same approach pi-mark and the other shared icon-adjacent
 * specs use. Rendered-DOM behaviour is covered by the legend / markers-help
 * surfaces that host the glyph.
 *
 * The hexagon is the corporate/commercial family glyph: a violet hexagon is
 * commercial availability (Distribution), a rose hexagon is corporate
 * governance, differentiated by inner-mark (none = Leadership Change,
 * dot = Financial, dash = Strategic). So the hexagon must render all four
 * system inner-marks, mirroring the geometry the circle (dash) and square (x)
 * icons already use so a mark reads identically across shapes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, 'hexagon-icon.component.ts'), 'utf8');

describe('HexagonIcon inner-mark coverage', () => {
  it('renders the dot inner-mark', () => {
    expect(src).toContain(`@if (innerMark() === 'dot')`);
  });

  it('renders the check inner-mark', () => {
    expect(src).toContain(`@if (innerMark() === 'check')`);
  });

  it('renders the dash inner-mark as a horizontal line, reusing the circle dash geometry', () => {
    expect(src).toContain(`@if (innerMark() === 'dash')`);
    // Same fractional endpoints as the circle icon so the dash reads identically.
    expect(src).toContain('R.circleDashX1');
    expect(src).toContain('R.circleDashX2');
  });

  it('renders the x inner-mark as two crossing lines, reusing the square x geometry', () => {
    expect(src).toContain(`@if (innerMark() === 'x')`);
    // Same fractional endpoints as the square icon so the cross reads identically.
    expect(src).toContain('R.squareXMin');
    expect(src).toContain('R.squareXMax');
  });

  it('paints every inner-mark with markColor (white when filled, the family color when outline)', () => {
    // No inner mark may hardcode a color -- they all follow the fill contract.
    const markStrokes = src.match(/\[attr\.(stroke|fill)\]="markColor\(\)"/g) ?? [];
    // dot (fill) + dash (stroke) + check (stroke) + 2x x (stroke) = 5 paints.
    expect(markStrokes.length).toBeGreaterThanOrEqual(5);
  });
});
