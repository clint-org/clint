/**
 * Pure presentational logic for the recent-change badge, extracted so it can be
 * unit-tested without Angular DI (see change-badge.logic.spec.ts). The badge is
 * a single neutral slate dot; "recent" means the unified 14-day window computed
 * server-side. See
 * docs/superpowers/specs/2026-05-29-unified-recent-change-indicator-design.md.
 */
export const BADGE_TYPE_LABELS: Record<string, string> = {
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
  intelligence_published: 'New intelligence',
};

export function badgeTypeLabel(type: string | null): string | null {
  if (!type) return null;
  return BADGE_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}

export function badgeTooltip(count: number, type: string | null): string {
  if (count <= 0) return '';
  const label = badgeTypeLabel(type);
  const head = label ? `Recent change: ${label}` : 'Recent change';
  if (count === 1) return head;
  const noun = count === 2 ? 'other change' : 'other changes';
  return `${head} (+${count - 1} ${noun})`;
}
