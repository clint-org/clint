import type { BullseyeData } from '../../core/models/landscape.model';
import { phaseShortLabel } from '../../core/models/phase-colors';
import type { SheetSpec } from '../../shared/export/xlsx-sheet.util';
import { buildExportSheet, type ExportColumn } from '../../shared/export/grid-sheet.util';

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type BullseyeExportRow = {
  spoke: string;
  company: string;
  asset: string;
  generic: string;
  phase: string;
  moa: string;
  roa: string;
  indication: string;
  trialCount: number;
  recentChanges: number;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type BullseyeTrialExportRow = {
  spoke: string;
  company: string;
  asset: string;
  trial: string;
  acronym: string;
  nctId: string;
  status: string;
  recruitmentStatus: string;
  studyType: string;
  phase: string;
};

/**
 * Flatten the bullseye spoke -> asset structure into one row per asset
 * occurrence, mirroring what the chart shows (an asset on N spokes yields N
 * rows). Carries the detail panel's row-model fields (trial count, recent
 * change count); intelligence notes load per asset and are excluded.
 */
export function buildBullseyeRows(data: BullseyeData): BullseyeExportRow[] {
  const rows: BullseyeExportRow[] = [];
  for (const spoke of data.spokes) {
    for (const a of spoke.products) {
      rows.push({
        spoke: spoke.name,
        company: a.company_name,
        asset: a.name,
        generic: a.generic_name ?? '',
        phase: a.highest_phase ? phaseShortLabel(a.highest_phase) : '',
        moa: a.moas.map((m) => m.name).join(', '),
        roa: a.roas.map((r) => r.abbreviation ?? r.name).join(', '),
        indication: a.indications.map((i) => i.name).join(', '),
        trialCount: a.trials?.length ?? 0,
        recentChanges: a.recent_changes_count ?? 0,
      });
    }
  }
  return rows;
}

/** One row per trial shown in the asset detail panel, keyed by spoke + asset. */
export function buildBullseyeTrialRows(data: BullseyeData): BullseyeTrialExportRow[] {
  const rows: BullseyeTrialExportRow[] = [];
  for (const spoke of data.spokes) {
    for (const a of spoke.products) {
      for (const t of a.trials ?? []) {
        rows.push({
          spoke: spoke.name,
          company: a.company_name,
          asset: a.name,
          trial: t.name,
          acronym: t.acronym ?? '',
          nctId: t.identifier ?? '',
          status: t.status ?? '',
          recruitmentStatus: t.recruitment_status ?? '',
          studyType: t.study_type ?? '',
          phase: t.phase ?? '',
        });
      }
    }
  }
  return rows;
}

export const BULLSEYE_EXPORT_COLUMNS: ExportColumn<BullseyeExportRow>[] = [
  { header: 'Group', value: (r) => r.spoke, width: 22 },
  { header: 'Company', value: (r) => r.company, width: 22 },
  { header: 'Asset', value: (r) => r.asset, width: 22 },
  { header: 'Generic', value: (r) => r.generic, width: 20 },
  { header: 'Phase', value: (r) => r.phase, width: 10 },
  { header: 'MOA', value: (r) => r.moa, width: 26 },
  { header: 'ROA', value: (r) => r.roa, width: 12 },
  { header: 'Indication', value: (r) => r.indication, width: 26 },
  { header: 'Trials', value: (r) => r.trialCount, width: 8 },
  { header: 'Recent changes', value: (r) => r.recentChanges, width: 14 },
];

export const BULLSEYE_TRIAL_COLUMNS: ExportColumn<BullseyeTrialExportRow>[] = [
  { header: 'Group', value: (r) => r.spoke, width: 22 },
  { header: 'Company', value: (r) => r.company, width: 22 },
  { header: 'Asset', value: (r) => r.asset, width: 22 },
  { header: 'Trial', value: (r) => r.trial, width: 30 },
  { header: 'Acronym', value: (r) => r.acronym, width: 14 },
  { header: 'NCT ID', value: (r) => r.nctId, width: 14 },
  { header: 'Status', value: (r) => r.status, width: 14 },
  { header: 'Recruitment status', value: (r) => r.recruitmentStatus, width: 20 },
  { header: 'Study type', value: (r) => r.studyType, width: 16 },
  { header: 'Phase', value: (r) => r.phase, width: 10 },
];

/** The bullseye workbook: Assets (one row per dot) + Trials (detail panel list). */
export function buildBullseyeSheets(data: BullseyeData): SheetSpec[] {
  return [
    buildExportSheet('Assets', BULLSEYE_EXPORT_COLUMNS, buildBullseyeRows(data)),
    buildExportSheet('Trials', BULLSEYE_TRIAL_COLUMNS, buildBullseyeTrialRows(data)),
  ];
}
