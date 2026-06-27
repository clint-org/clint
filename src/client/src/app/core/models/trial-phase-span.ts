/**
 * Derives the trial phase bar span from the trial's markers.
 *
 * This is the single client-side source of truth for the phase bar start/end
 * dates now that the trials.phase_start_date / phase_end_date columns have been
 * dropped. Every consumer reads the derived span instead of the old columns.
 *
 * Pure function (no Angular DI) so it runs under the node vitest runner.
 */
import type { DatePrecision } from './marker-date-precision';

/** System marker type UUIDs that drive the phase bar. */
export const TRIAL_START_MARKER_TYPE_ID = 'a0000000-0000-0000-0000-000000000011';
export const PCD_MARKER_TYPE_ID = 'a0000000-0000-0000-0000-000000000008';
export const TRIAL_END_MARKER_TYPE_ID = 'a0000000-0000-0000-0000-000000000012';

/**
 * Minimal marker shape required by deriveTrialPhaseSpan. Structurally
 * compatible with the full Marker interface (marker.model.ts): passing
 * Marker[] satisfies this parameter type due to structural typing.
 */
export interface PhaseSpanMarker {
  marker_type_id: string;
  event_date: string | null;
  date_precision: DatePrecision;
}

export interface TrialPhaseSpan {
  start: string | null;
  startPrecision: DatePrecision | null;
  end: string | null;
  endPrecision: DatePrecision | null;
}

/**
 * Derives the trial phase bar span from the trial's markers.
 *
 * Rules:
 *   start = earliest Trial Start marker event_date (+ its date_precision).
 *   end   = latest Trial End marker event_date (+ precision), else (no Trial
 *           End markers) the latest PCD marker event_date. This preserves the
 *           legacy column behavior: phase_end_date = coalesce(completionDate,
 *           primaryCompletionDate).
 *
 * Matching is by marker_type_id only. Analyst-created markers of the system
 * types participate: an analyst adding a second Trial Start with a later date
 * legitimately moves the bar (analyst intent).
 *
 * Earliest/latest is determined by lexical ISO date comparison on the stored
 * event_date (midpoint string). This is the only honest single-scalar rule
 * and avoids precision-aware interval math.
 *
 * Returns all-null when there are 0 relevant markers (bar does not render).
 */
export function deriveTrialPhaseSpan(markers: PhaseSpanMarker[]): TrialPhaseSpan {
  if (!markers || markers.length === 0) {
    return { start: null, startPrecision: null, end: null, endPrecision: null };
  }

  let start: string | null = null;
  let startPrecision: DatePrecision | null = null;
  let end: string | null = null;
  let endPrecision: DatePrecision | null = null;
  let hasTrialEnd = false;

  // start: earliest Trial Start marker
  for (const m of markers) {
    if (m.marker_type_id !== TRIAL_START_MARKER_TYPE_ID) continue;
    if (!m.event_date) continue;
    if (start === null || m.event_date < start) {
      start = m.event_date;
      startPrecision = m.date_precision;
    }
  }

  // end: latest Trial End marker
  for (const m of markers) {
    if (m.marker_type_id !== TRIAL_END_MARKER_TYPE_ID) continue;
    if (!m.event_date) continue;
    if (end === null || m.event_date > end) {
      end = m.event_date;
      endPrecision = m.date_precision;
      hasTrialEnd = true;
    }
  }

  // PCD fallback: latest PCD when no Trial End markers are present
  if (!hasTrialEnd) {
    for (const m of markers) {
      if (m.marker_type_id !== PCD_MARKER_TYPE_ID) continue;
      if (!m.event_date) continue;
      if (end === null || m.event_date > end) {
        end = m.event_date;
        endPrecision = m.date_precision;
      }
    }
  }

  return { start, startPrecision, end, endPrecision };
}
