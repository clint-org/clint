export interface ColumnVisibility {
  showMoa: boolean;
  showRoa: boolean;
  showNotes: boolean;
}

export type ColumnKey = 'company' | 'asset' | 'moa' | 'roa' | 'trial' | 'notes';

export interface ColumnDef {
  key: ColumnKey;
  x: number;
  width: number;
}

export interface ColumnLayout {
  columns: ColumnDef[];
  labelColW: number;
}

const COLUMN_WIDTHS: Record<ColumnKey, number> = {
  company: 1.0,
  asset: 0.85,
  moa: 0.8,
  roa: 0.45,
  trial: 1.05,
  notes: 0.22,
};

export function computeLeftColumns(v: ColumnVisibility): ColumnLayout {
  const keys: ColumnKey[] = ['company', 'asset'];
  if (v.showMoa) keys.push('moa');
  if (v.showRoa) keys.push('roa');
  keys.push('trial');
  if (v.showNotes) keys.push('notes');

  const columns: ColumnDef[] = [];
  let x = 0;
  for (const key of keys) {
    const width = COLUMN_WIDTHS[key];
    columns.push({ key, x, width });
    x += width;
  }
  return { columns, labelColW: x };
}
