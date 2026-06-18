import { describe, expect, it } from 'vitest';

import type { Company } from '../models/company.model';
import { buildXlsxWorkbook } from './xlsx-export.util';

const fixtureCompanies = [
  {
    id: 'c1',
    name: 'Acme Pharma',
    space_id: 's1',
    assets: [
      {
        id: 'a1',
        name: 'ACM-101',
        mechanisms_of_action: [{ name: 'GLP-1 agonist' }],
        routes_of_administration: [{ name: 'Subcutaneous', abbreviation: 'SC' }],
        trials: [
          {
            id: 't1',
            name: 'Acme Trial One',
            acronym: 'ACME-1',
            identifier: 'NCT00000001',
            notes: 'Pivotal readout expected H2.',
            trial_notes: [],
            phase_type: 'P3',
            phase_start_date: '2020-01-01',
            phase_end_date: '2022-06-30',
            markers: [
              {
                id: 'm1',
                event_date: '2021-06-15',
                end_date: null,
                projection: 'actual',
                is_projected: false,
                no_longer_expected: true,
                title: 'Topline readout',
                description: null,
                marker_types: {
                  name: 'Data readout',
                  color: '#16a34a',
                  shape: 'circle',
                  fill_style: 'filled',
                  inner_mark: 'none',
                  marker_categories: { name: 'Clinical', display_order: 1 },
                },
              },
            ],
          },
        ],
      },
    ],
  },
] as unknown as Company[];

const meta = {
  appDisplayName: 'Test App',
  primaryColorHex: '0d9488',
};

describe('buildXlsxWorkbook', () => {
  it('creates Trials and Markers sheets', () => {
    const wb = buildXlsxWorkbook(fixtureCompanies, meta);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Trials', 'Markers']);
  });

  it('writes trial rows with real Date cells for phase dates', () => {
    const wb = buildXlsxWorkbook(fixtureCompanies, meta);
    const sheet = wb.getWorksheet('Trials')!;
    expect(sheet.getCell('A1').value).toBe('Company');
    expect(sheet.getCell('A2').value).toBe('Acme Pharma');
    expect(sheet.getCell('E2').value).toBe('ACME-1');
    expect(sheet.getCell('G2').value).toBe('PH 3');
    const start = sheet.getCell('H2').value;
    expect(start).toBeInstanceOf(Date);
    expect((start as Date).getUTCFullYear()).toBe(2020);
    expect(sheet.getCell('J2').value).toBe('Pivotal readout expected H2.');
  });

  it('writes marker rows with honest date labels and a readable NLE status', () => {
    const wb = buildXlsxWorkbook(fixtureCompanies, meta);
    const sheet = wb.getWorksheet('Markers')!;
    // D=Marker, E=Category, F=Date, G=End Date, H=Status, I=Detail
    expect(sheet.getCell('D2').value).toBe('Data readout');
    expect(sheet.getCell('E2').value).toBe('Clinical');
    // Date/End Date are honest text labels (fuzzy markers have no real day).
    expect(sheet.getCell('F2').value).toBe('Jun ‘21');
    expect(sheet.getCell('G2').value).toBe('');
    expect(sheet.getCell('H2').value).toBe('No longer expected');
    expect(sheet.getCell('I2').value).toBe('Topline readout');
  });

  it('freezes the header row and sets the autofilter on both sheets', () => {
    const wb = buildXlsxWorkbook(fixtureCompanies, meta);
    for (const name of ['Trials', 'Markers'] as const) {
      const sheet = wb.getWorksheet(name)!;
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(sheet.autoFilter).toBeTruthy();
    }
  });

  it('applies the brand fill color per-cell on header row A1 (not row-level)', () => {
    const wb = buildXlsxWorkbook(fixtureCompanies, meta);
    const sheet = wb.getWorksheet('Markers')!;
    const cellA1 = sheet.getCell('A1');
    expect(cellA1.fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0D9488' },
    });
    expect(cellA1.font).toMatchObject({ bold: true, color: { argb: 'FFFFFFFF' } });
    // Row-level fill must not be relied on: the row object itself should have no fill set
    expect(sheet.getRow(1).fill).toBeUndefined();
  });

  it('writes the full untruncated detail text in the Detail column', () => {
    const longTitle = 'A'.repeat(100);
    const companiesWithLongTitle = [
      {
        ...fixtureCompanies[0],
        assets: [
          {
            ...fixtureCompanies[0].assets![0],
            trials: [
              {
                ...fixtureCompanies[0].assets![0].trials![0],
                markers: [
                  {
                    ...fixtureCompanies[0].assets![0].trials![0].markers![0],
                    title: longTitle,
                  },
                ],
              },
            ],
          },
        ],
      },
    ] as unknown as Company[];
    const wb = buildXlsxWorkbook(companiesWithLongTitle, meta);
    const sheet = wb.getWorksheet('Markers')!;
    // I=Detail column should carry the full 100-char string (not truncated to 80)
    expect(sheet.getCell('I2').value).toBe(longTitle);
    expect((sheet.getCell('I2').value as string).length).toBe(100);
  });
});
