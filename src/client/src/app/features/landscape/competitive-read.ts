import { Company } from '../../core/models/company.model';

const PHASE_RANK: Record<string, number> = {
  PRECLIN: 1,
  P1: 2,
  P2: 3,
  P3: 4,
  P4: 5,
};

const PHASE_LABEL: Record<string, string> = {
  PRECLIN: 'Preclinical',
  P1: 'Phase 1',
  P2: 'Phase 2',
  P3: 'Phase 3',
  P4: 'Phase 4',
};

const LATE_STAGE_THRESHOLD = PHASE_RANK['P3'];

interface CompanyStats {
  name: string;
  assetCount: number;
  trialCount: number;
  p3Count: number;
  lateStageCount: number;
  recentChanges: number;
  highestPhase: string;
  highestPhaseRank: number;
}

export interface ReadSegment {
  kind: 'leader' | 'sole' | 'deepest' | 'most-active';
  companyName: string;
  detail: string;
}

export interface CompetitiveRead {
  segments: ReadSegment[];
  text: string;
}

export interface TimelineStats {
  companyCount: number;
  assetCount: number;
  trialCount: number;
  catalystCount90d: number;
}

function escapeName(name: string): string {
  return name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function gatherStats(companies: Company[]): CompanyStats[] {
  return companies.map((co) => {
    let assetCount = 0;
    let trialCount = 0;
    let p3Count = 0;
    let lateStageCount = 0;
    let recentChanges = 0;
    let highestPhaseRank = 0;
    let highestPhase = '';

    for (const asset of co.assets ?? []) {
      assetCount++;
      for (const trial of asset.trials ?? []) {
        trialCount++;
        const rank = PHASE_RANK[trial.phase_type ?? ''] ?? 0;
        if (rank >= LATE_STAGE_THRESHOLD) lateStageCount++;
        if (trial.phase_type === 'P3') p3Count++;
        if (rank > highestPhaseRank) {
          highestPhaseRank = rank;
          highestPhase = trial.phase_type ?? '';
        }
        recentChanges += trial.recent_changes_count ?? 0;
      }
    }

    return {
      name: co.name,
      assetCount,
      trialCount,
      p3Count,
      lateStageCount,
      recentChanges,
      highestPhase,
      highestPhaseRank,
    };
  });
}

export function buildCompetitiveRead(companies: Company[]): CompetitiveRead {
  if (companies.length === 0) {
    return { segments: [], text: '' };
  }

  const stats = gatherStats(companies);

  if (stats.length === 1) {
    const s = stats[0];
    const seg: ReadSegment = {
      kind: 'sole',
      companyName: s.name,
      detail: `${s.assetCount} asset${s.assetCount !== 1 ? 's' : ''}, ${s.trialCount} trial${s.trialCount !== 1 ? 's' : ''}`,
    };
    const escaped = escapeName(s.name);
    const text = `<strong class="leader-name">${escaped}</strong>: ${seg.detail}`;
    return { segments: [seg], text };
  }

  stats.sort((a, b) => {
    if (b.lateStageCount !== a.lateStageCount) return b.lateStageCount - a.lateStageCount;
    if (b.assetCount !== a.assetCount) return b.assetCount - a.assetCount;
    if (b.trialCount !== a.trialCount) return b.trialCount - a.trialCount;
    return a.name.localeCompare(b.name);
  });

  const segments: ReadSegment[] = [];
  const parts: string[] = [];

  const leader = stats[0];
  const leaderEscaped = escapeName(leader.name);

  let leaderDetail: string;
  if (leader.p3Count > 0) {
    leaderDetail = `${leader.assetCount} assets, ${leader.p3Count} at P3`;
  } else {
    const phaseLabel = PHASE_LABEL[leader.highestPhase] ?? leader.highestPhase;
    leaderDetail = `${leader.assetCount} assets, furthest at ${phaseLabel}`;
  }
  segments.push({ kind: 'leader', companyName: leader.name, detail: leaderDetail });
  parts.push(`<strong class="leader-name">${leaderEscaped}</strong> leads: ${leaderDetail}`);

  const rest = stats.slice(1);

  const deepest = rest
    .filter((s) => s.p3Count > 0)
    .sort((a, b) => {
      if (b.p3Count !== a.p3Count) return b.p3Count - a.p3Count;
      if (b.assetCount !== a.assetCount) return b.assetCount - a.assetCount;
      return a.name.localeCompare(b.name);
    })[0];

  if (deepest) {
    segments.push({
      kind: 'deepest',
      companyName: deepest.name,
      detail: `${deepest.p3Count} P3`,
    });
    parts.push(
      `<strong>${escapeName(deepest.name)}</strong> deepest pipeline (${deepest.p3Count} P3)`
    );
  }

  const mostActive = rest
    .filter((s) => s.recentChanges >= 2 && s !== deepest)
    .sort((a, b) => b.recentChanges - a.recentChanges)[0];

  if (mostActive) {
    segments.push({
      kind: 'most-active',
      companyName: mostActive.name,
      detail: `${mostActive.recentChanges} recent changes`,
    });
    parts.push(
      `<strong>${escapeName(mostActive.name)}</strong> most active (${mostActive.recentChanges} recent changes)`
    );
  }

  return { segments, text: parts.join(' | ') };
}

export function computeTimelineStats(companies: Company[], today?: string): TimelineStats {
  const todayStr = today ?? new Date().toISOString().slice(0, 10);
  const todayMs = Date.UTC(
    +todayStr.slice(0, 4),
    +todayStr.slice(5, 7) - 1,
    +todayStr.slice(8, 10)
  );
  const cutoffMs = todayMs + 90 * 86_400_000;
  const cutoffDate = new Date(cutoffMs);
  const cutoffStr =
    cutoffDate.getUTCFullYear() +
    '-' +
    String(cutoffDate.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(cutoffDate.getUTCDate()).padStart(2, '0');

  let companyCount = 0;
  let assetCount = 0;
  let trialCount = 0;
  let catalystCount90d = 0;

  for (const co of companies) {
    companyCount++;
    for (const asset of co.assets ?? []) {
      assetCount++;
      for (const trial of asset.trials ?? []) {
        trialCount++;
        for (const marker of trial.markers ?? []) {
          if (
            marker.event_date &&
            marker.event_date >= todayStr &&
            marker.event_date <= cutoffStr
          ) {
            catalystCount90d++;
          }
        }
      }
    }
  }

  return { companyCount, assetCount, trialCount, catalystCount90d };
}
