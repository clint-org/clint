import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import {
  BullseyeSpoke,
  PHASE_COLOR,
  visibleRingOrder,
  RingPhase,
  SpokeGrouping,
  SPOKE_GROUPING_OPTIONS,
  spokeGroupingNoun,
} from '../../core/models/landscape.model';
import { LandscapeStateService } from './landscape-state.service';
import { buildLandscapeRead, fromSpokes } from './competitive-read/index';
import { CompetitiveReadStripComponent } from './competitive-read/competitive-read-strip.component';
import { SegmentedControlComponent } from '../../shared/components/segmented-control/segmented-control.component';
import { PiMarkComponent } from '../../shared/components/pi-mark/pi-mark.component';

@Component({
  selector: 'app-bullseye-controls-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SegmentedControlComponent, CompetitiveReadStripComponent, PiMarkComponent],
  template: `
    <aside class="bullseye-controls">
      <!-- Section: Group By -->
      <div class="controls-section">
        <div class="section-label">GROUP BY</div>
        <app-segmented-control
          ariaLabel="Group bullseye by"
          [options]="groupingOptions"
          [value]="state.spokeGrouping()"
          (valueChange)="onGroupingChange($event)"
        />
      </div>

      <!-- Section: Competitive read (auto-generated narration) -->
      <div class="controls-section">
        <div class="section-label">AT A GLANCE</div>
        @if (read().text) {
          <app-competitive-read-strip class="read-content" [read]="read()" />
        }
      </div>

      <!-- Section: Stats -->
      <div class="controls-section">
        <div class="section-label">STATS</div>
        <div class="stats-grid" [class.stats-grid--single]="singleStat()">
          @if (!singleStat()) {
            <div class="stat">
              <span class="stat-value">{{ spokeCount() }}</span>
              <span class="stat-label">{{ spokeNoun() }}</span>
            </div>
          }
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
          @for (phase of phases(); track phase.value) {
            <div class="legend-item">
              <span class="legend-dot" [style.background]="phase.color"></span>
              <span>{{ phase.label }}</span>
            </div>
          }
          <div class="legend-divider"></div>
          <div class="legend-item">
            <app-pi-mark [size]="12" />
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
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #94a3b8;
    }

    .read-content {
      font-size: 12px;
      color: var(--slate-600, #475569);
      line-height: 1.6;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .stats-grid--single {
      grid-template-columns: 1fr;
    }

    .stat {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 9px 10px;
      border: 1px solid #e2e8f0;
    }

    .stat-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 18px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1;
      color: #0f172a;
    }

    .stat-label {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
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

    .legend-activity {
      border: 2px solid #f97316;
      background: transparent;
    }

    .legend-duplicate {
      border: 2px dashed #94a3b8;
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

  protected onGroupingChange(grouping: string): void {
    this.state.spokeGrouping.set(grouping as SpokeGrouping);
  }

  /** Domain noun for the spoke count, e.g. "companies" under company grouping. */
  protected readonly spokeNoun = computed(() =>
    spokeGroupingNoun(this.grouping(), this.spokeCount())
  );

  // When grouping by asset, the spoke count and the asset count are the same
  // number with the same noun ("N assets" twice). Collapse to a single box.
  protected readonly singleStat = computed(() => this.grouping() === 'asset');

  // Ring legend narrowed to the space's tracked phases. PRECLIN drops out when
  // the space does not track preclinical, matching the rings the server returns.
  protected readonly phases = computed<{ value: RingPhase; label: string; color: string }[]>(() =>
    visibleRingOrder(this.state.showPreclinical()).map((phase) => ({
      value: phase,
      label: this.formatPhase(phase),
      color: PHASE_COLOR[phase],
    }))
  );

  protected readonly read = computed(() =>
    buildLandscapeRead({
      view: 'radial',
      groupBy: this.grouping(),
      stats: fromSpokes(this.spokes()),
    })
  );

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
