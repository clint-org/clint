import { ReadStats } from './read-stats';
import { classifyCompetitive } from './competitive-headlines';
import { classifyDistributional } from './distributional-headlines';
import { densityViewClause, radialViewClause, ViewClauseResult } from './view-clauses';

export type LandscapeView = 'radial' | 'density' | 'timeline';
export type LandscapeGroupBy = 'company' | 'indication' | 'moa' | 'roa' | 'asset';

export interface BuildReadInput {
  view: LandscapeView;
  groupBy: LandscapeGroupBy;
  stats: ReadStats[];
}

export interface ReadSegment {
  clause: 'headline' | 'view' | 'momentum';
  shape: string;
  detail: string;
}

export interface LandscapeRead {
  text: string;
  segments: ReadSegment[];
}

export { ReadStats, ReadCatalyst, fromCompanies, fromSpokes } from './read-stats';

export function buildLandscapeRead(input: BuildReadInput): LandscapeRead {
  if (input.stats.length === 0) {
    return { text: '', segments: [] };
  }

  const isDistributional =
    input.groupBy === 'indication' || input.groupBy === 'moa' || input.groupBy === 'roa';

  const headline = input.groupBy === 'company'
    ? classifyCompetitive(input.stats)
    : isDistributional
    ? classifyDistributional(input.stats, input.groupBy)
    : classifyCompetitive(input.stats);

  const segments: ReadSegment[] = [headline.segment];
  const parts: string[] = [headline.text];

  let viewClause: ViewClauseResult | null = null;
  if (input.view === 'radial') {
    viewClause = radialViewClause(headline, input.stats);
  } else if (input.view === 'density') {
    viewClause = densityViewClause(headline, input.stats);
  }

  if (viewClause) {
    segments.push(viewClause.segment);
    parts.push(viewClause.text);
  }

  return { text: parts.join(' | '), segments };
}

export function escapeName(name: string): string {
  return name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
