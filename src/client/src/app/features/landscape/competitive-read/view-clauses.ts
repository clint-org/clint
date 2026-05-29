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
  entityName?: string;
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
        entityName: challenger.name,
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
        entityName: closest.name,
      };
    }
  }

  if (shape === 'tied' && headline.leader) {
    const tiedNames = new Set(
      allStats.filter((s) => s.p3Count === headline.leader!.p3Count).map((s) => s.name)
    );
    const tiedStats = allStats.filter((s) => tiedNames.has(s.name));
    const broadest = [...tiedStats].sort((a, b) => b.assetCount - a.assetCount)[0];
    const others = tiedStats.filter((s) => s !== broadest);
    if (broadest && others.length > 0 && broadest.assetCount > others[0].assetCount) {
      const detail = `${broadest.name} broader portfolio (${broadest.assetCount} assets vs ${others[0].assetCount})`;
      return {
        segment: { clause: 'view', shape: 'broader-portfolio', detail },
        text: `<strong>${escapeName(broadest.name)}</strong> broader portfolio (${broadest.assetCount} assets vs ${others[0].assetCount})`,
        entityName: broadest.name,
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

function catalystsInWindow(stats: ReadStats[]): { entity: string; count: number }[] {
  const map = new Map<string, number>();
  for (const s of stats) {
    const c = (s.upcomingCatalysts ?? []).filter((x) => x.daysOut >= 0 && x.daysOut <= 90).length;
    if (c > 0) map.set(s.name, c);
  }
  return Array.from(map.entries())
    .map(([entity, count]) => ({ entity, count }))
    .sort((a, b) => b.count - a.count);
}

function distributionalLeader(headline: HeadlineResult): ReadStats | null {
  return headline.leader ?? null;
}

export function distributionalRadialClause(headline: HeadlineResult): ViewClauseResult | null {
  const leader = distributionalLeader(headline);
  if (!leader) return null;
  if (leader.p3Count === 0) return null;
  const detail = `${leader.name} bucket has the deepest pipeline (${leader.p3Count} at Phase 3)`;
  return {
    segment: { clause: 'view', shape: 'deepest-bucket', detail },
    text: detail,
    entityName: leader.name,
  };
}

export function distributionalDensityClause(headline: HeadlineResult): ViewClauseResult | null {
  const leader = distributionalLeader(headline);
  if (!leader) return null;
  if (leader.lateStageCount === 0) {
    const detail = `${leader.name} early-stage only, no Phase 3 assets`;
    return {
      segment: { clause: 'view', shape: 'early-stage-only', detail },
      text: detail,
      entityName: leader.name,
    };
  }
  const detail = `Late-stage activity concentrated in ${leader.name}`;
  return {
    segment: { clause: 'view', shape: 'late-stage-concentrated-in', detail },
    text: detail,
    entityName: leader.name,
  };
}

export function distributionalTimelineClause(
  headline: HeadlineResult,
  _allStats: ReadStats[]
): ViewClauseResult | null {
  const leader = distributionalLeader(headline);
  if (!leader) return null;

  const leaderCatalysts = (leader.upcomingCatalysts ?? []).filter(
    (c) => c.daysOut >= 0 && c.daysOut <= 90
  );

  if (leaderCatalysts.length > 0) {
    const detail = `Next ${leaderCatalysts.length} readouts cluster in ${leader.name}`;
    return {
      segment: { clause: 'view', shape: 'readouts-cluster-in', detail },
      text: detail,
      entityName: leader.name,
    };
  }

  const detail = `${leader.name} bucket quiet, no catalysts in next 90 days`;
  return {
    segment: { clause: 'view', shape: 'bucket-quiet', detail },
    text: detail,
    entityName: leader.name,
  };
}

export function timelineViewClause(
  headline: HeadlineResult,
  allStats: ReadStats[]
): ViewClauseResult | null {
  const breakdown = catalystsInWindow(allStats);
  const totalInWindow = breakdown.reduce((sum, b) => sum + b.count, 0);

  if (headline.segment.shape === 'sole-entrant') {
    const cats = allStats[0].upcomingCatalysts ?? [];
    const next = cats.filter((c) => c.daysOut >= 0).sort((a, b) => a.daysOut - b.daysOut)[0];
    if (next && next.daysOut <= 90) {
      const detail = `next catalyst in ${next.daysOut} days: ${next.trialName} readout`;
      return {
        segment: { clause: 'view', shape: 'next-catalyst', detail },
        text: detail,
      };
    }
    return null;
  }

  if (totalInWindow === 0) {
    const detail = 'no near-term catalysts (next readout > 12 months)';
    return {
      segment: { clause: 'view', shape: 'no-near-term-catalysts', detail },
      text: detail,
    };
  }

  if (breakdown.length === 1) {
    const detail = `${totalInWindow} ${totalInWindow === 1 ? 'readout' : 'readouts'} in next 90 days, all ${breakdown[0].entity}`;
    return {
      segment: { clause: 'view', shape: 'all-from-one-entity', detail },
      text: detail,
      entityName: breakdown[0].entity,
    };
  }

  const breakdownText = breakdown.map((b) => `${b.count} ${b.entity}`).join(', ');
  const detail = `${totalInWindow} ${totalInWindow === 1 ? 'catalyst' : 'catalysts'} in next 90 days (${breakdownText})`;
  return {
    segment: { clause: 'view', shape: 'catalyst-window', detail },
    text: detail,
  };
}
