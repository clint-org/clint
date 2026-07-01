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
          asset_refs: [],
          primary_asset_ref: null,
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
          asset_refs: [],
          primary_asset_ref: null,
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
          asset_refs: [],
          primary_asset_ref: null,
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
          asset_refs: [],
          primary_asset_ref: null,
          indication: null,
          evidence: 'trial',
        },
      ],
    });

    const result = await enrichWithCtgov(proposals, ['Pfizer'], []);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Object.keys(result.candidates)).toHaveLength(0);
  });

  it('builds a title-centric query without the verbose condition/intervention free-text', async () => {
    // query.cond and query.intr are the model's verbose free-text; the CT.gov v2
    // API ANDs every query.* param, so those two zero out otherwise-valid matches.
    // The primary query keeps the specific signals (title, sponsor, phase) only.
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
          asset_refs: [0],
          primary_asset_ref: 0,
          indication: 'solid tumors',
          evidence: 'trial',
        },
      ],
    });

    await enrichWithCtgov(proposals, ['Eikon'], ['ETX-101']);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('query.titles=ETX-101-001');
    expect(url).toContain('query.spons=Eikon');
    expect(url).toContain('PHASE1');
    expect(url).not.toContain('query.cond');
    expect(url).not.toContain('query.intr');
  });

  it('scores an acronym that appears verbatim in the brief title as an exact match', async () => {
    // Real CT.gov brief titles carry the trial acronym as a parenthetical
    // substring, e.g. "...Advanced Solid Tumors (TROPION-PanTumor01)". Raw
    // Jaro-Winkler over the whole long title scores such matches ~0.4, so the
    // right study never clears the confidence bar. A verbatim substring is a
    // definitive identifier and must score 1.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ctgovResponse([
        {
          protocolSection: {
            identificationModule: {
              nctId: 'NCT03401385',
              briefTitle: 'First-in-human Study of DS-1062a for Advanced Solid Tumors (TROPION-PanTumor01)',
            },
            statusModule: { overallStatus: 'ACTIVE_NOT_RECRUITING' },
            designModule: { phases: ['PHASE1'] },
          },
        },
      ])
    );

    const proposals = makeProposals({
      companies: [{ match: { kind: 'new', name: 'AstraZeneca' }, evidence: 'e' }],
      trials: [
        {
          match: { kind: 'new', name: 'TROPION-PanTumor01' },
          name: 'TROPION-PanTumor01',
          phase: 'P1',
          phase_start_date: null,
          phase_end_date: null,
          status: null,
          sample_size: null,
          sponsor_ref: 0,
          asset_refs: [],
          primary_asset_ref: null,
          indication: 'non-small cell lung cancer',
          evidence: 'trial',
        },
      ],
    });

    const result = await enrichWithCtgov(proposals, ['AstraZeneca'], []);
    expect(result.candidates['0'][0].nct_id).toBe('NCT03401385');
    expect(result.candidates['0'][0].score).toBe(1);
  });

  it('falls back to a title-only search when the constrained query returns nothing', async () => {
    // A sponsor or phase mismatch on the tight query would otherwise drop a
    // real trial. When the constrained query yields zero studies, retry by
    // title alone (the acronym is a near-unique identifier).
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ctgovResponse([]))
      .mockResolvedValueOnce(
        ctgovResponse([
          {
            protocolSection: {
              identificationModule: {
                nctId: 'NCT04656652',
                briefTitle: 'Dato-DXd vs Docetaxel in NSCLC (TROPION-Lung01)',
              },
              statusModule: { overallStatus: 'ACTIVE_NOT_RECRUITING' },
              designModule: { phases: ['PHASE3'] },
            },
          },
        ])
      );

    const proposals = makeProposals({
      companies: [{ match: { kind: 'new', name: 'Daiichi Sankyo' }, evidence: 'e' }],
      trials: [
        {
          match: { kind: 'new', name: 'TROPION-Lung01' },
          name: 'TROPION-Lung01',
          phase: 'P3',
          phase_start_date: null,
          phase_end_date: null,
          status: null,
          sample_size: null,
          sponsor_ref: 0,
          asset_refs: [],
          primary_asset_ref: null,
          indication: 'non-small cell lung cancer',
          evidence: 'trial',
        },
      ],
    });

    const result = await enrichWithCtgov(proposals, ['Daiichi Sankyo'], []);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const fallbackUrl = fetchSpy.mock.calls[1][0] as string;
    expect(fallbackUrl).toContain('query.titles=TROPION-Lung01');
    expect(fallbackUrl).not.toContain('query.spons');
    expect(fallbackUrl).not.toContain('filter.advanced');
    expect(result.candidates['0'][0].nct_id).toBe('NCT04656652');
    expect(result.candidates['0'][0].score).toBe(1);
  });
});
