import { describe, it, expect } from 'vitest';
import { normalizeNctId } from './nct-id';
import { ExtractionResultSchema } from './types';

describe('normalizeNctId', () => {
  it('passes through a canonical id', () => {
    expect(normalizeNctId('NCT01234567')).toBe('NCT01234567');
  });

  it('uppercases and trims', () => {
    expect(normalizeNctId('  nct01234567 ')).toBe('NCT01234567');
  });

  it('extracts an id embedded in surrounding text/prefix', () => {
    expect(normalizeNctId('ClinicalTrials.gov: NCT07654321')).toBe('NCT07654321');
  });

  it('returns null for malformed or absent ids', () => {
    expect(normalizeNctId('NCT123')).toBeNull(); // too few digits
    expect(normalizeNctId('not an id')).toBeNull();
    expect(normalizeNctId('')).toBeNull();
    expect(normalizeNctId(null)).toBeNull();
    expect(normalizeNctId(undefined)).toBeNull();
  });
});

describe('TrialSchema nct_id capture', () => {
  function parseTrial(nct: unknown): { nct_id: string | null } {
    const raw = {
      source_summary: 's',
      companies: [{ match: { kind: 'new', name: 'Acme' }, evidence: 'e' }],
      assets: [],
      trials: [
        {
          match: { kind: 'new', name: 'CORE' },
          name: 'CORE',
          ...(nct === undefined ? {} : { nct_id: nct }),
          sponsor_ref: 0,
          asset_refs: [],
          evidence: 'e',
        },
      ],
      events: [],
    };
    const res = ExtractionResultSchema.safeParse(raw);
    if (!res.success) throw new Error(res.error.message);
    return res.data.trials[0] as { nct_id: string | null };
  }

  it('captures and normalizes an NCT id from the extraction', () => {
    expect(parseTrial('nct01234567').nct_id).toBe('NCT01234567');
  });

  it('nulls a malformed NCT id rather than persisting garbage', () => {
    expect(parseTrial('NCT-123').nct_id).toBeNull();
  });

  it('defaults to null when no nct_id is present', () => {
    expect(parseTrial(undefined).nct_id).toBeNull();
  });
});
