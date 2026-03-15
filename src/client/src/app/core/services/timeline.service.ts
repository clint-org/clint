import { Injectable } from '@angular/core';

import { ZoomLevel } from '../models/dashboard.model';

export interface TimelineColumn {
  label: string;
  startX: number;
  width: number;
  subColumns?: TimelineColumn[];
}

const YEAR_WIDTH: Record<ZoomLevel, number> = {
  yearly: 200,
  quarterly: 600,
  monthly: 1200,
  daily: 365 * 4,
};

const QUARTER_LABELS = ['Q1', 'Q2', 'Q3', 'Q4'];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

@Injectable({ providedIn: 'root' })
export class TimelineService {
  getTimelineWidth(startYear: number, endYear: number, zoom: ZoomLevel): number {
    const years = endYear - startYear + 1;
    return years * YEAR_WIDTH[zoom];
  }

  getColumns(startYear: number, endYear: number, zoom: ZoomLevel): TimelineColumn[] {
    const columns: TimelineColumn[] = [];
    let x = 0;

    for (let year = startYear; year <= endYear; year++) {
      const yearWidth = YEAR_WIDTH[zoom];

      if (zoom === 'yearly') {
        columns.push({ label: `${year}`, startX: x, width: yearWidth });
        x += yearWidth;
      } else if (zoom === 'quarterly') {
        const quarterWidth = yearWidth / 4;
        const subColumns: TimelineColumn[] = QUARTER_LABELS.map((q, i) => ({
          label: `${q} ${year}`,
          startX: x + i * quarterWidth,
          width: quarterWidth,
        }));
        columns.push({
          label: `${year}`,
          startX: x,
          width: yearWidth,
          subColumns,
        });
        x += yearWidth;
      } else if (zoom === 'monthly') {
        const monthWidth = yearWidth / 12;
        const subColumns: TimelineColumn[] = MONTH_LABELS.map((m, i) => ({
          label: `${m} ${year}`,
          startX: x + i * monthWidth,
          width: monthWidth,
        }));
        columns.push({
          label: `${year}`,
          startX: x,
          width: yearWidth,
          subColumns,
        });
        x += yearWidth;
      } else {
        // daily: each day is 4px, use months as sub-columns
        const daysInYear = this.isLeapYear(year) ? 366 : 365;
        const dayWidth = 4;
        const actualYearWidth = daysInYear * dayWidth;
        const subColumns: TimelineColumn[] = [];
        let monthX = x;

        for (let month = 0; month < 12; month++) {
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const monthWidth = daysInMonth * dayWidth;
          subColumns.push({
            label: `${MONTH_LABELS[month]} ${year}`,
            startX: monthX,
            width: monthWidth,
          });
          monthX += monthWidth;
        }

        columns.push({
          label: `${year}`,
          startX: x,
          width: actualYearWidth,
          subColumns,
        });
        x += actualYearWidth;
      }
    }

    return columns;
  }

  dateToX(date: string, startYear: number, endYear: number, totalWidth: number): number {
    const d = new Date(date);
    const timelineStart = new Date(startYear, 0, 1);
    const timelineEnd = new Date(endYear + 1, 0, 1);
    const totalMs = timelineEnd.getTime() - timelineStart.getTime();
    const elapsedMs = d.getTime() - timelineStart.getTime();
    return (elapsedMs / totalMs) * totalWidth;
  }

  xToDate(x: number, startYear: number, endYear: number, totalWidth: number): string {
    const timelineStart = new Date(startYear, 0, 1);
    const timelineEnd = new Date(endYear + 1, 0, 1);
    const totalMs = timelineEnd.getTime() - timelineStart.getTime();
    const ms = (x / totalWidth) * totalMs;
    const d = new Date(timelineStart.getTime() + ms);
    return d.toISOString().split('T')[0];
  }

  private isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }
}
