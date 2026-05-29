import { ReadStats } from './read-stats';
import { classifyCompetitive } from './competitive-headlines';

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

  if (input.groupBy === 'company') {
    const headline = classifyCompetitive(input.stats);
    return { text: headline.text, segments: [headline.segment] };
  }

  throw new Error('not implemented');
}

export function escapeName(name: string): string {
  return name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
