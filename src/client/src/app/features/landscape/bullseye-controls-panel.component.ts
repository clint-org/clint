import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import {
  BullseyeSpoke,
  PHASE_COLOR,
  RING_ORDER,
  RingPhase,
  SpokeGrouping,
  SPOKE_GROUPING_OPTIONS,
} from '../../core/models/landscape.model';
import { LandscapeStateService } from './landscape-state.service';
import { buildLandscapeRead, fromSpokes } from './competitive-read/index';

@Component({
  selector: 'app-bullseye-controls-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="bullseye-controls">
      <!-- Section: Group By -->
      <div class="controls-section">
        <div class="section-label">GROUP BY</div>
        <div class="group-buttons">
          @for (opt of groupingOptions; track opt.value) {
            <button
              type="button"
              [class.active]="state.spokeGrouping() === opt.value"
              (click)="state.spokeGrouping.set(opt.value)"
            >
              {{ opt.label }}
            </button>
          }
        </div>
      </div>

      <!-- Section: Competitive Read -->
      <div class="controls-section">
        <div class="section-label">READ</div>
        @if (readText()) {
          <span class="read-content" [innerHTML]="readText()"></span>
        }
      </div>

      <!-- Section: Stats -->
      <div class="controls-section">
        <div class="section-label">STATS</div>
        <div class="stats-grid">
          <div class="stat">
            <span class="stat-value">{{ spokeCount() }}</span>
            <span class="stat-label">spokes</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ assetCount() }}</span>
            <span class="stat-label">assets</span>
          </div>
        </div>
      </div>

      <!-- Section: Legend -->
      <div class="controls-section">
        <div class="section-label">LEGEND</div>
        <div class="legend-items">
          @for (phase of phases; track phase.value) {
            <div class="legend-item">
              <span class="legend-dot" [style.background]="phase.color"></span>
              <span>{{ phase.label }}</span>
            </div>
          }
          <div class="legend-divider"></div>
          <div class="legend-item">
            <span class="legend-indicator legend-intel"></span>
            <span>Intelligence attached</span>
          </div>
          <div class="legend-item">
            <span class="legend-indicator legend-activity"></span>
            <span>Recent activity</span>
          </div>
          @if (hasDuplicates()) {
            <div class="legend-item">
              <span class="legend-indicator legend-duplicate"></span>
              <span>Multiple spokes</span>
            </div>
          }
        </div>
      </div>
    </aside>
  `,
  styles: `
    .bullseye-controls {
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
      border-color: #2dd4bf;
      background: #f0fdfa;
      color: #0d9488;
      font-weight: 600;
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
      color: var(--teal-600, #0d9488);
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

    .legend-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .legend-intel {
      border: 2px solid #0d9488;
      background: transparent;
    }

    .legend-activity {
      border: 2px solid #f59e0b;
      background: transparent;
    }

    .legend-duplicate {
      border: 2px dashed #475569;
      background: transparent;
    }
  `,
})
export class BullseyeControlsPanelComponent {
  protected readonly state = inject(LandscapeStateService);

  readonly spokes = input<BullseyeSpoke[]>([]);
  readonly grouping = input<SpokeGrouping>('company');
  readonly assetCount = input(0);
  readonly spokeCount = input(0);
  readonly hasDuplicates = input(false);

  protected readonly groupingOptions = SPOKE_GROUPING_OPTIONS;

  protected readonly phases: { value: RingPhase; label: string; color: string }[] = RING_ORDER.map(
    (phase) => ({
      value: phase,
      label: this.formatPhase(phase),
      color: PHASE_COLOR[phase],
    })
  );

  protected readonly readText = computed<string>(() => {
    const result = buildLandscapeRead({
      view: 'radial',
      groupBy: this.grouping(),
      stats: fromSpokes(this.spokes()),
    });
    return result.text;
  });

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
