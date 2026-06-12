import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('MarkWatermarkComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'mark-watermark.component.ts'), 'utf8');

  it('is decorative only', () => {
    expect(src).toContain('aria-hidden="true"');
    expect(src).toContain('pointer-events: none');
  });

  it('renders the faded mark centered behind content', () => {
    expect(src).toContain('opacity: 0.07');
    expect(src).toContain('position: absolute');
    expect(src).toContain(`from '../clint-mark'`);
  });
});
