/**
 * Catalogue of ClinicalTrials.gov v2 study fields surfaced inside Clint.
 *
 * Each entry maps a dotted JSON path into the snapshot payload (as returned by
 * the CT.gov v2 study endpoint and stored in `trial_ctgov_snapshots.payload`)
 * to a human-readable label and a render kind. Used by:
 *   - the CT.gov field renderer (one renderer for every surface)
 *   - the "Show all CT.gov data" modal on trial-detail
 *   - the per-space `ctgov_field_visibility` settings UI
 */
export interface CtgovField {
  /** dotted JSON path into the snapshot payload, e.g. 'protocolSection.identificationModule.officialTitle' */
  path: string;
  /** human-readable label rendered in the field renderer + the field picker */
  label: string;
  /** how to render the value */
  kind: 'string' | 'longtext' | 'date' | 'number' | 'boolean' | 'array';
  /** for arrays: the sub-path inside each item to extract for the rendered list */
  itemPath?: string;
  /** for arrays: 'count' renders as 'N items' with click-to-expand */
  summary?: 'count';
}

export const CTGOV_FIELD_CATALOGUE: CtgovField[] = [
  // ===== identificationModule =====
  { path: 'protocolSection.identificationModule.nctId', label: 'NCT identifier', kind: 'string' },
  { path: 'protocolSection.identificationModule.briefTitle', label: 'Brief title', kind: 'string' },
  {
    path: 'protocolSection.identificationModule.officialTitle',
    label: 'Official title',
    kind: 'longtext',
  },
  { path: 'protocolSection.identificationModule.acronym', label: 'Acronym', kind: 'string' },
  {
    path: 'protocolSection.identificationModule.orgStudyIdInfo.id',
    label: 'Org study ID',
    kind: 'string',
  },
  {
    path: 'protocolSection.identificationModule.organization.fullName',
    label: 'Submitting organization',
    kind: 'string',
  },
  {
    path: 'protocolSection.identificationModule.organization.class',
    label: 'Submitting organization class',
    kind: 'string',
  },
  {
    path: 'protocolSection.identificationModule.secondaryIdInfos',
    label: 'Secondary IDs',
    kind: 'array',
    itemPath: 'id',
    summary: 'count',
  },

  // ===== statusModule =====
  { path: 'protocolSection.statusModule.overallStatus', label: 'Overall status', kind: 'string' },
  {
    path: 'protocolSection.statusModule.statusVerifiedDate',
    label: 'Status verified',
    kind: 'date',
  },
  { path: 'protocolSection.statusModule.whyStopped', label: 'Why stopped', kind: 'longtext' },
  {
    path: 'protocolSection.statusModule.expandedAccessInfo.hasExpandedAccess',
    label: 'Expanded access available',
    kind: 'boolean',
  },
  { path: 'protocolSection.statusModule.startDateStruct.date', label: 'Start date', kind: 'date' },
  {
    path: 'protocolSection.statusModule.primaryCompletionDateStruct.date',
    label: 'Primary completion date',
    kind: 'date',
  },
  {
    path: 'protocolSection.statusModule.completionDateStruct.date',
    label: 'Study completion date',
    kind: 'date',
  },
  {
    path: 'protocolSection.statusModule.studyFirstSubmitDate',
    label: 'First submitted',
    kind: 'date',
  },
  {
    path: 'protocolSection.statusModule.studyFirstPostDateStruct.date',
    label: 'First posted',
    kind: 'date',
  },
  {
    path: 'protocolSection.statusModule.lastUpdateSubmitDate',
    label: 'Last update submitted',
    kind: 'date',
  },
  {
    path: 'protocolSection.statusModule.lastUpdatePostDateStruct.date',
    label: 'Last update posted',
    kind: 'date',
  },
  {
    path: 'protocolSection.statusModule.resultsFirstSubmitDate',
    label: 'Results first submitted',
    kind: 'date',
  },
  {
    path: 'protocolSection.statusModule.resultsFirstPostDateStruct.date',
    label: 'Results first posted',
    kind: 'date',
  },

  // ===== sponsorCollaboratorsModule =====
  {
    path: 'protocolSection.sponsorCollaboratorsModule.leadSponsor.name',
    label: 'Lead sponsor',
    kind: 'string',
  },
  {
    path: 'protocolSection.sponsorCollaboratorsModule.leadSponsor.class',
    label: 'Sponsor class',
    kind: 'string',
  },
  {
    path: 'protocolSection.sponsorCollaboratorsModule.responsibleParty.type',
    label: 'Responsible party type',
    kind: 'string',
  },
  {
    path: 'protocolSection.sponsorCollaboratorsModule.collaborators',
    label: 'Collaborators',
    kind: 'array',
    itemPath: 'name',
    summary: 'count',
  },

  // ===== oversightModule =====
  {
    path: 'protocolSection.oversightModule.oversightHasDmc',
    label: 'Has data monitoring committee',
    kind: 'boolean',
  },
  {
    path: 'protocolSection.oversightModule.isFdaRegulatedDrug',
    label: 'FDA regulated drug',
    kind: 'boolean',
  },
  {
    path: 'protocolSection.oversightModule.isFdaRegulatedDevice',
    label: 'FDA regulated device',
    kind: 'boolean',
  },
  { path: 'protocolSection.oversightModule.isUsExport', label: 'US export', kind: 'boolean' },

  // ===== descriptionModule =====
  {
    path: 'protocolSection.descriptionModule.briefSummary',
    label: 'Brief summary',
    kind: 'longtext',
  },
  {
    path: 'protocolSection.descriptionModule.detailedDescription',
    label: 'Detailed description',
    kind: 'longtext',
  },

  // ===== conditionsModule =====
  {
    path: 'protocolSection.conditionsModule.conditions',
    label: 'Conditions',
    kind: 'array',
    summary: 'count',
  },
  { path: 'protocolSection.conditionsModule.keywords', label: 'Keywords', kind: 'array' },

  // ===== designModule =====
  { path: 'protocolSection.designModule.studyType', label: 'Study type', kind: 'string' },
  { path: 'protocolSection.designModule.phases', label: 'Phases', kind: 'array' },
  {
    path: 'protocolSection.designModule.designInfo.allocation',
    label: 'Allocation',
    kind: 'string',
  },
  {
    path: 'protocolSection.designModule.designInfo.interventionModel',
    label: 'Intervention model',
    kind: 'string',
  },
  {
    path: 'protocolSection.designModule.designInfo.primaryPurpose',
    label: 'Primary purpose',
    kind: 'string',
  },
  {
    path: 'protocolSection.designModule.designInfo.observationalModel',
    label: 'Observational model',
    kind: 'string',
  },
  {
    path: 'protocolSection.designModule.designInfo.timePerspective',
    label: 'Time perspective',
    kind: 'string',
  },
  {
    path: 'protocolSection.designModule.designInfo.maskingInfo.masking',
    label: 'Masking',
    kind: 'string',
  },
  {
    path: 'protocolSection.designModule.enrollmentInfo.count',
    label: 'Enrollment count',
    kind: 'number',
  },
  {
    path: 'protocolSection.designModule.enrollmentInfo.type',
    label: 'Enrollment type',
    kind: 'string',
  },

  // ===== armsInterventionsModule =====
  {
    path: 'protocolSection.armsInterventionsModule.armGroups',
    label: 'Arm groups',
    kind: 'array',
    itemPath: 'label',
  },
  {
    path: 'protocolSection.armsInterventionsModule.interventions',
    label: 'Interventions',
    kind: 'array',
    itemPath: 'name',
  },

  // ===== outcomesModule =====
  {
    path: 'protocolSection.outcomesModule.primaryOutcomes',
    label: 'Primary outcomes',
    kind: 'array',
    itemPath: 'measure',
  },
  {
    path: 'protocolSection.outcomesModule.secondaryOutcomes',
    label: 'Secondary outcomes',
    kind: 'array',
    itemPath: 'measure',
  },

  // ===== eligibilityModule =====
  { path: 'protocolSection.eligibilityModule.sex', label: 'Sex', kind: 'string' },
  {
    path: 'protocolSection.eligibilityModule.genderBased',
    label: 'Gender-based eligibility',
    kind: 'boolean',
  },
  { path: 'protocolSection.eligibilityModule.minimumAge', label: 'Minimum age', kind: 'string' },
  { path: 'protocolSection.eligibilityModule.maximumAge', label: 'Maximum age', kind: 'string' },
  { path: 'protocolSection.eligibilityModule.stdAges', label: 'Standard ages', kind: 'array' },
  {
    path: 'protocolSection.eligibilityModule.healthyVolunteers',
    label: 'Accepts healthy volunteers',
    kind: 'boolean',
  },
  {
    path: 'protocolSection.eligibilityModule.eligibilityCriteria',
    label: 'Eligibility criteria',
    kind: 'longtext',
  },
  {
    path: 'protocolSection.eligibilityModule.samplingMethod',
    label: 'Sampling method',
    kind: 'string',
  },
  {
    path: 'protocolSection.eligibilityModule.studyPopulation',
    label: 'Study population',
    kind: 'longtext',
  },

  // ===== contactsLocationsModule =====
  {
    path: 'protocolSection.contactsLocationsModule.locations',
    label: 'Locations',
    kind: 'array',
    itemPath: 'facility',
    summary: 'count',
  },
  {
    path: 'protocolSection.contactsLocationsModule.centralContacts',
    label: 'Central contacts',
    kind: 'array',
    summary: 'count',
  },
  {
    path: 'protocolSection.contactsLocationsModule.overallOfficials',
    label: 'Overall officials',
    kind: 'array',
    itemPath: 'name',
    summary: 'count',
  },

  // ===== ipdSharingStatementModule =====
  {
    path: 'protocolSection.ipdSharingStatementModule.ipdSharing',
    label: 'IPD sharing',
    kind: 'string',
  },
  {
    path: 'protocolSection.ipdSharingStatementModule.description',
    label: 'IPD sharing description',
    kind: 'longtext',
  },

  // ===== referencesModule =====
  {
    path: 'protocolSection.referencesModule.references',
    label: 'References',
    kind: 'array',
    itemPath: 'citation',
    summary: 'count',
  },
];

/** Defaults referenced by the per-space surface_key visibility config. */
export const CTGOV_DETAIL_DEFAULT_PATHS = [
  'protocolSection.sponsorCollaboratorsModule.leadSponsor.name',
  'protocolSection.statusModule.primaryCompletionDateStruct.date',
];

export const CTGOV_BULLSEYE_DEFAULT_PATHS = [
  'protocolSection.sponsorCollaboratorsModule.leadSponsor.name',
];

export const CTGOV_KEY_CATALYSTS_DEFAULT_PATHS = [
  'protocolSection.sponsorCollaboratorsModule.leadSponsor.name',
];

export const CTGOV_TIMELINE_DEFAULT_PATHS: string[] = [];

export const CTGOV_TRIAL_LIST_DEFAULT_PATHS = ['protocolSection.identificationModule.nctId'];
