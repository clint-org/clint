import { inject, Injectable } from '@angular/core';
import PptxGenJS from 'pptxgenjs';

import { Company } from '../models/company.model';
import { ZoomLevel } from '../models/dashboard.model';
import { Trial } from '../models/trial.model';
import { TimelineService } from './timeline.service';

export interface ExportOptions {
  zoomLevel: ZoomLevel;
  startYear: number;
  endYear: number;
}

interface FlatRow {
  companyName: string;
  productName: string;
  trialName: string;
  trial: Trial;
  isFirstInCompany: boolean;
  isFirstInProduct: boolean;
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
const HEADER_H = 0.25;
const LEGEND_H = 0.55;
const LABEL_COL_W = 2.8;
const TIMELINE_X = LABEL_COL_W;
const TIMELINE_W = SLIDE_W - LABEL_COL_W;
const DATA_Y = TITLE_H + HEADER_H;

const COMPANY_X = 0.1;
const COMPANY_W = 0.9;
const PRODUCT_X = 1.0;
const PRODUCT_W = 0.8;
const TRIAL_X = 1.8;
const TRIAL_W = 1.0;

@Injectable({ providedIn: 'root' })
export class PptxExportService {
  private timeline = inject(TimelineService);

  async exportDashboard(companies: Company[], options: ExportOptions): Promise<void> {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'WIDE', width: SLIDE_W, height: SLIDE_H });
    pptx.layout = 'WIDE';

    const slide = pptx.addSlide();
    const rows = this.flattenTrials(companies);
    if (rows.length === 0) return;

    const rowH = Math.min(0.28, (SLIDE_H - DATA_Y - LEGEND_H) / rows.length);
    const { startYear, endYear, zoomLevel } = options;

    this.renderTitle(slide);
    this.renderHeader(slide, startYear, endYear, zoomLevel);
    this.renderGridLines(slide, startYear, endYear, zoomLevel, rows.length, rowH);
    this.renderRows(slide, rows, rowH, startYear, endYear);
    this.renderLegend(slide, companies);

    await pptx.writeFile({ fileName: 'clinical-trial-dashboard.pptx' });
  }

  private flattenTrials(companies: Company[]): FlatRow[] {
    const rows: FlatRow[] = [];
    for (const company of companies) {
      let isFirstInCompany = true;
      for (const product of company.products ?? []) {
        let isFirstInProduct = true;
        for (const trial of product.trials ?? []) {
          rows.push({
            companyName: company.name,
            productName: product.name,
            trialName: trial.name,
            trial,
            isFirstInCompany,
            isFirstInProduct,
          });
          isFirstInCompany = false;
          isFirstInProduct = false;
        }
      }
    }
    return rows;
  }

  private renderTitle(slide: PptxGenJS.Slide): void {
    slide.addText('Clinical Trial Dashboard', {
      x: 0.2, y: 0, w: SLIDE_W - 0.4, h: TITLE_H,
      fontSize: 12, fontFace: 'Arial', bold: true, color: '1e293b',
    });
    slide.addText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), {
      x: SLIDE_W - 2.5, y: 0, w: 2.3, h: TITLE_H,
      fontSize: 8, fontFace: 'Arial', color: '64748b', align: 'right',
    });
    slide.addShape('line', {
      x: 0, y: TITLE_H - 0.02, w: SLIDE_W, h: 0,
      line: { color: '14b8a6', width: 1.5 },
    });
  }

  private renderHeader(slide: PptxGenJS.Slide, startYear: number, endYear: number, zoom: ZoomLevel): void {
    const headerY = TITLE_H;
    const hStyle = { fontSize: 6, fontFace: 'Arial' as const, bold: true, color: '64748b' };
    slide.addText('Company', { x: COMPANY_X, y: headerY, w: COMPANY_W, h: HEADER_H, ...hStyle });
    slide.addText('Product', { x: PRODUCT_X, y: headerY, w: PRODUCT_W, h: HEADER_H, ...hStyle });
    slide.addText('Trial', { x: TRIAL_X, y: headerY, w: TRIAL_W, h: HEADER_H, ...hStyle });

    const columns = this.timeline.getColumns(startYear, endYear, zoom);
    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, zoom);

    for (const col of columns) {
      const x = TIMELINE_X + (col.startX / totalPx) * TIMELINE_W;
      const w = (col.width / totalPx) * TIMELINE_W;
      slide.addText(col.label, {
        x, y: headerY, w, h: HEADER_H,
        fontSize: 7, fontFace: 'Consolas', color: '475569', align: 'center', valign: 'middle',
      });
    }

    slide.addShape('line', {
      x: 0, y: headerY + HEADER_H, w: SLIDE_W, h: 0,
      line: { color: 'cbd5e1', width: 0.5 },
    });
  }

  private renderGridLines(
    slide: PptxGenJS.Slide, startYear: number, endYear: number,
    zoom: ZoomLevel, rowCount: number, rowH: number
  ): void {
    const columns = this.timeline.getColumns(startYear, endYear, zoom);
    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, zoom);
    const gridBottom = DATA_Y + rowCount * rowH;

    for (const col of columns) {
      const x = TIMELINE_X + (col.startX / totalPx) * TIMELINE_W;
      slide.addShape('line', {
        x, y: DATA_Y, w: 0, h: gridBottom - DATA_Y,
        line: { color: 'e2e8f0', width: 0.25 },
      });
    }
  }

  private renderRows(
    slide: PptxGenJS.Slide, rows: FlatRow[], rowH: number,
    startYear: number, endYear: number
  ): void {
    const fontSize = Math.max(5, Math.min(7, rowH * 28));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const y = DATA_Y + i * rowH;

      if (i % 2 !== 0) {
        slide.addShape('rect', {
          x: 0, y, w: SLIDE_W, h: rowH,
          fill: { color: 'f8fafc' },
        });
      }

      if (row.isFirstInCompany) {
        slide.addText(row.companyName.toUpperCase(), {
          x: COMPANY_X, y, w: COMPANY_W, h: rowH,
          fontSize: Math.max(4, fontSize - 1), fontFace: 'Arial', bold: true,
          color: '94a3b8', valign: 'middle', shrinkText: true,
        });
      }

      if (row.isFirstInProduct) {
        slide.addText(row.productName, {
          x: PRODUCT_X, y, w: PRODUCT_W, h: rowH,
          fontSize, fontFace: 'Arial', bold: true,
          color: '475569', valign: 'middle',
        });
      }

      slide.addText(row.trialName, {
        x: TRIAL_X, y, w: TRIAL_W, h: rowH,
        fontSize, fontFace: 'Arial', color: '334155', valign: 'middle',
        shrinkText: true,
      });

      this.renderPhaseBars(slide, row.trial, y, rowH, startYear, endYear, fontSize);
      this.renderMarkers(slide, row.trial, y, rowH, startYear, endYear, fontSize);
    }
  }

  private renderPhaseBars(
    slide: PptxGenJS.Slide, trial: Trial, rowY: number, rowH: number,
    startYear: number, endYear: number, fontSize: number
  ): void {
    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, 'yearly');
    const barH = rowH * 0.45;
    const barY = rowY + (rowH - barH) / 2;

    for (const phase of trial.trial_phases ?? []) {
      if (!phase.start_date) continue;
      const endDate = phase.end_date ?? phase.start_date;

      const sx = this.timeline.dateToX(phase.start_date, startYear, endYear, totalPx);
      const ex = this.timeline.dateToX(endDate, startYear, endYear, totalPx);
      const barX = TIMELINE_X + (sx / totalPx) * TIMELINE_W;
      const barW = Math.max(0.05, ((ex - sx) / totalPx) * TIMELINE_W);

      const color = (phase.color ?? PHASE_COLORS[phase.phase_type] ?? '94a3b8').replace('#', '');

      slide.addShape('roundRect', {
        x: barX, y: barY, w: barW, h: barH,
        rectRadius: 0.02,
        fill: { color, transparency: 25 },
        line: { color, width: 0.5, transparency: 60 },
      });

      if (barW > 0.4) {
        slide.addText(phase.label ?? phase.phase_type, {
          x: barX, y: barY, w: barW, h: barH,
          fontSize: Math.max(4, fontSize - 2), fontFace: 'Arial',
          color: 'ffffff', bold: true, align: 'center', valign: 'middle',
        });
      }
    }
  }

  private renderMarkers(
    slide: PptxGenJS.Slide, trial: Trial, rowY: number, rowH: number,
    startYear: number, endYear: number, fontSize: number
  ): void {
    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, 'yearly');
    const markerSize = Math.min(0.12, rowH * 0.35);
    const markers = trial.trial_markers ?? [];

    // Sort markers by date for overlap detection
    const sorted = [...markers]
      .filter(m => m.event_date && m.marker_types)
      .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

    let lastLabelX = -Infinity;

    for (const marker of sorted) {
      const mx = this.timeline.dateToX(marker.event_date, startYear, endYear, totalPx);
      const centerX = TIMELINE_X + (mx / totalPx) * TIMELINE_W;
      const x = centerX - markerSize / 2;
      const y = rowY + rowH * 0.1;
      const color = (marker.marker_types!.color ?? '3b82f6').replace('#', '');
      const shape = marker.marker_types!.shape;
      const fill = marker.marker_types!.fill_style;
      const isFilled = fill === 'filled' || fill === 'gradient';

      this.renderMarkerShape(slide, shape, isFilled, x, y, markerSize, color, marker.end_date, startYear, endYear, totalPx);

      // Only show date label if far enough from previous label
      if (centerX - lastLabelX > 0.3) {
        const dateLabel = this.formatDateShort(marker.event_date);
        slide.addText(dateLabel, {
          x: centerX - 0.15, y: y + markerSize + 0.01, w: 0.3, h: 0.1,
          fontSize: Math.max(3, fontSize - 3), fontFace: 'Consolas',
          color, align: 'center',
        });
        lastLabelX = centerX;
      }
    }
  }

  private renderMarkerShape(
    slide: PptxGenJS.Slide, shape: string, isFilled: boolean,
    x: number, y: number, size: number, color: string,
    endDate: string | null, startYear: number, endYear: number, totalPx: number
  ): void {
    if (shape === 'circle') {
      slide.addShape('ellipse', {
        x, y, w: size, h: size,
        fill: isFilled ? { color } : undefined,
        line: { color, width: 1 },
      });
    } else if (shape === 'diamond') {
      slide.addShape('diamond', {
        x, y, w: size, h: size,
        fill: isFilled ? { color } : undefined,
        line: { color, width: 1 },
      });
    } else if (shape === 'flag') {
      const flagX = x + size * 0.3;
      slide.addShape('line', {
        x: flagX, y, w: 0, h: size,
        line: { color, width: 1 },
      });
      slide.addShape('rect', {
        x: flagX, y, w: size * 0.7, h: size * 0.5,
        fill: isFilled ? { color } : undefined,
        line: { color, width: 0.5 },
      });
    } else if (shape === 'arrow') {
      // Render as a simple up-pointing triangle
      slide.addShape('triangle', {
        x, y, w: size, h: size,
        fill: isFilled ? { color } : undefined,
        line: { color, width: 1 },
      });
    } else if (shape === 'x') {
      // Two diagonal lines forming an X
      const pad = size * 0.15;
      slide.addShape('rect', {
        x: x + pad, y: y + pad, w: size - pad * 2, h: size - pad * 2,
        fill: isFilled ? { color } : undefined,
        line: { color, width: 1.5 },
      });
      // Draw X lines on top
      slide.addText('X', {
        x, y, w: size, h: size,
        fontSize: Math.round(size * 50), fontFace: 'Arial', bold: true,
        color, align: 'center', valign: 'middle',
      });
    } else if (shape === 'bar' && endDate) {
      const startPx = x + size / 2;
      const endPx = TIMELINE_X + (this.timeline.dateToX(endDate, startYear, endYear, totalPx) / totalPx) * TIMELINE_W;
      const barW = Math.max(0.1, endPx - startPx);
      slide.addShape('roundRect', {
        x: startPx, y: y + size * 0.2, w: barW, h: size * 0.6,
        rectRadius: 0.01,
        fill: { color, transparency: 50 },
        line: { color, width: 0.5 },
      });
    }
  }

  private renderLegend(slide: PptxGenJS.Slide, companies: Company[]): void {
    const legendY = SLIDE_H - LEGEND_H;

    slide.addShape('rect', {
      x: 0, y: legendY, w: SLIDE_W, h: LEGEND_H,
      fill: { color: 'f8fafc' },
      line: { color: 'e2e8f0', width: 0.5 },
    });

    // Collect unique marker types preserving display order
    const markerTypes = new Map<string, { name: string; color: string; shape: string; fill_style: string; display_order: number }>();
    for (const company of companies) {
      for (const product of company.products ?? []) {
        for (const trial of product.trials ?? []) {
          for (const marker of trial.trial_markers ?? []) {
            if (marker.marker_types && !markerTypes.has(marker.marker_types.id)) {
              markerTypes.set(marker.marker_types.id, {
                name: marker.marker_types.name,
                color: marker.marker_types.color,
                shape: marker.marker_types.shape,
                fill_style: marker.marker_types.fill_style,
                display_order: marker.marker_types.display_order,
              });
            }
          }
        }
      }
    }

    const sortedTypes = [...markerTypes.values()].sort((a, b) => a.display_order - b.display_order);
    const dotSize = 0.08;
    const itemW = 1.5;
    const itemsPerRow = Math.floor((SLIDE_W - 0.4) / itemW);
    const rowH = 0.2;

    for (let i = 0; i < sortedTypes.length; i++) {
      const mt = sortedTypes[i];
      const col = i % itemsPerRow;
      const row = Math.floor(i / itemsPerRow);
      const x = 0.3 + col * itemW;
      const itemY = legendY + 0.08 + row * rowH;

      const color = mt.color.replace('#', '');
      const isFilled = mt.fill_style === 'filled' || mt.fill_style === 'gradient';

      if (mt.shape === 'circle') {
        slide.addShape('ellipse', {
          x, y: itemY, w: dotSize, h: dotSize,
          fill: isFilled ? { color } : undefined,
          line: { color, width: 0.5 },
        });
      } else if (mt.shape === 'diamond') {
        slide.addShape('diamond', {
          x, y: itemY, w: dotSize, h: dotSize,
          fill: isFilled ? { color } : undefined,
          line: { color, width: 0.5 },
        });
      } else {
        slide.addShape('rect', {
          x, y: itemY, w: dotSize, h: dotSize,
          fill: isFilled ? { color } : undefined,
          line: { color, width: 0.5 },
        });
      }

      slide.addText(mt.name, {
        x: x + dotSize + 0.04, y: itemY - 0.03, w: itemW - dotSize - 0.15, h: 0.14,
        fontSize: 5, fontFace: 'Arial', color: '64748b', valign: 'middle',
        shrinkText: true,
      });
    }
  }

  private formatDateShort(dateStr: string): string {
    const d = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
  }
}
