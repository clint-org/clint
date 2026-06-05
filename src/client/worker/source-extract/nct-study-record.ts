import { mapCtgovPhase } from './nct-phase-map';
import type { NctStudyRecord } from './nct-prompt-builder';

// Strips the CT.gov type prefix from an arm's intervention name
// ("Drug: Cagrilintide" -> "Cagrilintide") so arm intervention names line up
// with the bare names in interventions[].name. The combination-detection rule
// in the prompt correlates the two, so clean names reduce model error.
function stripInterventionPrefix(raw: string): string {
  return raw.replace(/^[A-Za-z]+:\s*/, '').trim();
}

export function toStudyRecord(study: unknown): NctStudyRecord {
  const s = study as Record<string, any>;
  const proto = s['protocolSection'] ?? s;
  const ident = proto['identificationModule'] ?? {};
  const status = proto['statusModule'] ?? {};
  const design = proto['designModule'] ?? {};
  const sponsors = proto['sponsorCollaboratorsModule'] ?? {};
  const arms = proto['armsInterventionsModule'] ?? {};
  const conditions = proto['conditionsModule'] ?? {};

  const startDate = status.startDateStruct?.date ?? null;
  const completionDate = status.primaryCompletionDateStruct?.date ?? null;

  const phases: string[] | undefined = design.phases;
  const mappedPhase = mapCtgovPhase(phases);

  const collaborators = (sponsors.collaborators ?? []).map((c: any) => c.name as string);
  const interventions = (arms.interventions ?? []).map((iv: any) => ({
    name: (iv.name ?? '') as string,
    type: (iv.type as string) ?? null,
    description: (iv.description as string) ?? null,
    other_names: (iv.otherNames ?? []) as string[],
  }));

  // Arm groups carry the combination/regimen names (e.g. "CagriSema") that
  // never appear in interventions[]. Each arm lists the interventions its
  // patient group receives; an arm with two or more active drugs is a
  // fixed-dose combination. We feed these to the model so it can resolve the
  // combination product as the trial's headline asset.
  const arm_groups = (arms.armGroups ?? []).map((ag: any) => ({
    label: (ag.label ?? '') as string,
    type: (ag.type as string) ?? null,
    intervention_names: ((ag.interventionNames ?? []) as string[]).map(stripInterventionPrefix),
  }));

  return {
    nct_id: ident.nctId ?? '',
    brief_title: ident.briefTitle ?? '',
    acronym: ident.acronym?.trim() || null,
    overall_status: status.overallStatus ?? '',
    phase: mappedPhase,
    study_type: design.studyType ?? 'INTERVENTIONAL',
    enrollment_count: design.enrollmentInfo?.count ?? null,
    start_date: normalizeCtgovDate(startDate),
    primary_completion_date: normalizeCtgovDate(completionDate),
    lead_sponsor: sponsors.leadSponsor?.name ?? '',
    collaborators,
    interventions,
    arm_groups,
    conditions: conditions.conditions ?? [],
  };
}

// The headline trial name: prefer CT.gov's study acronym (e.g. "SYNERGY-Outcomes"),
// falling back to the brief title only when no acronym is published. Naming is
// resolved deterministically here, not by the LLM, so it is testable and stays
// consistent with the press-release import path. The full brief title is still
// persisted separately on the trial.
export function trialDisplayName(record: Pick<NctStudyRecord, 'acronym' | 'brief_title'>): string {
  return record.acronym?.trim() || record.brief_title;
}

// Overrides each proposal trial's name with its CT.gov-derived display name,
// matched by NCT id (new NCT trials carry their NCT id as `match.name`). Trials
// matched to an existing record, or whose match is not in `records`, are left
// untouched. Mutates `proposals.trials` in place, mirroring the other
// post-validation enrichment steps in nct-handler.
export function applyNctTrialNames(
  proposals: { trials: { name?: string; match?: { name?: string } }[] },
  records: Pick<NctStudyRecord, 'nct_id' | 'acronym' | 'brief_title'>[]
): void {
  const byNct = new Map(records.map((r) => [r.nct_id.toUpperCase(), r]));
  for (const trial of proposals.trials) {
    const nct = (trial.match?.name ?? '').toUpperCase();
    const record = byNct.get(nct);
    if (record) trial.name = trialDisplayName(record);
  }
}

function normalizeCtgovDate(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split(/[\s-]+/);
  if (parts.length === 3) {
    const [year, month, day] = parseYearMonthDay(parts);
    if (year && month && day) return `${year}-${month}-${day}`;
  }
  if (parts.length === 2) {
    const month = MONTH_MAP[parts[0]?.toLowerCase()] ?? parts[0];
    const year = parts[1];
    if (year && month) return `${year}-${month}-01`;
  }
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  return null;
}

const MONTH_MAP: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

function parseYearMonthDay(parts: string[]): [string | null, string | null, string | null] {
  const monthStr = parts[0]?.toLowerCase();
  const month = MONTH_MAP[monthStr];
  if (month) {
    const day = parts[1]?.replace(',', '').padStart(2, '0');
    const year = parts[2];
    return [year ?? null, month, day ?? null];
  }
  return [parts[0] ?? null, parts[1] ?? null, parts[2] ?? null];
}
