import { inject, Injectable } from '@angular/core';
import PptxGenJS from 'pptxgenjs';

import { Company } from '../models/company.model';
import { ZoomLevel } from '../models/dashboard.model';
import { Trial } from '../models/trial.model';
import { BrandContextService } from './brand-context.service';
import { loadImageElement } from './load-image.util';
import { MarkerTypeService } from './marker-type.service';
import {
  buildLegendGroups,
  buildMarkerTableRows,
  computeLeftColumns,
  type ColumnLayout,
  type ExportOptions,
  flattenTrials,
  type FlatRow,
  formatDateShort,
  type MarkerRow,
  paginate,
} from './export-common.util';
import { TimelineService } from './timeline.service';
import { resolveMarkerVisual, type MarkerVisual } from '../models/marker-visual';
import { drawMarkerGlyph } from './pptx-marker-glyph';
import type { FillStyle, InnerMark, MarkerShape } from '../models/marker.model';
import { PHASE_COLORS, PHASE_FALLBACK_COLOR, phaseShortLabel } from '../models/phase-colors';


const SLIDE_W = 13.33;
const SLIDE_H = 7.5;
const HEADER_Y = 0;
const HEADER_H = 0.28;
const HEADER_BAND = '1e293b';
const LEGEND_H = 0.85;
const DATA_Y = HEADER_Y + HEADER_H;
const FOOTER_H = 0.26;

const FALLBACK_PRIMARY = '0d9488';

interface FooterBrand {
  appDisplayName: string;
  dateStr: string;
  tenantLogo: string | null;
  agencyName: string | null;
  agencyLogo: string | null;
}

@Injectable({ providedIn: 'root' })
export class PptxExportService {
  private timeline = inject(TimelineService);
  private brand = inject(BrandContextService);
  private markerTypeService = inject(MarkerTypeService);

  async exportDashboard(companies: Company[], options: ExportOptions): Promise<void> {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'WIDE', width: SLIDE_W, height: SLIDE_H });
    pptx.layout = 'WIDE';

    // Capture brand vars once at the start of the export.
    const appDisplayName = this.brand.appDisplayName();
    const logoUrl = this.brand.logoUrl();
    const primaryColorHex = this.normalizeHex(this.brand.primaryColor()) || FALLBACK_PRIMARY;
    const agency = this.brand.agency();
    const agencyName = agency?.name ?? null;
    const [logoData, agencyLogo] = await Promise.all([
      this.loadLogoAsPng(logoUrl),
      this.loadLogoAsPng(agency?.logo_url ?? null),
    ]);
    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const footer: FooterBrand = { appDisplayName, dateStr, tenantLogo: logoData, agencyName, agencyLogo };

    const rows = flattenTrials(companies);
    if (rows.length === 0) return;

    const markerRows = buildMarkerTableRows(companies);
    const ROWS_PER_TABLE_PAGE = 20;
    const tablePages = paginate(markerRows, ROWS_PER_TABLE_PAGE);
    const totalPages = 2 + tablePages.length;

    // Slide 1: branded cover.
    const cover = pptx.addSlide();
    this.renderCover(cover, appDisplayName, primaryColorHex, logoData, agencyName, agencyLogo, dateStr);
    this.addFooter(cover, footer, 1, totalPages);

    // Slide 2: data slide.
    const slide = pptx.addSlide();
    const rowH = Math.min(0.28, (SLIDE_H - DATA_Y - LEGEND_H) / rows.length);
    const { startYear, endYear, zoomLevel } = options;

    const layout = computeLeftColumns({
      showMoa: options.showMoaColumn,
      showRoa: options.showRoaColumn,
      showNotes: options.showNotesColumn,
    });
    const logoByCompany = await this.loadCompanyLogos(companies);

    this.renderHeader(slide, layout, startYear, endYear, zoomLevel);
    this.renderGridLines(slide, layout, startYear, endYear, zoomLevel, rows.length, rowH);
    this.renderRows(slide, rows, layout, logoByCompany, rowH, startYear, endYear, primaryColorHex);
    await this.renderLegend(slide, companies);
    this.addFooter(slide, footer, 2, totalPages);

    for (let p = 0; p < tablePages.length; p++) {
      const tableSlide = pptx.addSlide();
      this.renderMarkerTable(tableSlide, tablePages[p], primaryColorHex);
      this.addFooter(tableSlide, footer, 3 + p, totalPages);
    }

    await pptx.writeFile({ fileName: 'clinical-trial-dashboard.pptx' });
  }

  private addFooter(
    slide: PptxGenJS.Slide,
    footer: FooterBrand,
    pageNum: number,
    totalPages: number
  ): void {
    const footerY = SLIDE_H - FOOTER_H;
    const glyph = 0.18;
    const glyphY = footerY + (FOOTER_H - glyph) / 2;

    // Left cluster: tenant logo + name.
    let tenantTextX = 0.1;
    if (footer.tenantLogo) {
      slide.addImage({
        data: footer.tenantLogo,
        x: 0.1,
        y: glyphY,
        w: glyph,
        h: glyph,
        sizing: { type: 'contain', w: glyph, h: glyph },
      });
      tenantTextX = 0.1 + glyph + 0.07;
    }
    slide.addText(footer.appDisplayName, {
      x: tenantTextX,
      y: footerY,
      w: 3,
      h: FOOTER_H,
      fontSize: 8,
      fontFace: 'Arial',
      bold: true,
      color: '64748b',
      valign: 'middle',
      wrap: false,
      margin: 0,
    });

    // Agency attribution, left-aligned right after the tenant cluster.
    if (footer.agencyName) {
      const tenantNameW = footer.appDisplayName.length * 0.065;
      const agencyX = tenantTextX + tenantNameW + 0.3;
      let agencyTextX = agencyX;
      if (footer.agencyLogo) {
        slide.addImage({
          data: footer.agencyLogo,
          x: agencyX,
          y: glyphY,
          w: glyph,
          h: glyph,
          sizing: { type: 'contain', w: glyph, h: glyph },
        });
        agencyTextX = agencyX + glyph + 0.07;
      }
      slide.addText(`Intelligence delivered by ${footer.agencyName}`, {
        x: agencyTextX,
        y: footerY,
        w: 4.5,
        h: FOOTER_H,
        fontSize: 8,
        fontFace: 'Arial',
        italic: true,
        color: '94a3b8',
        valign: 'middle',
        wrap: false,
        margin: 0,
      });
    }

    // Right cluster: date + page number.
    slide.addText(footer.dateStr, {
      x: SLIDE_W - 2.7,
      y: footerY,
      w: 1.6,
      h: FOOTER_H,
      fontSize: 8,
      fontFace: 'Arial',
      color: '94a3b8',
      align: 'right',
      valign: 'middle',
      wrap: false,
      margin: 0,
    });
    slide.addText(`${pageNum} / ${totalPages}`, {
      x: SLIDE_W - 1.05,
      y: footerY,
      w: 0.95,
      h: FOOTER_H,
      fontSize: 8,
      fontFace: 'Arial',
      color: '94a3b8',
      align: 'right',
      valign: 'middle',
      wrap: false,
      margin: 0,
    });
  }

  private renderCover(
    cover: PptxGenJS.Slide,
    appDisplayName: string,
    primaryColorHex: string,
    logoData: string | null,
    agencyName: string | null,
    agencyLogo: string | null,
    dateStr: string
  ): void {
    // Logo + name lockup: the logo sits directly left of the name; the rest of
    // the text column aligns under the name.
    const textX = logoData ? 1.45 : 0.5;
    if (logoData) {
      cover.addImage({
        data: logoData,
        x: 0.5,
        y: 1.95,
        w: 0.75,
        h: 0.75,
        sizing: { type: 'contain', w: 0.75, h: 0.75 },
      });
    }
    cover.addText(appDisplayName, {
      x: textX,
      y: 2,
      w: 12 - textX,
      h: 0.6,
      fontSize: 28,
      fontFace: 'Arial',
      bold: true,
      color: primaryColorHex,
      valign: 'middle',
    });
    cover.addText('Clinical Trial Landscape', {
      x: textX,
      y: 2.75,
      w: 12 - textX,
      h: 0.4,
      fontSize: 14,
      fontFace: 'Arial',
      color: '475569',
    });
    cover.addText(dateStr, {
      x: textX,
      y: 3.35,
      w: 12 - textX,
      h: 0.3,
      fontSize: 11,
      fontFace: 'Arial',
      color: '64748b',
    });
    if (agencyName) {
      let attrX = textX;
      if (agencyLogo) {
        cover.addImage({
          data: agencyLogo,
          x: textX,
          y: 3.8,
          w: 0.3,
          h: 0.3,
          sizing: { type: 'contain', w: 0.3, h: 0.3 },
        });
        attrX = textX + 0.4;
      }
      cover.addText(`Intelligence delivered by ${agencyName}`, {
        x: attrX,
        y: 3.8,
        w: 11,
        h: 0.3,
        fontSize: 10,
        fontFace: 'Arial',
        italic: true,
        color: '94a3b8',
        valign: 'middle',
      });
    }
  }

  /**
   * Loads a logo URL and returns a base64 PNG data URI suitable for
   * pptxgenjs `addImage` (PowerPoint only embeds raster formats). Uses the
   * shared loadImageElement loader (Brandfetch enrichment, 8 s timeout, null
   * on any failure), then rasterizes the returned element through a canvas so
   * SVG / webp logos become PNG. Returns null so the deck falls back to the
   * brand name text.
   */
  private async loadLogoAsPng(rawUrl: string | null | undefined): Promise<string | null> {
    const img = await loadImageElement(rawUrl);
    if (!img) return null;
    try {
      const w = img.naturalWidth || 256;
      const h = img.naturalHeight || 256;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  private async loadCompanyLogos(companies: Company[]): Promise<Map<string, string>> {
    const entries = await Promise.all(
      companies
        .filter((c) => c.logo_url)
        .map(async (c) => [c.id, await this.loadLogoAsPng(c.logo_url!)] as const)
    );
    const map = new Map<string, string>();
    for (const [id, data] of entries) {
      if (data) map.set(id, data);
    }
    return map;
  }

  private normalizeHex(value: string | null | undefined): string {
    if (!value) return '';
    return value.replace('#', '').trim().toLowerCase();
  }

  private renderHeader(
    slide: PptxGenJS.Slide,
    layout: ColumnLayout,
    startYear: number,
    endYear: number,
    zoom: ZoomLevel
  ): void {
    const headerY = HEADER_Y;
    const timelineX = layout.labelColW;
    const timelineW = SLIDE_W - layout.labelColW;

    // Dark band across the full header row.
    slide.addShape('rect', {
      x: 0,
      y: headerY,
      w: SLIDE_W,
      h: HEADER_H,
      fill: { color: HEADER_BAND },
    });

    const hStyle = { fontSize: 6, fontFace: 'Arial' as const, bold: true, color: 'e2e8f0' };
    const labels: Record<string, string> = {
      company: 'Company',
      asset: 'Asset',
      moa: 'MOA',
      roa: 'ROA',
      trial: 'Trial',
      notes: 'Notes',
    };
    for (const col of layout.columns) {
      slide.addText(labels[col.key], {
        x: col.x + 0.05,
        y: headerY,
        w: col.width - 0.05,
        h: HEADER_H,
        valign: 'middle',
        wrap: false,
        margin: 0,
        ...hStyle,
      });
    }

    const columns = this.timeline.getColumns(startYear, endYear, zoom);
    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, zoom);
    for (const col of columns) {
      const x = timelineX + (col.startX / totalPx) * timelineW;
      const w = (col.width / totalPx) * timelineW;
      slide.addText(col.label, {
        x,
        y: headerY,
        w,
        h: HEADER_H,
        fontSize: 6,
        fontFace: 'Consolas',
        color: 'ffffff',
        align: 'center',
        valign: 'middle',
        wrap: false,
        margin: 0,
      });
    }

    slide.addShape('line', {
      x: 0,
      y: headerY + HEADER_H,
      w: SLIDE_W,
      h: 0,
      line: { color: 'cbd5e1', width: 0.5 },
    });
  }

  private renderGridLines(
    slide: PptxGenJS.Slide,
    layout: ColumnLayout,
    startYear: number,
    endYear: number,
    zoom: ZoomLevel,
    rowCount: number,
    rowH: number
  ): void {
    const timelineX = layout.labelColW;
    const timelineW = SLIDE_W - layout.labelColW;
    const columns = this.timeline.getColumns(startYear, endYear, zoom);
    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, zoom);
    const gridBottom = DATA_Y + rowCount * rowH;

    for (const col of columns) {
      const x = timelineX + (col.startX / totalPx) * timelineW;
      slide.addShape('line', {
        x,
        y: DATA_Y,
        w: 0,
        h: gridBottom - DATA_Y,
        line: { color: 'e2e8f0', width: 0.25 },
      });
    }
  }

  private renderRows(
    slide: PptxGenJS.Slide,
    rows: FlatRow[],
    layout: ColumnLayout,
    logoByCompany: Map<string, string>,
    rowH: number,
    startYear: number,
    endYear: number,
    primaryColorHex: string
  ): void {
    const fontSize = Math.max(5, Math.min(7, rowH * 28));
    const col = (key: string) => layout.columns.find((c) => c.key === key);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const y = DATA_Y + i * rowH;

      if (i % 2 !== 0) {
        slide.addShape('rect', { x: 0, y, w: SLIDE_W, h: rowH, fill: { color: 'f8fafc' } });
      }

      const companyCol = col('company')!;
      if (row.isFirstInCompany) {
        const logo = logoByCompany.get(row.companyId);
        const logoSize = 0.16;
        const textX = companyCol.x + (logo ? logoSize + 0.07 : 0.05);
        if (logo) {
          slide.addImage({
            data: logo,
            x: companyCol.x + 0.04,
            y: y + (rowH - logoSize) / 2,
            w: logoSize,
            h: logoSize,
            sizing: { type: 'contain', w: logoSize, h: logoSize },
          });
        }
        slide.addText(row.companyName.toUpperCase(), {
          x: textX,
          y,
          w: companyCol.x + companyCol.width - textX,
          h: rowH,
          fontSize: Math.max(4, fontSize - 1),
          fontFace: 'Arial',
          bold: true,
          color: primaryColorHex,
          valign: 'middle',
          shrinkText: true,
        });
      }

      const assetCol = col('asset')!;
      if (row.isFirstInAsset) {
        slide.addText(row.assetName, {
          x: assetCol.x + 0.05,
          y,
          w: assetCol.width - 0.05,
          h: rowH,
          fontSize,
          fontFace: 'Arial',
          bold: true,
          color: '475569',
          valign: 'middle',
          shrinkText: true,
        });
      }

      const moaCol = col('moa');
      if (moaCol && row.isFirstInAsset && row.moa) {
        slide.addText(row.moa, {
          x: moaCol.x + 0.05,
          y,
          w: moaCol.width - 0.05,
          h: rowH,
          fontSize: Math.max(4, fontSize - 1),
          fontFace: 'Arial',
          color: '64748b',
          valign: 'middle',
          shrinkText: true,
        });
      }

      const roaCol = col('roa');
      if (roaCol && row.isFirstInAsset && row.roa) {
        slide.addText(row.roa, {
          x: roaCol.x + 0.05,
          y,
          w: roaCol.width - 0.05,
          h: rowH,
          fontSize: Math.max(4, fontSize - 1),
          fontFace: 'Arial',
          color: '64748b',
          valign: 'middle',
        });
      }

      const trialCol = col('trial')!;
      const nctRun = row.nctId
        ? [
            {
              text: `  ${row.nctId}`,
              options: { color: '94a3b8', fontSize: Math.max(4, fontSize - 2) },
            },
          ]
        : [];
      slide.addText(
        [{ text: row.trialName, options: { bold: true, color: '334155' } }, ...nctRun],
        {
          x: trialCol.x + 0.05,
          y,
          w: trialCol.width - 0.05,
          h: rowH,
          fontSize,
          fontFace: 'Arial',
          valign: 'middle',
          shrinkText: true,
        }
      );

      const notesCol = col('notes');
      if (notesCol && row.hasNotes) {
        slide.addShape('ellipse', {
          x: notesCol.x + notesCol.width / 2 - 0.03,
          y: y + rowH / 2 - 0.03,
          w: 0.06,
          h: 0.06,
          fill: { color: '94a3b8' },
        });
      }

      this.renderPhaseBars(slide, row.trial, layout, y, rowH, startYear, endYear, fontSize);
      this.renderMarkers(slide, row.trial, layout, y, rowH, startYear, endYear, fontSize);
    }
  }

  private renderPhaseBars(
    slide: PptxGenJS.Slide,
    trial: Trial,
    layout: ColumnLayout,
    rowY: number,
    rowH: number,
    startYear: number,
    endYear: number,
    fontSize: number
  ): void {
    const timelineX = layout.labelColW;
    const timelineW = SLIDE_W - layout.labelColW;
    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, 'yearly');
    const barH = rowH * 0.45;
    const barY = rowY + (rowH - barH) / 2;

    if (trial.phase_type && trial.phase_start_date) {
      const startDate = trial.phase_start_date;
      const endDate = trial.phase_end_date ?? startDate;

      const sx = this.timeline.dateToX(startDate, startYear, endYear, totalPx);
      const ex = this.timeline.dateToX(endDate, startYear, endYear, totalPx);
      const barX = timelineX + (sx / totalPx) * timelineW;
      const barW = Math.max(0.05, ((ex - sx) / totalPx) * timelineW);

      const color = (PHASE_COLORS[trial.phase_type] ?? PHASE_FALLBACK_COLOR).replace('#', '');

      slide.addShape('roundRect', {
        x: barX,
        y: barY,
        w: barW,
        h: barH,
        rectRadius: 0.02,
        fill: { color, transparency: 88 }, // 12% opacity wash, matching the web
        line: { color, width: 0.75 },
      });

      if (barW > 0.4) {
        slide.addText(phaseShortLabel(trial.phase_type), {
          x: barX,
          y: barY,
          w: barW,
          h: barH,
          fontSize: Math.max(4, fontSize - 2),
          fontFace: 'Arial',
          color,
          bold: true,
          align: 'center',
          valign: 'middle',
        });
      }
    }
  }

  private renderMarkers(
    slide: PptxGenJS.Slide,
    trial: Trial,
    layout: ColumnLayout,
    rowY: number,
    rowH: number,
    startYear: number,
    endYear: number,
    fontSize: number
  ): void {
    const timelineX = layout.labelColW;
    const timelineW = SLIDE_W - layout.labelColW;
    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, 'yearly');
    const markerSize = Math.min(0.12, rowH * 0.35);
    const markers = trial.markers ?? [];

    // Sort markers by date for overlap detection
    const sorted = [...markers]
      .filter((m) => m.event_date && m.marker_types)
      .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

    let lastLabelX = -Infinity;

    for (const marker of sorted) {
      const mx = this.timeline.dateToX(marker.event_date, startYear, endYear, totalPx);
      const centerX = timelineX + (mx / totalPx) * timelineW;
      const x = centerX - markerSize / 2;
      const y = rowY + rowH * 0.1;

      const visual = resolveMarkerVisual(marker);
      drawMarkerGlyph(slide, visual, x, y, markerSize);

      // Only show date label if far enough from previous label
      if (centerX - lastLabelX > 0.4) {
        const dateLabel = formatDateShort(marker.event_date);
        slide.addText(dateLabel, {
          x: centerX - 0.15,
          y: y + markerSize + 0.01,
          w: 0.3,
          h: 0.1,
          fontSize: Math.max(3, fontSize - 3),
          fontFace: 'Consolas',
          color: visual.color.replace('#', ''),
          align: 'center',
        });
        lastLabelX = centerX;
      }
    }
  }

  private renderMarkerTable(
    slide: PptxGenJS.Slide,
    rows: MarkerRow[],
    primaryColorHex: string
  ): void {
    slide.addText('Marker Detail', {
      x: 0.3,
      y: 0.2,
      w: SLIDE_W - 0.6,
      h: 0.35,
      fontSize: 14,
      fontFace: 'Arial',
      bold: true,
      color: primaryColorHex,
    });

    const header = ['Company', 'Asset', 'Trial', 'Marker', 'Date', 'Status', 'Detail'];
    const headerRow = header.map((text) => ({
      text,
      options: { bold: true, color: 'ffffff', fill: { color: HEADER_BAND } },
    }));

    const body = rows.map((r, i) => {
      const fill = i % 2 === 0 ? 'ffffff' : 'f8fafc';
      const cells = [r.company, r.asset, r.trial, r.marker, r.date, r.status, r.detail];
      return cells.map((text) => ({ text, options: { fill: { color: fill }, color: '334155' } }));
    });

    slide.addTable([headerRow, ...body] as Parameters<PptxGenJS.Slide['addTable']>[0], {
      x: 0.3,
      y: 0.7,
      w: SLIDE_W - 0.6,
      colW: [1.6, 1.5, 1.6, 1.4, 1.1, 0.9, 4.63],
      fontSize: 8,
      fontFace: 'Arial',
      border: { type: 'solid', color: 'e2e8f0', pt: 0.5 },
      valign: 'middle',
      rowH: 0.26,
    });
  }

  private async renderLegend(slide: PptxGenJS.Slide, companies: Company[]): Promise<void> {
    const legendY = SLIDE_H - LEGEND_H;

    slide.addShape('rect', {
      x: 0,
      y: legendY,
      w: SLIDE_W,
      h: LEGEND_H,
      fill: { color: 'f8fafc' },
      line: { color: 'e2e8f0', width: 0.5 },
    });

    // Authoritative marker types (same source as the on-screen legend), grouped
    // by category. Mirrors legend.component.ts so the deck legend never drifts.
    let allTypes: Awaited<ReturnType<MarkerTypeService['list']>> = [];
    try {
      allTypes = await this.markerTypeService.list(companies[0]?.space_id);
    } catch {
      allTypes = [];
    }
    const groups = buildLegendGroups(allTypes);

    const xStart = 0.3;
    const xEnd = SLIDE_W - 0.3;
    const rowH = 0.16;
    const s = 0.09;
    const yTop = legendY + 0.07;
    const CHAR = 0.032;
    const HCHAR = 0.04;

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
    const label = (text: string, px: number, py: number, w: number, bold: boolean): void => {
      slide.addText(text, {
        x: px,
        y: py - 0.03,
        w: w + 0.1,
        h: 0.14,
        fontSize: 5,
        fontFace: 'Arial',
        bold,
        color: bold ? '475569' : '64748b',
        valign: 'middle',
        wrap: false,
        margin: 0,
      });
    };

    // Projection / status indicators (fixed prefix, matching the app legend).
    const statuses: { name: string; kind: 'actual' | 'projected' | 'nle' }[] = [
      { name: 'Actual', kind: 'actual' },
      { name: 'Projected', kind: 'projected' },
      { name: 'NLE', kind: 'nle' },
    ];
    for (const st of statuses) {
      const w = s + 0.04 + st.name.length * CHAR + 0.16;
      const { px, py } = place(w);
      const cy = py + s / 2;
      if (st.kind === 'actual') {
        slide.addShape('ellipse', { x: px, y: py, w: s, h: s, fill: { color: '64748b' }, line: { color: '64748b', width: 0.5 } });
      } else if (st.kind === 'projected') {
        slide.addShape('ellipse', { x: px, y: py, w: s, h: s, line: { color: '64748b', width: 1 } });
      } else {
        slide.addShape('ellipse', { x: px, y: py, w: s, h: s, fill: { color: '64748b', transparency: 70 }, line: { color: '64748b', width: 0.5 } });
        slide.addShape('line', { x: px - 0.01, y: cy, w: s + 0.02, h: 0, line: { color: '64748b', width: 1 } });
      }
      label(st.name, px + s + 0.03, py, st.name.length * CHAR, false);
    }

    // Category groups with bold uppercase headers + real marker shapes.
    for (const g of groups) {
      const head = g.label.toUpperCase();
      const hw = head.length * HCHAR + 0.14;
      const h = place(hw);
      label(head, h.px, h.py, head.length * HCHAR, true);
      for (const it of g.items) {
        const w = s + 0.04 + it.name.length * CHAR + 0.16;
        const { px, py } = place(w);
        drawMarkerGlyph(
          slide,
          {
            shape: it.shape as MarkerShape,
            color: it.color,
            fillStyle: it.fill_style as FillStyle,
            innerMark: it.inner_mark as InnerMark,
            isNle: false,
          } satisfies MarkerVisual,
          px,
          py,
          s
        );
        label(it.name, px + s + 0.03, py, it.name.length * CHAR, false);
      }
    }
  }

}
