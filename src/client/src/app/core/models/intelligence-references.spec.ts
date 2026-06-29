import { describe, it, expect } from 'vitest';
import type { IntelligencePayload, PrimaryIntelligenceBrief } from './primary-intelligence.model';
import { briefsToReferences, dedupeReferencesById } from './intelligence-references';

function payload(id: string, headline: string): IntelligencePayload {
  return {
    record: { id, headline } as IntelligencePayload['record'],
    links: [],
    contributors: [],
  };
}

function brief(overrides: Partial<PrimaryIntelligenceBrief>): PrimaryIntelligenceBrief {
  return {
    anchor_id: 'a',
    is_lead: false,
    display_order: 0,
    published: null,
    draft: null,
    updated_at: null,
    version_count: 0,
    ...overrides,
  };
}

describe('briefsToReferences', () => {
  it('maps published briefs to references tagged with the owning entity', () => {
    const briefs = [
      brief({ anchor_id: 'x', published: payload('b1', 'Phase 3 readout strong') }),
      brief({ anchor_id: 'y', published: payload('b2', 'Label expansion likely') }),
    ];
    expect(briefsToReferences(briefs, 'trial', 't1', 'NCT123')).toEqual([
      { id: 'b1', entity_type: 'trial', entity_id: 't1', entity_name: 'NCT123', headline: 'Phase 3 readout strong' },
      { id: 'b2', entity_type: 'trial', entity_id: 't1', entity_name: 'NCT123', headline: 'Label expansion likely' },
    ]);
  });

  it('skips briefs with no published payload (drafts only)', () => {
    const briefs = [
      brief({ published: null, draft: payload('d1', 'draft') }),
      brief({ published: payload('b1', 'published') }),
    ];
    const refs = briefsToReferences(briefs, 'product', 'p1', 'Tirzepatide');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ id: 'b1', entity_type: 'product', entity_id: 'p1' });
  });

  it('returns an empty array for no briefs', () => {
    expect(briefsToReferences([], 'trial', 't1', null)).toEqual([]);
  });
});

describe('dedupeReferencesById', () => {
  it('collapses duplicate brief ids, keeping first-seen order', () => {
    const refs = [
      { id: 'b1', entity_type: 'trial' as const, entity_id: 't1', entity_name: 'T', headline: 'first' },
      { id: 'b2', entity_type: 'product' as const, entity_id: 'p1', entity_name: 'A', headline: 'second' },
      { id: 'b1', entity_type: 'product' as const, entity_id: 'p1', entity_name: 'A', headline: 'first again' },
    ];
    const out = dedupeReferencesById(refs);
    expect(out.map((r) => r.id)).toEqual(['b1', 'b2']);
    expect(out[0].entity_type).toBe('trial');
  });

  it('leaves a distinct list untouched', () => {
    const refs = [
      { id: 'a', entity_type: 'trial' as const, entity_id: 't', entity_name: null, headline: 'h1' },
      { id: 'b', entity_type: 'trial' as const, entity_id: 't', entity_name: null, headline: 'h2' },
    ];
    expect(dedupeReferencesById(refs)).toHaveLength(2);
  });
});
