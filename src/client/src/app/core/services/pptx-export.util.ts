import type { MarkerType } from '../models/marker.model';

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

export interface PresentMarkerType {
  id: string;
  name: string;
  color: string;
  shape: string;
  fill_style: string;
  display_order: number;
}

export interface LegendItem {
  name: string;
  color: string;
  shape: string;
  fill_style: string;
}

export interface LegendLayout {
  items: LegendItem[];
  /** Index of the first item AFTER the Regulatory group, or -1 if none / no break. */
  breakIndex: number;
}

const REGULATORY_CATEGORY = 'regulatory';

export function orderLegendItems(
  present: PresentMarkerType[],
  allTypes: MarkerType[]
): LegendLayout {
  const toItem = (p: PresentMarkerType): LegendItem => ({
    name: p.name,
    color: p.color,
    shape: p.shape,
    fill_style: p.fill_style,
  });

  // Fallback: no authoritative ordering available -> flat by type display_order.
  if (!allTypes.length) {
    const items = [...present].sort((a, b) => a.display_order - b.display_order).map(toItem);
    return { items, breakIndex: -1 };
  }

  const meta = new Map<string, { catOrder: number; typeOrder: number; catName: string }>();
  for (const t of allTypes) {
    meta.set(t.id, {
      catOrder: t.marker_categories?.display_order ?? 999,
      typeOrder: t.display_order,
      catName: (t.marker_categories?.name ?? '').toLowerCase(),
    });
  }

  const sorted = [...present].sort((a, b) => {
    const ma = meta.get(a.id);
    const mb = meta.get(b.id);
    const ca = ma?.catOrder ?? 999;
    const cb = mb?.catOrder ?? 999;
    if (ca !== cb) return ca - cb;
    return (ma?.typeOrder ?? a.display_order) - (mb?.typeOrder ?? b.display_order);
  });

  let lastRegIndex = -1;
  sorted.forEach((p, i) => {
    if (meta.get(p.id)?.catName === REGULATORY_CATEGORY) lastRegIndex = i;
  });
  const breakIndex = lastRegIndex >= 0 && lastRegIndex + 1 < sorted.length ? lastRegIndex + 1 : -1;

  return { items: sorted.map(toItem), breakIndex };
}
