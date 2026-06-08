import type { MarkerType } from '../models/marker.model';
import type { Company } from '../models/company.model';

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

export type MarkerStatus = 'Actual' | 'Projected' | 'NLE';

export interface MarkerRow {
  company: string;
  asset: string;
  trial: string;
  marker: string;
  date: string;
  status: MarkerStatus;
  notes: string;
}

const NOTE_MAX = 80;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDateShort(dateStr: string): string {
  const [year, month] = dateStr.split('-').map(Number);
  return `${MONTHS[month - 1]} ‘${String(year).slice(2)}`;
}

export function formatMarkerDate(eventDate: string, endDate: string | null): string {
  if (endDate) return `${formatDateShort(eventDate)}-${formatDateShort(endDate)}`;
  return formatDateShort(eventDate);
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
}

export function buildMarkerTableRows(companies: Company[]): MarkerRow[] {
  const rows: MarkerRow[] = [];
  for (const company of companies) {
    for (const asset of company.assets ?? []) {
      for (const trial of asset.trials ?? []) {
        const markers = [...(trial.markers ?? [])]
          .filter((m) => m.event_date && m.marker_types)
          .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
        for (const m of markers) {
          const status: MarkerStatus = m.no_longer_expected
            ? 'NLE'
            : m.is_projected || m.projection !== 'actual'
              ? 'Projected'
              : 'Actual';
          rows.push({
            company: company.name,
            asset: asset.name,
            trial: trial.acronym ?? trial.name,
            marker: m.marker_types!.name,
            date: formatMarkerDate(m.event_date, m.end_date),
            status,
            notes: truncate(m.title ?? m.description ?? '', NOTE_MAX),
          });
        }
      }
    }
  }
  return rows;
}

export function paginate<T>(rows: T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += perPage) {
    pages.push(rows.slice(i, i + perPage));
  }
  return pages;
}
