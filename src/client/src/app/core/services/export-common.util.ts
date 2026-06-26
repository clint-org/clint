import type { MarkerType } from '../models/marker.model';
import type { Company } from '../models/company.model';
import type { Trial } from '../models/trial.model';
import { phaseShortLabel } from '../models/phase-colors';
import {
  formatMarkerExtent,
  markerEndpointLabel,
  type DatePrecision,
} from '../models/marker-date-precision';
import type { ZoomLevel } from '../models/dashboard.model';

export interface ColumnVisibility {
  showMoa: boolean;
  showRoa: boolean;
  showIndication: boolean;
  showNotes: boolean;
}

export type ColumnKey = 'company' | 'asset' | 'moa' | 'roa' | 'indication' | 'trial' | 'notes';

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
  showIndicationColumn: boolean;
  showNotesColumn: boolean;
  /** Workspace tenant for the export footer's "Prepared for" segment. */
  tenant?: { name: string; logoUrl: string | null } | null;
  /** Download filename; defaults to the generic dashboard name when omitted. */
  filename?: string;
}

export interface FlatRow {
  companyName: string;
  companyId: string;
  assetName: string;
  trialName: string;
  nctId: string | null;
  moa: string;
  roa: string;
  indications: string;
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
        // Indication is per-trial (a trial can span several of its asset's
        // indications), unlike MOA/ROA which are asset-level.
        const indications = (trial._indications ?? []).map((i) => i.indication_name).join(', ');
        rows.push({
          companyName: company.name,
          companyId: company.id,
          assetName: asset.name,
          trialName: trial.acronym ?? trial.name,
          nctId: trial.identifier ?? null,
          moa,
          roa,
          indications,
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
  indication: string;
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
    indication: r.indications,
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
  indication: 0.9,
  trial: 1.05,
  notes: 0.35,
};

export function computeLeftColumns(v: ColumnVisibility): ColumnLayout {
  const keys: ColumnKey[] = ['company', 'asset'];
  if (v.showMoa) keys.push('moa');
  if (v.showRoa) keys.push('roa');
  if (v.showIndication) keys.push('indication');
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
  /** Category name for the marker type (e.g. "Clinical Trial", "Regulatory"). */
  category: string;
  /** Full human extent: fuzzy point, exact day, range, or "... onwards" (PPTX). */
  date: string;
  /** Raw ISO event date (yyyy-mm-dd), for renderers that need real dates. */
  eventDate: string;
  /** Raw ISO end date or null. */
  endDate: string | null;
  /** Honest start-endpoint label (period label when fuzzy), for spreadsheet cells. */
  startLabel: string;
  /** Honest end-endpoint label: period/exact, "onwards", or '' for a point. */
  endLabel: string;
  status: MarkerStatus;
  detail: string;
  /** Untruncated detail text for data exports (Excel); `detail` stays truncated for the PPTX table. */
  detailFull: string;
}

const NOTE_MAX = 80;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDateShort(dateStr: string): string {
  const [year, month] = dateStr.split('-').map(Number);
  return `${MONTHS[month - 1]} ‘${String(year).slice(2)}`;
}

export function formatMarkerDate(
  eventDate: string,
  endDate: string | null,
  datePrecision: DatePrecision = 'exact',
  endDatePrecision: DatePrecision = 'exact',
  isOngoing = false
): string {
  return formatMarkerExtent(
    eventDate,
    datePrecision,
    endDate,
    endDatePrecision,
    isOngoing,
    formatDateShort
  );
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
          const rawDetail = m.title ?? m.description ?? '';
          rows.push({
            company: company.name,
            asset: asset.name,
            trial: trial.acronym ?? trial.name,
            marker: m.marker_types!.name,
            category: m.marker_types!.marker_categories?.name ?? '',
            date: formatMarkerDate(
              m.event_date,
              m.end_date,
              m.date_precision,
              m.end_date_precision,
              m.is_ongoing
            ),
            eventDate: m.event_date,
            endDate: m.end_date ?? null,
            startLabel: markerEndpointLabel(m.event_date, m.date_precision, formatDateShort),
            endLabel: m.is_ongoing
              ? 'onwards'
              : m.end_date
                ? markerEndpointLabel(m.end_date, m.end_date_precision, formatDateShort)
                : '',
            status,
            detail: truncate(rawDetail, NOTE_MAX),
            detailFull: rawDetail,
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
