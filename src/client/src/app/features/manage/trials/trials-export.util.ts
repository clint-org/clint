import type { Trial } from '../../../core/models/trial.model';
import { phaseShortLabel } from '../../../core/models/phase-colors';
import {
  dateCell,
  EXPORT_DATE_FMT,
  type ExportColumn,
} from '../../../shared/export/grid-sheet.util';

/** Structural slice of the trial list's row model that the export reads. */
export interface TrialExportRow {
  readonly trial: Trial;
  readonly assetName: string;
  readonly companyName: string;
  readonly markerCount: number;
}

export interface TrialExtraColumn {
  label: string;
  path: string;
}

/**
 * Explicit export surface for the trials grid: every visible column (trial,
 * NCT ID, asset, company, status, markers, the per-space CT.gov columns) plus
 * the trial detail's row-model fields (acronym, phase + window, recruitment
 * status, study type). The CT.gov extras resolve through the page's
 * already-loaded snapshot map (one batched fetch per space, no per-row calls).
 *
 * Detail fields that need a per-row fetch are intentionally excluded:
 * conditions/indications and the change feed load per trial on the detail
 * page.
 */
export function buildTrialExportColumns(
  extras: TrialExtraColumn[],
  extraValue: (trialId: string, path: string) => string
): ExportColumn<TrialExportRow>[] {
  const columns: ExportColumn<TrialExportRow>[] = [
    { header: 'Trial', value: (r) => r.trial.name, width: 30 },
    { header: 'Acronym', value: (r) => r.trial.acronym ?? '', width: 14 },
    { header: 'NCT ID', value: (r) => r.trial.identifier ?? '', width: 14 },
    { header: 'Asset', value: (r) => r.assetName },
    { header: 'Company', value: (r) => r.companyName },
    { header: 'Status', value: (r) => r.trial.status ?? '', width: 14 },
    {
      header: 'Phase',
      value: (r) => (r.trial.phase_type ? phaseShortLabel(r.trial.phase_type) : ''),
      width: 10,
    },
    {
      header: 'Phase start',
      value: (r) => dateCell(r.trial.phase_start_date),
      numFmt: EXPORT_DATE_FMT,
      width: 12,
    },
    {
      header: 'Phase end',
      value: (r) => dateCell(r.trial.phase_end_date),
      numFmt: EXPORT_DATE_FMT,
      width: 12,
    },
    { header: 'Recruitment status', value: (r) => r.trial.recruitment_status ?? '', width: 20 },
    { header: 'Study type', value: (r) => r.trial.study_type ?? '', width: 16 },
    { header: 'Markers', value: (r) => r.markerCount, width: 9 },
  ];
  for (const extra of extras) {
    columns.push({
      header: extra.label,
      value: (r) => extraValue(r.trial.id, extra.path),
      width: 26,
    });
  }
  return columns;
}
