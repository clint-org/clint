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
  const text = `${escapeName(s.name)}: ${detail}`;
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
  const text = `${escapeName(leader.name)} leads: ${detail}`;
  return {
    segment: { clause: 'headline', shape: 'clear-leader', detail },
    text,
    leader,
  };
}

export function classifyCompetitive(stats: ReadStats[]): HeadlineResult {
  if (stats.length === 1) return soleEntrantHeadline(stats[0]);
  const sorted = sortForLeadership(stats);
  return clearLeaderHeadline(sorted[0]);
}
