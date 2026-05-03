import type { ChangeEvent, ChangeEventType } from '../../core/models/change-event.model';

/**
 * Render a short, human-readable summary line for a change event. Used by
 * the activity-page row, the engagement-landing what-changed widget, and
 * the system_update branch of the intelligence feed.
 */
export function summaryFor(e: ChangeEvent): string {
  const p = e.payload;
  switch (e.event_type) {
    case 'status_changed':
      return `Status: ${p['from']} -> ${p['to']}`;
    case 'date_moved':
      return `${p['which_date']} ${p['direction']} ${p['days_diff']}d (${p['from']} -> ${p['to']})`;
    case 'phase_transitioned': {
      const from = (p['from'] as string[] | undefined)?.join('/') ?? '';
      const to = (p['to'] as string[] | undefined)?.join('/') ?? '';
      return `Phase: ${from} -> ${to}`;
    }
    case 'enrollment_target_changed':
      return `Enrollment: ${p['from']} -> ${p['to']} (${p['percent_change']}%)`;
    case 'arm_added':
      return `Arm added: ${p['arm_label']}`;
    case 'arm_removed':
      return `Arm removed: ${p['arm_label']}`;
    case 'intervention_changed':
      return `Intervention changed: ${p['arm_label'] ?? ''}`.trim();
    case 'outcome_measure_changed':
      return `Outcome measure changed: ${p['measure_name'] ?? ''}`.trim();
    case 'sponsor_changed':
      return `Sponsor: ${p['from']} -> ${p['to']}`;
    case 'eligibility_criteria_changed':
    case 'eligibility_changed':
      return `Eligibility criteria changed`;
    case 'trial_withdrawn':
      return `Trial withdrawn from CT.gov (last seen ${p['last_seen_post_date']})`;
    case 'marker_added':
      return `Marker added${e.marker_title ? `: ${e.marker_title}` : ''}`;
    case 'marker_removed':
      return `Marker removed${e.marker_title ? `: ${e.marker_title}` : ''}`;
    case 'marker_updated': {
      const fields = (p['changed_fields'] as string[] | undefined)?.join(', ') ?? '';
      return `Updated: ${fields}`;
    }
    case 'marker_reclassified':
      return `Reclassified`;
    case 'projection_finalized':
      return `Projected -> Actual`;
    default:
      return e.event_type as ChangeEventType;
  }
}
