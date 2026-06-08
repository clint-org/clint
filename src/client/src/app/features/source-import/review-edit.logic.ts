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
  indications: string[];
  phase: string | null;
  phaseStart: string | null;
  phaseEnd: string | null;
}

function trialIndications(t: Entity): string[] {
  const many = t['indications'];
  if (Array.isArray(many)) return many.filter((i): i is string => typeof i === 'string');
  const one = t['indication'];
  return typeof one === 'string' && one.length > 0 ? [one] : [];
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
    indications: trialIndications(t),
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
      indications: value.indications,
      phase: value.phase,
      phase_start_date: value.phaseStart,
      phase_end_date: value.phaseEnd,
    };
  });
  return { ...p, proposals: { ...p.proposals, trials } };
}

export interface AssetFormValue {
  name: string;
  genericName: string | null;
  companyId: string | null;
  moa: string[];
  roa: string[];
}

export function proposalAssetToForm(idx: number, p: Proposal): AssetFormValue {
  const a = p.proposals.assets[idx];
  const cref = a['company_ref'];
  return {
    name: String(a['name'] ?? ''),
    genericName: (a['generic_name'] as string) ?? null,
    companyId: typeof cref === 'number' ? String(cref) : null,
    moa: Array.isArray(a['moa']) ? (a['moa'] as string[]) : [],
    roa: Array.isArray(a['roa']) ? (a['roa'] as string[]) : [],
  };
}

export function applyAssetForm(value: AssetFormValue, idx: number, p: Proposal): Proposal {
  const assets = p.proposals.assets.map((a, i) =>
    i !== idx
      ? a
      : {
          ...a,
          name: value.name,
          generic_name: value.genericName,
          company_ref: value.companyId != null ? Number(value.companyId) : null,
          moa: value.moa,
          roa: value.roa,
        },
  );
  return { ...p, proposals: { ...p.proposals, assets } };
}

export interface CompanyFormValue {
  name: string;
  website: string | null;
}

export function proposalCompanyToForm(idx: number, p: Proposal): CompanyFormValue {
  const c = p.proposals.companies[idx];
  return { name: String(c['name'] ?? ''), website: (c['website'] as string) ?? null };
}

export function applyCompanyForm(value: CompanyFormValue, idx: number, p: Proposal): Proposal {
  const companies = p.proposals.companies.map((c, i) =>
    i !== idx ? c : { ...c, name: value.name, website: value.website },
  );
  return { ...p, proposals: { ...p.proposals, companies } };
}

type EntityType = 'companies' | 'assets' | 'trials';
interface FuzzyAlt {
  id: string;
  name: string;
  score: number;
}
interface ProposalWithFuzzy extends Proposal {
  fuzzy_alternates?: Record<string, FuzzyAlt[]>;
}

export function matchOptionsFor(type: EntityType, idx: number, p: ProposalWithFuzzy): FormOption[] {
  const e = p.proposals[type][idx];
  const alts = p.fuzzy_alternates?.[`${type}_${idx}`] ?? [];
  return [
    { id: '__new__', name: `Create new: ${entityName(e)}` },
    ...alts.map((a) => ({ id: a.id, name: `${a.name} (${a.score.toFixed(2)})` })),
  ];
}

export function currentMatchId(type: EntityType, idx: number, p: ProposalWithFuzzy): string {
  const m = p.proposals[type][idx]['match'] as { kind?: string; id?: string } | undefined;
  return m?.kind === 'existing' && m.id ? m.id : '__new__';
}

export function applyMatchOverride(
  type: EntityType,
  idx: number,
  optionId: string,
  p: ProposalWithFuzzy,
): ProposalWithFuzzy {
  const list = p.proposals[type].map((e, i) => {
    if (i !== idx) return e;
    const match =
      optionId === '__new__' ? { kind: 'new', name: entityName(e) } : { kind: 'existing', id: optionId };
    return { ...e, match };
  });
  return { ...p, proposals: { ...p.proposals, [type]: list } };
}
