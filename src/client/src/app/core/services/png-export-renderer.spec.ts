import { describe, expect, it } from 'vitest';

import type { Company } from '../models/company.model';
import {
  PNG_H,
  PNG_W,
  type PngRenderContext,
  type PngSurface,
  renderTimelinePng,
} from './png-export-renderer';

type Op = [string, ...unknown[]];

class RecordingCtx {
  ops: Op[] = [];
  private record(name: string, ...args: unknown[]): void {
    this.ops.push([name, ...args]);
  }
  set fillStyle(v: unknown) {
    this.record('set fillStyle', v);
  }
  set strokeStyle(v: unknown) {
    this.record('set strokeStyle', v);
  }
  set lineWidth(v: unknown) {
    this.record('set lineWidth', v);
  }
  set globalAlpha(v: unknown) {
    this.record('set globalAlpha', v);
  }
  set font(v: unknown) {
    this.record('set font', v);
  }
  set textAlign(v: unknown) {
    this.record('set textAlign', v);
  }
  set textBaseline(v: unknown) {
    this.record('set textBaseline', v);
  }
  beginPath(): void {
    this.record('beginPath');
  }
  closePath(): void {
    this.record('closePath');
  }
  arc(...a: unknown[]): void {
    this.record('arc', ...a);
  }
  arcTo(...a: unknown[]): void {
    this.record('arcTo', ...a);
  }
  moveTo(...a: unknown[]): void {
    this.record('moveTo', ...a);
  }
  lineTo(...a: unknown[]): void {
    this.record('lineTo', ...a);
  }
  rect(...a: unknown[]): void {
    this.record('rect', ...a);
  }
  fill(): void {
    this.record('fill');
  }
  stroke(): void {
    this.record('stroke');
  }
  save(): void {
    this.record('save');
  }
  restore(): void {
    this.record('restore');
  }
  setLineDash(...a: unknown[]): void {
    this.record('setLineDash', ...a);
  }
  fillRect(...a: unknown[]): void {
    this.record('fillRect', ...a);
  }
  fillText(...a: unknown[]): void {
    this.record('fillText', ...a);
  }
  drawImage(...a: unknown[]): void {
    this.record('drawImage', ...a);
  }
  measureText(text: string): TextMetrics {
    return { width: text.length * 6 } as TextMetrics;
  }
}

const companies = [
  {
    id: 'c1',
    name: 'Acme Pharma',
    space_id: 's1',
    assets: [
      {
        id: 'a1',
        name: 'ACM-101',
        mechanisms_of_action: [],
        routes_of_administration: [],
        trials: [
          {
            id: 't1',
            name: 'ACME-1',
            acronym: null,
            identifier: 'NCT00000001',
            notes: null,
            trial_notes: [],
            phase_type: 'P3',
            phase_start_date: '2020-01-01',
            phase_end_date: '2022-06-30',
            markers: [
              {
                id: 'm1',
                event_date: '2021-06-15',
                end_date: null,
                projection: 'actual',
                is_projected: false,
                no_longer_expected: false,
                title: 'Topline readout',
                description: null,
                marker_types: {
                  name: 'Data readout',
                  color: '#16a34a',
                  shape: 'circle',
                  fill_style: 'filled',
                  inner_mark: 'none',
                },
              },
            ],
          },
        ],
      },
    ],
  },
] as unknown as Company[];

function renderContext(): PngRenderContext {
  return {
    companies,
    options: {
      zoomLevel: 'yearly',
      startYear: 2019,
      endYear: 2023,
      showMoaColumn: true,
      showRoaColumn: true,
      showNotesColumn: true,
    },
    appDisplayName: 'Test App',
    primaryColor: '#0d9488',
    agencyName: 'Test Agency',
    dateStr: 'June 10, 2026',
    legendGroups: [
      {
        label: 'Clinical',
        items: [
          { name: 'Data readout', color: '#16a34a', shape: 'circle', fill_style: 'filled', inner_mark: 'none' },
        ],
      },
    ],
    columns: [2019, 2020, 2021, 2022, 2023].map((year, i) => ({
      label: `${year}`,
      startX: i * 200,
      width: 200,
    })),
    totalPx: 1000,
    dateToX: (date: string) => {
      const start = new Date(2019, 0, 1).getTime();
      const end = new Date(2024, 0, 1).getTime();
      return ((new Date(date).getTime() - start) / (end - start)) * 1000;
    },
  };
}

function render(): Op[] {
  const rec = new RecordingCtx();
  renderTimelinePng(rec as unknown as PngSurface, renderContext());
  return rec.ops;
}

describe('renderTimelinePng', () => {
  it('paints a white background across the full 1920x1080 frame', () => {
    const ops = render();
    expect(ops).toContainEqual(['fillRect', 0, 0, PNG_W, PNG_H]);
  });

  it('paints the dark header band across the full width', () => {
    const ops = render();
    const bandIdx = ops.findIndex(
      (o) => o[0] === 'fillRect' && o[1] === 0 && o[2] === 0 && o[3] === PNG_W && o[4] !== PNG_H
    );
    expect(bandIdx).toBeGreaterThan(-1);
    const priorFills = ops.slice(0, bandIdx).filter((o) => o[0] === 'set fillStyle');
    expect(priorFills.at(-1)).toEqual(['set fillStyle', '#1e293b']);
  });

  it('writes the left column headers and year labels', () => {
    const ops = render();
    const texts = ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
    expect(texts).toContain('Company');
    expect(texts).toContain('Trial');
    expect(texts).toContain('2021');
  });

  it('washes the phase bar at 12% alpha', () => {
    const ops = render();
    expect(ops).toContainEqual(['set globalAlpha', 0.12]);
  });

  it('draws the marker glyph (circle arc) and the company name in brand color', () => {
    const ops = render();
    expect(ops.some((o) => o[0] === 'arc')).toBe(true);
    expect(ops).toContainEqual(['set fillStyle', '#0d9488']);
    const texts = ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
    expect(texts).toContain('ACME PHARMA');
  });

  it('renders legend group header, status entries, and footer branding', () => {
    const ops = render();
    const texts = ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
    expect(texts).toContain('CLINICAL');
    expect(texts).toContain('Actual');
    expect(texts).toContain('Data readout');
    expect(texts).toContain('Test App');
    expect(texts).toContain('Intelligence delivered by Test Agency');
    expect(texts).toContain('June 10, 2026');
  });
});
