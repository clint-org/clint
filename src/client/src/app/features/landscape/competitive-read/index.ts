import { ReadStats } from './read-stats';
import { classifyCompetitive } from './competitive-headlines';
import { classifyDistributional } from './distributional-headlines';
import {
  densityViewClause,
  distributionalDensityClause,
  distributionalRadialClause,
  distributionalTimelineClause,
  radialViewClause,
  timelineViewClause,
  ViewClauseResult,
} from './view-clauses';
import { momentumClause } from './momentum-clause';

export type LandscapeView = 'radial' | 'density' | 'timeline';
export type LandscapeGroupBy =
  | 'company'
  | 'indication'
  | 'moa'
  | 'moa+indication'
  | 'roa'
  | 'asset';

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

export { ReadStats, ReadCatalyst, fromCompanies, fromSpokes, fromBubbles } from './read-stats';

export function buildLandscapeRead(input: BuildReadInput): LandscapeRead {
  if (input.stats.length === 0) {
    return { text: '', segments: [] };
  }

  if (input.groupBy === 'asset') {
    return buildAssetGroupRead(input);
  }

  const isDistributional =
    input.groupBy === 'indication' ||
    input.groupBy === 'moa' ||
    input.groupBy === 'moa+indication' ||
    input.groupBy === 'roa';

  const headline = isDistributional
    ? classifyDistributional(input.stats, input.groupBy)
    : classifyCompetitive(input.stats);

  const segments: ReadSegment[] = [headline.segment];
  const parts: string[] = [headline.text];

  let viewClause: ViewClauseResult | null = null;
  if (isDistributional) {
    if (input.view === 'radial') viewClause = distributionalRadialClause(headline);
    else if (input.view === 'density') viewClause = distributionalDensityClause(headline);
    else if (input.view === 'timeline')
      viewClause = distributionalTimelineClause(headline, input.stats);
  } else {
    if (input.view === 'radial') viewClause = radialViewClause(headline, input.stats);
    else if (input.view === 'density') viewClause = densityViewClause(headline, input.stats);
    else if (input.view === 'timeline') viewClause = timelineViewClause(headline, input.stats);
  }

  if (viewClause) {
    segments.push(viewClause.segment);
    parts.push(viewClause.text);
  }

  const momentum = momentumClause(input.view, headline, viewClause, input.stats);
  if (momentum) {
    segments.push(momentum.segment);
    parts.push(momentum.text);
  }

  return { text: parts.join(' | '), segments };
}

function buildAssetGroupRead(input: BuildReadInput): LandscapeRead {
  const total = input.stats.length;
  const sponsors = new Set<string>();
  for (const s of input.stats) sponsors.add(s.name);
  const detail = `Showing ${total} assets across ${sponsors.size} sponsors`;
  return {
    text: detail,
    segments: [{ clause: 'headline', shape: 'asset-count-summary', detail }],
  };
}

export function escapeName(name: string): string {
  return name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
