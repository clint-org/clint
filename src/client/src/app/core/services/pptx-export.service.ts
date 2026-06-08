import { inject, Injectable } from '@angular/core';
import PptxGenJS from 'pptxgenjs';

import { Company } from '../models/company.model';
import { ZoomLevel } from '../models/dashboard.model';
import { Trial } from '../models/trial.model';
import { BrandContextService } from './brand-context.service';
import { MarkerTypeService } from './marker-type.service';
import {
  computeLeftColumns,
  type ColumnLayout,
  formatDateShort,
  orderLegendItems,
  type PresentMarkerType,
} from './pptx-export.util';
import { TimelineService } from './timeline.service';

export interface ExportOptions {
  zoomLevel: ZoomLevel;
  startYear: number;
  endYear: number;
  showMoaColumn: boolean;
  showRoaColumn: boolean;
  showNotesColumn: boolean;
}

interface FlatRow {
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

const PHASE_COLORS: Record<string, string> = {
  P1: '94a3b8',
  P2: '67e8f9',
  P3: '2dd4bf',
  P4: 'a78bfa',
  OBS: 'fbbf24',
};

const SLIDE_W = 13.33;
const SLIDE_H = 7.5;
const TITLE_H = 0.3;
const HEADER_H = 0.28;
const HEADER_BAND = '1e293b';
const LEGEND_H = 0.7;
const DATA_Y = TITLE_H + HEADER_H;

const FALLBACK_PRIMARY = '0d9488';

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
    const logoData = logoUrl ? await this.loadLogoAsBase64(logoUrl) : null;

    const rows = this.flattenTrials(companies);
    if (rows.length === 0) return;

    // Two slides total: cover + data slide.
    const totalPages = 2;

    // Slide 1: branded cover.
    const cover = pptx.addSlide();
    this.renderCover(cover, appDisplayName, primaryColorHex, logoData);
    this.addFooter(cover, appDisplayName, 1, totalPages);

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

    this.renderTitle(slide, appDisplayName, primaryColorHex);
    this.renderHeader(slide, layout, startYear, endYear, zoomLevel);
    this.renderGridLines(slide, layout, startYear, endYear, zoomLevel, rows.length, rowH);
    this.renderRows(slide, rows, layout, logoByCompany, rowH, startYear, endYear, primaryColorHex);
    await this.renderLegend(slide, companies);
    this.addFooter(slide, appDisplayName, 2, totalPages);

    await pptx.writeFile({ fileName: 'clinical-trial-dashboard.pptx' });
  }

  private addFooter(
    slide: PptxGenJS.Slide,
    appDisplayName: string,
    pageNum: number,
    totalPages: number
  ): void {
    slide.addText(appDisplayName, {
      x: 0.1,
      y: SLIDE_H - 0.25,
      w: 4,
      h: 0.2,
      fontSize: 8,
      fontFace: 'Arial',
      color: '94a3b8',
    });
    slide.addText(`${pageNum} / ${totalPages}`, {
      x: SLIDE_W - 1.5,
      y: SLIDE_H - 0.25,
      w: 1.4,
      h: 0.2,
      fontSize: 8,
      fontFace: 'Arial',
      color: '94a3b8',
      align: 'right',
    });
  }

  private renderCover(
    cover: PptxGenJS.Slide,
    appDisplayName: string,
    primaryColorHex: string,
    logoData: string | null
  ): void {
    if (logoData) {
      cover.addImage({
        data: logoData,
        x: 0.5,
        y: 0.5,
        w: 2,
        h: 0.8,
        sizing: { type: 'contain', w: 2, h: 0.8 },
      });
    }
    cover.addText(appDisplayName, {
      x: 0.5,
      y: 2,
      w: 12,
      h: 0.6,
      fontSize: 28,
      fontFace: 'Arial',
      bold: true,
      color: primaryColorHex,
    });
    cover.addText('Clinical Trial Landscape', {
      x: 0.5,
      y: 2.7,
      w: 12,
      h: 0.4,
      fontSize: 14,
      fontFace: 'Arial',
      color: '475569',
    });
    cover.addText(
      new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      {
        x: 0.5,
        y: 3.3,
        w: 12,
        h: 0.3,
        fontSize: 11,
        fontFace: 'Arial',
        color: '64748b',
      }
    );
  }

  private async loadLogoAsBase64(url: string): Promise<string | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      const base64 = btoa(binary);
      const contentType = res.headers.get('content-type') || 'image/png';
      return `data:${contentType};base64,${base64}`;
    } catch {
      return null;
    }
  }

  private async loadCompanyLogos(companies: Company[]): Promise<Map<string, string>> {
    const entries = await Promise.all(
      companies
        .filter((c) => c.logo_url)
        .map(async (c) => [c.id, await this.loadLogoAsBase64(c.logo_url!)] as const)
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

  private flattenTrials(companies: Company[]): FlatRow[] {
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

  private renderTitle(
    slide: PptxGenJS.Slide,
    appDisplayName: string,
    primaryColorHex: string
  ): void {
    slide.addText(appDisplayName, {
      x: 0.2,
      y: 0,
      w: SLIDE_W - 0.4,
      h: TITLE_H,
      fontSize: 12,
      fontFace: 'Arial',
      bold: true,
      color: primaryColorHex,
    });
    slide.addText(
      new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      {
        x: SLIDE_W - 2.5,
        y: 0,
        w: 2.3,
        h: TITLE_H,
        fontSize: 8,
        fontFace: 'Arial',
        color: '64748b',
        align: 'right',
      }
    );
    slide.addShape('line', {
      x: 0,
      y: TITLE_H - 0.02,
      w: SLIDE_W,
      h: 0,
      line: { color: primaryColorHex, width: 1.5 },
    });
  }

  private renderHeader(
    slide: PptxGenJS.Slide,
    layout: ColumnLayout,
    startYear: number,
    endYear: number,
    zoom: ZoomLevel
  ): void {
    const headerY = TITLE_H;
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
        fontSize: 7,
        fontFace: 'Consolas',
        color: 'ffffff',
        align: 'center',
        valign: 'middle',
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

      const color = (PHASE_COLORS[trial.phase_type] ?? '94a3b8').replace('#', '');

      slide.addShape('roundRect', {
        x: barX,
        y: barY,
        w: barW,
        h: barH,
        rectRadius: 0.02,
        fill: { color },
        line: { color, width: 0.5 },
      });

      if (barW > 0.4) {
        slide.addText(trial.phase_type, {
          x: barX,
          y: barY,
          w: barW,
          h: barH,
          fontSize: Math.max(4, fontSize - 2),
          fontFace: 'Arial',
          color: 'ffffff',
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
      const color = (marker.marker_types!.color ?? '3b82f6').replace('#', '');
      const shape = marker.marker_types!.shape;
      const fill = marker.marker_types!.fill_style;
      const isFilled = fill === 'filled';

      this.renderMarkerShape(
        slide,
        shape,
        isFilled,
        x,
        y,
        markerSize,
        color,
        marker.end_date,
        startYear,
        endYear,
        totalPx,
        timelineX,
        timelineW
      );

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
          color,
          align: 'center',
        });
        lastLabelX = centerX;
      }
    }
  }

  private renderMarkerShape(
    slide: PptxGenJS.Slide,
    shape: string,
    isFilled: boolean,
    x: number,
    y: number,
    size: number,
    color: string,
    endDate: string | null,
    startYear: number,
    endYear: number,
    totalPx: number,
    timelineX: number,
    timelineW: number
  ): void {
    if (shape === 'circle') {
      slide.addShape('ellipse', {
        x,
        y,
        w: size,
        h: size,
        fill: isFilled ? { color } : undefined,
        line: { color, width: 1 },
      });
    } else if (shape === 'diamond') {
      slide.addShape('diamond', {
        x,
        y,
        w: size,
        h: size,
        fill: isFilled ? { color } : undefined,
        line: { color, width: 1 },
      });
    } else if (shape === 'flag') {
      const flagX = x + size * 0.3;
      slide.addShape('line', {
        x: flagX,
        y,
        w: 0,
        h: size,
        line: { color, width: 1 },
      });
      slide.addShape('rect', {
        x: flagX,
        y,
        w: size * 0.7,
        h: size * 0.5,
        fill: isFilled ? { color } : undefined,
        line: { color, width: 0.5 },
      });
    } else if (shape === 'arrow') {
      // Render as a simple up-pointing triangle
      slide.addShape('triangle', {
        x,
        y,
        w: size,
        h: size,
        fill: isFilled ? { color } : undefined,
        line: { color, width: 1 },
      });
    } else if (shape === 'x') {
      // Two diagonal lines forming an X
      const pad = size * 0.15;
      slide.addShape('rect', {
        x: x + pad,
        y: y + pad,
        w: size - pad * 2,
        h: size - pad * 2,
        fill: isFilled ? { color } : undefined,
        line: { color, width: 1.5 },
      });
      // Draw X lines on top
      slide.addText('X', {
        x,
        y,
        w: size,
        h: size,
        fontSize: Math.round(size * 50),
        fontFace: 'Arial',
        bold: true,
        color,
        align: 'center',
        valign: 'middle',
      });
    } else if (shape === 'bar' && endDate) {
      const startPx = x + size / 2;
      const endPx =
        timelineX +
        (this.timeline.dateToX(endDate, startYear, endYear, totalPx) / totalPx) * timelineW;
      const barW = Math.max(0.1, endPx - startPx);
      slide.addShape('roundRect', {
        x: startPx,
        y: y + size * 0.2,
        w: barW,
        h: size * 0.6,
        rectRadius: 0.01,
        fill: { color, transparency: 50 },
        line: { color, width: 0.5 },
      });
    }
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

    // Collect unique present marker types.
    const presentMap = new Map<string, PresentMarkerType>();
    for (const company of companies) {
      for (const asset of company.assets ?? []) {
        for (const trial of asset.trials ?? []) {
          for (const marker of trial.markers ?? []) {
            const mt = marker.marker_types;
            if (mt && !presentMap.has(mt.id)) {
              presentMap.set(mt.id, {
                id: mt.id,
                name: mt.name,
                color: mt.color,
                shape: mt.shape,
                fill_style: mt.fill_style,
                display_order: mt.display_order,
              });
            }
          }
        }
      }
    }

    // Authoritative category ordering (same source as the on-screen legend).
    let allTypes: Awaited<ReturnType<MarkerTypeService['list']>> = [];
    try {
      allTypes = await this.markerTypeService.list(companies[0]?.space_id);
    } catch {
      allTypes = [];
    }

    const { items, breakIndex } = orderLegendItems([...presentMap.values()], allTypes);

    const dotSize = 0.08;
    const itemW = 1.5;
    const itemsPerRow = Math.floor((SLIDE_W - 0.4) / itemW);
    const rowH = 0.2;

    let col = 0;
    let rowIdx = 0;
    for (let i = 0; i < items.length; i++) {
      if (i === breakIndex || col >= itemsPerRow) {
        col = 0;
        rowIdx++;
      }
      const mt = items[i];
      const x = 0.3 + col * itemW;
      const itemY = legendY + 0.08 + rowIdx * rowH;
      const color = mt.color.replace('#', '');
      const isFilled = mt.fill_style === 'filled';

      if (mt.shape === 'circle') {
        slide.addShape('ellipse', {
          x,
          y: itemY,
          w: dotSize,
          h: dotSize,
          fill: isFilled ? { color } : undefined,
          line: { color, width: 0.5 },
        });
      } else if (mt.shape === 'diamond') {
        slide.addShape('diamond', {
          x,
          y: itemY,
          w: dotSize,
          h: dotSize,
          fill: isFilled ? { color } : undefined,
          line: { color, width: 0.5 },
        });
      } else {
        slide.addShape('rect', {
          x,
          y: itemY,
          w: dotSize,
          h: dotSize,
          fill: isFilled ? { color } : undefined,
          line: { color, width: 0.5 },
        });
      }

      slide.addText(mt.name, {
        x: x + dotSize + 0.04,
        y: itemY - 0.03,
        w: itemW - dotSize - 0.15,
        h: 0.14,
        fontSize: 5,
        fontFace: 'Arial',
        color: '64748b',
        valign: 'middle',
        shrinkText: true,
      });
      col++;
    }
  }
}
