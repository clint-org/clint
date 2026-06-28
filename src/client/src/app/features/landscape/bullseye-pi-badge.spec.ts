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
const detailHtml = readFileSync(join(__dirname, 'bullseye-detail-panel.component.html'), 'utf8');
const detailTs = readFileSync(join(__dirname, 'bullseye-detail-panel.component.ts'), 'utf8');
const controlsTs = readFileSync(join(__dirname, 'bullseye-controls-panel.component.ts'), 'utf8');
const tooltipTs = readFileSync(join(__dirname, 'bullseye-tooltip.component.ts'), 'utf8');

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

describe('bullseye detail panel intelligence section', () => {
  it('renders the shared PiDetailSection from mapped asset notes', () => {
    expect(detailHtml).toContain('<app-pi-detail-section');
    expect(detailHtml).toContain('[references]="intelligenceReferences()"');
    expect(detailTs).toContain('intelligenceReferences = computed<PiReference[]>');
    expect(detailTs).toContain('PiDetailSectionComponent');
  });

  it('marks the intelligence section header with the bookmark', () => {
    expect(detailHtml).toContain('[piMark]="true"');
  });
});

describe('bullseye legend + tooltip use the bookmark, not a blue circle', () => {
  it('legend shows the bookmark glyph for "Intelligence attached"', () => {
    expect(controlsTs).toContain('<app-pi-mark');
    expect(controlsTs).toContain('Intelligence attached');
    // The old blue hollow-circle swatch is gone.
    expect(controlsTs).not.toContain('legend-intel');
    expect(controlsTs).not.toContain('#2563eb');
  });

  it('tooltip intelligence chip uses the bookmark + brand tint', () => {
    expect(tooltipTs).toContain('<app-pi-mark');
    expect(tooltipTs).not.toContain('#2563eb');
    expect(tooltipTs).not.toContain('border-blue-200');
  });
});
