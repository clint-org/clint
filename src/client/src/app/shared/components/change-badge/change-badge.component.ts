import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

const PRIORITY_TYPES = new Set<string>(['date_moved', 'phase_transitioned', 'trial_withdrawn']);

const TYPE_LABELS: Record<string, string> = {
  status_changed: 'Status changed',
  date_moved: 'Date moved',
  phase_transitioned: 'Phase transitioned',
  enrollment_target_changed: 'Enrollment target changed',
  arm_added: 'Arm added',
  arm_removed: 'Arm removed',
  intervention_changed: 'Intervention changed',
  outcome_measure_changed: 'Outcome measure changed',
  sponsor_changed: 'Sponsor changed',
  eligibility_criteria_changed: 'Eligibility criteria changed',
  eligibility_changed: 'Eligibility changed',
  trial_withdrawn: 'Trial withdrawn',
  marker_added: 'Marker added',
  projection_finalized: 'Projection finalized',
  marker_reclassified: 'Marker reclassified',
  marker_updated: 'Marker updated',
  marker_removed: 'Marker removed',
};

/**
 * Small dot rendered next to a trial name when that trial has had any
 * change-feed events in the last 7 days. Three visual states:
 *   - count === 0 -> nothing renders
 *   - non-priority type -> slate-400 dot
 *   - priority type    -> red-500 dot
 *
 * Priority types are the "analyst needs to act" set: date_moved,
 * phase_transitioned, trial_withdrawn. The component is purely
 * presentational: count and type are inputs, no data fetching of its own.
 * Callers bind the `recent_changes_count` and `most_recent_change_type`
 * fields surfaced by `get_dashboard_data`.
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

  readonly isPriority = computed(() => {
    const t = this.type();
    return t != null && PRIORITY_TYPES.has(t);
  });

  readonly dotClass = computed(() => {
    const color = this.isPriority() ? 'bg-red-500' : 'bg-slate-400';
    return `inline-block w-2 h-2 rounded-full ${color}`;
  });

  readonly tooltip = computed(() => {
    const n = this.count();
    if (n <= 0) return '';
    const t = this.type();
    const label = t ? (TYPE_LABELS[t] ?? t.replace(/_/g, ' ')) : null;
    const prefix = this.isPriority() ? 'Priority update in last 7 days' : 'Recent change';
    const head = label ? `${prefix}: ${label}` : prefix;
    if (n === 1) return head;
    const noun = n === 2 ? 'other change' : 'other changes';
    return `${head} (+${n - 1} ${noun})`;
  });
}
