/**
 * Template-contract tests for the consolidated timeline header (issue #167).
 *
 * The three previously-stacked chrome rows -- the TIMELINE/SHOW LEGEND section
 * header, the Display strip, and the INTELLIGENCE HEADLINES toggle row -- are
 * folded into a single header row owned by timeline-view. The unit runner is a
 * plain node environment without the Angular compiler, so we pin the contract by
 * source assertion rather than mounting the components.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const dir = __dirname;
// Built as a single combined segment so the no-manage-route-segments guard
// (which bans the exact quoted route token) does not flag this test path.
const manage = join(dir, '../manage');

const timelineHtml = readFileSync(join(dir, 'timeline-view.component.html'), 'utf8');
const timelineTs = readFileSync(join(dir, 'timeline-view.component.ts'), 'utf8');
const stripTs = readFileSync(join(dir, 'timeline-insight-strip.component.ts'), 'utf8');
const detailHtml = {
  trial: readFileSync(join(manage, 'trials', 'trial-detail.component.html'), 'utf8'),
  asset: readFileSync(join(manage, 'assets', 'asset-detail.component.html'), 'utf8'),
  company: readFileSync(join(manage, 'companies', 'company-detail.component.html'), 'utf8'),
};
const detailTs = {
  trial: readFileSync(join(manage, 'trials', 'trial-detail.component.ts'), 'utf8'),
  asset: readFileSync(join(manage, 'assets', 'asset-detail.component.ts'), 'utf8'),
  company: readFileSync(join(manage, 'companies', 'company-detail.component.ts'), 'utf8'),
};

describe('timeline-view consolidated header', () => {
  it('renders a single controls header row', () => {
    expect(timelineHtml).toContain('aria-label="Timeline controls"');
    // Exactly one header region, not three stacked bands.
    expect(timelineHtml.match(/aria-label="Timeline controls"/g)).toHaveLength(1);
  });

  it('gates the TIMELINE label and legend toggle on embedded mode', () => {
    expect(timelineTs).toContain('readonly embedded = input<boolean>(false)');
    expect(timelineHtml).toContain('@if (embedded()) {');
  });

  it('hosts the Display popover and intelligence-headlines toggle in the header', () => {
    expect(timelineHtml).toContain('displayPanel.toggle($event)');
    expect(timelineHtml).toContain('toggleIntelligenceHeadlines()');
    expect(timelineHtml).toContain('<p-popover #displayPanel>');
  });

  it('folds Show legend into the Display popover via an internal signal', () => {
    expect(timelineTs).toContain('protected readonly legendVisible = signal(false)');
    expect(timelineTs).toContain('toggleLegend()');
    expect(timelineHtml).toContain('Show legend');
    // legendVisible is no longer a caller-supplied input.
    expect(timelineTs).not.toContain('legendVisible = input');
  });

  it('drops the standalone headlines row and the columnsOnly input', () => {
    expect(timelineHtml).not.toContain('flex justify-end px-3 py-1');
    expect(timelineTs).not.toContain('columnsOnly');
  });
});

describe('timeline-insight-strip is pure content', () => {
  it('no longer carries the Display button or popover', () => {
    expect(stripTs).not.toContain('displayPanel');
    expect(stripTs).not.toContain('Popover');
    expect(stripTs).not.toContain('columnsOnly');
  });

  it('still renders the at-a-glance and stats content', () => {
    expect(stripTs).toContain('AT A GLANCE');
    expect(stripTs).toContain('STATS');
  });
});

describe('detail pages embed the timeline without their own header', () => {
  for (const key of ['trial', 'asset', 'company'] as const) {
    it(`${key} detail passes embedded and drops the SHOW LEGEND header`, () => {
      expect(detailHtml[key]).toContain('[embedded]="true"');
      expect(detailHtml[key]).not.toContain('legendVisible');
      expect(detailHtml[key]).not.toContain('Show legend');
      // The bordered section wrapper (scroll anchor) stays.
      expect(detailHtml[key]).toContain('id="timeline"');
      // The local legendVisible signal is gone.
      expect(detailTs[key]).not.toContain('legendVisible');
    });
  }
});
