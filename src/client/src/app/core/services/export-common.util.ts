import type { MarkerType } from '../models/marker.model';
import type { Company } from '../models/company.model';
import type { Trial } from '../models/trial.model';
import { phaseShortLabel } from '../models/phase-colors';
import type { ZoomLevel } from '../models/dashboard.model';

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

export type ExportFormat = 'pptx' | 'png' | 'xlsx';

export interface ExportOptions {
  zoomLevel: ZoomLevel;
  startYear: number;
  endYear: number;
  showMoaColumn: boolean;
  showRoaColumn: boolean;
  showNotesColumn: boolean;
}

export interface FlatRow {
  companyName: string;
  companyId: string;
  assetName: string;
  trialName: string;
  nctId: string | null;
  moa: string;
  roa: string;
  hasNotes: boolean;
  trial: Trial;
  isFirstInCompany: boolean;
  isFirstInAsset: boolean;
}

export function flattenTrials(companies: Company[]): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const company of companies) {
    let isFirstInCompany = true;
    for (const asset of company.assets ?? []) {
      let isFirstInAsset = true;
      const moa = (asset.mechanisms_of_action ?? []).map((m) => m.name).join(', ');
      const roa = (asset.routes_of_administration ?? [])
        .map((r) => r.abbreviation ?? r.name)
        .join(', ');
      for (const trial of asset.trials ?? []) {
        rows.push({
          companyName: company.name,
          companyId: company.id,
          assetName: asset.name,
          trialName: trial.acronym ?? trial.name,
          nctId: trial.identifier ?? null,
          moa,
          roa,
          hasNotes: !!(trial.notes || (trial.trial_notes?.length ?? 0) > 0),
          trial,
          isFirstInCompany,
          isFirstInAsset,
        });
        isFirstInCompany = false;
        isFirstInAsset = false;
      }
    }
  }
  return rows;
}

export interface TrialExportRow {
  company: string;
  asset: string;
  moa: string;
  roa: string;
  trial: string;
  nctId: string;
  phase: string;
  phaseStart: string | null;
  phaseEnd: string | null;
  notes: string;
}

export function buildTrialExportRows(companies: Company[]): TrialExportRow[] {
  return flattenTrials(companies).map((r) => ({
    company: r.companyName,
    asset: r.assetName,
    moa: r.moa,
    roa: r.roa,
    trial: r.trialName,
    nctId: r.nctId ?? '',
    phase: r.trial.phase_type ? phaseShortLabel(r.trial.phase_type) : '',
    phaseStart: r.trial.phase_start_date ?? null,
    phaseEnd: r.trial.phase_end_date ?? null,
    notes: r.trial.notes ?? '',
  }));
}

const COLUMN_WIDTHS: Record<ColumnKey, number> = {
  company: 1.0,
  asset: 0.85,
  moa: 0.8,
  roa: 0.45,
  trial: 1.05,
  notes: 0.35,
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

export interface LegendEntry {
  name: string;
  color: string;
  shape: string;
  fill_style: string;
  inner_mark: string;
}

export interface LegendGroup {
  label: string;
  items: LegendEntry[];
}

/**
 * Group marker types by category for the legend, mirroring the on-screen legend
 * (`legend.component.ts` groupedMarkerTypes): only types with display_order > 0,
 * groups sorted by category display_order, items left in the input order (the
 * MarkerTypeService lists types ordered by display_order, so items within a
 * category are already display-order ascending).
 */
export function buildLegendGroups(allTypes: MarkerType[]): LegendGroup[] {
  const groups = new Map<string, { label: string; order: number; items: LegendEntry[] }>();
  for (const t of allTypes) {
    if (t.display_order <= 0) continue;
    const cat = t.marker_categories;
    const label = cat?.name ?? 'Other';
    const order = cat?.display_order ?? 999;
    let g = groups.get(label);
    if (!g) {
      g = { label, order, items: [] };
      groups.set(label, g);
    }
    g.items.push({
      name: t.name,
      color: t.color,
      shape: t.shape,
      fill_style: t.fill_style,
      inner_mark: t.inner_mark,
    });
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({ label: g.label, items: g.items }));
}

export type MarkerStatus = 'Actual' | 'Projected' | 'NLE';

export interface MarkerRow {
  company: string;
  asset: string;
  trial: string;
  marker: string;
  date: string;
  /** Raw ISO event date (yyyy-mm-dd), for renderers that need real dates (Excel). */
  eventDate: string;
  /** Raw ISO end date or null. */
  endDate: string | null;
  status: MarkerStatus;
  detail: string;
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
            eventDate: m.event_date,
            endDate: m.end_date ?? null,
            status,
            detail: truncate(m.title ?? m.description ?? '', NOTE_MAX),
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
