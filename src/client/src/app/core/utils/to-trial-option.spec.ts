import { describe, expect, it } from 'vitest';
import type { Trial } from '../models/trial.model';
import { toTrialOption } from './to-trial-option';

function makeTrial(overrides: Partial<Trial> = {}): Trial {
  return {
    id: 't1',
    space_id: 's1',
    created_by: 'u1',
    asset_id: 'a1',
    name: 'A Study of Tirzepatide (LY3298176) in Participants With Obesity',
    acronym: 'SURMOUNT-1',
    identifier: 'NCT04184622',
    status: null,
    notes: null,
    display_order: 0,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    updated_by: null,
    phase_type: null,
    assets: { id: 'a1', name: 'Tirzepatide', companies: { id: 'c1', name: 'Lilly' } },
    ...overrides,
  };
}

describe('toTrialOption', () => {
  it('prefers acronym when present', () => {
    const opt = toTrialOption(makeTrial());
    expect(opt.label).toBe('SURMOUNT-1');
  });

  it('falls back to name when acronym is null', () => {
    const opt = toTrialOption(makeTrial({ acronym: null }));
    expect(opt.label).toBe('A Study of Tirzepatide (LY3298176) in Participants With Obesity');
  });

  it('falls back to name when acronym is whitespace', () => {
    const opt = toTrialOption(makeTrial({ acronym: '   ' }));
    expect(opt.label).toBe('A Study of Tirzepatide (LY3298176) in Participants With Obesity');
  });

  it('exposes company and asset names from the nested assets relation', () => {
    const opt = toTrialOption(makeTrial());
    expect(opt.companyName).toBe('Lilly');
    expect(opt.assetName).toBe('Tirzepatide');
  });

  it('returns empty strings when the assets relation is missing', () => {
    const opt = toTrialOption(makeTrial({ assets: null }));
    expect(opt.companyName).toBe('');
    expect(opt.assetName).toBe('');
  });

  it('returns empty string when the asset has no company', () => {
    const opt = toTrialOption(
      makeTrial({ assets: { id: 'a1', name: 'Tirzepatide', companies: null } }),
    );
    expect(opt.companyName).toBe('');
    expect(opt.assetName).toBe('Tirzepatide');
  });

  it('passes through the NCT identifier verbatim', () => {
    expect(toTrialOption(makeTrial()).identifier).toBe('NCT04184622');
    expect(toTrialOption(makeTrial({ identifier: null })).identifier).toBe('');
  });

  it('preserves the id for use as p-select optionValue', () => {
    expect(toTrialOption(makeTrial({ id: 'abc' })).id).toBe('abc');
  });

  it('keeps the raw briefTitle on the option so it can be used as a search target', () => {
    expect(toTrialOption(makeTrial()).briefTitle).toBe(
      'A Study of Tirzepatide (LY3298176) in Participants With Obesity',
    );
  });
});
