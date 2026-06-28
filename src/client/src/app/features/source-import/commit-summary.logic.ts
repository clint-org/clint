/**
 * Post-commit toast summary.
 *
 * commit_source_import returns `created.{companies,assets,trials,markers,events}`
 * holding the ids of rows ACTUALLY inserted (matched-existing rows are skipped,
 * never created). The toast must count those, not the user's grid selection --
 * otherwise a re-import that matched everything falsely reads "Committed N items"
 * while inserting nothing.
 */
export interface CommitCreated {
  companies?: string[];
  assets?: string[];
  trials?: string[];
  markers?: string[];
  events?: string[];
}

export function commitSummary(created: CommitCreated | null | undefined, title: string): string {
  const c = created ?? {};
  const total =
    (c.companies?.length ?? 0) +
    (c.assets?.length ?? 0) +
    (c.trials?.length ?? 0) +
    (c.markers?.length ?? 0) +
    (c.events?.length ?? 0);

  if (total === 0) {
    return `No new items from ${title}. Everything matched existing records.`;
  }

  const noun = total === 1 ? 'item' : 'items';
  const base = `Committed ${total} new ${noun} from ${title}.`;
  // Only point to the timeline when a marker actually landed there; events
  // are not rendered on the trial timeline.
  const markersCreated = c.markers?.length ?? 0;
  return markersCreated > 0 ? `${base} View in timeline.` : base;
}
