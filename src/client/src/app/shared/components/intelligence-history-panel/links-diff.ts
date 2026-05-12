import { PrimaryIntelligenceLink } from '../../../core/models/primary-intelligence.model';

export interface LinksDiffChange {
  before: PrimaryIntelligenceLink;
  after: PrimaryIntelligenceLink;
  relationshipChanged: boolean;
  glossChanged: boolean;
}

export interface LinksDiff {
  added: PrimaryIntelligenceLink[];
  removed: PrimaryIntelligenceLink[];
  changed: LinksDiffChange[];
  unchanged: PrimaryIntelligenceLink[];
}

function keyOf(link: PrimaryIntelligenceLink): string {
  return `${link.entity_type}::${link.entity_id}`;
}

function normGloss(g: string | null | undefined): string {
  return (g ?? '').trim();
}

/**
 * Pure diff of linked-entity arrays keyed on (entity_type, entity_id). When
 * `base` is null we treat every entry in `next` as added so the section can
 * render on first publication. `unchanged` entries are included so the diff
 * can show "no change to linked entities" when relevant -- callers decide
 * whether to render that bucket.
 */
export function diffLinks(
  base: readonly PrimaryIntelligenceLink[] | null,
  next: readonly PrimaryIntelligenceLink[]
): LinksDiff {
  if (base === null) {
    return {
      added: [...next],
      removed: [],
      changed: [],
      unchanged: [],
    };
  }

  const baseByKey = new Map<string, PrimaryIntelligenceLink>();
  for (const l of base) baseByKey.set(keyOf(l), l);

  const out: LinksDiff = { added: [], removed: [], changed: [], unchanged: [] };
  const seen = new Set<string>();

  for (const after of next) {
    const k = keyOf(after);
    seen.add(k);
    const before = baseByKey.get(k);
    if (!before) {
      out.added.push(after);
      continue;
    }
    const relationshipChanged = before.relationship_type !== after.relationship_type;
    const glossChanged = normGloss(before.gloss) !== normGloss(after.gloss);
    if (relationshipChanged || glossChanged) {
      out.changed.push({ before, after, relationshipChanged, glossChanged });
    } else {
      out.unchanged.push(after);
    }
  }

  for (const before of base) {
    if (!seen.has(keyOf(before))) out.removed.push(before);
  }

  return out;
}
