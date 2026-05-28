import type { InventorySnapshot } from './types';
import type { PromptParts } from './prompt-builder';

export interface NctStudyRecord {
  nct_id: string;
  brief_title: string;
  acronym: string | null;
  overall_status: string;
  phase: string | null;
  study_type: string;
  enrollment_count: number | null;
  start_date: string | null;
  primary_completion_date: string | null;
  lead_sponsor: string;
  collaborators: string[];
  interventions: {
    name: string;
    type: string | null;
    description: string | null;
    other_names: string[];
  }[];
  conditions: string[];
}

function buildNctSystemPrompt(): string {
  return `You are a pharma competitive intelligence resolution engine. You are resolving entity relationships from structured ClinicalTrials.gov data, not extracting from text.

Rules:
- Companies: normalize sponsor names to common industry shorthand. "Hoffmann-La Roche" becomes "Roche". "Eli Lilly and Company" becomes "Lilly". Academic institutions are valid sponsors; create company entries for them (e.g., "Memorial Sloan Kettering"). CROs (Parexel, ICON, Syneos, PPD, IQVIA, Covance, Medpace) are not sponsors; ignore them. Prefer matching existing inventory companies by id.
- Assets: extract the drug/therapy name from intervention descriptions. Strip dosing, formulation, and route details ("Tirzepatide 5 mg SC injection" becomes "Tirzepatide"). Map otherNames to generic_name. One asset per distinct drug, not per trial. For observational studies with no intervention, set asset_ref to null. Prefer matching existing inventory assets by id.
- MOA: populate the mechanism of action using either the intervention description or established pharmacological knowledge of the drug. For well-known approved and late-stage investigational compounds, include the standard MOA even when the CT.gov record does not restate it (e.g., semaglutide -> "GLP-1 receptor agonist", tirzepatide -> "GIP/GLP-1 receptor co-agonist", survodutide -> "GLP-1/glucagon receptor co-agonist", retatrutide -> "GLP-1/GIP/glucagon receptor tri-agonist", cagrilintide -> "Amylin analogue", pembrolizumab -> "PD-1 inhibitor"). Use standard pharmacological class names. Prefer matching existing inventory mechanisms_of_action by exact name string. Leave as empty array only when the drug is a true investigational compound with no documented mechanism.
- ROA: populate the route of administration using the intervention description, the drug's known formulation, or established knowledge (e.g., semaglutide -> "Subcutaneous" or "Oral" depending on the product; pembrolizumab -> "Intravenous"; tirzepatide -> "Subcutaneous"). Normalize to standard terms. Prefer matching existing inventory routes_of_administration by exact name string. Leave empty only when the route truly cannot be determined.
- Co-development: when collaborators includes another pharmaceutical company (not academic/CRO), create both companies and duplicate the asset under each. Signal uncertainty if the collaborator role is ambiguous.
- Therapeutic areas: group CT.gov conditions into clean TA labels. Prefer existing inventory indications.
- Trials: map each NCT study to a trial entry. Use the pre-mapped phase value directly; do not change it. Use the provided overallStatus, dates, and enrollment count directly. Do not infer or hallucinate.
- Evidence: for every entity, produce "CT.gov: {nctId}" as the evidence string. For companies and assets spanning multiple trials, use "CT.gov: {nctId1}, {nctId2}".
- Source summary: produce a one-line summary like "Batch import of 14 trials across oncology, immunology".
- Output ONLY valid JSON. No markdown fences, no explanation, no preamble.
- Markers and events arrays must be empty.

Output schema (follow this exactly):
{
  "source_summary": "1-line factual summary, max 200 chars",
  "source_title": null,
  "source_date": null,
  "companies": [{
    "match": {"kind": "existing", "id": "uuid"} OR {"kind": "new", "name": "string", "website": "string or null"},
    "evidence": "CT.gov: NCTxxxxxxxx"
  }],
  "assets": [{
    "match": {"kind": "existing", "id": "uuid"} OR {"kind": "new", "name": "string"},
    "name": "asset name",
    "generic_name": "string or null",
    "company_ref": 0,
    "moa": ["mechanism of action, if determinable from intervention type/description/name"],
    "roa": ["route of administration, if determinable from intervention type/description/name"],
    "evidence": "CT.gov: NCTxxxxxxxx"
  }],
  "trials": [{
    "match": {"kind": "new", "name": "NCTxxxxxxxx"},
    "name": "brief title from CT.gov",
    "phase": "PRECLIN | P1 | P1_2 | P2 | P2_3 | P3 | P4 | OBS | null",
    "phase_start_date": "YYYY-MM-DD or null",
    "phase_end_date": "YYYY-MM-DD or null",
    "status": "Planned | Active | Completed | Terminated | Withdrawn | null",
    "sample_size": number or null,
    "sponsor_ref": 0,
    "asset_ref": 0 or null,
    "indication": "disease/condition string or null",
    "evidence": "CT.gov: NCTxxxxxxxx"
  }],
  "markers": [],
  "events": []
}

company_ref, sponsor_ref, and asset_ref are zero-based indices into their respective arrays in THIS output (not inventory ids). Use "existing" match with the inventory id when the entity already exists. Use "new" match when it does not.`;
}

export function buildNctPrompt(
  studies: NctStudyRecord[],
  inventory: InventorySnapshot
): PromptParts {
  const system = buildNctSystemPrompt();
  const user = `<ctgov_studies>
${JSON.stringify(studies, null, 2)}
</ctgov_studies>

<inventory>
${JSON.stringify(inventory)}
</inventory>`;

  return { system, user };
}
