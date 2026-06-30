// Pure decision logic for "status-lifting" event types (Approval / Launch) and
// the diagnostics around them. No Angular, no Supabase, so the component and the
// asset-profile surface share ONE implementation that unit tests exercise
// directly (units run in plain node and cannot TestBed-render a component).
//
// An Approval/Launch event tagged with an indication is what lifts that
// indication's asset_indications.development_status to APPROVED / LAUNCHED (a DB
// trigger does the lift). These helpers answer: does the chosen type lift?
// should we nudge the analyst to map an indication? and does an asset have an
// actual approval that never reached its stage (because no indication was
// mapped)?

/** System event-type ids whose events lift asset_indications.development_status. */
export const APPROVAL_EVENT_TYPE_ID = 'a0000000-0000-0000-0000-000000000035';
export const LAUNCH_EVENT_TYPE_ID = 'a0000000-0000-0000-0000-000000000036';

/** development_status values that already reflect an approval/launch. */
const REFLECTED_STATUSES = new Set(['APPROVED', 'LAUNCHED']);

/**
 * Minimal shape of an event type for the lift decision: the row may carry a
 * `lifts_development_status` column ('APPROVED' | 'LAUNCHED' | null) and/or its
 * id. We prefer the column when present and fall back to the two system ids.
 */
export interface EventTypeLiftInfo {
  id?: string | null;
  lifts_development_status?: string | null;
}

/** True when an event of this type lifts the asset's development status. */
export function eventTypeLiftsStatus(type: EventTypeLiftInfo | null | undefined): boolean {
  if (!type) return false;
  const lift = type.lifts_development_status;
  if (lift === 'APPROVED' || lift === 'LAUNCHED') return true;
  return type.id === APPROVAL_EVENT_TYPE_ID || type.id === LAUNCH_EVENT_TYPE_ID;
}

/**
 * Soft warn: a status-lifting type was chosen but no indication is mapped, so
 * the lift will not happen. Never blocks save (the form decision is soft-warn).
 */
export function shouldWarnMissingIndication(args: {
  lifts: boolean;
  indicationId: string | null;
}): boolean {
  return args.lifts && !args.indicationId;
}

/** One asset-anchored event, reduced to the fields the diagnostic needs. */
export interface AssetApprovalEventLike extends EventTypeLiftInfo {
  projection?: string | null;
  no_longer_expected?: boolean | null;
}

/**
 * Asset-profile diagnostic: the asset has an ACTUAL (projection='actual', not
 * no-longer-expected) Approval/Launch event, yet none of its indications reached
 * APPROVED/LAUNCHED. That is the "approval recorded but not reflected in stage"
 * case, almost always because the approval event was not tagged with an
 * indication so the lift trigger had nothing to lift.
 */
export function assetApprovalUnreflected(args: {
  statuses: (string | null | undefined)[];
  events: AssetApprovalEventLike[];
}): boolean {
  const hasActualApproval = args.events.some(
    (e) => eventTypeLiftsStatus(e) && e.projection === 'actual' && !e.no_longer_expected,
  );
  if (!hasActualApproval) return false;
  const anyReflected = args.statuses.some((s) => s != null && REFLECTED_STATUSES.has(s));
  return !anyReflected;
}
