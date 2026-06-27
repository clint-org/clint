import { describe, expect, it } from 'vitest';
import type { Trial } from '../../../core/models/trial.model';
import { buildTrialExportColumns, type TrialExportRow } from './trials-export.util';
import { buildExportSheet } from '../../../shared/export/grid-sheet.util';

function fixture(overrides: Partial<Trial> = {}): TrialExportRow {
  return {
    trial: {
      id: 't1',
      space_id: 's1',
      created_by: 'u1',
      asset_id: 'a1',
      name: 'DELIVER Trial',
      acronym: 'DELIVER',
      identifier: 'NCT03548935',
      status: 'Active',
      notes: 'Pivotal HFpEF readout expected H2.',
      phase_type: 'P3',
      phase_start_date: '2022-01-01',
      phase_end_date: '2026-12-31',
      recruitment_status: 'RECRUITING',
      study_type: 'INTERVENTIONAL',
      display_order: 0,
      created_at: '',
      updated_at: '',
      updated_by: null,
      ...overrides,
    } as Trial,
    assetName: 'Farxiga',
    companyName: 'AstraZeneca',
    markerCount: 2,
  };
}

describe('buildTrialExportColumns', () => {
  it('carries the visible columns plus detail fields with date cells', () => {
    const spec = buildExportSheet(
      'Trials',
      buildTrialExportColumns([], () => ''),
      [fixture()]
    );
    expect(spec.columns.map((c) => c.header)).toEqual([
      'Trial',
      'Acronym',
      'NCT ID',
      'Asset',
      'Company',
      'Status',
      'Phase',
      'Phase start',
      'Phase end',
      'Recruitment status',
      'Study type',
      'Markers',
    ]);
    const row = spec.rows[0];
    expect(row['c1']).toBe('DELIVER');
    expect(row['c2']).toBe('NCT03548935');
    expect(row['c6']).toBe('PH 3');
    expect(row['c7']).toEqual(new Date(Date.UTC(2022, 0, 1)));
    expect(row['c8']).toEqual(new Date(Date.UTC(2026, 11, 31)));
    expect(row['c9']).toBe('RECRUITING');
    expect(row['c11']).toBe(2);
  });

  it('appends per-space CT.gov columns resolved through the snapshot lookup', () => {
    const columns = buildTrialExportColumns(
      [{ label: 'Brief title', path: 'protocolSection.identificationModule.briefTitle' }],
      (trialId, path) => `${trialId}:${path.split('.').at(-1)}`
    );
    const spec = buildExportSheet('Trials', columns, [fixture()]);
    expect(spec.columns.at(-1)!.header).toBe('Brief title');
    expect(spec.rows[0]['c12']).toBe('t1:briefTitle');
  });

  it('collapses absent optional fields to empty cells', () => {
    const spec = buildExportSheet(
      'Trials',
      buildTrialExportColumns([], () => ''),
      [
        fixture({
          acronym: null,
          identifier: null,
          status: null,
          phase_type: null,
          phase_start_date: null,
          phase_end_date: null,
          recruitment_status: null,
          study_type: null,
          notes: null,
        }),
      ]
    );
    const row = spec.rows[0];
    for (const key of ['c1', 'c2', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10']) {
      expect(row[key]).toBe('');
    }
  });
});
