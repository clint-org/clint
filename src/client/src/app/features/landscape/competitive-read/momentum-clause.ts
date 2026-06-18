import { escapeName, LandscapeView, ReadSegment } from './index';
import { ReadStats } from './read-stats';
import { HeadlineResult } from './competitive-headlines';
import { ViewClauseResult } from './view-clauses';

const MOMENTUM_THRESHOLD = 3;

export interface MomentumResult {
  segment: ReadSegment;
  text: string;
  /** The most-active entity named in the clause (a company in company mode). */
  entityName: string;
}

export function momentumClause(
  view: LandscapeView,
  headline: HeadlineResult,
  viewClause: ViewClauseResult | null,
  allStats: ReadStats[]
): MomentumResult | null {
  if (headline.segment.shape === 'sole-entrant') return null;

  const viewClauseEntity = viewClause?.entityName ?? null;

  const candidates = allStats
    .filter((s) => s !== headline.leader)
    .filter((s) => s.recentChanges >= MOMENTUM_THRESHOLD)
    .sort((a, b) => b.recentChanges - a.recentChanges);

  const winner = candidates[0];
  if (!winner) return null;

  if (viewClauseEntity && winner.name === viewClauseEntity) return null;

  const noun = view === 'timeline' ? 'recent changes' : 'recent events';
  const detail = `${winner.name} most active (${winner.recentChanges} ${noun})`;
  return {
    segment: { clause: 'momentum', shape: 'most-active', detail },
    text: `<strong>${escapeName(winner.name)}</strong> most active (${winner.recentChanges} ${noun})`,
    entityName: winner.name,
  };
}
