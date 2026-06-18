import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { BullseyeSpoke, SpokeGrouping } from '../../core/models/landscape.model';
import { buildLandscapeRead, fromSpokes } from './competitive-read/index';
import { CompetitiveReadStripComponent } from './competitive-read/competitive-read-strip.component';

@Component({
  selector: 'app-competitive-read-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CompetitiveReadStripComponent],
  template: `
    @if (read().text) {
      <div class="read-bar">
        <span class="read-label">READ</span>
        <app-competitive-read-strip class="read-content" [read]="read()" />
      </div>
    }
  `,
  styles: `
    .read-bar {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 10px 24px;
      background: white;
      border-bottom: 1px solid var(--slate-200, #e2e8f0);
    }

    .read-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--slate-400, #94a3b8);
      font-family: 'JetBrains Mono', monospace;
      min-width: 72px;
    }

    .read-content {
      font-size: 12px;
      color: var(--slate-600, #475569);
      line-height: 1.6;
    }
  `,
})
export class CompetitiveReadBarComponent {
  readonly spokes = input<BullseyeSpoke[]>([]);
  readonly grouping = input<SpokeGrouping>('company');

  protected readonly read = computed(() =>
    buildLandscapeRead({
      view: 'radial',
      groupBy: this.grouping(),
      stats: fromSpokes(this.spokes()),
    })
  );
}
