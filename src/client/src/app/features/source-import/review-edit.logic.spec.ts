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
  matchOptionsFor,
  currentMatchId,
  applyMatchOverride,
  isExistingMatch,
  lockNoteFor,
} from './review-edit.logic';

const proposal = () => ({
  proposals: {
    companies: [{ match: { kind: 'existing', id: 'co-1' }, name: 'Lilly' }],
    assets: [
      { match: { kind: 'existing', id: 'as-t' }, name: 'Tirzepatide', company_ref: 0 },
      { match: { kind: 'new', name: 'Retatrutide' }, name: 'Retatrutide', company_ref: 0 },
    ],
    trials: [
      {
        match: { kind: 'new', name: 'NCT07165028' },
        name: 'SYNERGY-Outcomes',
        identifier: 'NCT07165028',
        phase: 'P3',
        status: 'Active',
        indications: ['MASLD', 'NASH'],
        asset_refs: [0, 1],
        primary_asset_ref: 0,
        phase_start_date: '2025-10-15',
        phase_end_date: null,
      },
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
    expect(companyOptionsFromProposal(proposal())).toEqual<FormOption[]>([
      { id: '0', name: 'Lilly' },
    ]);
  });
});

describe('proposalTrialToForm', () => {
  it('maps refs to string ids and carries fields', () => {
    expect(proposalTrialToForm(0, proposal())).toEqual({
      name: 'SYNERGY-Outcomes',
      identifier: 'NCT07165028',
      assetIds: ['0', '1'],
      primaryAssetId: '0',
      indications: ['MASLD', 'NASH'],
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
  it('folds a legacy scalar indication into the indications array', () => {
    const p = proposal();
    const t = p.proposals.trials[0] as Record<string, unknown>;
    delete t['indications'];
    t['indication'] = 'MASLD';
    expect(proposalTrialToForm(0, p).indications).toEqual(['MASLD']);
  });
});

describe('applyTrialForm', () => {
  it('writes refs back as numbers and updates editable fields, leaving status/match intact', () => {
    const p = proposal();
    const next = applyTrialForm(
      {
        name: 'SYNERGY-Outcomes',
        identifier: 'NCT07165028',
        assetIds: ['1'],
        primaryAssetId: '1',
        indications: ['NASH', 'MASLD'],
        phase: 'P2',
        phaseStart: null,
        phaseEnd: null,
      },
      0,
      p
    );
    const t = next.proposals.trials[0] as Record<string, unknown>;
    expect(t['asset_refs']).toEqual([1]);
    expect(t['primary_asset_ref']).toBe(1);
    expect(t['indications']).toEqual(['NASH', 'MASLD']);
    expect(t['phase']).toBe('P2');
    expect(t['status']).toBe('Active'); // untouched
    expect(t['match']).toEqual({ kind: 'new', name: 'NCT07165028' }); // untouched
    // input proposal not mutated
    expect((p.proposals.trials[0] as Record<string, unknown>)['asset_refs']).toEqual([0, 1]);
  });
});

describe('asset mapping', () => {
  const p = () => ({
    proposals: {
      companies: [{ match: { kind: 'existing', id: 'co' }, name: 'Lilly' }],
      assets: [
        {
          match: { kind: 'new', name: 'Retatrutide' },
          name: 'Retatrutide',
          generic_name: 'reta',
          company_ref: 0,
          moa: ['tri-agonist'],
          roa: ['Subcutaneous'],
        },
      ],
      trials: [],
    },
  });
  it('maps to form value with company id and moa/roa names', () => {
    expect(proposalAssetToForm(0, p())).toEqual({
      name: 'Retatrutide',
      genericName: 'reta',
      companyId: '0',
      moa: ['tri-agonist'],
      roa: ['Subcutaneous'],
    });
  });
  it('writes form back without mutating input', () => {
    const src = p();
    const next = applyAssetForm(
      { name: 'Reta', genericName: null, companyId: '0', moa: ['X'], roa: [] },
      0,
      src
    );
    const a = next.proposals.assets[0] as Record<string, unknown>;
    expect(a['name']).toBe('Reta');
    expect(a['moa']).toEqual(['X']);
    expect(a['roa']).toEqual([]);
    expect((src.proposals.assets[0] as Record<string, unknown>)['name']).toBe('Retatrutide');
  });
});

describe('company mapping', () => {
  const p = () => ({
    proposals: {
      companies: [{ match: { kind: 'new', name: 'Lilly' }, name: 'Lilly', website: 'x.com' }],
      assets: [],
      trials: [],
    },
  });
  it('round-trips name + website', () => {
    expect(proposalCompanyToForm(0, p())).toEqual({ name: 'Lilly', website: 'x.com' });
    const next = applyCompanyForm({ name: 'Eli Lilly', website: null }, 0, p());
    expect((next.proposals.companies[0] as Record<string, unknown>)['name']).toBe('Eli Lilly');
  });
});

const fp = () => ({
  proposals: {
    companies: [],
    assets: [{ match: { kind: 'new', name: 'Reta' }, name: 'Reta' }],
    trials: [],
  },
  fuzzy_alternates: { assets_0: [{ id: 'as-9', name: 'Retatrutide (existing)', score: 0.82 }] },
});

describe('match options', () => {
  it('offers create-new plus fuzzy candidates with scores', () => {
    expect(matchOptionsFor('assets', 0, fp())).toEqual([
      { id: '__new__', name: 'Create new: Reta' },
      { id: 'as-9', name: 'Retatrutide (existing) (82% match)' },
    ]);
  });
  it('current match id is __new__ for a new entity', () => {
    expect(currentMatchId('assets', 0, fp())).toBe('__new__');
  });
  it('applies an existing override and clears it back to new', () => {
    const linked = applyMatchOverride('assets', 0, 'as-9', fp());
    expect((linked.proposals.assets[0] as Record<string, unknown>)['match']).toEqual({
      kind: 'existing',
      id: 'as-9',
    });
    const reset = applyMatchOverride('assets', 0, '__new__', linked);
    expect((reset.proposals.assets[0] as Record<string, unknown>)['match']).toEqual({
      kind: 'new',
      name: 'Reta',
    });
  });
});

describe('existing-match locking', () => {
  it('isExistingMatch is false only for the create-new sentinel', () => {
    expect(isExistingMatch('__new__')).toBe(false);
    expect(isExistingMatch('as-9')).toBe(true);
  });
  it('no lock note when creating new', () => {
    expect(lockNoteFor('assets', '__new__')).toBeNull();
    expect(lockNoteFor('companies', '__new__')).toBeNull();
    expect(lockNoteFor('trials', '__new__')).toBeNull();
  });
  it('no lock note without a resolved type', () => {
    expect(lockNoteFor(null, 'as-9')).toBeNull();
  });
  it('asset note calls out the MOA/ROA merge exception', () => {
    const note = lockNoteFor('assets', 'as-9');
    expect(note).toContain('mechanisms and routes are merged in');
  });
  it('company and trial notes say details are unchanged', () => {
    expect(lockNoteFor('companies', 'co-1')).toContain('not changed by this import');
    expect(lockNoteFor('trials', 'tr-1')).toContain('not changed by this import');
  });
});

// Existing-matched entities carry no inline `name`; the display name comes from
// resolved_names. This is the common NCT-import case.
describe('existing-match name resolution', () => {
  const ep = () => ({
    proposals: {
      companies: [{ match: { kind: 'existing', id: 'co-novo' } }],
      assets: [{ match: { kind: 'existing', id: 'as-sema' }, generic_name: 'semaglutide', company_ref: 0, moa: ['GLP-1'], roa: ['SC'] }],
      trials: [{ match: { kind: 'existing', id: 'tr-1' }, asset_ref: 0 }],
    },
    resolved_names: { companies_0: 'Novo Nordisk', assets_0: 'Semaglutide', trials_0: 'STEP-1' },
    fuzzy_alternates: {},
  });

  it('company options use the resolved name', () => {
    expect(companyOptionsFromProposal(ep())).toEqual([{ id: '0', name: 'Novo Nordisk' }]);
  });
  it('asset options use the resolved name', () => {
    expect(assetOptionsFromProposal(ep())).toEqual([{ id: '0', name: 'Semaglutide' }]);
  });
  it('proposalCompanyToForm resolves the name', () => {
    expect(proposalCompanyToForm(0, ep()).name).toBe('Novo Nordisk');
  });
  it('proposalAssetToForm resolves the name and keeps the company ref', () => {
    const v = proposalAssetToForm(0, ep());
    expect(v.name).toBe('Semaglutide');
    expect(v.companyId).toBe('0');
  });
  it('proposalTrialToForm resolves the name', () => {
    expect(proposalTrialToForm(0, ep()).name).toBe('STEP-1');
  });
  it('matchOptionsFor keeps the current existing match selectable with the resolved name', () => {
    const opts = matchOptionsFor('companies', 0, ep());
    expect(opts).toEqual([
      { id: '__new__', name: 'Create new: Novo Nordisk' },
      { id: 'co-novo', name: 'Novo Nordisk (current match)' },
    ]);
    expect(currentMatchId('companies', 0, ep())).toBe('co-novo');
  });
});
