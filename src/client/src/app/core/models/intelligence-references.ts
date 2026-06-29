import {
  IntelligenceEntityType,
  PiReference,
  PrimaryIntelligenceBrief,
} from './primary-intelligence.model';

/**
 * Flatten a detail bundle's briefs into the compact PiReference shape the shared
 * PiDetailSection renders. Only published briefs are surfaced (drafts are
 * agency-internal); each becomes a reference card tagged with the owning
 * entity's type and name.
 */
export function briefsToReferences(
  briefs: PrimaryIntelligenceBrief[],
  entityType: IntelligenceEntityType,
  entityId: string,
  entityName: string | null,
): PiReference[] {
  return briefs
    .filter((b) => b.published !== null)
    .map((b) => ({
      id: b.published!.record.id,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      headline: b.published!.record.headline,
    }));
}

/**
 * De-duplicate references by their brief id, preserving first-seen order. A
 * single brief can surface from more than one source (e.g. a trial brief that
 * also appears under its asset), so the merged list is collapsed by id.
 */
export function dedupeReferencesById(refs: PiReference[]): PiReference[] {
  const seen = new Set<string>();
  const out: PiReference[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
  }
  return out;
}
