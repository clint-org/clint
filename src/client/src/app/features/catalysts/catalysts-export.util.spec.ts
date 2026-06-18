import { describe, expect, it } from 'vitest';
import type { FlatCatalyst } from '../../core/models/catalyst.model';
import { CATALYST_EXPORT_COLUMNS, catalystStatusLabel } from './catalysts-export.util';
import { buildExportSheet } from '../../shared/export/grid-sheet.util';

function fixture(overrides: Partial<FlatCatalyst> = {}): FlatCatalyst {
  return {
    marker_id: 'm1',
    title: 'DELIVER topline readout',
    event_date: '2026-09-15',
    date_precision: 'exact',
    end_date: null,
    end_date_precision: 'exact',
    is_ongoing: false,
    category_name: 'Data',
    category_id: 'cat1',
    marker_type_name: 'Data Readout',
    marker_type_color: '#16a34a',
    marker_type_shape: 'circle',
    marker_type_inner_mark: null,
    is_projected: true,
    no_longer_expected: false,
    company_name: 'AstraZeneca',
    company_id: 'co1',
    asset_name: 'Farxiga',
    asset_id: 'a1',
    trial_name: 'DELIVER Trial',
    trial_acronym: 'DELIVER',
    trial_id: 't1',
    trial_phase: 'P3',
    description: 'Topline HFpEF efficacy data.',
    source_url: 'https://example.com/deliver',
    time_bucket: 'Next 90 days',
    time_bucket_range: 'Jul-Sep 2026',
    ...overrides,
  } as FlatCatalyst;
}

describe('CATALYST_EXPORT_COLUMNS', () => {
  it('carries the visible columns plus drawer fields, with an honest date label', () => {
    const spec = buildExportSheet('Catalysts', CATALYST_EXPORT_COLUMNS, [fixture()]);
    const headers = spec.columns.map((c) => c.header);
    expect(headers).toEqual([
      'Date',
      'Timeframe',
      'Category',
      'Catalyst',
      'Company',
      'Asset',
      'Trial',
      'Phase',
      'Status',
      'Marker type',
      'Description',
      'Source URL',
    ]);
    const row = spec.rows[0];
    expect(row['c0']).toBe('Sep ‘26'); // exact date -> short label
    expect(row['c3']).toBe('DELIVER topline readout');
    expect(row['c6']).toBe('DELIVER');
    expect(row['c7']).toBe('P3');
    expect(row['c8']).toBe('Projected');
    expect(row['c10']).toBe('Topline HFpEF efficacy data.');
  });

  it('exports the period label for a fuzzy date and the extent for a range / onwards', () => {
    const fuzzy = buildExportSheet('Catalysts', CATALYST_EXPORT_COLUMNS, [
      fixture({ event_date: '2026-11-15', date_precision: 'quarter' }),
    ]);
    expect(fuzzy.rows[0]['c0']).toBe("Q4 '26");

    const range = buildExportSheet('Catalysts', CATALYST_EXPORT_COLUMNS, [
      fixture({
        event_date: '2026-11-15',
        date_precision: 'quarter',
        end_date: '2027-02-15',
        end_date_precision: 'quarter',
      }),
    ]);
    expect(range.rows[0]['c0']).toBe("Q4 '26 – Q1 '27");

    const onwards = buildExportSheet('Catalysts', CATALYST_EXPORT_COLUMNS, [
      fixture({ event_date: '2024-08-15', date_precision: 'quarter', is_ongoing: true }),
    ]);
    expect(onwards.rows[0]['c0']).toBe("Q3 '24 onwards");
  });

  it('falls back to the trial name when there is no acronym', () => {
    const spec = buildExportSheet('Catalysts', CATALYST_EXPORT_COLUMNS, [
      fixture({ trial_acronym: null }),
    ]);
    expect(spec.rows[0]['c6']).toBe('DELIVER Trial');
  });
});

describe('catalystStatusLabel', () => {
  it('mirrors the status pill states', () => {
    expect(catalystStatusLabel(fixture({ is_projected: false }))).toBe('Confirmed');
    expect(catalystStatusLabel(fixture())).toBe('Projected');
    expect(catalystStatusLabel(fixture({ no_longer_expected: true }))).toBe('No longer expected');
  });
});
