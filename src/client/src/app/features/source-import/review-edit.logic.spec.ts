import { describe, it, expect } from 'vitest';
import {
  type FormOption,
  assetOptionsFromProposal,
  companyOptionsFromProposal,
  proposalTrialToForm,
  applyTrialForm,
  proposalAssetToForm,
  applyAssetForm,
  proposalCompanyToForm,
  applyCompanyForm,
} from './review-edit.logic';

const proposal = () => ({
  proposals: {
    companies: [{ match: { kind: 'existing', id: 'co-1' }, name: 'Lilly' }],
    assets: [
      { match: { kind: 'existing', id: 'as-t' }, name: 'Tirzepatide', company_ref: 0 },
      { match: { kind: 'new', name: 'Retatrutide' }, name: 'Retatrutide', company_ref: 0 },
    ],
    trials: [
      { match: { kind: 'new', name: 'NCT07165028' }, name: 'SYNERGY-Outcomes', identifier: 'NCT07165028',
        phase: 'P3', status: 'Active', indication: 'MASLD', asset_refs: [0, 1], primary_asset_ref: 0,
        phase_start_date: '2025-10-15', phase_end_date: null },
    ],
  },
});

describe('option builders', () => {
  it('asset options are indexed by position with display names', () => {
    expect(assetOptionsFromProposal(proposal())).toEqual<FormOption[]>([
      { id: '0', name: 'Tirzepatide' },
      { id: '1', name: 'Retatrutide' },
    ]);
  });
  it('company options are indexed by position', () => {
    expect(companyOptionsFromProposal(proposal())).toEqual<FormOption[]>([{ id: '0', name: 'Lilly' }]);
  });
});

describe('proposalTrialToForm', () => {
  it('maps refs to string ids and carries fields', () => {
    expect(proposalTrialToForm(0, proposal())).toEqual({
      name: 'SYNERGY-Outcomes',
      identifier: 'NCT07165028',
      assetIds: ['0', '1'],
      primaryAssetId: '0',
      indication: 'MASLD',
      phase: 'P3',
      phaseStart: '2025-10-15',
      phaseEnd: null,
    });
  });
  it('falls back primary to first ref when unset', () => {
    const p = proposal();
    delete (p.proposals.trials[0] as Record<string, unknown>)['primary_asset_ref'];
    expect(proposalTrialToForm(0, p).primaryAssetId).toBe('0');
  });
});

describe('applyTrialForm', () => {
  it('writes refs back as numbers and updates editable fields, leaving status/match intact', () => {
    const p = proposal();
    const next = applyTrialForm(
      { name: 'SYNERGY-Outcomes', identifier: 'NCT07165028', assetIds: ['1'], primaryAssetId: '1',
        indication: 'NASH', phase: 'P2', phaseStart: null, phaseEnd: null },
      0,
      p,
    );
    const t = next.proposals.trials[0] as Record<string, unknown>;
    expect(t['asset_refs']).toEqual([1]);
    expect(t['primary_asset_ref']).toBe(1);
    expect(t['indication']).toBe('NASH');
    expect(t['phase']).toBe('P2');
    expect(t['status']).toBe('Active'); // untouched
    expect(t['match']).toEqual({ kind: 'new', name: 'NCT07165028' }); // untouched
    // input proposal not mutated
    expect((p.proposals.trials[0] as Record<string, unknown>)['asset_refs']).toEqual([0, 1]);
  });
});

describe('asset mapping', () => {
  const p = () => ({ proposals: { companies: [{ match: { kind: 'existing', id: 'co' }, name: 'Lilly' }],
    assets: [{ match: { kind: 'new', name: 'Retatrutide' }, name: 'Retatrutide', generic_name: 'reta',
      company_ref: 0, moa: ['tri-agonist'], roa: ['Subcutaneous'] }], trials: [] } });
  it('maps to form value with company id and moa/roa names', () => {
    expect(proposalAssetToForm(0, p())).toEqual({
      name: 'Retatrutide', genericName: 'reta', companyId: '0', moa: ['tri-agonist'], roa: ['Subcutaneous'],
    });
  });
  it('writes form back without mutating input', () => {
    const src = p();
    const next = applyAssetForm({ name: 'Reta', genericName: null, companyId: '0', moa: ['X'], roa: [] }, 0, src);
    const a = next.proposals.assets[0] as Record<string, unknown>;
    expect(a['name']).toBe('Reta'); expect(a['moa']).toEqual(['X']); expect(a['roa']).toEqual([]);
    expect((src.proposals.assets[0] as Record<string, unknown>)['name']).toBe('Retatrutide');
  });
});

describe('company mapping', () => {
  const p = () => ({ proposals: { companies: [{ match: { kind: 'new', name: 'Lilly' }, name: 'Lilly', website: 'x.com' }], assets: [], trials: [] } });
  it('round-trips name + website', () => {
    expect(proposalCompanyToForm(0, p())).toEqual({ name: 'Lilly', website: 'x.com' });
    const next = applyCompanyForm({ name: 'Eli Lilly', website: null }, 0, p());
    expect((next.proposals.companies[0] as Record<string, unknown>)['name']).toBe('Eli Lilly');
  });
});
