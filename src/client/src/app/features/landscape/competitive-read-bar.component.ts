import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { BullseyeSpoke, SpokeGrouping } from '../../core/models/landscape.model';
import { buildLandscapeRead, fromSpokes } from './competitive-read/index';

@Component({
  selector: 'app-competitive-read-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (readText()) {
      <div class="read-bar">
        <span class="read-label">READ</span>
        <span class="read-content" [innerHTML]="readText()"></span>
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

    :host ::ng-deep .read-content strong {
      color: var(--slate-800, #1e293b);
      font-weight: 600;
    }

    :host ::ng-deep .read-content strong.leader-name {
      color: var(--teal-600, #0d9488);
    }
  `,
})
export class CompetitiveReadBarComponent {
  readonly spokes = input<BullseyeSpoke[]>([]);
  readonly grouping = input<SpokeGrouping>('company');

  readonly readText = computed<string>(() => {
    const result = buildLandscapeRead({
      view: 'radial',
      groupBy: this.grouping(),
      stats: fromSpokes(this.spokes()),
    });
    return result.text;
  });
}
