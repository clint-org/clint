import type { ChangeEvent, ChangeEventType } from '../../core/models/change-event.model';
import { MARKER_FIELD_LABELS, formatDateRange } from './marker-fields';

// which_date is the trial-level date that moved (or `event_date` for a
// marker's anchor date). Marker-level fields read through MARKER_FIELD_LABELS
// so the label matches the history pane and edit form.
const WHICH_DATE_LABEL: Record<string, string> = {
  event_date: MARKER_FIELD_LABELS['event_date'],
  start: 'Trial start',
  primary_completion: 'Primary completion',
  study_completion: 'Study completion',
};

function pluralDays(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/**
 * Render a short, human-readable summary line for a change event. Used by
 * the activity-page row, the engagement-landing what-changed widget, and
 * the system_update branch of the intelligence feed.
 */
export function summaryFor(e: ChangeEvent): string {
  const p = e.payload;
  switch (e.event_type) {
    case 'status_changed':
      return `Status: ${p['from']} → ${p['to']}`;
    case 'date_moved': {
      const which = String(p['which_date'] ?? '');
      const label = WHICH_DATE_LABEL[which] ?? 'Date';
      const direction = p['direction'] === 'accelerate' ? 'pulled forward' : 'delayed';
      const daysRaw = p['days_diff'];
      const days = typeof daysRaw === 'number' ? Math.abs(daysRaw) : null;
      const range = formatDateRange(p['from'], p['to']);
      const magnitude = days !== null ? ` ${pluralDays(days)}` : '';
      return `${label} ${direction}${magnitude} (${range})`;
    }
    case 'phase_transitioned': {
      const from = (p['from'] as string[] | undefined)?.join('/') ?? '';
      const to = (p['to'] as string[] | undefined)?.join('/') ?? '';
      return `Phase: ${from} → ${to}`;
    }
    case 'enrollment_target_changed':
      return `Enrollment target: ${p['from']} → ${p['to']} (${p['percent_change']}%)`;
    case 'arm_added':
      return p['arm_label'] ? `Arm added: ${p['arm_label']}` : 'Arm added';
    case 'arm_removed':
      return p['arm_label'] ? `Arm removed: ${p['arm_label']}` : 'Arm removed';
    case 'intervention_changed':
      return p['arm_label'] ? `Intervention changed: ${p['arm_label']}` : 'Intervention changed';
    case 'outcome_measure_changed':
      return p['measure_name']
        ? `Outcome measure changed: ${p['measure_name']}`
        : 'Outcome measure changed';
    case 'sponsor_changed':
      return `Sponsor: ${p['from']} → ${p['to']}`;
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
      const raw = (p['changed_fields'] as string[] | undefined) ?? [];
      // Labels are Title-cased at the source; lowercased here because they
      // render inline in a comma list, not as standalone row labels.
      const fields = raw
        .map((f) => MARKER_FIELD_LABELS[f] ?? f.replace(/_/g, ' '))
        .map((label) => label.charAt(0).toLowerCase() + label.slice(1))
        .join(', ');
      return fields ? `Marker edited: ${fields}` : 'Marker edited';
    }
    case 'marker_reclassified':
      return `Reclassified`;
    case 'projection_finalized':
      return `Projected → actual`;
    default:
      return e.event_type as ChangeEventType;
  }
}
