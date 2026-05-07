import type { ChangeEvent, ChangeEventType } from '../../core/models/change-event.model';
import { PHASE_COLORS } from '../../core/models/phase-colors';
import { MARKER_FIELD_LABELS, formatDateRange, formatShortDate } from './marker-fields';

/**
 * A typed summary fragment for a change event row. The row template renders
 * `old` with strikethrough, `new` bold (and color-tinted when the event has a
 * color), `arrow` as a → glyph, `muted` in slate-500, and `plain` inheriting
 * the row body color. Used by the activity feed, the engagement-landing
 * what-changed widget, and (eventually) the trial-detail Activity card.
 */
export type SummarySegment =
  | { kind: 'plain'; text: string }
  | { kind: 'old'; text: string }
  | { kind: 'new'; text: string }
  | { kind: 'arrow' }
  | { kind: 'muted'; text: string };

export interface RichSummary {
  segments: SummarySegment[];
  /**
   * CSS color (hex) for the icon and `new` segments. Null = slate-700 default.
   * Comes from PHASE_COLORS for phase_transitioned, or marker_color (joined in
   * get_activity_feed) for marker_* events. All other event types are slate.
   */
  color: string | null;
}

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

/**
 * Pick the destination phase color for a phase_transitioned event. payload.to
 * is an array of phase keys (single phase or "P2/P3" combo); we color by the
 * deepest / last phase in the array, matching how the phase bar reads.
 */
function phaseColorFor(toRaw: unknown): string | null {
  if (!Array.isArray(toRaw) || toRaw.length === 0) return null;
  const last = toRaw[toRaw.length - 1];
  if (typeof last !== 'string') return null;
  return PHASE_COLORS[last] ?? null;
}

/**
 * Structured version of summaryFor: returns segments the row template can
 * render with strikethrough on `old` and bold/colored on `new`, plus a color
 * for the icon and `new` segments. Color comes from PHASE_COLORS for phase
 * transitions and marker_color for marker_* events; everything else is slate
 * (color === null).
 */
export function summarySegmentsFor(e: ChangeEvent): RichSummary {
  const p = e.payload;
  const isMarker =
    e.event_type === 'marker_added' ||
    e.event_type === 'marker_removed' ||
    e.event_type === 'marker_updated' ||
    e.event_type === 'marker_reclassified';
  const color =
    e.event_type === 'phase_transitioned'
      ? phaseColorFor(p['to'])
      : isMarker
        ? e.marker_color
        : null;

  switch (e.event_type) {
    case 'status_changed':
      return {
        color,
        segments: [
          { kind: 'plain', text: 'Status: ' },
          { kind: 'old', text: String(p['from'] ?? '') },
          { kind: 'arrow' },
          { kind: 'new', text: String(p['to'] ?? '') },
        ],
      };
    case 'date_moved': {
      const which = String(p['which_date'] ?? '');
      const label = WHICH_DATE_LABEL[which] ?? 'Date';
      const direction = p['direction'] === 'accelerate' ? 'pulled forward' : 'delayed';
      const daysRaw = p['days_diff'];
      const days = typeof daysRaw === 'number' ? Math.abs(daysRaw) : null;
      const magnitude = days !== null ? ` ${pluralDays(days)}` : '';
      const fromStr = typeof p['from'] === 'string' ? formatShortDate(p['from']) : '?';
      const toStr = typeof p['to'] === 'string' ? formatShortDate(p['to']) : '?';
      return {
        color,
        segments: [
          { kind: 'plain', text: `${label} ${direction}${magnitude} (` },
          { kind: 'old', text: fromStr },
          { kind: 'arrow' },
          { kind: 'new', text: toStr },
          { kind: 'plain', text: ')' },
        ],
      };
    }
    case 'phase_transitioned': {
      const from = (p['from'] as string[] | undefined)?.join('/') ?? '';
      const to = (p['to'] as string[] | undefined)?.join('/') ?? '';
      return {
        color,
        segments: [
          { kind: 'plain', text: 'Phase: ' },
          { kind: 'old', text: from },
          { kind: 'arrow' },
          { kind: 'new', text: to },
        ],
      };
    }
    case 'enrollment_target_changed':
      return {
        color,
        segments: [
          { kind: 'plain', text: 'Enrollment target: ' },
          { kind: 'old', text: String(p['from'] ?? '') },
          { kind: 'arrow' },
          { kind: 'new', text: String(p['to'] ?? '') },
          { kind: 'muted', text: ` (${p['percent_change']}%)` },
        ],
      };
    case 'arm_added':
      return {
        color,
        segments: p['arm_label']
          ? [
              { kind: 'plain', text: 'Arm added: ' },
              { kind: 'new', text: String(p['arm_label']) },
            ]
          : [{ kind: 'plain', text: 'Arm added' }],
      };
    case 'arm_removed':
      return {
        color,
        segments: p['arm_label']
          ? [
              { kind: 'plain', text: 'Arm removed: ' },
              { kind: 'old', text: String(p['arm_label']) },
            ]
          : [{ kind: 'plain', text: 'Arm removed' }],
      };
    case 'intervention_changed':
      return {
        color,
        segments: p['arm_label']
          ? [
              { kind: 'plain', text: 'Intervention changed: ' },
              { kind: 'plain', text: String(p['arm_label']) },
            ]
          : [{ kind: 'plain', text: 'Intervention changed' }],
      };
    case 'outcome_measure_changed':
      return {
        color,
        segments: p['measure_name']
          ? [
              { kind: 'plain', text: 'Outcome measure changed: ' },
              { kind: 'plain', text: String(p['measure_name']) },
            ]
          : [{ kind: 'plain', text: 'Outcome measure changed' }],
      };
    case 'sponsor_changed':
      return {
        color,
        segments: [
          { kind: 'plain', text: 'Sponsor: ' },
          { kind: 'old', text: String(p['from'] ?? '') },
          { kind: 'arrow' },
          { kind: 'new', text: String(p['to'] ?? '') },
        ],
      };
    case 'eligibility_criteria_changed':
    case 'eligibility_changed':
      return { color, segments: [{ kind: 'plain', text: 'Eligibility criteria changed' }] };
    case 'trial_withdrawn':
      return {
        color,
        segments: [
          {
            kind: 'plain',
            text: `Trial withdrawn from CT.gov (last seen ${p['last_seen_post_date']})`,
          },
        ],
      };
    case 'marker_added':
      return {
        color,
        segments: e.marker_title
          ? [
              { kind: 'plain', text: 'Marker added: ' },
              { kind: 'new', text: e.marker_title },
            ]
          : [{ kind: 'plain', text: 'Marker added' }],
      };
    case 'marker_removed':
      return {
        color,
        segments: e.marker_title
          ? [
              { kind: 'plain', text: 'Marker removed: ' },
              { kind: 'old', text: e.marker_title },
            ]
          : [{ kind: 'plain', text: 'Marker removed' }],
      };
    case 'marker_updated': {
      const raw = (p['changed_fields'] as string[] | undefined) ?? [];
      const fields = raw
        .map((f) => MARKER_FIELD_LABELS[f] ?? f.replace(/_/g, ' '))
        .map((label) => label.charAt(0).toLowerCase() + label.slice(1))
        .join(', ');
      return {
        color,
        segments: fields
          ? [
              { kind: 'plain', text: 'Marker edited: ' },
              { kind: 'plain', text: fields },
            ]
          : [{ kind: 'plain', text: 'Marker edited' }],
      };
    }
    case 'marker_reclassified':
      return { color, segments: [{ kind: 'plain', text: 'Reclassified' }] };
    case 'projection_finalized':
      return {
        color,
        segments: [
          { kind: 'plain', text: 'Projection: ' },
          { kind: 'old', text: 'projected' },
          { kind: 'arrow' },
          { kind: 'new', text: 'actual' },
        ],
      };
    default:
      return { color: null, segments: [{ kind: 'plain', text: e.event_type as ChangeEventType }] };
  }
}
