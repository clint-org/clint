/**
 * Template-contract tests for the trial-row primary-intelligence treatment.
 *
 * The unit runner is a plain node environment (vitest.units.config.ts) without
 * the Angular compiler, so we pin the trial-column contract by source assertion
 * rather than mounting the grid. The contract: a trial that owns published PI
 * shows the bookmark mark beside its name always, and -- only when the
 * timeline-scoped headline density control is on -- an inline PI headline as a
 * second line. The mark is gated on has_intelligence; the headline is
 * additionally gated on the toggle and a non-empty headline.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(join(__dirname, 'dashboard-grid.component.html'), 'utf8');
const ts = readFileSync(join(__dirname, 'dashboard-grid.component.ts'), 'utf8');

describe('trial-row primary-intelligence mark', () => {
  it('renders the bookmark mark whenever the trial owns intelligence', () => {
    expect(html).toContain('row.trial.has_intelligence');
    expect(html).toContain('<app-pi-mark [size]="11"');
  });

  it('exposes a timeline-scoped headline density input defaulting on', () => {
    expect(ts).toContain('showIntelligenceHeadlines = input<boolean>(true)');
    expect(ts).toContain('PiMarkComponent');
  });
});

describe('trial-row inline headline', () => {
  it('shows the inline headline only when the toggle is on, PI exists, and a headline is present', () => {
    expect(html).toContain('showIntelligenceHeadlines() &&');
    expect(html).toContain('row.trial.has_intelligence &&');
    expect(html).toContain('row.trial.intelligence_headline');
    expect(html).toContain('{{ row.trial.intelligence_headline }}');
  });

  it('tints the inline headline with the tenant brand, not teal', () => {
    expect(html).toContain('text-brand-700');
    expect(html).not.toContain('text-teal-');
  });
});
