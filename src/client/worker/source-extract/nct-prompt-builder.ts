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
  arm_groups: {
    label: string;
    type: string | null;
    intervention_names: string[];
  }[];
  conditions: string[];
}

function buildNctSystemPrompt(): string {
  return `You are a pharma competitive intelligence resolution engine. You are resolving entity relationships from structured ClinicalTrials.gov data, not extracting from text.

Rules:
- Companies: normalize sponsor names to common industry shorthand. "Hoffmann-La Roche" becomes "Roche". "Eli Lilly and Company" becomes "Lilly". Academic institutions are valid sponsors; create company entries for them (e.g., "Memorial Sloan Kettering"). CROs (Parexel, ICON, Syneos, PPD, IQVIA, Covance, Medpace) are not sponsors; ignore them. Prefer matching existing inventory companies by id.
- Assets: extract the drug/therapy name from intervention descriptions. Strip dosing, formulation, and route details ("Tirzepatide 5 mg SC injection" becomes "Tirzepatide"). Map otherNames to generic_name. One asset per distinct drug, not per trial. For observational studies with no intervention, set asset_refs to [] (empty). Prefer matching existing inventory assets by id.
- asset_refs and primary_asset_ref: a trial's asset_refs is the list of every distinct asset it actively tests (zero-based indices into the assets array). primary_asset_ref is the single headline asset and MUST be one of asset_refs. For an ordinary single-drug trial, asset_refs has one element and primary_asset_ref equals it.
- Master protocols / platform trials: when ONE study tests two or more distinct experimental-arm drugs (each its own asset, e.g. SYNERGY-Outcomes testing tirzepatide in one arm and retatrutide in another), set asset_refs to ALL of those assets and set primary_asset_ref to the first/lead experimental arm. Do not invent a primary; pick the lead experimental drug. Placebo/standard-of-care comparator arms are not assets.
- Combinations: arm_groups describe which interventions each patient group receives. When an arm group's intervention_names lists two or more distinct ACTIVE drugs (ignore any whose name contains "placebo" or "sham"), that arm is a fixed-dose combination product, and its arm label is the product/brand name (e.g., arm "CagriSema" = cagrilintide + semaglutide; arm "Trastuzumab + Pertuzumab" is the combination of the two). Create the combination as a SINGLE asset named by the arm label. Set generic_name to the component INNs joined by " / " (e.g., "cagrilintide / semaglutide") and moa to the union of the components' mechanisms (e.g., ["Amylin analogue", "GLP-1 receptor agonist"]). When the combination arm is the experimental/primary arm (type EXPERIMENTAL), the trial is about the combination: include the combination asset's index in asset_refs and set it as primary_asset_ref, not the components. Still create the individual component drugs as their own assets when they also appear as their own single-drug arms (so monotherapy comparators remain tracked).
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
    "name": "study acronym if present, else brief title from CT.gov",
    "phase": "PRECLIN | P1 | P1_2 | P2 | P2_3 | P3 | P4 | OBS | null",
    "phase_start_date": "YYYY-MM-DD or null",
    "phase_end_date": "YYYY-MM-DD or null",
    "status": "Planned | Active | Completed | Terminated | Withdrawn | null",
    "sample_size": number or null,
    "sponsor_ref": 0,
    "asset_refs": [0],
    "primary_asset_ref": 0 or null,
    "indications": ["disease/condition string", ...] (every indication the trial studies; empty array if none),
    "evidence": "CT.gov: NCTxxxxxxxx"
  }],
  "markers": [],
  "events": []
}

company_ref, sponsor_ref, asset_refs, and primary_asset_ref are zero-based indices into their respective arrays in THIS output (not inventory ids). Use "existing" match with the inventory id when the entity already exists. Use "new" match when it does not.`;
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
