/**
 * Post-commit toast summary.
 *
 * commit_source_import returns `created.{companies,assets,trials,events}`
 * holding the ids of rows ACTUALLY inserted (matched-existing rows are skipped,
 * never created). The toast must count those, not the user's grid selection --
 * otherwise a re-import that matched everything falsely reads "Committed N items"
 * while inserting nothing.
 */
export interface CommitCreated {
  companies?: string[];
  assets?: string[];
  trials?: string[];
  events?: string[];
}

export function commitSummary(created: CommitCreated | null | undefined, title: string): string {
  const c = created ?? {};
  const total =
    (c.companies?.length ?? 0) +
    (c.assets?.length ?? 0) +
    (c.trials?.length ?? 0) +
    (c.events?.length ?? 0);

  if (total === 0) {
    return `No new items from ${title}. Everything matched existing records.`;
  }

  const noun = total === 1 ? 'item' : 'items';
  const base = `Committed ${total} new ${noun} from ${title}.`;
  const eventsCreated = c.events?.length ?? 0;
  return eventsCreated > 0 ? `${base} View in timeline.` : base;
}
