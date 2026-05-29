import { escapeName, ReadSegment } from './index';
import { ReadStats } from './read-stats';
import { HeadlineResult } from './competitive-headlines';

const PHASE_LABEL: Record<string, string> = {
  PRECLIN: 'Preclinical',
  P1: 'Phase 1',
  P2: 'Phase 2',
  P3: 'Phase 3',
  P4: 'Phase 4',
  APPROVED: 'Approved',
  LAUNCHED: 'Launched',
};

export interface ViewClauseResult {
  segment: ReadSegment;
  text: string;
}

export function radialViewClause(
  headline: HeadlineResult,
  allStats: ReadStats[]
): ViewClauseResult | null {
  const shape = headline.segment.shape;

  if (shape === 'sole-entrant' || shape === 'fragmented' || shape === 'count-floor') {
    return null;
  }

  if (shape === 'clear-leader' && headline.leader) {
    const challenger = allStats
      .filter((s) => s !== headline.leader && s.p3Count > 0)
      .sort((a, b) => b.p3Count - a.p3Count)[0];
    if (challenger) {
      const detail = `${challenger.name} only credible challenger (${challenger.p3Count === 1 ? '1 asset' : `${challenger.p3Count} assets`} at Phase 3)`;
      return {
        segment: { clause: 'view', shape: 'only-credible-challenger', detail },
        text: `<strong>${escapeName(challenger.name)}</strong> only credible challenger (${challenger.p3Count === 1 ? '1 asset' : `${challenger.p3Count} assets`} at Phase 3)`,
      };
    }
  }

  if (shape === 'sweep' && headline.leader) {
    const closest = allStats
      .filter((s) => s !== headline.leader)
      .sort((a, b) => b.highestPhaseRank - a.highestPhaseRank)[0];
    if (closest) {
      const phase = PHASE_LABEL[closest.highestPhase] ?? closest.highestPhase;
      const detail = `no credible challengers, closest is ${closest.name} at ${phase}`;
      return {
        segment: { clause: 'view', shape: 'no-credible-challengers', detail },
        text: `no credible challengers, closest is <strong>${escapeName(closest.name)}</strong> at ${phase}`,
      };
    }
  }

  if (shape === 'tied' && headline.leader) {
    const tiedNames = new Set(
      allStats.filter((s) => s.lateStageCount === headline.leader!.lateStageCount).map((s) => s.name)
    );
    const tiedStats = allStats.filter((s) => tiedNames.has(s.name));
    const broadest = [...tiedStats].sort((a, b) => b.assetCount - a.assetCount)[0];
    const others = tiedStats.filter((s) => s !== broadest);
    if (broadest && others.length > 0 && broadest.assetCount > others[0].assetCount) {
      const detail = `${broadest.name} broader portfolio (${broadest.assetCount} assets vs ${others[0].assetCount})`;
      return {
        segment: { clause: 'view', shape: 'broader-portfolio', detail },
        text: `<strong>${escapeName(broadest.name)}</strong> broader portfolio (${broadest.assetCount} assets vs ${others[0].assetCount})`,
      };
    }
  }

  return null;
}

function phaseCountFromHighest(stats: ReadStats[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of stats) {
    counts[s.highestPhase] = (counts[s.highestPhase] ?? 0) + s.assetCount;
  }
  return counts;
}

export function densityViewClause(
  _headline: HeadlineResult,
  allStats: ReadStats[]
): ViewClauseResult | null {
  const totalAssets = allStats.reduce((sum, s) => sum + s.assetCount, 0);
  if (totalAssets === 0) return null;

  const phaseCounts = phaseCountFromHighest(allStats);
  const entries = Object.entries(phaseCounts).sort((a, b) => b[1] - a[1]);
  const [topPhase, topCount] = entries[0];
  const topFraction = topCount / totalAssets;

  if (topFraction >= 0.6) {
    const phaseLabel = PHASE_LABEL[topPhase] ?? topPhase;
    const detail = `${topCount} of ${totalAssets} assets clustered at ${phaseLabel}`;
    return {
      segment: { clause: 'view', shape: 'clustered-at-phase', detail },
      text: detail,
    };
  }

  const maxFraction = entries[0][1] / totalAssets;
  if (maxFraction < 0.4) {
    const detail = 'evenly spread across phases';
    return {
      segment: { clause: 'view', shape: 'evenly-spread', detail },
      text: detail,
    };
  }

  return null;
}
