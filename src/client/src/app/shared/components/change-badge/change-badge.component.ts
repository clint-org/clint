import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { badgeTooltip } from './change-badge.logic';

/**
 * Small neutral dot rendered next to a trial or asset that has had any
 * change-feed activity in the unified recent window (14 days, computed
 * server-side). count === 0 renders nothing. Purely presentational: count and
 * type are inputs, no data fetching of its own. Callers bind the
 * recent_changes_count and most_recent_change_type fields surfaced by
 * get_dashboard_data / get_bullseye_assets.
 *
 * See docs/superpowers/specs/2026-05-29-unified-recent-change-indicator-design.md.
 */
@Component({
  selector: 'app-change-badge',
  standalone: true,
  imports: [TooltipModule],
  templateUrl: './change-badge.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangeBadgeComponent {
  readonly count = input.required<number>();
  readonly type = input<string | null>(null);

  readonly dotClass = 'inline-block w-2 h-2 rounded-full bg-slate-400';

  readonly tooltip = computed(() => badgeTooltip(this.count(), this.type()));
}
