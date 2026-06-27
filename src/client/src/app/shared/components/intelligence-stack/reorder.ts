import { moveItemInArray } from '@angular/cdk/drag-drop';

import { PrimaryIntelligenceBrief } from '../../../core/models/primary-intelligence.model';

/**
 * Stable order with the lead brief first. The detail RPCs already return
 * briefs ordered `is_lead desc, display_order asc`, so this is a defensive
 * guard for the component's local copy.
 */
export function leadFirst(briefs: PrimaryIntelligenceBrief[]): PrimaryIntelligenceBrief[] {
  const lead = briefs.find((b) => b.is_lead);
  if (!lead) return [...briefs];
  return [lead, ...briefs.filter((b) => b !== lead)];
}

/**
 * Apply a drag-drop move to the ordered brief list and return the FULL
 * ordered anchor_id array with the lead pinned at index 0. Emitting the
 * complete set (lead included) is what makes reorder_intelligence's
 * exact-set validation pass; the old accordion omitted the lead and always
 * failed.
 */
export function computeReorder(
  ordered: PrimaryIntelligenceBrief[],
  previousIndex: number,
  currentIndex: number
): string[] {
  const items = [...ordered];
  // Never let anything land above the lead at index 0.
  const target = Math.max(1, currentIndex);
  const from = Math.max(1, previousIndex);
  moveItemInArray(items, from, target);
  return leadFirst(items).map((b) => b.anchor_id);
}
