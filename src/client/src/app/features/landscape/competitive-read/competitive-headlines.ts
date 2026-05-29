import { ReadSegment } from './index';
import { ReadStats } from './read-stats';
import { escapeName } from './index';

const PHASE_LABEL: Record<string, string> = {
  PRECLIN: 'Preclinical',
  P1: 'Phase 1',
  P2: 'Phase 2',
  P3: 'Phase 3',
  P4: 'Phase 4',
  APPROVED: 'Approved',
  LAUNCHED: 'Launched',
};

export interface HeadlineResult {
  segment: ReadSegment;
  text: string;
  leader?: ReadStats;
}

function phaseLabel(phase: string): string {
  return PHASE_LABEL[phase] ?? phase;
}

function sortForLeadership(stats: ReadStats[]): ReadStats[] {
  return [...stats].sort((a, b) => {
    if (b.lateStageCount !== a.lateStageCount) return b.lateStageCount - a.lateStageCount;
    if (b.assetCount !== a.assetCount) return b.assetCount - a.assetCount;
    if (b.trialCount !== a.trialCount) return b.trialCount - a.trialCount;
    return a.name.localeCompare(b.name);
  });
}

function soleEntrantHeadline(s: ReadStats): HeadlineResult {
  const phase = phaseLabel(s.highestPhase);
  const asset = s.assetCount === 1 ? '1 asset' : `${s.assetCount} assets`;
  const detail = `only entrant (${asset} at ${phase})`;
  const text = `<strong class="leader-name">${escapeName(s.name)}</strong>: ${detail}`;
  return {
    segment: { clause: 'headline', shape: 'sole-entrant', detail },
    text,
    leader: s,
  };
}

function clearLeaderHeadline(leader: ReadStats): HeadlineResult {
  let detail: string;
  if (leader.p3Count > 0) {
    detail = `${leader.assetCount} assets, ${leader.p3Count} at Phase 3`;
  } else {
    detail = `${leader.assetCount} assets, furthest at ${phaseLabel(leader.highestPhase)}`;
  }
  const text = `<strong class="leader-name">${escapeName(leader.name)}</strong> leads: ${detail}`;
  return {
    segment: { clause: 'headline', shape: 'clear-leader', detail },
    text,
    leader,
  };
}

function sweepHeadline(leader: ReadStats): HeadlineResult {
  const detail = `all ${leader.lateStageCount} Phase 3 assets in view`;
  const text = `<strong class="leader-name">${escapeName(leader.name)}</strong> sweep: ${detail}`;
  return {
    segment: { clause: 'headline', shape: 'sweep', detail },
    text,
    leader,
  };
}

function tiedHeadline(tied: ReadStats[], rest: ReadStats[]): HeadlineResult {
  const names = tied.map((s) => `<strong class="leader-name">${escapeName(s.name)}</strong>`).join(' and ');
  const tiedCount = tied[0].lateStageCount;
  let detail = `${tiedCount} P3 each`;
  let text = `${names} tied: ${detail}`;

  if (rest.length > 0 && rest[0].lateStageCount <= tiedCount / 2) {
    const trail = rest[0];
    text += ` (<strong>${escapeName(trail.name)}</strong> trailing at ${trail.lateStageCount})`;
    detail += ` (${trail.name} trailing at ${trail.lateStageCount})`;
  }

  return {
    segment: { clause: 'headline', shape: 'tied', detail },
    text,
    leader: tied[0],
  };
}

function fragmentedHeadline(stats: ReadStats[]): HeadlineResult {
  const phase = phaseLabel(stats[0].highestPhase);
  const detail = `${stats.length} sponsors at ${phase}, no late-stage activity`;
  return {
    segment: { clause: 'headline', shape: 'fragmented', detail },
    text: detail,
  };
}

function countFloorHeadline(stats: ReadStats[]): HeadlineResult {
  const totalAssets = stats.reduce((sum, s) => sum + s.assetCount, 0);
  const detail = `${stats.length} sponsors, ${totalAssets} assets total`;
  return {
    segment: { clause: 'headline', shape: 'count-floor', detail },
    text: detail,
  };
}

export function classifyCompetitive(stats: ReadStats[]): HeadlineResult {
  if (stats.length === 1) return soleEntrantHeadline(stats[0]);

  const sorted = sortForLeadership(stats);
  const totalLateStage = sorted.reduce((sum, s) => sum + s.lateStageCount, 0);

  if (sorted[0].lateStageCount === totalLateStage && totalLateStage >= 2) {
    return sweepHeadline(sorted[0]);
  }

  const tied = sorted.filter((s) => s.lateStageCount === sorted[0].lateStageCount);
  if (tied.length >= 2 && sorted[0].lateStageCount >= 1) {
    return tiedHeadline(tied, sorted.slice(tied.length));
  }

  const allTiedAtAssetCount = sorted.every((s) => s.assetCount === sorted[0].assetCount);
  if (sorted.length >= 3 && totalLateStage === 0 && allTiedAtAssetCount) {
    return fragmentedHeadline(sorted);
  }

  if (sorted[0].lateStageCount === 0 && sorted[0].assetCount === sorted[1].assetCount) {
    return countFloorHeadline(sorted);
  }

  return clearLeaderHeadline(sorted[0]);
}
