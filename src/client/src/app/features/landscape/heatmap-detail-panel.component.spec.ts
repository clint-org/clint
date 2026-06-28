/**
 * Tests for the heatmap detail panel primary-intelligence section.
 *
 * The unit runner has no Angular compiler, so we mirror the panel's
 * aggregation / count logic against fixtures and pin the template + fetch
 * wiring by source contract. The section now lists the REAL PI entries for the
 * group's PI-bearing assets (via getIntelligenceNotesForAsset), so a trial-
 * level PI routes to the trial -- not the asset -- and a "N of M assets have
 * intelligence" summary, reusing the shared PiDetailSection.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { HeatmapBubble, HeatmapAsset, RingPhase } from '../../core/models/landscape.model';
import type { AssetIntelligenceNote, PiReference } from '../../core/models/primary-intelligence.model';

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

// Mirrors the effect's aggregation: dedup per-asset notes by PI id, preserving
// each note's real entity_type/entity_id (so trial-level PI stays a trial).
function aggregate(perAsset: AssetIntelligenceNote[][]): PiReference[] {
  const byId = new Map<string, PiReference>();
  for (const notes of perAsset) {
    for (const n of notes) {
      byId.set(n.id, {
        id: n.id,
        entity_type: n.entity_type,
        entity_id: n.entity_id,
        entity_name: n.entity_name,
        headline: n.headline,
      });
    }
  }
  return [...byId.values()];
}

// Mirrors HeatmapDetailPanelComponent.piCountLabel.
function piCountLabel(b: HeatmapBubble): string | null {
  const total = b.products.length;
  const n = b.intelligence_count ?? 0;
  return n > 0 ? `${n} of ${total} assets have intelligence` : null;
}

const src = readFileSync(join(__dirname, 'heatmap-detail-panel.component.ts'), 'utf8');

describe('heatmap detail panel PI aggregation', () => {
  it('preserves the real entity (a trial-level PI stays a trial, not the asset)', () => {
    const trialNote: AssetIntelligenceNote = {
      id: 'pi-1',
      entity_type: 'trial',
      entity_id: 'trial-xyz',
      entity_name: 'NCT-555',
      headline: 'Phase 3 readout',
      updated_at: '2026-06-01T00:00:00Z',
    };
    const refs = aggregate([[trialNote]]);
    expect(refs).toEqual([
      {
        id: 'pi-1',
        entity_type: 'trial',
        entity_id: 'trial-xyz',
        entity_name: 'NCT-555',
        headline: 'Phase 3 readout',
      },
    ]);
  });

  it('dedupes a PI shared across two assets in the group by id', () => {
    const shared: AssetIntelligenceNote = {
      id: 'pi-dup',
      entity_type: 'product',
      entity_id: 'a',
      entity_name: 'Asset a',
      headline: 'h',
      updated_at: '2026-06-01T00:00:00Z',
    };
    expect(aggregate([[shared], [shared]]).map((r) => r.id)).toEqual(['pi-dup']);
  });

  it('counts N of M assets from the bubble rollup', () => {
    const b = bubble([asset('a', true), asset('b', false), asset('c', true)], 2);
    expect(piCountLabel(b)).toBe('2 of 3 assets have intelligence');
  });

  it('produces no count label when the group has no intelligence', () => {
    expect(piCountLabel(bubble([asset('a', false)], 0))).toBeNull();
  });
});

describe('heatmap detail panel PI section wiring', () => {
  it('renders the shared PiDetailSection with the count label', () => {
    expect(src).toContain('<app-pi-detail-section');
    expect(src).toContain('[references]="allPiReferences()"');
    expect(src).toContain('[countLabel]="piCountLabel()"');
    expect(src).toContain('assets have intelligence');
    expect(src).toContain('PiDetailSectionComponent');
  });

  it('fetches the real PI notes per PI-bearing asset instead of synthesizing them', () => {
    expect(src).toContain('PrimaryIntelligenceService');
    expect(src).toContain('getIntelligenceNotesForAsset(spaceId, id)');
    expect(src).toContain('entity_type: n.entity_type');
    expect(src).toContain('entity_id: n.entity_id');
    // Regression: it must NOT fabricate an asset-level reference from the
    // has_intelligence boolean, which mis-routed trial-level PI to the asset.
    expect(src).not.toContain("entity_type: 'product' as const");
    // Race guard: stale responses are discarded when the selection moves on.
    expect(src).toContain('if (this.bubble() !== b) return;');
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
