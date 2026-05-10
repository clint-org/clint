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

// Trial-side date_moved labels. Marker-side (which_date='event_date') is
// handled separately: it leads with the marker title rather than a "Date" word.
const TRIAL_DATE_LABEL: Record<string, string> = {
  start: 'Trial start',
  primary_completion: 'Primary completion',
  study_completion: 'Study completion',
};

const ELIGIBILITY_LABEL: Record<string, string> = {
  sex: 'Sex',
  minimum_age: 'Minimum age',
  maximum_age: 'Maximum age',
};

function pluralDays(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/**
 * Format a CT.gov arm/intervention type enum like "ACTIVE_COMPARATOR" as a
 * humanized suffix like "(Active Comparator)". CT.gov capitalizes these but
 * underscores them; the row body is mixed-case so we follow suit.
 */
function formatEnum(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

interface NamedItem {
  name?: unknown;
  measure?: unknown;
}

/**
 * Read an added/removed list (intervention or outcome payloads) and return the
 * display names. Outcome rows use `measure`; intervention rows use `name`.
 */
function listNames(raw: unknown, key: 'name' | 'measure'): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw as NamedItem[]) {
    const v = entry?.[key];
    if (typeof v === 'string' && v.length > 0) out.push(v);
  }
  return out;
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
      const direction = p['direction'] === 'accelerate' ? 'pulled forward' : 'delayed';
      const daysRaw = p['days_diff'];
      const days = typeof daysRaw === 'number' ? Math.abs(daysRaw) : null;
      const range = formatDateRange(p['from'], p['to']);
      const magnitude = days !== null ? ` ${pluralDays(days)}` : '';
      if (which === 'event_date' && e.marker_title) {
        return `${e.marker_title}: event date ${direction}${magnitude} (${range})`;
      }
      const label = TRIAL_DATE_LABEL[which] ?? MARKER_FIELD_LABELS[which] ?? 'Date';
      return `${label} ${direction}${magnitude} (${range})`;
    }
    case 'phase_transitioned': {
      const from = (p['from'] as string[] | undefined)?.join('/') ?? '';
      const to = (p['to'] as string[] | undefined)?.join('/') ?? '';
      return `Phase: ${from} → ${to}`;
    }
    case 'enrollment_target_changed':
      return `Enrollment target: ${p['from']} → ${p['to']} (${p['percent_change']}%)`;
    case 'arm_added': {
      const armType = formatEnum(p['arm_type']);
      const base = p['arm_label'] ? `Arm added: ${p['arm_label']}` : 'Arm added';
      return armType ? `${base} (${armType})` : base;
    }
    case 'arm_removed': {
      const armType = formatEnum(p['arm_type']);
      const base = p['arm_label'] ? `Arm removed: ${p['arm_label']}` : 'Arm removed';
      return armType ? `${base} (${armType})` : base;
    }
    case 'intervention_changed': {
      const added = listNames(p['added'], 'name');
      const removed = listNames(p['removed'], 'name');
      const parts: string[] = [];
      if (added.length) parts.push(`+${added.join(', +')}`);
      if (removed.length) parts.push(`-${removed.join(', -')}`);
      return parts.length ? `Intervention changed: ${parts.join(', ')}` : 'Intervention changed';
    }
    case 'outcome_measure_changed': {
      const kind = p['outcome_kind'] === 'secondary' ? 'Secondary' : 'Primary';
      const added = listNames(p['added'], 'measure');
      const removed = listNames(p['removed'], 'measure');
      const modified = listNames(p['modified'], 'measure');
      const parts: string[] = [];
      if (added.length) parts.push(`+${added.join(', +')}`);
      if (removed.length) parts.push(`-${removed.join(', -')}`);
      if (modified.length) parts.push(`~${modified.join(', ~')}`);
      return parts.length
        ? `${kind} outcome changed: ${parts.join(', ')}`
        : `${kind} outcome changed`;
    }
    case 'sponsor_changed':
      return `Sponsor: ${p['from']} → ${p['to']}`;
    case 'eligibility_criteria_changed':
      return 'Eligibility criteria revised';
    case 'eligibility_changed': {
      const which = String(p['which_field'] ?? '');
      const label = ELIGIBILITY_LABEL[which] ?? 'Eligibility';
      return `${label}: ${p['from']} → ${p['to']}`;
    }
    case 'trial_withdrawn':
      return `Trial withdrawn from CT.gov (last seen ${p['last_seen_post_date']})`;
    case 'marker_added': {
      const base = `Marker added${e.marker_title ? `: ${e.marker_title}` : ''}`;
      return appendMarkerContext(base, e, p);
    }
    case 'marker_removed': {
      const base = `Marker removed${e.marker_title ? `: ${e.marker_title}` : ''}`;
      return appendMarkerContext(base, e, p, 'was');
    }
    case 'marker_updated': {
      const raw = (p['changed_fields'] as string[] | undefined) ?? [];
      const fields = raw
        .map((f) => MARKER_FIELD_LABELS[f] ?? f.replace(/_/g, ' '))
        .map((label) => label.charAt(0).toLowerCase() + label.slice(1))
        .join(', ');
      return fields ? `Marker edited: ${fields}` : 'Marker edited';
    }
    case 'marker_reclassified': {
      const from = e.from_marker_type_name;
      const to = e.to_marker_type_name;
      if (from && to) return `Reclassified: ${from} → ${to}`;
      return 'Reclassified';
    }
    case 'projection_finalized':
      return appendMarkerContext('Projection: projected → actual', e, p);
    default:
      return e.event_type as ChangeEventType;
  }
}

function appendMarkerContext(
  base: string,
  e: ChangeEvent,
  payload: Record<string, unknown>,
  datePrefix = ''
): string {
  const parts: string[] = [base];
  const type = e.marker_type_name;
  if (type) parts.push(type);
  const date = typeof payload['event_date'] === 'string' ? payload['event_date'] : null;
  if (date) {
    const formatted = formatShortDate(date);
    parts.push(datePrefix ? `${datePrefix} ${formatted}` : formatted);
  }
  return parts.join(' · ');
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

function markerContextSegments(
  e: ChangeEvent,
  payload: Record<string, unknown>,
  datePrefix = ''
): SummarySegment[] {
  const segs: SummarySegment[] = [];
  const type = e.marker_type_name;
  const date = typeof payload['event_date'] === 'string' ? payload['event_date'] : null;
  if (!type && !date) return segs;
  const trailing: string[] = [];
  if (type) trailing.push(type);
  if (date) {
    const formatted = formatShortDate(date);
    trailing.push(datePrefix ? `${datePrefix} ${formatted}` : formatted);
  }
  segs.push({ kind: 'muted', text: ` · ${trailing.join(' · ')}` });
  return segs;
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
    e.event_type === 'marker_reclassified' ||
    e.event_type === 'projection_finalized' ||
    (e.event_type === 'date_moved' && e.marker_id !== null);
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
      const direction = p['direction'] === 'accelerate' ? 'pulled forward' : 'delayed';
      const daysRaw = p['days_diff'];
      const days = typeof daysRaw === 'number' ? Math.abs(daysRaw) : null;
      const magnitude = days !== null ? ` ${pluralDays(days)}` : '';
      const fromStr = typeof p['from'] === 'string' ? formatShortDate(p['from']) : '?';
      const toStr = typeof p['to'] === 'string' ? formatShortDate(p['to']) : '?';
      // marker-level: lead with marker title, then "event date {direction}"
      if (which === 'event_date' && e.marker_title) {
        return {
          color,
          segments: [
            { kind: 'plain', text: `${e.marker_title}: event date ${direction}${magnitude} (` },
            { kind: 'old', text: fromStr },
            { kind: 'arrow' },
            { kind: 'new', text: toStr },
            { kind: 'plain', text: ')' },
          ],
        };
      }
      const label = TRIAL_DATE_LABEL[which] ?? MARKER_FIELD_LABELS[which] ?? 'Date';
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
    case 'arm_added': {
      const armType = formatEnum(p['arm_type']);
      const segments: SummarySegment[] = p['arm_label']
        ? [
            { kind: 'plain', text: 'Arm added: ' },
            { kind: 'new', text: String(p['arm_label']) },
          ]
        : [{ kind: 'plain', text: 'Arm added' }];
      if (armType) segments.push({ kind: 'muted', text: ` (${armType})` });
      return { color, segments };
    }
    case 'arm_removed': {
      const armType = formatEnum(p['arm_type']);
      const segments: SummarySegment[] = p['arm_label']
        ? [
            { kind: 'plain', text: 'Arm removed: ' },
            { kind: 'old', text: String(p['arm_label']) },
          ]
        : [{ kind: 'plain', text: 'Arm removed' }];
      if (armType) segments.push({ kind: 'muted', text: ` (${armType})` });
      return { color, segments };
    }
    case 'intervention_changed': {
      const added = listNames(p['added'], 'name');
      const removed = listNames(p['removed'], 'name');
      const segments: SummarySegment[] = [{ kind: 'plain', text: 'Intervention changed: ' }];
      if (added.length === 0 && removed.length === 0) {
        return { color, segments: [{ kind: 'plain', text: 'Intervention changed' }] };
      }
      added.forEach((name, i) => {
        if (i > 0) segments.push({ kind: 'plain', text: ', ' });
        segments.push({ kind: 'new', text: `+${name}` });
      });
      if (added.length && removed.length) segments.push({ kind: 'plain', text: ', ' });
      removed.forEach((name, i) => {
        if (i > 0) segments.push({ kind: 'plain', text: ', ' });
        segments.push({ kind: 'old', text: `-${name}` });
      });
      return { color, segments };
    }
    case 'outcome_measure_changed': {
      const kind = p['outcome_kind'] === 'secondary' ? 'Secondary' : 'Primary';
      const added = listNames(p['added'], 'measure');
      const removed = listNames(p['removed'], 'measure');
      const modified = listNames(p['modified'], 'measure');
      const segments: SummarySegment[] = [{ kind: 'plain', text: `${kind} outcome changed` }];
      if (added.length === 0 && removed.length === 0 && modified.length === 0) {
        return { color, segments };
      }
      segments.push({ kind: 'plain', text: ': ' });
      added.forEach((name, i) => {
        if (i > 0) segments.push({ kind: 'plain', text: ', ' });
        segments.push({ kind: 'new', text: `+${name}` });
      });
      if (added.length && (removed.length || modified.length)) {
        segments.push({ kind: 'plain', text: ', ' });
      }
      removed.forEach((name, i) => {
        if (i > 0) segments.push({ kind: 'plain', text: ', ' });
        segments.push({ kind: 'old', text: `-${name}` });
      });
      if (removed.length && modified.length) segments.push({ kind: 'plain', text: ', ' });
      modified.forEach((name, i) => {
        if (i > 0) segments.push({ kind: 'plain', text: ', ' });
        segments.push({ kind: 'muted', text: `~${name}` });
      });
      return { color, segments };
    }
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
      return { color, segments: [{ kind: 'plain', text: 'Eligibility criteria revised' }] };
    case 'eligibility_changed': {
      const which = String(p['which_field'] ?? '');
      const label = ELIGIBILITY_LABEL[which] ?? 'Eligibility';
      return {
        color,
        segments: [
          { kind: 'plain', text: `${label}: ` },
          { kind: 'old', text: String(p['from'] ?? '') },
          { kind: 'arrow' },
          { kind: 'new', text: String(p['to'] ?? '') },
        ],
      };
    }
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
    case 'marker_added': {
      const segments: SummarySegment[] = e.marker_title
        ? [
            { kind: 'plain', text: 'Marker added: ' },
            { kind: 'new', text: e.marker_title },
          ]
        : [{ kind: 'plain', text: 'Marker added' }];
      segments.push(...markerContextSegments(e, p));
      return { color, segments };
    }
    case 'marker_removed': {
      const segments: SummarySegment[] = e.marker_title
        ? [
            { kind: 'plain', text: 'Marker removed: ' },
            { kind: 'old', text: e.marker_title },
          ]
        : [{ kind: 'plain', text: 'Marker removed' }];
      segments.push(...markerContextSegments(e, p, 'was'));
      return { color, segments };
    }
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
    case 'marker_reclassified': {
      const from = e.from_marker_type_name;
      const to = e.to_marker_type_name;
      if (from && to) {
        return {
          color,
          segments: [
            { kind: 'plain', text: 'Reclassified: ' },
            { kind: 'old', text: from },
            { kind: 'arrow' },
            { kind: 'new', text: to },
          ],
        };
      }
      return { color, segments: [{ kind: 'plain', text: 'Reclassified' }] };
    }
    case 'projection_finalized': {
      const segments: SummarySegment[] = [
        { kind: 'plain', text: 'Projection: ' },
        { kind: 'old', text: 'projected' },
        { kind: 'arrow' },
        { kind: 'new', text: 'actual' },
      ];
      segments.push(...markerContextSegments(e, p));
      return { color, segments };
    }
    default:
      return { color: null, segments: [{ kind: 'plain', text: e.event_type as ChangeEventType }] };
  }
}
