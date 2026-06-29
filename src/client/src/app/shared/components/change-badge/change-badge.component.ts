import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { badgeTooltip } from './change-badge.logic';

/**
 * Small neutral dot next to a trial/asset with change-feed activity in the
 * unified 14-day window. count === 0 renders nothing. When an `eventId`
 * (a trial_change_events id) is provided, the dot becomes a button that
 * navigates to that event in the feed; otherwise it is a non-interactive dot.
 * Callers bind recent_changes_count / most_recent_change_type /
 * most_recent_change_event_id from get_dashboard_data / get_bullseye_assets.
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
  readonly eventId = input<string | null>(null);

  readonly dotClass = 'inline-block w-2 h-2 rounded-full bg-slate-400';
  readonly tooltip = computed(() => badgeTooltip(this.count(), this.type()));
  readonly clickable = computed(() => !!this.eventId());

  protected openEvent(event: MouseEvent): void {
    event.stopPropagation();
    // navigation to /events removed (Stage-3 cutover); Stage 3 will re-route to /activity
  }
}
