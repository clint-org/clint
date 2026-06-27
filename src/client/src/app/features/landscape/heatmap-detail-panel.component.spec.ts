/**
 * Tests for the heatmap detail panel primary-intelligence section.
 *
 * The unit runner has no Angular compiler, so we mirror the panel's
 * PI-reference / count logic against a bubble fixture and pin the template
 * wiring by source contract. The section lists the group's PI-bearing assets
 * and a "N of M assets have intelligence" summary, reusing the shared
 * PiDetailSection.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { HeatmapBubble, HeatmapAsset, RingPhase } from '../../core/models/landscape.model';

function asset(id: string, hasIntelligence: boolean): HeatmapAsset {
  return {
    id,
    name: `Asset ${id}`,
    generic_name: null,
    company_id: 'c',
    company_name: 'Co',
    company_logo_url: null,
    highest_phase: 'P3' as RingPhase,
    highest_phase_rank: 3,
    trial_count: 1,
    has_intelligence: hasIntelligence,
  };
}

function bubble(products: HeatmapAsset[], intelligenceCount: number): HeatmapBubble {
  return {
    label: 'Obesity',
    group_keys: {},
    competitor_count: 1,
    highest_phase: 'P3',
    highest_phase_rank: 3,
    unit_count: products.length,
    intelligence_count: intelligenceCount,
    phase_counts: { P3: products.length },
    products,
  };
}

// Mirrors HeatmapDetailPanelComponent.piReferences / piCountLabel.
function piReferences(b: HeatmapBubble) {
  return b.products
    .filter((p) => p.has_intelligence)
    .map((p) => ({ id: p.id, entity_type: 'product', entity_id: p.id, entity_name: p.name, headline: p.name }));
}
function piCountLabel(b: HeatmapBubble): string | null {
  const total = b.products.length;
  const n = b.intelligence_count ?? piReferences(b).length;
  return n > 0 ? `${n} of ${total} assets have intelligence` : null;
}

const src = readFileSync(join(__dirname, 'heatmap-detail-panel.component.ts'), 'utf8');

describe('heatmap detail panel PI section logic', () => {
  it('lists only PI-bearing assets and counts N of M', () => {
    const b = bubble([asset('a', true), asset('b', false), asset('c', true)], 2);
    expect(piReferences(b).map((r) => r.id)).toEqual(['a', 'c']);
    expect(piCountLabel(b)).toBe('2 of 3 assets have intelligence');
  });

  it('produces no count label when the group has no intelligence', () => {
    const b = bubble([asset('a', false), asset('b', false)], 0);
    expect(piReferences(b)).toEqual([]);
    expect(piCountLabel(b)).toBeNull();
  });
});

describe('heatmap detail panel PI section wiring', () => {
  it('renders the shared PiDetailSection with the count label', () => {
    expect(src).toContain('<app-pi-detail-section');
    expect(src).toContain('[references]="piReferences()"');
    expect(src).toContain('[countLabel]="piCountLabel()"');
    expect(src).toContain('assets have intelligence');
    expect(src).toContain('PiDetailSectionComponent');
  });

  it('emits the intelligence entity so the parent routes to its profile', () => {
    expect(src).toContain('onPiReferenceClick(ref: PiReference)');
    expect(src).toContain('this.openIntelligence.emit(');
    expect(src).toContain('entityType: ref.entity_type as IntelligenceEntityType');
    expect(src).toContain('entityId: ref.entity_id');
    // Regression: PI rows used to navigate to the timeline via openAsset.
    expect(src).not.toContain('openAsset');
  });

  it('has no cross-navigation footer button', () => {
    expect(src).not.toContain('openInBullseye');
    expect(src).not.toContain('Open in bullseye');
  });
});
