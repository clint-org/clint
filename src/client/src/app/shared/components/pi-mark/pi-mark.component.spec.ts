/**
 * Unit tests for PiMarkComponent.
 *
 * The unit-test runner uses a plain node environment (vitest.units.config.ts)
 * without the Angular compiler, so we don't mount the component via TestBed.
 * Instead we pin the exported shape constants and the template contract by
 * source assertion -- the same approach the rest of the shared/landscape specs
 * use. Rendered-DOM behaviour is covered by the surfaces that host the mark.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BOOKMARK_PATH, PI_MARK_VIEWBOX } from './pi-mark.component';

const src = readFileSync(join(__dirname, 'pi-mark.component.ts'), 'utf8');

describe('PiMark shape constants', () => {
  it('exposes a closed bookmark path in a 24x24 viewBox', () => {
    expect(BOOKMARK_PATH.startsWith('M')).toBe(true);
    // Closed path (ends with a close command) so the fill renders solid.
    expect(BOOKMARK_PATH.trim().endsWith('z')).toBe(true);
    expect(PI_MARK_VIEWBOX).toBe('0 0 24 24');
  });
});

describe('PiMark template contract', () => {
  it('renders an accessible svg whose label and size come from inputs', () => {
    expect(src).toContain('role="img"');
    expect(src).toContain('[attr.aria-label]="label()"');
    expect(src).toContain('[attr.width]="size()"');
    expect(src).toContain('[attr.height]="size()"');
  });

  it('fills with the tenant brand and keeps the mandatory white outline', () => {
    expect(src).toContain('[attr.d]="path"');
    expect(src).toContain('fill="var(--brand-600)"');
    expect(src).toContain('stroke="#ffffff"');
    // The brand colour is never hardcoded teal on the data surfaces.
    expect(src).not.toMatch(/fill="#[0-9a-fA-F]{6}"/);
  });

  it('defaults to an 11px mark labelled for intelligence', () => {
    expect(src).toContain('input<number>(11)');
    expect(src).toContain(`input<string>('Has intelligence')`);
  });
});
