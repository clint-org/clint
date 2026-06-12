import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '../grids/filter-types';
import { buildGridSheet } from './grid-sheet.util';

interface Row {
  name: string;
  nested: { id: string };
  count: number;
}

const columns: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name' },
  { field: 'nested.id', header: 'Identifier' },
  { field: 'count', header: 'Trials' },
];

describe('buildGridSheet', () => {
  it('maps dotted-path fields to a SheetSpec preserving header + order', () => {
    const spec = buildGridSheet('Companies', columns, [
      { name: 'Pfizer', nested: { id: 'c1' }, count: 3 },
    ]);
    expect(spec.name).toBe('Companies');
    expect(spec.columns.map((c) => c.header)).toEqual(['Name', 'Identifier', 'Trials']);
    expect(spec.rows[0]).toEqual({ c0: 'Pfizer', c1: 'c1', c2: 3 });
  });

  it('prefers a column getValue over the dotted path', () => {
    const withGetter: ColumnDef<Row>[] = [
      { field: 'name', header: 'Name', getValue: (r) => r.name.toUpperCase() },
    ];
    const spec = buildGridSheet('X', withGetter, [{ name: 'pfizer', nested: { id: 'c1' }, count: 0 }]);
    expect(spec.rows[0]).toEqual({ c0: 'PFIZER' });
  });
});
