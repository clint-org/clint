import type { Company } from '../models/company.model';
import { resolveMarkerVisual, type MarkerVisual } from '../models/marker-visual';
import { PHASE_COLORS, PHASE_FALLBACK_COLOR, phaseShortLabel } from '../models/phase-colors';
import { type CanvasGlyphSurface, drawMarkerGlyphCanvas } from './canvas-marker-glyph';
import {
  type ColumnLayout,
  computeLeftColumns,
  type ExportOptions,
  type FlatRow,
  flattenTrials,
  formatDateShort,
  type LegendGroup,
} from './export-common.util';
import type { TimelineColumn } from './timeline.service';

/** Logical frame size. The service renders at 2x for a 3840x2160 PNG. */
export const PNG_W = 1920;
export const PNG_H = 1080;

// The PPTX data slide is the layout reference: 13.33in wide -> 144 px/in,
// and point font sizes -> 2 px/pt. Constants below mirror pptx-export.service.
const IN = 144;
const PT = 2;
const HEADER_H = 0.28 * IN;
const DATA_Y = HEADER_H;
const LEGEND_H = 0.85 * IN;
const FOOTER_H = 0.26 * IN;
const HEADER_BAND = '#1e293b';
const SANS = 'Arial, sans-serif';
const MONO = 'Consolas, monospace';

export type PngSurface = CanvasGlyphSurface &
  Pick<
    CanvasRenderingContext2D,
    'fillRect' | 'fillText' | 'measureText' | 'drawImage' | 'arcTo' | 'font' | 'textAlign' | 'textBaseline'
  >;

export interface PngImages {
  tenantLogo?: CanvasImageSource | null;
  agencyLogo?: CanvasImageSource | null;
  companyLogos?: Map<string, CanvasImageSource>;
}

export interface PngRenderContext {
  companies: Company[];
  options: ExportOptions;
  appDisplayName: string;
  primaryColor: string;
  agencyName: string | null;
  dateStr: string;
  legendGroups: LegendGroup[];
  columns: TimelineColumn[];
  totalPx: number;
  /** Maps an ISO date to [0..totalPx] (TimelineService.dateToX bound to the window). */
  dateToX: (date: string) => number;
  images?: PngImages;
}

/** Render the full timeline image. Pure: all data and DI products come in via rc. */
export function renderTimelinePng(ctx: PngSurface, rc: PngRenderContext): void {
  const rows = flattenTrials(rc.companies);
  if (rows.length === 0) return;

  const inches = computeLeftColumns({
    showMoa: rc.options.showMoaColumn,
    showRoa: rc.options.showRoaColumn,
    showNotes: rc.options.showNotesColumn,
  });
  const layout: ColumnLayout = {
    labelColW: inches.labelColW * IN,
    columns: inches.columns.map((c) => ({ ...c, x: c.x * IN, width: c.width * IN })),
  };
  const rowH = Math.min(0.28 * IN, (PNG_H - DATA_Y - LEGEND_H) / rows.length);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PNG_W, PNG_H);

  drawRowBackgrounds(ctx, rows.length, rowH);
  drawHeader(ctx, layout, rc);
  drawGridLines(ctx, layout, rc, rows.length, rowH);
  drawRows(ctx, rows, layout, rc, rowH);
  drawLegend(ctx, rc);
  drawFooter(ctx, rc);
}

function timelineX(layout: ColumnLayout, rc: PngRenderContext, px: number): number {
  return layout.labelColW + (px / rc.totalPx) * (PNG_W - layout.labelColW);
}

function drawRowBackgrounds(ctx: PngSurface, count: number, rowH: number): void {
  ctx.fillStyle = '#f8fafc';
  for (let i = 1; i < count; i += 2) {
    ctx.fillRect(0, DATA_Y + i * rowH, PNG_W, rowH);
  }
}

const COLUMN_LABELS: Record<string, string> = {
  company: 'Company',
  asset: 'Asset',
  moa: 'MOA',
  roa: 'ROA',
  trial: 'Trial',
  notes: 'Notes',
};

function drawHeader(ctx: PngSurface, layout: ColumnLayout, rc: PngRenderContext): void {
  ctx.fillStyle = HEADER_BAND;
  ctx.fillRect(0, 0, PNG_W, HEADER_H);

  ctx.font = `bold ${6 * PT}px ${SANS}`;
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'left';
  for (const col of layout.columns) {
    ctx.fillText(COLUMN_LABELS[col.key], col.x + 0.05 * IN, HEADER_H / 2);
  }

  ctx.font = `${6 * PT}px ${MONO}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  for (const col of rc.columns) {
    const x = timelineX(layout, rc, col.startX);
    const w = (col.width / rc.totalPx) * (PNG_W - layout.labelColW);
    ctx.fillText(col.label, x + w / 2, HEADER_H / 2);
  }
  ctx.textAlign = 'left';

  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(0, HEADER_H - 1, PNG_W, 1);
}

function drawGridLines(
  ctx: PngSurface,
  layout: ColumnLayout,
  rc: PngRenderContext,
  rowCount: number,
  rowH: number
): void {
  ctx.fillStyle = '#e2e8f0';
  const gridH = rowCount * rowH;
  for (const col of rc.columns) {
    const x = timelineX(layout, rc, col.startX);
    ctx.fillRect(x, DATA_Y, 1, gridH);
  }
}

function fitText(ctx: PngSurface, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

function colOf(layout: ColumnLayout, key: string): { x: number; width: number } | undefined {
  return layout.columns.find((c) => c.key === key);
}

function drawRows(
  ctx: PngSurface,
  rows: FlatRow[],
  layout: ColumnLayout,
  rc: PngRenderContext,
  rowH: number
): void {
  const fontPt = Math.max(5, Math.min(7, (rowH / IN) * 28));
  const pad = 0.05 * IN;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const y = DATA_Y + i * rowH;
    const midY = y + rowH / 2;

    const companyCol = colOf(layout, 'company')!;
    if (row.isFirstInCompany) {
      const logo = rc.images?.companyLogos?.get(row.companyId);
      const logoS = 0.16 * IN;
      let textX = companyCol.x + pad;
      if (logo) {
        ctx.drawImage(logo, companyCol.x + 0.04 * IN, y + (rowH - logoS) / 2, logoS, logoS);
        textX = companyCol.x + 0.04 * IN + logoS + 0.07 * IN;
      }
      ctx.font = `bold ${Math.max(4, fontPt - 1) * PT}px ${SANS}`;
      ctx.fillStyle = rc.primaryColor;
      ctx.fillText(
        fitText(ctx, row.companyName.toUpperCase(), companyCol.x + companyCol.width - textX),
        textX,
        midY
      );
    }

    const assetCol = colOf(layout, 'asset')!;
    if (row.isFirstInAsset) {
      ctx.font = `bold ${fontPt * PT}px ${SANS}`;
      ctx.fillStyle = '#475569';
      ctx.fillText(fitText(ctx, row.assetName, assetCol.width - pad), assetCol.x + pad, midY);
    }

    const moaCol = colOf(layout, 'moa');
    if (moaCol && row.isFirstInAsset && row.moa) {
      ctx.font = `${Math.max(4, fontPt - 1) * PT}px ${SANS}`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(fitText(ctx, row.moa, moaCol.width - pad), moaCol.x + pad, midY);
    }

    const roaCol = colOf(layout, 'roa');
    if (roaCol && row.isFirstInAsset && row.roa) {
      ctx.font = `${Math.max(4, fontPt - 1) * PT}px ${SANS}`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(fitText(ctx, row.roa, roaCol.width - pad), roaCol.x + pad, midY);
    }

    const trialCol = colOf(layout, 'trial')!;
    ctx.font = `bold ${fontPt * PT}px ${SANS}`;
    ctx.fillStyle = '#334155';
    const trialText = fitText(ctx, row.trialName, trialCol.width - pad);
    ctx.fillText(trialText, trialCol.x + pad, midY);
    if (row.nctId) {
      const used = ctx.measureText(trialText).width;
      ctx.font = `${Math.max(4, fontPt - 2) * PT}px ${SANS}`;
      ctx.fillStyle = '#94a3b8';
      const nctX = trialCol.x + pad + used + 6;
      const room = trialCol.x + trialCol.width - nctX;
      if (room > 20) ctx.fillText(fitText(ctx, row.nctId, room), nctX, midY);
    }

    const notesCol = colOf(layout, 'notes');
    if (notesCol && row.hasNotes) {
      ctx.beginPath();
      ctx.fillStyle = '#94a3b8';
      ctx.arc(notesCol.x + notesCol.width / 2, midY, 0.03 * IN, 0, Math.PI * 2);
      ctx.fill();
    }

    drawPhaseBar(ctx, row, layout, rc, y, rowH, fontPt);
    drawMarkers(ctx, row, layout, rc, y, rowH, fontPt);
  }
}

function drawPhaseBar(
  ctx: PngSurface,
  row: FlatRow,
  layout: ColumnLayout,
  rc: PngRenderContext,
  rowY: number,
  rowH: number,
  fontPt: number
): void {
  const trial = row.trial;
  if (!trial.phase_type || !trial.phase_start_date) return;

  const sx = rc.dateToX(trial.phase_start_date);
  const ex = rc.dateToX(trial.phase_end_date ?? trial.phase_start_date);
  const barX = timelineX(layout, rc, sx);
  const barW = Math.max(0.05 * IN, ((ex - sx) / rc.totalPx) * (PNG_W - layout.labelColW));
  const barH = rowH * 0.45;
  const barY = rowY + (rowH - barH) / 2;
  const color = PHASE_COLORS[trial.phase_type] ?? PHASE_FALLBACK_COLOR;

  roundRectPath(ctx, barX, barY, barW, barH, 0.02 * IN);
  ctx.save();
  ctx.globalAlpha = 0.12; // same wash as the web and the deck
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (barW > 0.4 * IN) {
    ctx.font = `bold ${Math.max(4, fontPt - 2) * PT}px ${SANS}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(phaseShortLabel(trial.phase_type), barX + barW / 2, barY + barH / 2);
    ctx.textAlign = 'left';
  }
}

function drawMarkers(
  ctx: PngSurface,
  row: FlatRow,
  layout: ColumnLayout,
  rc: PngRenderContext,
  rowY: number,
  rowH: number,
  fontPt: number
): void {
  const size = Math.min(0.12, (rowH / IN) * 0.35) * IN;
  const sorted = [...(row.trial.markers ?? [])]
    .filter((m) => m.event_date && m.marker_types)
    .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

  let lastLabelX = -Infinity;
  for (const marker of sorted) {
    const centerX = timelineX(layout, rc, rc.dateToX(marker.event_date));
    const x = centerX - size / 2;
    const y = rowY + rowH * 0.1;
    const visual = resolveMarkerVisual(marker);
    drawMarkerGlyphCanvas(ctx, visual, x, y, size);

    if (centerX - lastLabelX > 0.4 * IN) {
      ctx.font = `${Math.max(3, fontPt - 3) * PT}px ${MONO}`;
      ctx.fillStyle = visual.color;
      ctx.textAlign = 'center';
      ctx.fillText(formatDateShort(marker.event_date), centerX, y + size + 0.06 * IN);
      ctx.textAlign = 'left';
      lastLabelX = centerX;
    }
  }
}

function drawLegend(ctx: PngSurface, rc: PngRenderContext): void {
  const legendY = PNG_H - LEGEND_H;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, legendY, PNG_W, LEGEND_H);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, legendY, PNG_W, 1);

  const xStart = 0.3 * IN;
  const xEnd = PNG_W - 0.3 * IN;
  const rowH = 0.16 * IN;
  const s = 0.09 * IN;
  const yTop = legendY + 0.07 * IN;

  let x = xStart;
  let row = 0;
  const place = (w: number): { px: number; py: number } => {
    if (x + w > xEnd) {
      x = xStart;
      row++;
    }
    const px = x;
    x += w;
    return { px, py: yTop + row * rowH };
  };
  const label = (text: string, px: number, py: number, bold: boolean): void => {
    ctx.font = `${bold ? 'bold ' : ''}${5 * PT}px ${SANS}`;
    ctx.fillStyle = bold ? '#475569' : '#64748b';
    ctx.fillText(text, px, py + s / 2);
  };
  const measure = (text: string, bold: boolean): number => {
    ctx.font = `${bold ? 'bold ' : ''}${5 * PT}px ${SANS}`;
    return ctx.measureText(text).width;
  };

  const statuses: { name: string; kind: 'actual' | 'projected' | 'nle' }[] = [
    { name: 'Actual', kind: 'actual' },
    { name: 'Projected', kind: 'projected' },
    { name: 'NLE', kind: 'nle' },
  ];
  for (const st of statuses) {
    const w = s + 6 + measure(st.name, false) + 22;
    const { px, py } = place(w);
    const cy = py + s / 2;
    ctx.beginPath();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    if (st.kind === 'actual') {
      ctx.fillStyle = '#64748b';
      ctx.arc(px + s / 2, cy, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (st.kind === 'projected') {
      ctx.fillStyle = '#ffffff';
      ctx.arc(px + s / 2, cy, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#64748b';
      ctx.arc(px + s / 2, cy, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.strokeStyle = '#64748b';
      ctx.moveTo(px - 1, cy);
      ctx.lineTo(px + s + 1, cy);
      ctx.stroke();
    }
    label(st.name, px + s + 6, py, false);
  }

  for (const g of rc.legendGroups) {
    const head = g.label.toUpperCase();
    const h = place(measure(head, true) + 20);
    label(head, h.px, h.py, true);
    for (const it of g.items) {
      const w = s + 6 + measure(it.name, false) + 22;
      const { px, py } = place(w);
      drawMarkerGlyphCanvas(
        ctx,
        {
          shape: it.shape as MarkerVisual['shape'],
          color: it.color,
          fillStyle: it.fill_style as MarkerVisual['fillStyle'],
          innerMark: it.inner_mark as MarkerVisual['innerMark'],
          isNle: false,
        },
        px,
        py,
        s
      );
      label(it.name, px + s + 6, py, false);
    }
  }
}

function drawFooter(ctx: PngSurface, rc: PngRenderContext): void {
  const footerY = PNG_H - FOOTER_H;
  const midY = footerY + FOOTER_H / 2;
  const glyph = 0.18 * IN;

  let textX = 0.1 * IN;
  if (rc.images?.tenantLogo) {
    ctx.drawImage(rc.images.tenantLogo, 0.1 * IN, midY - glyph / 2, glyph, glyph);
    textX = 0.1 * IN + glyph + 0.07 * IN;
  }
  ctx.font = `bold ${8 * PT}px ${SANS}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText(rc.appDisplayName, textX, midY);

  if (rc.agencyName) {
    let agencyX = textX + ctx.measureText(rc.appDisplayName).width + 0.3 * IN;
    if (rc.images?.agencyLogo) {
      ctx.drawImage(rc.images.agencyLogo, agencyX, midY - glyph / 2, glyph, glyph);
      agencyX += glyph + 0.07 * IN;
    }
    ctx.font = `italic ${8 * PT}px ${SANS}`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`Intelligence delivered by ${rc.agencyName}`, agencyX, midY);
  }

  ctx.font = `${8 * PT}px ${SANS}`;
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.fillText(rc.dateStr, PNG_W - 0.1 * IN, midY);
  ctx.textAlign = 'left';
}

function roundRectPath(
  ctx: PngSurface,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
