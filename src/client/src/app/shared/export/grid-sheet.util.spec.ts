import { describe, expect, it } from 'vitest';
import {
  buildExportSheet,
  dateCell,
  timestampCell,
  EXPORT_DATE_FMT,
  type ExportColumn,
} from './grid-sheet.util';

interface Row {
  name: string;
  nested: { id: string };
  count: number;
  when: string | null;
}

const columns: ExportColumn<Row>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Identifier', value: (r) => r.nested.id },
  { header: 'Trials', value: (r) => r.count },
  { header: 'Date', value: (r) => dateCell(r.when), numFmt: EXPORT_DATE_FMT, width: 12 },
];

describe('buildExportSheet', () => {
  it('maps explicit columns to a SheetSpec preserving header order and formats', () => {
    const spec = buildExportSheet('Companies', columns, [
      { name: 'Pfizer', nested: { id: 'c1' }, count: 3, when: '2026-05-15' },
    ]);
    expect(spec.name).toBe('Companies');
    expect(spec.columns.map((c) => c.header)).toEqual(['Name', 'Identifier', 'Trials', 'Date']);
    expect(spec.columns[3].numFmt).toBe(EXPORT_DATE_FMT);
    expect(spec.columns[3].width).toBe(12);
    expect(spec.rows[0]['c0']).toBe('Pfizer');
    expect(spec.rows[0]['c2']).toBe(3);
    expect(spec.rows[0]['c3']).toEqual(new Date(Date.UTC(2026, 4, 15)));
  });

  it('collapses null and undefined values to empty cells', () => {
    const spec = buildExportSheet('X', columns, [
      { name: 'Merck', nested: { id: 'c2' }, count: 0, when: null },
    ]);
    expect(spec.rows[0]['c3']).toBe('');
  });
});

describe('dateCell', () => {
  it('parses yyyy-mm-dd to a UTC date', () => {
    expect(dateCell('2026-01-02')).toEqual(new Date(Date.UTC(2026, 0, 2)));
  });

  it('truncates full ISO timestamps to the calendar day', () => {
    expect(dateCell('2026-01-02T15:30:00Z')).toEqual(new Date(Date.UTC(2026, 0, 2)));
  });

  it('returns empty string for absent values', () => {
    expect(dateCell(null)).toBe('');
    expect(dateCell(undefined)).toBe('');
    expect(dateCell('')).toBe('');
  });
});

describe('timestampCell', () => {
  it('keeps time of day', () => {
    const d = timestampCell('2026-01-02T15:30:00.000Z');
    expect(d).toBeInstanceOf(Date);
    expect((d as Date).toISOString()).toBe('2026-01-02T15:30:00.000Z');
  });

  it('returns empty string for absent or invalid values', () => {
    expect(timestampCell(null)).toBe('');
    expect(timestampCell('not-a-date')).toBe('');
  });
});
