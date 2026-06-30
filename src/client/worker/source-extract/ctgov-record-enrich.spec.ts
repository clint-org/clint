import { describe, it, expect } from 'vitest';
import { enrichTrialsByNct } from './ctgov-record-enrich';
import type { ExtractionResult } from './types';

function studyFixture(over: Record<string, unknown> = {}): unknown {
  return {
    protocolSection: {
      identificationModule: { nctId: 'NCT01234567', briefTitle: 'A Study', acronym: 'CORE' },
      statusModule: {
        overallStatus: 'COMPLETED',
        startDateStruct: { date: '2021-03-01' },
        primaryCompletionDateStruct: { date: '2023-06-15' },
      },
      designModule: { phases: ['PHASE3'], enrollmentInfo: { count: 540 } },
      ...(over as object),
    },
  };
}

function clientReturning(study: unknown | null): { fetchStudy: () => Promise<unknown | null> } {
  return { fetchStudy: () => Promise.resolve(study) };
}

function proposals(
  trials: Record<string, unknown>[]
): ExtractionResult {
  return {
    source_summary: 's',
    companies: [],
    assets: [],
    trials: trials as unknown as ExtractionResult['trials'],
    events: [],
  } as unknown as ExtractionResult;
}

function newTrial(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    match: { kind: 'new', name: 'CORE' },
    name: 'CORE',
    nct_id: 'NCT01234567',
    phase: null,
    phase_start_date: null,
    phase_end_date: null,
    sample_size: null,
    status: null,
    ...over,
  };
}

describe('enrichTrialsByNct', () => {
  it('backfills phase / dates / sample size / status from the exact CT.gov record', async () => {
    const p = proposals([newTrial()]);
    const res = await enrichTrialsByNct(p, clientReturning(studyFixture()));
    expect(res.enriched).toEqual([0]);
    const t = p.trials[0] as Record<string, unknown>;
    expect(t['phase']).toBe('P3');
    expect(t['phase_start_date']).toBe('2021-03-01');
    expect(t['phase_end_date']).toBe('2023-06-15');
    expect(t['sample_size']).toBe(540);
    expect(t['status']).toBe('Completed');
  });

  it('lets the authoritative registry value override an extracted one', async () => {
    const p = proposals([newTrial({ phase: 'P2' })]);
    await enrichTrialsByNct(p, clientReturning(studyFixture()));
    expect((p.trials[0] as Record<string, unknown>)['phase']).toBe('P3');
  });

  it('keeps the extracted value when the registry field is absent', async () => {
    const p = proposals([newTrial({ phase: 'P2' })]);
    const study = studyFixture({ designModule: { enrollmentInfo: { count: 540 } } }); // no phases
    await enrichTrialsByNct(p, clientReturning(study));
    expect((p.trials[0] as Record<string, unknown>)['phase']).toBe('P2');
  });

  it('flags a not-found (404 -> null) NCT and leaves fields untouched', async () => {
    const p = proposals([newTrial({ phase: 'P2' })]);
    const res = await enrichTrialsByNct(p, clientReturning(null));
    expect(res.warnings).toEqual(['ctgov_record_not_found:trial_0']);
    expect(res.enriched).toEqual([]);
    expect((p.trials[0] as Record<string, unknown>)['phase']).toBe('P2');
  });

  it('flags a fetch failure without throwing', async () => {
    const p = proposals([newTrial()]);
    const client = { fetchStudy: () => Promise.reject(new Error('boom')) };
    const res = await enrichTrialsByNct(p, client);
    expect(res.warnings).toEqual(['ctgov_record_failed:trial_0']);
    expect(res.enriched).toEqual([]);
  });

  it('skips trials with no NCT and existing-matched trials', async () => {
    const p = proposals([
      newTrial({ nct_id: null }),
      { match: { kind: 'existing', id: 'x' }, name: 'Y', nct_id: 'NCT01234567' },
    ]);
    const res = await enrichTrialsByNct(p, clientReturning(studyFixture()));
    expect(res.enriched).toEqual([]);
  });
});
