import { describe, it, expect } from 'vitest';
import { buildPrompt } from './prompt-builder';
import type { InventorySnapshot } from './types';

const inv = (et: { id: string; name: string }[]): InventorySnapshot => ({
  companies: [], assets: [], trials: [], indications: [],
  event_types: et, event_type_categories: [],
  mechanisms_of_action: [], routes_of_administration: [], hash: 'h',
});

describe('buildPrompt unified events', () => {
  it('enumerates event_type names from inventory and has no markers bucket', () => {
    const { system } = buildPrompt('text', inv([
      { id: '1', name: 'Topline Data' }, { id: '2', name: 'Regulatory Filing' },
    ]));
    expect(system).toContain('Topline Data');
    expect(system).toContain('Regulatory Filing');
    expect(system).toContain('"event_type"');
    expect(system).not.toContain('"markers"');
    expect(system).not.toContain('marker_type');
  });

  it('falls back to the system event-type names when inventory is empty', () => {
    const { system } = buildPrompt('text', inv([]));
    expect(system).toContain('Topline Data');
    expect(system).toContain('LOE Date');
  });
});
