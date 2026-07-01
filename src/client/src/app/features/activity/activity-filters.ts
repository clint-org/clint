import { ChangeEventSource, ChangeEventType } from '../../core/models/change-event.model';

/**
 * Pure filter-option data + label helpers for the Activity page's Source and
 * Type column filters. Kept free of Angular DI so it can be unit-tested in the
 * plain-node units runner. The Activity feed is detected-only, so these options
 * enumerate the `trial_change_events` source and event_type domains; the grid
 * maps a selection to `p_change_sources` / `p_change_event_types` via
 * buildServerQuery, and get_events_page_data applies them server-side.
 */

/** Source-of-change options: registry feed, analyst edit, or article import. */
export const ACTIVITY_SOURCE_OPTIONS: { label: string; value: ChangeEventSource }[] = [
  { label: 'CT.gov', value: 'ctgov' },
  { label: 'Analyst', value: 'analyst' },
  { label: 'Import', value: 'source_import' },
];

// The marker_* change types are internal discriminators; "marker" is retired
// from user-facing copy, so they read as "Event ...", matching the change
// summary text and the row's Type cell.
const CHANGE_TYPE_LABELS: Record<string, string> = {
  marker_added: 'Event added',
  marker_removed: 'Event removed',
  marker_updated: 'Event edited',
  marker_reclassified: 'Event reclassified',
};

/** Humanized change-type label, e.g. "date_moved" -> "Date moved". */
export function changeTypeLabel(type: string | null): string {
  if (!type) return '--';
  if (CHANGE_TYPE_LABELS[type]) return CHANGE_TYPE_LABELS[type];
  const spaced = type.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// The full detected change-type taxonomy (mirrors ChangeEventType). Listed
// statically so the Type filter is a stable, predictable enum rather than one
// that shifts with whatever happens to be on the current page.
const ALL_CHANGE_EVENT_TYPES: ChangeEventType[] = [
  'status_changed',
  'date_moved',
  'phase_transitioned',
  'enrollment_target_changed',
  'arm_added',
  'arm_removed',
  'intervention_changed',
  'outcome_measure_changed',
  'sponsor_changed',
  'eligibility_criteria_changed',
  'eligibility_changed',
  'trial_withdrawn',
  'trial_restored',
  'marker_added',
  'projection_finalized',
  'marker_reclassified',
  'marker_updated',
  'marker_removed',
];

/** Change-type options for the Type column filter, sorted by display label. */
export const ACTIVITY_TYPE_OPTIONS: { label: string; value: ChangeEventType }[] =
  ALL_CHANGE_EVENT_TYPES.map((t) => ({ label: changeTypeLabel(t), value: t })).sort((a, b) =>
    a.label.localeCompare(b.label)
  );
