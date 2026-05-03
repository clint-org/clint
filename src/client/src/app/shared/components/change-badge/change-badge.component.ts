import { Component, computed, input } from '@angular/core';

/**
 * Event types that should escalate the badge to the priority (red) color.
 * These are the "an analyst needs to act on this" categories: a trial date
 * has shifted, a phase transitioned, or the trial was withdrawn. All other
 * change types render the muted slate dot.
 */
const PRIORITY_TYPES = new Set<string>(['date_moved', 'phase_transitioned', 'trial_withdrawn']);

/**
 * Small dot rendered next to a trial name when that trial has had any
 * change-feed events in the last 7 days. Three visual states:
 *   - count === 0 -> nothing renders
 *   - non-priority type -> slate-400 dot
 *   - priority type    -> red-500 dot
 *
 * The component is purely presentational: count and type are inputs, no
 * data fetching of its own. Callers bind the `recent_changes_count` and
 * `most_recent_change_type` fields surfaced by `get_dashboard_data`.
 */
@Component({
  selector: 'app-change-badge',
  standalone: true,
  templateUrl: './change-badge.component.html',
})
export class ChangeBadgeComponent {
  readonly count = input.required<number>();
  readonly type = input<string | null>(null);

  readonly dotClass = computed(() => {
    const t = this.type();
    const isPriority = t != null && PRIORITY_TYPES.has(t);
    const color = isPriority ? 'bg-red-500' : 'bg-slate-400';
    return `inline-block w-2 h-2 rounded-full ${color}`;
  });

  readonly ariaLabel = computed(() => {
    const n = this.count();
    if (n <= 0) return '';
    const noun = n === 1 ? 'change' : 'changes';
    return `${n} ${noun} in last 7 days`;
  });
}
