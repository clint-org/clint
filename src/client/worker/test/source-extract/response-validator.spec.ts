import { describe, it, expect } from 'vitest';
import { validateExtraction } from '../../source-extract/response-validator';
import type { InventorySnapshot } from '../../source-extract/types';

const C1 = '11111111-1111-4111-8111-111111111111';
const A1 = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';
const UNKNOWN_UUID = '99999999-9999-4999-8999-999999999999';

const SOURCE_TEXT =
  'Pfizer Inc reported results from the ATTAIN-1 trial for Paxlovid. ' +
  'Eikon Therapeutics initiated a Phase 1 study of ETX-101 (ETX-101-001).';

function makeInventory(overrides: Partial<InventorySnapshot> = {}): InventorySnapshot {
  return {
    companies: [{ id: C1, name: 'Pfizer' }],
    assets: [{ id: A1, name: 'Paxlovid', company_id: C1, generic_name: 'nirmatrelvir' }],
    trials: [{ id: T1, name: 'ATTAIN-1', asset_id: A1 }],
    indications: [],
    marker_types: [{ id: 'mt1', name: 'Topline Data' }],
    event_categories: [{ id: 'ec1', name: 'Clinical' }],
    hash: 'h1',
    ...overrides,
  };
}

function validJson(): string {
  return JSON.stringify({
    source_summary: 'Pfizer Q1 update',
    source_title: 'Pfizer Q1',
    source_date: '2026-04-28',
    companies: [
      { match: { kind: 'existing', id: C1 }, evidence: 'Pfizer' },
      {
        match: { kind: 'new', name: 'Eikon Therapeutics' },
        evidence: 'Eikon',
      },
    ],
    assets: [
      {
        match: { kind: 'existing', id: A1 },
        name: 'Paxlovid',
        generic_name: null,
        company_ref: 0,
        moa: [],
        roa: [],
        evidence: 'Paxlovid',
      },
    ],
    trials: [
      {
        match: { kind: 'existing', id: T1 },
        name: 'ATTAIN-1',
        phase: 'P3',
        phase_start_date: null,
        phase_end_date: null,
        status: 'Active',
        sample_size: null,
        sponsor_ref: 0,
        asset_refs: [0],
        primary_asset_ref: 0,
        indication: null,
        evidence: 'ATTAIN-1',
      },
    ],
    markers: [
      {
        marker_type: 'data_readout',
        title: 'Interim',
        event_date: '2026-09-01',
        end_date: null,
        projection: 'company',
        description: null,
        trial_refs: [0],
        evidence: 'interim',
      },
    ],
    events: [
      {
        category: 'earnings',
        title: 'Q1 call',
        event_date: '2026-04-28',
        description: null,
        priority: 'high',
        tags: [],
        anchor: { level: 'company', ref: 0 },
        evidence: 'Q1 call',
      },
    ],
  });
}

describe('validateExtraction', () => {
  it('returns ok:false on invalid JSON', () => {
    const r = validateExtraction('not json', makeInventory(), SOURCE_TEXT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_json');
  });

  it('returns ok:false on schema-invalid JSON', () => {
    const r = validateExtraction(
      JSON.stringify({ companies: [{ match: { kind: 'invalid' } }] }),
      makeInventory(),
      SOURCE_TEXT
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('schema_invalid');
  });

  it('passes valid extraction through', () => {
    const r = validateExtraction(validJson(), makeInventory(), SOURCE_TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.companies.length).toBeGreaterThan(0);
      expect(r.result.assets.length).toBeGreaterThan(0);
      expect(r.result.trials.length).toBeGreaterThan(0);
    }
  });

  it('drops assets with out-of-bounds company_ref', () => {
    const json = JSON.parse(validJson());
    json.assets.push({
      match: { kind: 'new', name: 'Ghost' },
      name: 'Ghost',
      generic_name: null,
      company_ref: 99,
      moa: [],
      roa: [],
      evidence: 'ghost',
    });
    const r = validateExtraction(JSON.stringify(json), makeInventory(), SOURCE_TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const drop = r.dropped.find((d) => d.type === 'asset' && d.name === 'Ghost');
      expect(drop).toBeDefined();
      expect(drop!.reason).toContain('company_ref');
    }
  });

  it('demotes existing match with unknown ID to new', () => {
    const json = JSON.parse(validJson());
    json.companies[0].match = {
      kind: 'existing',
      id: UNKNOWN_UUID,
    };
    const r = validateExtraction(JSON.stringify(json), makeInventory(), SOURCE_TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.some((w) => w.includes('demoted to new'))).toBe(true);
    }
  });

  it('drops new company that fails name-substring check', () => {
    const json = JSON.parse(validJson());
    json.companies.push({
      match: { kind: 'new', name: 'Nonexistent Corp' },
      evidence: 'none',
    });
    const r = validateExtraction(JSON.stringify(json), makeInventory(), SOURCE_TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const drop = r.dropped.find((d) => d.type === 'company' && d.name === 'Nonexistent Corp');
      expect(drop).toBeDefined();
      expect(drop!.reason).toContain('name not found');
    }
  });

  it('drops new asset where neither name nor generic_name passes', () => {
    const json = JSON.parse(validJson());
    json.assets.push({
      match: { kind: 'new', name: 'FakeAsset' },
      name: 'FakeAsset',
      generic_name: 'fakemab',
      company_ref: 0,
      moa: [],
      roa: [],
      evidence: 'fake',
    });
    const r = validateExtraction(JSON.stringify(json), makeInventory(), SOURCE_TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const drop = r.dropped.find((d) => d.type === 'asset' && d.name === 'FakeAsset');
      expect(drop).toBeDefined();
      expect(drop!.reason).toContain('neither name nor generic_name');
    }
  });

  it('keeps new asset where generic_name passes even if name does not', () => {
    const sourceWithGeneric = SOURCE_TEXT + ' nirmatrelvir is a protease inhibitor.';
    const json = JSON.parse(validJson());
    json.assets.push({
      match: { kind: 'new', name: 'BrandXYZ' },
      name: 'BrandXYZ',
      generic_name: 'nirmatrelvir',
      company_ref: 0,
      moa: [],
      roa: [],
      evidence: 'nirmatrelvir',
    });
    const r = validateExtraction(JSON.stringify(json), makeInventory(), sourceWithGeneric);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const drop = r.dropped.find((d) => d.type === 'asset' && d.name === 'BrandXYZ');
      expect(drop).toBeUndefined();
    }
  });

  it('drops marker with no grounded trial refs', () => {
    const json = JSON.parse(validJson());
    json.trials = [
      {
        match: { kind: 'new', name: 'PHANTOM-1' },
        name: 'PHANTOM-1',
        phase: 'P2',
        phase_start_date: null,
        phase_end_date: null,
        status: null,
        sample_size: null,
        sponsor_ref: 0,
        asset_refs: [],
        primary_asset_ref: null,
        indication: null,
        evidence: 'phantom',
      },
    ];
    json.markers = [
      {
        marker_type: 'data_readout',
        title: 'Phantom readout',
        event_date: '2026-09-01',
        end_date: null,
        projection: 'actual',
        description: null,
        trial_refs: [0],
        evidence: 'phantom',
      },
    ];
    const r = validateExtraction(JSON.stringify(json), makeInventory(), SOURCE_TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const drop = r.dropped.find((d) => d.type === 'marker' && d.name === 'Phantom readout');
      expect(drop).toBeDefined();
    }
  });

  it('drops event with ungrounded anchor', () => {
    const json = JSON.parse(validJson());
    json.companies.push({
      match: { kind: 'new', name: 'Invisible Co' },
      evidence: 'none',
    });
    json.events.push({
      category: 'conference',
      title: 'Invisible conf',
      event_date: '2026-05-01',
      description: null,
      priority: 'low',
      tags: [],
      anchor: { level: 'company', ref: 2 },
      evidence: 'invisible',
    });
    const r = validateExtraction(JSON.stringify(json), makeInventory(), SOURCE_TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const drop = r.dropped.find((d) => d.type === 'event' && d.name === 'Invisible conf');
      expect(drop).toBeDefined();
    }
  });

  const twoAssets = [
    { match: { kind: 'existing', id: A1 }, name: 'Paxlovid', generic_name: null, company_ref: 0, moa: [], roa: [], evidence: 'Paxlovid' },
    { match: { kind: 'new', name: 'ETX-101' }, name: 'ETX-101', generic_name: null, company_ref: 1, moa: [], roa: [], evidence: 'ETX-101' },
  ];

  function trialWith(assetRefs: number[], primary: number | null) {
    return {
      match: { kind: 'existing', id: T1 },
      name: 'ATTAIN-1',
      phase: 'P3',
      phase_start_date: null,
      phase_end_date: null,
      status: 'Active',
      sample_size: null,
      sponsor_ref: 0,
      asset_refs: assetRefs,
      primary_asset_ref: primary,
      indication: null,
      evidence: 'ATTAIN-1',
    };
  }

  it('drops a trial whose asset_refs contains an out-of-bounds index', () => {
    const json = JSON.parse(validJson());
    json.trials = [trialWith([5], null)];
    json.markers = [];
    json.events = [];
    const r = validateExtraction(JSON.stringify(json), makeInventory(), SOURCE_TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const drop = r.dropped.find((d) => d.type === 'trial' && d.name === 'ATTAIN-1');
      expect(drop?.reason).toContain('asset_refs contains out-of-bounds');
    }
  });

  it('drops a trial whose primary_asset_ref is not one of asset_refs', () => {
    const json = JSON.parse(validJson());
    json.assets = twoAssets;
    json.trials = [trialWith([0], 1)];
    json.markers = [];
    json.events = [];
    const r = validateExtraction(JSON.stringify(json), makeInventory(), SOURCE_TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const drop = r.dropped.find((d) => d.type === 'trial' && d.name === 'ATTAIN-1');
      expect(drop?.reason).toContain('primary_asset_ref');
    }
  });

  it('keeps a master-protocol trial that tests multiple valid assets', () => {
    const json = JSON.parse(validJson());
    json.assets = twoAssets;
    json.trials = [trialWith([0, 1], 1)];
    json.markers = [];
    json.events = [];
    const r = validateExtraction(JSON.stringify(json), makeInventory(), SOURCE_TEXT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dropped.find((d) => d.type === 'trial')).toBeUndefined();
      expect(r.result.trials).toHaveLength(1);
      expect((r.result.trials[0] as { asset_refs: number[] }).asset_refs).toEqual([0, 1]);
    }
  });
});
