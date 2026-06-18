import { ReadStats } from './read-stats';
import { classifyCompetitive, HeadlineResult } from './competitive-headlines';
import { classifyDistributional } from './distributional-headlines';
import {
  heatmapViewClause,
  distributionalHeatmapClause,
  distributionalRadialClause,
  distributionalTimelineClause,
  radialViewClause,
  timelineViewClause,
  ViewClauseResult,
} from './view-clauses';
import { momentumClause } from './momentum-clause';

export type LandscapeView = 'radial' | 'heatmap' | 'timeline';
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

/**
 * A structured navigation intent attached to a READ segment. The build layer
 * (pure, unit-tested) only declares intent; the render component
 * (competitive-read-strip) resolves it into real navigation using the shared
 * LandscapeStateService (company name -> id) and the router. Only intents whose
 * destination already exists today are emitted -- see the segment-link mapping
 * in competitive-read-strip.component.ts.
 */
export type ReadLink =
  | { kind: 'company-filter'; companyName: string }
  | { kind: 'catalysts-view'; companyName?: string };

export interface ReadSegment {
  clause: 'headline' | 'view' | 'momentum';
  shape: string;
  detail: string;
  /**
   * The segment's own controlled markup (the same string concatenated into
   * LandscapeRead.text). Carries the leader-name emphasis so the strip can
   * render each segment exactly without re-splitting the joined text. The
   * sub-clause builders leave this unset; buildLandscapeRead populates it.
   */
  html?: string;
  /**
   * Optional deep-link target. Present only for segments whose anchor entity
   * can be navigated with an existing destination capability. Absent segments
   * render as plain (non-interactive) text.
   */
  link?: ReadLink;
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

  // Links are only attached in competitive (company) mode, where a segment's
  // anchor name is a company name that the shared filter can resolve to an id.
  // Distributional buckets (indication / moa / roa) carry bucket names, not
  // company names, so they stay plain text.
  const linkable = !isDistributional;

  const headlineSegment: ReadSegment = {
    ...headline.segment,
    html: headline.text,
    link: linkable ? headlineLink(input.view, headline) : undefined,
  };
  const segments: ReadSegment[] = [headlineSegment];

  let viewClause: ViewClauseResult | null = null;
  if (isDistributional) {
    if (input.view === 'radial') viewClause = distributionalRadialClause(headline);
    else if (input.view === 'heatmap') viewClause = distributionalHeatmapClause(headline);
    else if (input.view === 'timeline')
      viewClause = distributionalTimelineClause(headline, input.stats);
  } else {
    if (input.view === 'radial') viewClause = radialViewClause(headline, input.stats);
    else if (input.view === 'heatmap') viewClause = heatmapViewClause(headline, input.stats);
    else if (input.view === 'timeline') viewClause = timelineViewClause(headline, input.stats);
  }

  if (viewClause) {
    segments.push({
      ...viewClause.segment,
      html: viewClause.text,
      link: linkable ? viewClauseLink(input.view, viewClause) : undefined,
    });
  }

  const momentum = momentumClause(input.view, headline, viewClause, input.stats);
  if (momentum) {
    segments.push({
      ...momentum.segment,
      html: momentum.text,
      link: linkable
        ? { kind: 'company-filter', companyName: momentum.entityName }
        : undefined,
    });
  }

  return { text: segments.map((s) => s.html).join(' | '), segments };
}

/**
 * Link intent for a competitive-mode headline segment. Single-leader shapes
 * point at the company filter. The `tied` shape names two leaders in one
 * segment, so it stays plain text (a single link would mislead). `fragmented`
 * and `count-floor` are aggregate observations with no single anchor company.
 */
function headlineLink(view: LandscapeView, headline: HeadlineResult): ReadLink | undefined {
  const shape = headline.segment.shape;
  const leaderName = headline.leader?.name;
  if (!leaderName) return undefined;

  if (shape === 'sole-entrant') {
    // On the timeline a sole entrant's READ resolves to its next catalyst, so
    // route to the catalysts view filtered to that company; elsewhere filter in place.
    return view === 'timeline'
      ? { kind: 'catalysts-view', companyName: leaderName }
      : { kind: 'company-filter', companyName: leaderName };
  }
  if (shape === 'clear-leader' || shape === 'sweep') {
    return { kind: 'company-filter', companyName: leaderName };
  }
  return undefined;
}

/**
 * Link intent for a competitive-mode view-clause segment. Entity-anchored
 * clauses point at the company filter; timeline catalyst clauses point at the
 * catalysts view (with the originating company when the clause names exactly one).
 */
function viewClauseLink(view: LandscapeView, viewClause: ViewClauseResult): ReadLink | undefined {
  const shape = viewClause.segment.shape;

  if (view === 'timeline') {
    // Timeline catalyst clauses route to the catalysts view. `all-from-one-entity`
    // names a single company; `catalyst-window` lists several inside one segment,
    // so it routes to the unfiltered catalysts view rather than picking one.
    if (shape === 'all-from-one-entity') {
      return { kind: 'catalysts-view', companyName: viewClause.entityName };
    }
    if (shape === 'catalyst-window') {
      return { kind: 'catalysts-view' };
    }
  }

  if (
    viewClause.entityName &&
    (shape === 'only-credible-challenger' ||
      shape === 'no-credible-challengers' ||
      shape === 'broader-portfolio')
  ) {
    return { kind: 'company-filter', companyName: viewClause.entityName };
  }
  return undefined;
}

function buildAssetGroupRead(input: BuildReadInput): LandscapeRead {
  const total = input.stats.length;
  const sponsors = new Set<string>();
  for (const s of input.stats) sponsors.add(s.name);
  const detail = `Showing ${total} assets across ${sponsors.size} sponsors`;
  return {
    text: detail,
    segments: [{ clause: 'headline', shape: 'asset-count-summary', detail, html: detail }],
  };
}

export function escapeName(name: string): string {
  return name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
