import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import {
  type CountUnit,
  type DensityBubble,
  PHASE_COLOR,
  type RingPhase,
  visibleRingOrder,
} from '../../core/models/landscape.model';

const PHASE_SHORT: Record<RingPhase, string> = {
  PRECLIN: 'Pre',
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4',
  APPROVED: 'App',
  LAUNCHED: 'Lnch',
};

export type SortField = 'total' | 'phase' | 'name';

export interface SortEvent {
  field: string;
  dir: 'asc' | 'desc';
}

export interface MatrixRow {
  bubble: DensityBubble;
  cells: MatrixCell[];
  total: number;
}

export interface MatrixCell {
  phase: RingPhase;
  count: number;
  /** Phase-hued tint for the cell, or null when the cell is empty. */
  background: string | null;
}

/**
 * Absolute density step (0-6) for a cell's count. Independent of the rest of
 * the matrix and of the active count unit, so a given count always renders at
 * the same shade across the Assets / Trials / Companies toggle.
 */
export function densityStep(count: number): number {
  if (count <= 0) return 0;
  if (count <= 3) return count; // 1, 2, 3 map one-to-one
  if (count <= 5) return 4;
  if (count <= 9) return 5;
  return 6;
}

// Mix percentage of the phase hue over white per step. Capped well below full
// saturation so dark cell text keeps WCAG AA contrast on every phase color.
const STEP_MIX_PCT = [0, 14, 22, 30, 38, 46, 54];

/**
 * Background tint for a cell: the cell's own phase color mixed over white,
 * deeper as the count rises. Returns null for an empty cell. Color comes from
 * the fixed phase palette (data color), never the tenant brand color.
 */
export function cellTint(phaseColor: string, count: number): string | null {
  const step = densityStep(count);
  if (step === 0) return null;
  return `color-mix(in srgb, ${phaseColor} ${STEP_MIX_PCT[step]}%, white)`;
}

export function formatFreshness(isoDate: string | null, now: Date): string | null {
  if (!isoDate) return null;
  const then = new Date(isoDate);
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return 'Updated just now';

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'Updated just now';
  if (hours < 24) return `Updated ${hours}h ago`;

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 7) return `Updated ${days}d ago`;

  const month = then.toLocaleString('en-US', { month: 'short' });
  const day = then.getDate();
  return `Updated ${month} ${day}`;
}

@Component({
  selector: 'app-density-matrix',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'onEscape()',
  },
  styles: `
    :host {
      display: block;
      width: 100%;
    }

    .matrix-header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 12px;
    }

    .matrix-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--slate-900);
    }

    .matrix-subtitle {
      font-size: 12px;
      color: var(--slate-400);
    }

    .matrix-freshness {
      margin-left: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      color: var(--slate-400);
      letter-spacing: 0.06em;
    }

    .matrix-wrap {
      background: white;
      border: 1px solid var(--slate-200);
      overflow: hidden;
    }

    table.matrix {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    table.matrix col.row-label-col {
      width: 200px;
    }

    table.matrix col.phase-col {
      width: auto;
    }

    table.matrix col.total-col {
      width: 64px;
    }

    table.matrix thead th {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      font-weight: 600;
      color: var(--slate-500);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 9px 6px;
      text-align: center;
      border-bottom: 2px solid var(--slate-200);
      background: var(--slate-50);
      position: sticky;
      top: 0;
      z-index: 2;
    }

    table.matrix thead th:first-child {
      text-align: left;
      padding-left: 14px;
    }

    table.matrix thead th:last-child {
      border-left: 2px solid var(--slate-200);
    }

    table.matrix thead th .phase-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      margin-right: 3px;
      vertical-align: middle;
      position: relative;
      top: -0.5px;
    }

    table.matrix thead th.sortable {
      cursor: pointer;
      user-select: none;
    }

    table.matrix thead th.sortable:hover {
      color: var(--slate-700);
    }

    /* Tenant brand color marks the active sort column -- brand lives on the
       interactive chrome, never on the data cells. */
    table.matrix thead th.sortable.sorted {
      color: var(--brand-700);
    }

    .sort-arrow {
      font-size: 8px;
      margin-left: 2px;
      opacity: 0.5;
    }

    table.matrix tbody tr {
      cursor: pointer;
      transition: background 0.1s;
      outline: none;
    }

    table.matrix tbody tr:hover {
      background: var(--slate-50);
    }

    table.matrix tbody tr.selected {
      background: var(--brand-50);
    }

    table.matrix tbody tr.selected td:first-child {
      border-left: 3px solid var(--brand-600);
      padding-left: 11px;
    }

    table.matrix tbody td {
      padding: 0;
      height: 40px;
      border-bottom: 1px solid var(--slate-100);
      text-align: center;
      vertical-align: middle;
    }

    table.matrix tbody td:first-child {
      text-align: left;
      padding-left: 14px;
      border-left: 3px solid transparent;
    }

    table.matrix tbody td:last-child {
      border-left: 2px solid var(--slate-200);
    }

    .row-label-text {
      font-size: 13px;
      font-weight: 500;
      color: var(--slate-800);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
      max-width: 180px;
    }

    .row-label-sub {
      font-size: 10px;
      color: var(--slate-400);
      margin-top: 1px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .heat-cell {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      padding: 3px;
    }

    .heat-pip {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      transition: all 0.12s;
      /* Background is the cell's phase hue, applied inline per cell. Tints stay
         light enough that this dark text holds WCAG AA contrast on every hue. */
      color: var(--slate-900);
    }

    .heat-pip.empty {
      background: transparent;
    }

    .heat-pip.empty::after {
      content: '';
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--slate-200);
    }

    .total-cell {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      color: var(--slate-900);
      font-variant-numeric: tabular-nums;
    }
  `,
  template: `
    <div class="matrix-header">
      <div class="matrix-title">Competitive Density</div>
      <div class="matrix-subtitle">
        {{ rows().length }} {{ rows().length === 1 ? 'group' : 'groups' }} across
        {{ phases().length }} phases
      </div>
      @if (freshnessText()) {
        <div class="matrix-freshness">{{ freshnessText() }}</div>
      }
    </div>

    <div class="matrix-wrap">
      <table
        class="matrix"
        role="grid"
        aria-label="Competitive density by development phase; cell color marks the phase, shade marks the count"
      >
        <colgroup>
          <col class="row-label-col" />
          @for (phase of phases(); track phase) {
            <col class="phase-col" />
          }
          <col class="total-col" />
        </colgroup>
        <thead>
          <tr>
            <th
              class="sortable"
              [class.sorted]="sortField() === 'name'"
              role="columnheader"
              [attr.aria-sort]="
                sortField() === 'name' ? (sortDir() === 'asc' ? 'ascending' : 'descending') : 'none'
              "
              (click)="onSortClick('name')"
            >
              Group
              @if (sortField() === 'name') {
                <span class="sort-arrow">{{ sortDir() === 'asc' ? '▲' : '▼' }}</span>
              }
            </th>
            @for (phase of phases(); track phase) {
              <th role="columnheader">
                <span class="phase-dot" [style.background]="phaseColor(phase)"></span
                >{{ phaseShort(phase) }}
              </th>
            }
            <th
              class="sortable"
              [class.sorted]="sortField() === 'total'"
              role="columnheader"
              [attr.aria-sort]="
                sortField() === 'total'
                  ? sortDir() === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              "
              (click)="onSortClick('total')"
            >
              Total
              @if (sortField() === 'total') {
                <span class="sort-arrow">{{ sortDir() === 'asc' ? '▲' : '▼' }}</span>
              }
            </th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.bubble.label) {
            <tr
              [class.selected]="selectedBubble() === row.bubble"
              [attr.aria-selected]="selectedBubble() === row.bubble"
              tabindex="0"
              (click)="onRowClick(row.bubble)"
              (keydown.enter)="onRowClick(row.bubble)"
              (keydown.space)="onRowClick(row.bubble); $event.preventDefault()"
            >
              <td>
                <span class="row-label-text">{{ row.bubble.label }}</span>
                <div class="row-label-sub">
                  {{ row.bubble.competitor_count }}
                  {{ row.bubble.competitor_count === 1 ? 'company' : 'companies' }}
                </div>
              </td>
              @for (cell of row.cells; track cell.phase) {
                <td>
                  <div class="heat-cell">
                    @if (cell.count === 0) {
                      <div class="heat-pip empty" aria-hidden="true"></div>
                    } @else {
                      <div class="heat-pip" [style.background-color]="cell.background">
                        {{ cell.count }}
                      </div>
                    }
                  </div>
                </td>
              }
              <td class="total-cell">{{ row.total }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class DensityMatrixComponent {
  readonly bubbles = input.required<DensityBubble[]>();
  readonly countUnit = input<CountUnit>('assets');
  readonly selectedBubble = input<DensityBubble | null>(null);
  readonly sortField = input<SortField>('total');
  readonly sortDir = input<'asc' | 'desc'>('desc');
  readonly latestEventDate = input<string | null>(null);
  /** When false, the preclinical column is omitted (space does not track it). */
  readonly showPreclinical = input(true);

  readonly rowClick = output<DensityBubble>();
  readonly sortChange = output<SortEvent>();

  readonly phases = computed(() => visibleRingOrder(this.showPreclinical()));

  protected readonly freshnessText = computed(() =>
    formatFreshness(this.latestEventDate(), new Date())
  );

  protected readonly rows = computed<MatrixRow[]>(() => {
    const bubbles = this.bubbles();
    const field = this.sortField();
    const dir = this.sortDir();

    const rows: MatrixRow[] = bubbles.map((bubble) => {
      const cells: MatrixCell[] = this.phases().map((phase) => {
        const count = bubble.phase_counts[phase] ?? 0;
        return {
          phase,
          count,
          background: cellTint(PHASE_COLOR[phase], count),
        };
      });
      return { bubble, cells, total: bubble.unit_count };
    });

    rows.sort((a, b) => {
      let cmp = 0;
      switch (field) {
        case 'total':
          cmp = a.total - b.total;
          break;
        case 'phase':
          cmp = a.bubble.highest_phase_rank - b.bubble.highest_phase_rank;
          if (cmp === 0) cmp = a.total - b.total;
          break;
        case 'name':
          cmp = a.bubble.label.localeCompare(b.bubble.label);
          break;
      }
      return dir === 'asc' ? cmp : -cmp;
    });

    return rows;
  });

  protected phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase];
  }

  protected phaseShort(phase: RingPhase): string {
    return PHASE_SHORT[phase];
  }

  protected onRowClick(bubble: DensityBubble): void {
    this.rowClick.emit(bubble);
  }

  protected onSortClick(field: SortField): void {
    const currentField = this.sortField();
    const currentDir = this.sortDir();
    const newDir = field === currentField && currentDir === 'desc' ? 'asc' : 'desc';
    this.sortChange.emit({ field, dir: newDir });
  }

  protected onEscape(): void {
    this.rowClick.emit(undefined as unknown as DensityBubble);
  }
}
