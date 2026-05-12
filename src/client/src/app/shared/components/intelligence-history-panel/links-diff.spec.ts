import { describe, expect, it } from 'vitest';

import { PrimaryIntelligenceLink } from '../../../core/models/primary-intelligence.model';
import { diffLinks } from './links-diff';

function link(
  overrides: Partial<PrimaryIntelligenceLink> & Pick<PrimaryIntelligenceLink, 'entity_id'>
): PrimaryIntelligenceLink {
  return {
    entity_type: 'company',
    entity_name: 'Roche',
    relationship_type: 'Partner',
    gloss: null,
    display_order: 0,
    ...overrides,
  };
}

describe('diffLinks', () => {
  it('treats every entry as added when base is null (initial publication)', () => {
    const next = [link({ entity_id: 'a' }), link({ entity_id: 'b' })];
    const out = diffLinks(null, next);
    expect(out.added).toHaveLength(2);
    expect(out.removed).toHaveLength(0);
    expect(out.changed).toHaveLength(0);
    expect(out.unchanged).toHaveLength(0);
  });

  it('flags an entity removed across versions', () => {
    const base = [link({ entity_id: 'roche' }), link({ entity_id: 'lilly' })];
    const next = [link({ entity_id: 'lilly' })];
    const out = diffLinks(base, next);
    expect(out.removed.map((l) => l.entity_id)).toEqual(['roche']);
    expect(out.added).toHaveLength(0);
    expect(out.changed).toHaveLength(0);
    expect(out.unchanged.map((l) => l.entity_id)).toEqual(['lilly']);
  });

  it('flags an entity added across versions', () => {
    const base = [link({ entity_id: 'lilly' })];
    const next = [link({ entity_id: 'lilly' }), link({ entity_id: 'pfizer' })];
    const out = diffLinks(base, next);
    expect(out.added.map((l) => l.entity_id)).toEqual(['pfizer']);
    expect(out.removed).toHaveLength(0);
  });

  it('flags a relationship_type change as changed, not added/removed', () => {
    const base = [link({ entity_id: 'lilly', relationship_type: 'Competitor' })];
    const next = [link({ entity_id: 'lilly', relationship_type: 'Same class' })];
    const out = diffLinks(base, next);
    expect(out.changed).toHaveLength(1);
    expect(out.changed[0].relationshipChanged).toBe(true);
    expect(out.changed[0].glossChanged).toBe(false);
    expect(out.added).toHaveLength(0);
    expect(out.removed).toHaveLength(0);
  });

  it('flags a gloss change with trimmed whitespace normalization', () => {
    const base = [link({ entity_id: 'lilly', gloss: 'GLP-1 incumbent' })];
    const next = [link({ entity_id: 'lilly', gloss: '  GLP-1 incumbent  ' })];
    const noChange = diffLinks(base, next);
    expect(noChange.changed).toHaveLength(0);
    expect(noChange.unchanged).toHaveLength(1);

    const realChange = diffLinks(base, [link({ entity_id: 'lilly', gloss: 'GLP-1 + cardio' })]);
    expect(realChange.changed[0].glossChanged).toBe(true);
  });

  it('keys on entity_type so a marker and a company with the same UUID do not collide', () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const base = [link({ entity_type: 'marker', entity_id: id, relationship_type: 'Partner' })];
    const next = [link({ entity_type: 'company', entity_id: id, relationship_type: 'Partner' })];
    const out = diffLinks(base, next);
    expect(out.added.map((l) => l.entity_type)).toEqual(['company']);
    expect(out.removed.map((l) => l.entity_type)).toEqual(['marker']);
  });
});
