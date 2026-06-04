import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import {
  COUNT_UNIT_OPTIONS,
  CountUnit,
  HEATMAP_GROUPING_OPTIONS,
  HeatmapBubble,
  HeatmapGrouping,
  PHASE_COLOR,
  visibleRingOrder,
  RingPhase,
  groupingToSegment,
} from '../../core/models/landscape.model';
import { buildLandscapeRead, fromBubbles } from './competitive-read/index';
import { cellTint } from './heatmap.component';
import { LandscapeStateService } from './landscape-state.service';

@Component({
  selector: 'app-heatmap-controls-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="heatmap-controls">
      <div class="controls-section">
        <div class="section-label">GROUP BY</div>
        <div class="group-buttons">
          @for (opt of groupingOptions; track opt.value) {
            <button
              type="button"
              [class.active]="grouping() === opt.value"
              (click)="navigateToGrouping(opt.value)"
            >
              {{ opt.label }}
            </button>
          }
        </div>
      </div>

      <div class="controls-section">
        <div class="section-label">COUNT</div>
        <div class="count-toggle">
          @for (opt of countOptions; track opt.value) {
            <button
              type="button"
              [class.active]="countUnit() === opt.value"
              (click)="state.countUnit.set(opt.value)"
            >
              {{ opt.label }}
            </button>
          }
        </div>
      </div>

      <div class="controls-section">
        <div class="section-label">READ</div>
        @if (readText()) {
          <span class="read-content" [innerHTML]="readText()"></span>
        }
      </div>

      <div class="controls-section">
        <div class="section-label">STATS</div>
        <div class="stats-grid">
          <div class="stat">
            <span class="stat-value">{{ groupCount() }}</span>
            <span class="stat-label">groups</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ totalCount() }}</span>
            <span class="stat-label">{{ countUnit() }}</span>
          </div>
        </div>
      </div>

      <div class="controls-section">
        <div class="section-label">LEGEND</div>
        <div class="legend-items">
          @for (phase of phases(); track phase.value) {
            <div class="legend-item">
              <span class="legend-dot" [style.background]="phase.color"></span>
              <span>{{ phase.label }}</span>
            </div>
          }
          <div class="legend-divider"></div>
          <div class="heatmap-scale">
            <span class="scale-label">1</span>
            @for (swatch of swatches; track $index) {
              <span class="scale-swatch" [style.background]="swatch"></span>
            }
            <span class="scale-label">10+</span>
          </div>
          <div class="scale-caption">shade = count, in each phase color</div>
          <div class="legend-item empty-cell-indicator">
            <span class="empty-dot"></span>
            <span>No assets</span>
          </div>
        </div>
      </div>
    </aside>
  `,
  styles: `
    .heatmap-controls {
      width: 260px;
      flex-shrink: 0;
      border-right: 1px solid #e2e8f0;
      background: white;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .controls-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .section-label {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #94a3b8;
    }

    .group-buttons {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .group-buttons button {
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: white;
      color: #64748b;
      font-size: 12px;
      font-weight: 500;
      text-align: left;
      cursor: pointer;
      transition: all 0.15s;
    }

    .group-buttons button:hover {
      border-color: #cbd5e1;
      color: #334155;
    }

    .group-buttons button.active {
      border-color: var(--brand-600, #0d9488);
      background: var(--brand-50, #f0fdfa);
      color: var(--brand-700, #0f766e);
      font-weight: 600;
    }

    .count-toggle {
      display: flex;
      gap: 0;
    }

    .count-toggle button {
      flex: 1;
      text-align: center;
      padding: 5px 8px;
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
      background: white;
      border: 1px solid #e2e8f0;
      cursor: pointer;
      transition: all 0.15s;
      margin-right: -1px;
    }

    .count-toggle button:last-child {
      margin-right: 0;
    }

    .count-toggle button:hover {
      color: #334155;
      z-index: 1;
    }

    .count-toggle button.active {
      border-color: var(--brand-600, #0d9488);
      background: var(--brand-50, #f0fdfa);
      color: var(--brand-700, #0f766e);
      font-weight: 600;
      z-index: 1;
    }

    .read-content {
      font-size: 12px;
      color: var(--slate-600, #475569);
      line-height: 1.6;
    }

    :host ::ng-deep .read-content strong {
      color: var(--slate-800, #1e293b);
      font-weight: 600;
    }

    :host ::ng-deep .read-content strong.leader-name {
      color: var(--brand-600, #0d9488);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .stat {
      display: flex;
      flex-direction: column;
      padding: 8px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
    }

    .stat-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
    }

    .stat-label {
      font-size: 11px;
      color: #94a3b8;
    }

    .legend-items {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: #64748b;
    }

    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .legend-divider {
      height: 1px;
      background: #f1f5f9;
      margin: 4px 0;
    }

    .heatmap-scale {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .scale-label {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 9px;
      color: #94a3b8;
      margin: 0 2px;
    }

    .scale-swatch {
      width: 20px;
      height: 10px;
    }

    .scale-caption {
      font-size: 10px;
      color: #94a3b8;
      margin-top: 4px;
    }

    .empty-cell-indicator {
      margin-top: 4px;
    }

    .empty-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #e2e8f0;
      flex-shrink: 0;
      margin-left: 1px;
    }
  `,
})
export class HeatmapControlsPanelComponent {
  protected readonly state = inject(LandscapeStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly bubbles = input<HeatmapBubble[]>([]);
  readonly grouping = input<HeatmapGrouping>('moa');
  readonly countUnit = input<CountUnit>('assets');

  protected readonly groupingOptions = HEATMAP_GROUPING_OPTIONS;
  protected readonly countOptions = COUNT_UNIT_OPTIONS;

  // Ring legend narrowed to the space's tracked phases. PRECLIN drops out when
  // the space does not track preclinical, matching the rings the server returns.
  protected readonly phases = computed<{ value: RingPhase; label: string; color: string }[]>(() =>
    visibleRingOrder(this.state.showPreclinical()).map((phase) => ({
      value: phase,
      label: this.formatPhase(phase),
      color: PHASE_COLOR[phase],
    }))
  );

  // Shade ramp: one hue, deepening with count. Built from the same cellTint()
  // the heatmap cells use (with the P3 hero teal as the representative phase) so
  // the legend swatches are literally the cell shades and cannot drift. Counts
  // span the absolute buckets cellTint maps: 1, 2, 3, 4-5, 6-9, 10+.
  protected readonly swatches = [1, 2, 3, 4, 6, 10].map(
    (count) => cellTint(PHASE_COLOR.P3, count) as string
  );

  protected readonly groupCount = computed(() => this.bubbles().length);

  protected readonly totalCount = computed(() =>
    this.bubbles().reduce((sum, b) => sum + b.unit_count, 0)
  );

  protected readonly readText = computed<string>(() => {
    const result = buildLandscapeRead({
      view: 'heatmap',
      groupBy: this.grouping(),
      stats: fromBubbles(this.bubbles()),
    });
    return result.text;
  });

  protected navigateToGrouping(grouping: HeatmapGrouping): void {
    const segment = groupingToSegment(grouping);
    this.router.navigate(['..', segment], { relativeTo: this.route });
  }

  private formatPhase(phase: RingPhase): string {
    const labels: Record<RingPhase, string> = {
      PRECLIN: 'Preclinical',
      P1: 'Phase 1',
      P2: 'Phase 2',
      P3: 'Phase 3',
      P4: 'Phase 4',
      APPROVED: 'Approved',
      LAUNCHED: 'Launched',
    };
    return labels[phase];
  }
}
