/**
 * Contract test for the detail-panel-section primary-intelligence treatment.
 * When piMark is set, the eyebrow carries the brand bookmark glyph and tints
 * brand instead of slate -- the single, consistent PI marker shared with the
 * data surfaces. Asserted by source contract (node runner, no Angular compiler).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, 'detail-panel-section.component.ts'), 'utf8');

describe('DetailPanelSection piMark', () => {
  it('exposes a piMark input that gates the bookmark glyph', () => {
    expect(src).toContain('piMark = input<boolean>(false)');
    expect(src).toContain('@if (piMark())');
    expect(src).toContain('<app-pi-mark');
    expect(src).toContain('PiMarkComponent');
  });

  it('tints the eyebrow brand when the mark is shown, slate otherwise', () => {
    expect(src).toContain('[class.text-brand-700]="piMark()"');
    expect(src).toContain('[class.text-slate-400]="!piMark()"');
  });
});
