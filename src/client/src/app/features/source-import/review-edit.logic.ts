// Pure proposal⇄form logic for the import-review edit dialog. No Angular imports;
// unit-tested via vitest. The proposal shape is the in-memory SourceImportProposal.

export interface FormOption {
  id: string;
  name: string;
}

type Entity = Record<string, unknown>;
interface Proposal {
  proposals: { companies: Entity[]; assets: Entity[]; trials: Entity[] };
}

export interface TrialFormValue {
  name: string;
  identifier: string | null;
  assetIds: string[];
  primaryAssetId: string | null;
  indication: string | null;
  phase: string | null;
  phaseStart: string | null;
  phaseEnd: string | null;
}

function entityName(e: Entity): string {
  return String(e['name'] ?? e['title'] ?? '');
}

export function assetOptionsFromProposal(p: Proposal): FormOption[] {
  return p.proposals.assets.map((a, i) => ({ id: String(i), name: entityName(a) }));
}

export function companyOptionsFromProposal(p: Proposal): FormOption[] {
  return p.proposals.companies.map((c, i) => ({ id: String(i), name: entityName(c) }));
}

function rawRefs(t: Entity): number[] {
  const refs = t['asset_refs'];
  if (Array.isArray(refs)) return refs.filter((r): r is number => typeof r === 'number');
  const single = t['asset_ref'];
  return typeof single === 'number' ? [single] : [];
}

export function proposalTrialToForm(idx: number, p: Proposal): TrialFormValue {
  const t = p.proposals.trials[idx];
  const refs = rawRefs(t);
  const primary = t['primary_asset_ref'];
  return {
    name: String(t['name'] ?? ''),
    identifier: (t['identifier'] as string) ?? null,
    assetIds: refs.map(String),
    primaryAssetId:
      typeof primary === 'number' ? String(primary) : refs.length ? String(refs[0]) : null,
    indication: (t['indication'] as string) ?? null,
    phase: (t['phase'] as string) ?? null,
    phaseStart: (t['phase_start_date'] as string) ?? null,
    phaseEnd: (t['phase_end_date'] as string) ?? null,
  };
}

export function applyTrialForm(value: TrialFormValue, idx: number, p: Proposal): Proposal {
  const trials = p.proposals.trials.map((t, i) => {
    if (i !== idx) return t;
    return {
      ...t,
      name: value.name,
      asset_refs: value.assetIds.map(Number),
      primary_asset_ref: value.primaryAssetId != null ? Number(value.primaryAssetId) : null,
      indication: value.indication,
      phase: value.phase,
      phase_start_date: value.phaseStart,
      phase_end_date: value.phaseEnd,
    };
  });
  return { ...p, proposals: { ...p.proposals, trials } };
}
