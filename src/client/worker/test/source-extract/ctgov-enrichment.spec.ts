import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichWithCtgov } from '../../source-extract/ctgov-enrichment';
import type { ExtractionResult } from '../../source-extract/types';

beforeEach(() => {
  vi.restoreAllMocks();
});

function makeProposals(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    source_summary: 'test',
    source_title: null,
    source_date: null,
    companies: [],
    assets: [],
    trials: [],
    markers: [],
    events: [],
    ...overrides,
  };
}

function ctgovResponse(studies: unknown[]) {
  return new Response(JSON.stringify({ studies }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('enrichWithCtgov', () => {
  it('returns candidates ranked by Jaro-Winkler score', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ctgovResponse([
        {
          protocolSection: {
            identificationModule: { nctId: 'NCT001', briefTitle: 'ETX-101 Phase 1 Study' },
            statusModule: { overallStatus: 'RECRUITING' },
            designModule: { phases: ['PHASE1'] },
          },
        },
        {
          protocolSection: {
            identificationModule: { nctId: 'NCT002', briefTitle: 'Unrelated Cancer Study' },
            statusModule: { overallStatus: 'COMPLETED' },
            designModule: { phases: ['PHASE3'] },
          },
        },
      ])
    );

    const proposals = makeProposals({
      companies: [{ match: { kind: 'new', name: 'Eikon' }, evidence: 'e' }],
      trials: [
        {
          match: { kind: 'new', name: 'ETX-101-001' },
          name: 'ETX-101-001',
          phase: 'P1',
          phase_start_date: null,
          phase_end_date: null,
          status: null,
          sample_size: null,
          sponsor_ref: 0,
          asset_ref: null,
          indication: 'solid tumors',
          evidence: 'trial',
        },
      ],
    });

    const result = await enrichWithCtgov(proposals, ['Eikon'], [], {
      timeout: 5000,
    });
    expect(result.candidates['0']).toBeDefined();
    expect(result.candidates['0'].length).toBeGreaterThan(0);
    expect(result.candidates['0'][0].score).toBeGreaterThanOrEqual(
      result.candidates['0'][1]?.score ?? 0
    );
  });

  it('handles CT.gov timeout gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('AbortError'));

    const proposals = makeProposals({
      companies: [{ match: { kind: 'new', name: 'Co' }, evidence: 'e' }],
      trials: [
        {
          match: { kind: 'new', name: 'TRIAL-1' },
          name: 'TRIAL-1',
          phase: null,
          phase_start_date: null,
          phase_end_date: null,
          status: null,
          sample_size: null,
          sponsor_ref: 0,
          asset_ref: null,
          indication: null,
          evidence: 'trial',
        },
      ],
    });

    const result = await enrichWithCtgov(proposals, ['Co'], []);
    expect(result.warnings).toContain('ctgov_partial:trial_0');
    expect(Object.keys(result.candidates)).toHaveLength(0);
  });

  it('handles CT.gov 5xx gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Server Error', { status: 503 }));

    const proposals = makeProposals({
      companies: [{ match: { kind: 'new', name: 'Co' }, evidence: 'e' }],
      trials: [
        {
          match: { kind: 'new', name: 'TRIAL-1' },
          name: 'TRIAL-1',
          phase: null,
          phase_start_date: null,
          phase_end_date: null,
          status: null,
          sample_size: null,
          sponsor_ref: 0,
          asset_ref: null,
          indication: null,
          evidence: 'trial',
        },
      ],
    });

    const result = await enrichWithCtgov(proposals, ['Co'], []);
    expect(result.warnings).toContain('ctgov_partial:trial_0');
  });

  it('skips enrichment for existing trials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ctgovResponse([]));

    const proposals = makeProposals({
      companies: [{ match: { kind: 'existing', id: 'c1' }, evidence: 'e' }],
      trials: [
        {
          match: { kind: 'existing', id: 't1' },
          name: 'ATTAIN-1',
          phase: 'P3',
          phase_start_date: null,
          phase_end_date: null,
          status: 'Active',
          sample_size: null,
          sponsor_ref: 0,
          asset_ref: null,
          indication: null,
          evidence: 'trial',
        },
      ],
    });

    const result = await enrichWithCtgov(proposals, ['Pfizer'], []);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Object.keys(result.candidates)).toHaveLength(0);
  });

  it('builds correct query params', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ctgovResponse([]));

    const proposals = makeProposals({
      companies: [{ match: { kind: 'new', name: 'Eikon' }, evidence: 'e' }],
      assets: [
        {
          match: { kind: 'new', name: 'ETX-101' },
          name: 'ETX-101',
          generic_name: null,
          company_ref: 0,
          moa: [],
          roa: [],
          evidence: 'a',
        },
      ],
      trials: [
        {
          match: { kind: 'new', name: 'ETX-101-001' },
          name: 'ETX-101-001',
          phase: 'P1',
          phase_start_date: null,
          phase_end_date: null,
          status: null,
          sample_size: null,
          sponsor_ref: 0,
          asset_ref: 0,
          indication: 'solid tumors',
          evidence: 'trial',
        },
      ],
    });

    await enrichWithCtgov(proposals, ['Eikon'], ['ETX-101']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('query.spons=Eikon');
    expect(url).toContain('query.titles=ETX-101-001');
    expect(url).toContain('query.cond=solid+tumors');
    expect(url).toContain('query.intr=ETX-101');
    expect(url).toContain('PHASE1');
  });
});
