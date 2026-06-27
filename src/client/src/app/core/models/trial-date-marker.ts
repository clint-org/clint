/**
 * Maps the trial edit dialog's Phase start / Phase end date fields onto the
 * Trial Start / Trial End markers that now hold trial-date truth (the
 * trials.phase_start_date / phase_end_date columns were dropped).
 *
 * Pure functions (no Angular DI) so the node vitest runner exercises the
 * mapping logic directly. The dialog is a thin orchestrator over these.
 *
 * Analyst-marker semantics mirrored here come from the SQL helper
 * `_create_trial_date_markers` (the create_trial server path):
 *   - title:          'Trial Start' / 'Trial End'
 *   - date_precision: 'exact' (the analyst types a full date)
 *   - projection:     'actual' when the date is today-or-past, else 'company'
 *                     (anticipated). Recomputed on every date change.
 *   - ownership:      analyst / un-owned. A marker is ct.gov-owned (and locked
 *                     from analyst edits) only when metadata.source === 'ctgov'.
 */
import type { Marker, Projection } from './marker.model';
import { TRIAL_END_MARKER_TYPE_ID, TRIAL_START_MARKER_TYPE_ID } from './trial-phase-span';

export const TRIAL_START_TITLE = 'Trial Start';
export const TRIAL_END_TITLE = 'Trial End';

/** Minimal marker shape the mapping needs. Marker[] satisfies it structurally. */
export interface TrialDateMarker {
  id: string;
  marker_type_id: string;
  event_date: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * True when the marker is ct.gov-owned and therefore locked from analyst
 * edits. The DB BEFORE UPDATE trigger on markers enforces this server-side;
 * the UI mirrors it so it never offers an edit that would be rejected.
 */
export function isCtgovOwnedMarker(
  marker: Pick<Marker, 'metadata'> | null | undefined,
): boolean {
  return marker?.metadata?.['source'] === 'ctgov';
}

/**
 * The Trial Start marker that drives the phase bar: the earliest Trial Start
 * marker by event_date (mirrors deriveTrialPhaseSpan's start rule). This is the
 * marker the edit dialog prefills from, locks on, and updates.
 */
export function selectTrialStartMarker<
  T extends { marker_type_id: string; event_date: string | null },
>(markers: readonly T[] | null | undefined): T | null {
  return pickByEventDate(markers, TRIAL_START_MARKER_TYPE_ID, 'earliest');
}

/**
 * The Trial End marker that drives the phase bar: the latest Trial End marker
 * by event_date (mirrors deriveTrialPhaseSpan's end rule). PCD fallback markers
 * are not editable here, so only Trial End markers are considered.
 */
export function selectTrialEndMarker<
  T extends { marker_type_id: string; event_date: string | null },
>(markers: readonly T[] | null | undefined): T | null {
  return pickByEventDate(markers, TRIAL_END_MARKER_TYPE_ID, 'latest');
}

function pickByEventDate<T extends { marker_type_id: string; event_date: string | null }>(
  markers: readonly T[] | null | undefined,
  markerTypeId: string,
  mode: 'earliest' | 'latest',
): T | null {
  if (!markers) return null;
  let chosen: T | null = null;
  for (const m of markers) {
    if (m.marker_type_id !== markerTypeId) continue;
    if (!m.event_date) continue;
    if (chosen === null) {
      chosen = m;
      continue;
    }
    const better =
      mode === 'earliest'
        ? m.event_date < (chosen.event_date as string)
        : m.event_date > (chosen.event_date as string);
    if (better) chosen = m;
  }
  return chosen;
}

/**
 * Analyst-marker projection rule: a date that is today-or-past is `actual`,
 * a future date is `company` (anticipated). `today` is passed in (YYYY-MM-DD)
 * so the rule is deterministic under test.
 */
export function projectionForDate(date: string, today: string): Extract<Projection, 'actual' | 'company'> {
  return date <= today ? 'actual' : 'company';
}

export type TrialDateMarkerAction = 'none' | 'create' | 'update' | 'delete';

export interface TrialDateMarkerPlan {
  action: TrialDateMarkerAction;
  /** Present for update / delete. */
  markerId?: string;
  /** Present for create: the marker payload (analyst-owned semantics). */
  create?: {
    marker_type_id: string;
    title: string;
    event_date: string;
    projection: Extract<Projection, 'actual' | 'company'>;
    date_precision: 'exact';
    metadata: { source: 'analyst' };
  };
  /** Present for update: only the fields that change. */
  update?: {
    event_date: string;
    projection: Extract<Projection, 'actual' | 'company'>;
  };
}

export interface PlanTrialDateMarkerInput {
  markerTypeId: string;
  title: string;
  /** The existing bar-defining marker (analyst- or ct.gov-owned), or null. */
  existing: { id: string } | null;
  /** Whether the existing marker is ct.gov-owned (locked). */
  locked: boolean;
  /** The marker's stored date at dialog open (YYYY-MM-DD), or null. */
  oldDate: string | null;
  /** The date currently in the form (YYYY-MM-DD), or null when cleared. */
  newDate: string | null;
  /** Today (YYYY-MM-DD) for the projection rule. */
  today: string;
}

/**
 * Translates a single Phase start / Phase end field edit into the marker CRUD
 * the dialog should perform.
 *
 *   locked                        -> none (ct.gov owns it; field was disabled)
 *   unchanged                     -> none
 *   set + existing analyst marker -> update (event_date + recomputed projection)
 *   set + no marker               -> create an analyst-owned Trial Start/End
 *   cleared + existing marker     -> delete
 *   cleared + no marker           -> none
 */
export function planTrialDateMarker(input: PlanTrialDateMarkerInput): TrialDateMarkerPlan {
  const { markerTypeId, title, existing, locked, oldDate, newDate, today } = input;

  // ct.gov-owned dates cannot be analyst-edited; the server trigger enforces
  // this and the field is disabled, so never emit a write.
  if (locked) return { action: 'none' };

  // No effective change.
  if ((newDate ?? null) === (oldDate ?? null)) return { action: 'none' };

  if (newDate) {
    const projection = projectionForDate(newDate, today);
    if (existing) {
      return {
        action: 'update',
        markerId: existing.id,
        update: { event_date: newDate, projection },
      };
    }
    return {
      action: 'create',
      create: {
        marker_type_id: markerTypeId,
        title,
        event_date: newDate,
        projection,
        date_precision: 'exact',
        metadata: { source: 'analyst' },
      },
    };
  }

  // newDate cleared.
  if (existing) return { action: 'delete', markerId: existing.id };
  return { action: 'none' };
}
