// Pure proposal⇄form logic for the import-review edit dialog. No Angular imports;
// unit-tested via vitest. The proposal shape is the in-memory SourceImportProposal.

export interface FormOption {
  id: string;
  name: string;
}

type Entity = Record<string, unknown>;
type EntityKind = 'companies' | 'assets' | 'trials';
interface Proposal {
  proposals: { companies: Entity[]; assets: Entity[]; trials: Entity[] };
  // Existing-matched entities carry no inline `name`; their display name is
  // resolved from inventory into resolved_names, keyed `${type}_${idx}`.
  resolved_names?: Record<string, string>;
}

// Display name for an entity: the inline name (new entities) or, for an
// existing match that has no inline name, the inventory-resolved name.
function displayName(p: Proposal, type: EntityKind, idx: number): string {
  const inline = entityName(p.proposals[type][idx]);
  if (inline) return inline;
  return p.resolved_names?.[`${type}_${idx}`] ?? '';
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
  return p.proposals.assets.map((_, i) => ({ id: String(i), name: displayName(p, 'assets', i) }));
}

export function companyOptionsFromProposal(p: Proposal): FormOption[] {
  return p.proposals.companies.map((_, i) => ({ id: String(i), name: displayName(p, 'companies', i) }));
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
    name: displayName(p, 'trials', idx),
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
    name: displayName(p, 'assets', idx),
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
        }
  );
  return { ...p, proposals: { ...p.proposals, assets } };
}

export interface CompanyFormValue {
  name: string;
  website: string | null;
}

export function proposalCompanyToForm(idx: number, p: Proposal): CompanyFormValue {
  const c = p.proposals.companies[idx];
  return { name: displayName(p, 'companies', idx), website: (c['website'] as string) ?? null };
}

export function applyCompanyForm(value: CompanyFormValue, idx: number, p: Proposal): Proposal {
  const companies = p.proposals.companies.map((c, i) =>
    i !== idx ? c : { ...c, name: value.name, website: value.website }
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
  const alts = p.fuzzy_alternates?.[`${type}_${idx}`] ?? [];
  const m = p.proposals[type][idx]['match'] as { kind?: string; id?: string } | undefined;
  const options: FormOption[] = [
    { id: '__new__', name: `Create new: ${displayName(p, type, idx)}` },
  ];
  // Keep the current existing match selectable even when it is not among the
  // fuzzy alternates, so its Select has a valid selected option and the analyst
  // can switch away from (or back to) it.
  if (m?.kind === 'existing' && m.id && !alts.some((a) => a.id === m.id)) {
    options.push({ id: m.id, name: `${displayName(p, type, idx)} (current match)` });
  }
  // Score is a 0-1 Jaro-Winkler name similarity; show it as a "% match" so the
  // confidence reads clearly rather than as a bare decimal.
  options.push(
    ...alts.map((a) => ({ id: a.id, name: `${a.name} (${Math.round(a.score * 100)}% match)` })),
  );
  return options;
}

export function currentMatchId(type: EntityType, idx: number, p: ProposalWithFuzzy): string {
  const m = p.proposals[type][idx]['match'] as { kind?: string; id?: string } | undefined;
  return m?.kind === 'existing' && m.id ? m.id : '__new__';
}

/** A match id other than the create-new sentinel links to an existing record. */
export function isExistingMatch(matchId: string): boolean {
  return matchId !== '__new__';
}

/**
 * Explainer shown when an entity is linked to an existing record. The import
 * commit ignores the proposal's identity fields for existing matches (it links
 * by id), so those inputs are disabled; this note says so. Assets are the lone
 * partial case: MOA/ROA are additively merged into the matched asset, so we call
 * that out. Returns null when creating a new record (nothing is locked).
 */
export function lockNoteFor(type: EntityType | null, matchId: string): string | null {
  if (!type || !isExistingMatch(matchId)) return null;
  switch (type) {
    case 'assets':
      return 'Linked to an existing asset. Its name, generic name, and company are kept as-is; only mechanisms and routes are merged in.';
    case 'companies':
      return 'Linked to an existing company. Its details are not changed by this import.';
    case 'trials':
      return 'Linked to an existing trial. Its details are not changed by this import.';
  }
}

export function applyMatchOverride(
  type: EntityType,
  idx: number,
  optionId: string,
  p: ProposalWithFuzzy
): ProposalWithFuzzy {
  const list = p.proposals[type].map((e, i) => {
    if (i !== idx) return e;
    const match =
      optionId === '__new__'
        ? { kind: 'new', name: displayName(p, type, idx) }
        : { kind: 'existing', id: optionId };
    return { ...e, match };
  });
  return { ...p, proposals: { ...p.proposals, [type]: list } };
}
