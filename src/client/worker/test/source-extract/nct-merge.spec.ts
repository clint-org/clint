import { describe, it, expect } from 'vitest';
import { chunkArray, mergeSubBatches, type SubBatchExtraction } from '../../source-extract/nct-merge';
import type { ExtractionResult } from '../../source-extract/types';

const C1 = '11111111-1111-4111-8111-111111111111';
const A1 = '22222222-2222-4222-8222-222222222222';

function emptyResult(): ExtractionResult {
  return {
    source_summary: '',
    source_title: null,
    source_date: null,
    companies: [],
    assets: [],
    trials: [],
    events: [],
  };
}

function newCompany(name: string): ExtractionResult['companies'][number] {
  return { match: { kind: 'new', name }, evidence: `CT.gov: ${name}` };
}

function newAsset(name: string, company_ref: number): ExtractionResult['assets'][number] {
  return {
    match: { kind: 'new', name },
    name,
    generic_name: null,
    company_ref,
    moa: [],
    roa: [],
    evidence: `CT.gov: ${name}`,
  };
}

function newTrial(
  nct: string,
  sponsor_ref: number,
  asset_refs: number[],
  primary_asset_ref: number | null,
): ExtractionResult['trials'][number] {
  return {
    match: { kind: 'new', name: nct },
    name: nct,
    nct_id: nct,
    phase: 'P3',
    phase_start_date: null,
    phase_end_date: null,
    status: 'Active',
    sample_size: null,
    sponsor_ref,
    asset_refs,
    primary_asset_ref,
    indications: [],
    indication: null,
    evidence: `CT.gov: ${nct}`,
  };
}

function batch(result: ExtractionResult, over: Partial<SubBatchExtraction> = {}): SubBatchExtraction {
  return {
    result,
    dropped: [],
    warnings: [],
    promptTokens: 100,
    completionTokens: 200,
    ...over,
  };
}

describe('chunkArray', () => {
  it('splits into contiguous chunks of at most size', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single chunk when size >= length', () => {
    expect(chunkArray([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('handles size 1 and empty input', () => {
    expect(chunkArray([1, 2], 1)).toEqual([[1], [2]]);
    expect(chunkArray([], 5)).toEqual([]);
  });

  it('splits a full 50-id batch into 5 chunks of 10 (the MAX_NCTS / CHUNK_SIZE invariant)', () => {
    const ids = Array.from({ length: 50 }, (_, i) => i);
    const chunks = chunkArray(ids, 10);
    expect(chunks).toHaveLength(5);
    expect(chunks.every((c) => c.length === 10)).toBe(true);
  });

  it('throws on a non-positive chunk size', () => {
    expect(() => chunkArray([1], 0)).toThrow();
  });
});

describe('mergeSubBatches', () => {
  it('returns a single sub-batch verbatim (preserves pre-chunking behavior)', () => {
    const r = emptyResult();
    r.source_summary = 'Batch import of 3 trials across oncology';
    const only = batch(r);
    expect(mergeSubBatches([only])).toBe(only);
  });

  it('dedups a "new" company shared across batches and remaps trial sponsor_ref', () => {
    const b1 = emptyResult();
    b1.companies = [newCompany('Roche')];
    b1.trials = [newTrial('NCT00000001', 0, [], null)];

    const b2 = emptyResult();
    b2.companies = [newCompany('Roche')]; // same company, batch-local index 0
    b2.trials = [newTrial('NCT00000002', 0, [], null)];

    const merged = mergeSubBatches([batch(b1), batch(b2)]);

    expect(merged.result.companies).toHaveLength(1);
    // both trials point at the single merged company
    expect(merged.result.trials.map((t) => t.sponsor_ref)).toEqual([0, 0]);
    expect(merged.result.trials.map((t) => t.match.kind === 'new' && t.match.name)).toEqual([
      'NCT00000001',
      'NCT00000002',
    ]);
  });

  it('offsets distinct companies and remaps the second batch refs', () => {
    const b1 = emptyResult();
    b1.companies = [newCompany('Roche')];
    b1.trials = [newTrial('NCT00000001', 0, [], null)];

    const b2 = emptyResult();
    b2.companies = [newCompany('Pfizer')];
    b2.trials = [newTrial('NCT00000002', 0, [], null)];

    const merged = mergeSubBatches([batch(b1), batch(b2)]);

    expect(merged.result.companies).toHaveLength(2);
    // second batch's local company 0 -> global index 1
    expect(merged.result.trials.map((t) => t.sponsor_ref)).toEqual([0, 1]);
  });

  it('dedups a "new" asset and remaps company_ref, asset_refs and primary_asset_ref', () => {
    const b1 = emptyResult();
    b1.companies = [newCompany('Lilly')];
    b1.assets = [newAsset('Tirzepatide', 0)];
    b1.trials = [newTrial('NCT00000001', 0, [0], 0)];

    const b2 = emptyResult();
    b2.companies = [newCompany('Lilly')]; // dedups to global 0
    b2.assets = [newAsset('Tirzepatide', 0)]; // dedups to global 0
    b2.trials = [newTrial('NCT00000002', 0, [0], 0)];

    const merged = mergeSubBatches([batch(b1), batch(b2)]);

    expect(merged.result.companies).toHaveLength(1);
    expect(merged.result.assets).toHaveLength(1);
    expect(merged.result.assets[0].company_ref).toBe(0);
    expect(merged.result.trials).toHaveLength(2);
    for (const t of merged.result.trials) {
      expect(t.sponsor_ref).toBe(0);
      expect(t.asset_refs).toEqual([0]);
      expect(t.primary_asset_ref).toBe(0);
    }
  });

  it('keeps distinct assets separate and offsets the second batch asset refs', () => {
    const b1 = emptyResult();
    b1.companies = [newCompany('Lilly')];
    b1.assets = [newAsset('Tirzepatide', 0)];
    b1.trials = [newTrial('NCT00000001', 0, [0], 0)];

    const b2 = emptyResult();
    b2.companies = [newCompany('Novo Nordisk')];
    b2.assets = [newAsset('Semaglutide', 0)];
    b2.trials = [newTrial('NCT00000002', 0, [0], 0)];

    const merged = mergeSubBatches([batch(b1), batch(b2)]);

    expect(merged.result.assets.map((a) => a.name)).toEqual(['Tirzepatide', 'Semaglutide']);
    // second asset is global index 1; its company is global index 1
    expect(merged.result.assets[1].company_ref).toBe(1);
    expect(merged.result.trials[1].asset_refs).toEqual([1]);
    expect(merged.result.trials[1].primary_asset_ref).toBe(1);
  });

  it('dedups existing entities by inventory id', () => {
    const b1 = emptyResult();
    b1.companies = [{ match: { kind: 'existing', id: C1 }, evidence: 'CT.gov: NCT1' }];
    b1.assets = [
      { match: { kind: 'existing', id: A1 }, name: 'X', generic_name: null, company_ref: 0, moa: [], roa: [], evidence: 'e' },
    ];
    b1.trials = [newTrial('NCT00000001', 0, [0], 0)];

    const b2 = emptyResult();
    b2.companies = [{ match: { kind: 'existing', id: C1 }, evidence: 'CT.gov: NCT2' }];
    b2.assets = [
      { match: { kind: 'existing', id: A1 }, name: 'X', generic_name: null, company_ref: 0, moa: [], roa: [], evidence: 'e' },
    ];
    b2.trials = [newTrial('NCT00000002', 0, [0], 0)];

    const merged = mergeSubBatches([batch(b1), batch(b2)]);
    expect(merged.result.companies).toHaveLength(1);
    expect(merged.result.assets).toHaveLength(1);
    expect(merged.result.trials.map((t) => t.sponsor_ref)).toEqual([0, 0]);
  });

  it('sums token counts and concatenates warnings and dropped', () => {
    const b1 = batch(emptyResult(), {
      warnings: ['w1'],
      dropped: [{ type: 'asset', index: 0, name: 'A', reason: 'r1' }],
      promptTokens: 100,
      completionTokens: 200,
    });
    const b2 = batch(emptyResult(), {
      warnings: ['w2'],
      dropped: [{ type: 'trial', index: 1, name: 'B', reason: 'r2' }],
      promptTokens: 50,
      completionTokens: 75,
    });

    const merged = mergeSubBatches([b1, b2]);
    expect(merged.promptTokens).toBe(150);
    expect(merged.completionTokens).toBe(275);
    expect(merged.warnings).toEqual(['w1', 'w2']);
    expect(merged.dropped.map((d) => d.reason)).toEqual(['r1', 'r2']);
  });

  it('synthesizes a source_summary from the merged trial count', () => {
    const b1 = emptyResult();
    b1.trials = [newTrial('NCT00000001', 0, [], null)];
    b1.companies = [newCompany('Roche')];
    const b2 = emptyResult();
    b2.trials = [newTrial('NCT00000002', 0, [], null)];
    b2.companies = [newCompany('Pfizer')];

    const merged = mergeSubBatches([batch(b1), batch(b2)]);
    expect(merged.result.source_summary).toBe('Batch import of 2 trials');
  });
});
