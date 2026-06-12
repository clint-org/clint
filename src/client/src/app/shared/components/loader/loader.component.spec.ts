import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('LoaderComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'loader.component.ts'), 'utf8');

  it('announces itself as a status region with an aria-label fallback', () => {
    expect(src).toContain(`role: 'status'`);
    expect(src).toContain(`'[attr.aria-label]': 'resolvedLabel()'`);
    expect(src).toMatch(/resolvedLabel = computed\(\(\) => this\.label\(\) \|\| 'Loading'\)/);
  });

  it('renders a static track and three animated draw copies with pathLength', () => {
    expect(src.match(/clint-mark-track/g)?.length).toBe(3);
    expect(src).toContain('clint-mark-draw clint-mark-draw--m');
    expect(src).toContain('clint-mark-draw clint-mark-draw--i');
    expect(src.match(/pathLength="1"/g)?.length).toBe(3);
  });

  it('tints the inner ring with the host brand', () => {
    expect(src).toContain('var(--brand-600)');
  });

  it('derives stroke widths from the shared geometry', () => {
    expect(src).toContain(`from '../clint-mark'`);
    expect(src).toContain('clintMarkStrokes(this.size())');
  });

  it('hides the SVG from the accessibility tree and shows the optional caption', () => {
    expect(src).toContain('aria-hidden="true"');
    expect(src).toContain('@if (label())');
  });
});
