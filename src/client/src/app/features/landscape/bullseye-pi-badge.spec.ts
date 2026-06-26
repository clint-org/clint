/**
 * Contract tests for the bullseye primary-intelligence treatment.
 *
 * The node now signals PI with the shared brand bookmark badge instead of the
 * old blue halo ring -- the blue halo collided with the blue approval marker.
 * The signal-mark glyph (tooltip + detail-pane) drops the blue intel ring
 * entirely; activity stays a pulsing orange ring. Asserted by source contract
 * (the unit runner has no Angular compiler).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BOOKMARK_PATH } from '../../shared/components/pi-mark/pi-mark.component';

const chartHtml = readFileSync(join(__dirname, 'bullseye-chart.component.html'), 'utf8');
const chartTs = readFileSync(join(__dirname, 'bullseye-chart.component.ts'), 'utf8');
const signalTs = readFileSync(join(__dirname, 'bullseye-signal-mark.component.ts'), 'utf8');

describe('bullseye node PI badge', () => {
  it('renders the brand bookmark badge for nodes with intelligence', () => {
    expect(chartHtml).toContain('@if (dot.product.intelligence_count > 0)');
    expect(chartHtml).toContain('[attr.d]="bookmarkPath"');
    expect(chartHtml).toContain('fill="var(--brand-600)"');
    expect(chartHtml).toContain('aria-label="Has primary intelligence"');
    expect(chartTs).toContain('bookmarkPath = BOOKMARK_PATH');
    // The shape is the shared single source of truth.
    expect(BOOKMARK_PATH.startsWith('M')).toBe(true);
  });

  it('removes the blue intelligence halo from the chart', () => {
    expect(chartHtml).not.toContain('halo-ring');
    expect(chartHtml).not.toContain('#2563eb');
  });
});

describe('bullseye signal-mark glyph', () => {
  it('no longer draws the blue intelligence ring', () => {
    expect(signalTs).not.toContain('#2563eb');
    expect(signalTs).not.toContain("kind: 'intel'");
    expect(signalTs).not.toContain('hasIntelligence');
  });

  it('keeps the orange activity ring as a data color', () => {
    expect(signalTs).toContain('#f97316');
    expect(signalTs).toContain('hasRecentActivity');
  });
});
