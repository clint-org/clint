import { describe, expect, it } from 'vitest';
import { buildSheetWorkbook } from './xlsx-sheet.util';

describe('buildSheetWorkbook', () => {
  it('creates one worksheet per spec with headers and rows', async () => {
    const wb = buildSheetWorkbook(
      [
        {
          name: 'Catalysts',
          columns: [
            { header: 'Company', key: 'company', width: 20 },
            { header: 'Catalyst', key: 'title' },
          ],
          rows: [{ company: 'Pfizer', title: 'PDUFA' }],
        },
      ],
      { appDisplayName: 'Clint', primaryColorHex: '0d9488' }
    );

    const sheet = wb.getWorksheet('Catalysts')!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Company');
    expect(sheet.getRow(2).getCell(1).value).toBe('Pfizer');
    expect(sheet.getRow(2).getCell(2).value).toBe('PDUFA');
    expect((sheet.getRow(1).getCell(1).fill as { fgColor: { argb: string } }).fgColor.argb).toBe('FF0D9488');
    expect(sheet.views[0].ySplit).toBe(1);
  });

  it('writes Date cells with a yyyy-mm-dd number format', async () => {
    const wb = buildSheetWorkbook(
      [
        {
          name: 'Dates',
          columns: [{ header: 'When', key: 'when', numFmt: 'yyyy-mm-dd' }],
          rows: [{ when: new Date(Date.UTC(2026, 5, 11)) }],
        },
      ],
      { appDisplayName: 'Clint', primaryColorHex: '0d9488' }
    );
    const cell = wb.getWorksheet('Dates')!.getRow(2).getCell(1);
    expect(cell.value).toBeInstanceOf(Date);
    expect(cell.numFmt).toBe('yyyy-mm-dd');
  });
});
