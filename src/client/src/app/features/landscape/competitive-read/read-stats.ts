import { Company } from '../../../core/models/company.model';
import {
  RING_DEV_RANK,
  RingPhase,
  BullseyeSpoke,
  HeatmapBubble,
} from '../../../core/models/landscape.model';

const PHASE_RANK: Record<string, number> = {
  PRECLIN: 1,
  P1: 2,
  P2: 3,
  P3: 4,
  P4: 5,
  APPROVED: 6,
  LAUNCHED: 7,
};

const LATE_STAGE_THRESHOLD = PHASE_RANK['P3'];

const SPOKE_LATE_STAGE_THRESHOLD = RING_DEV_RANK['P3'];

export interface ReadStats {
  name: string;
  assetCount: number;
  trialCount: number;
  p3Count: number;
  lateStageCount: number;
  recentChanges: number;
  highestPhase: string;
  highestPhaseRank: number;
  upcomingCatalysts?: ReadCatalyst[];
}

export interface ReadCatalyst {
  daysOut: number;
  trialName: string;
  eventDate: string;
}

export function fromCompanies(companies: Company[], today?: string): ReadStats[] {
  const todayStr = today ?? new Date().toISOString().slice(0, 10);
  return companies.map((co) => {
    let assetCount = 0;
    let trialCount = 0;
    let p3Count = 0;
    let lateStageCount = 0;
    let recentChanges = 0;
    let highestPhaseRank = 0;
    let highestPhase = '';
    const upcomingCatalysts: ReadCatalyst[] = [];

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

        for (const marker of trial.markers ?? []) {
          if (marker.event_date && marker.event_date >= todayStr) {
            const daysOut = Math.round(
              (Date.parse(marker.event_date) - Date.parse(todayStr)) / 86_400_000
            );
            upcomingCatalysts.push({
              daysOut,
              trialName: trial.name,
              eventDate: marker.event_date,
            });
          }
        }
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
      upcomingCatalysts: upcomingCatalysts.length > 0 ? upcomingCatalysts : undefined,
    };
  });
}

export function fromBubbles(bubbles: HeatmapBubble[]): ReadStats[] {
  return bubbles.map((bubble) => {
    const p3Count = bubble.phase_counts['P3'] ?? 0;
    let lateStageCount = 0;
    for (const [phase, count] of Object.entries(bubble.phase_counts)) {
      if ((RING_DEV_RANK[phase as RingPhase] ?? 0) >= RING_DEV_RANK['P3']) {
        lateStageCount += count ?? 0;
      }
    }
    const trialCount = bubble.products.reduce((sum, a) => sum + (a.trial_count ?? 0), 0);
    return {
      name: bubble.label,
      assetCount: bubble.products.length,
      trialCount,
      p3Count,
      lateStageCount,
      recentChanges: 0,
      highestPhase: bubble.highest_phase as string,
      highestPhaseRank: bubble.highest_phase_rank,
    };
  });
}

export function fromSpokes(spokes: BullseyeSpoke[]): ReadStats[] {
  return spokes.map((spoke) => {
    let p3Count = 0;
    let lateStageCount = 0;
    let recentChanges = 0;
    let highestPhaseRank = 0;
    let highestPhase: RingPhase = 'PRECLIN';

    for (const asset of spoke.products) {
      if (asset.highest_phase === 'P3') p3Count++;
      if ((RING_DEV_RANK[asset.highest_phase] ?? 0) >= SPOKE_LATE_STAGE_THRESHOLD) {
        lateStageCount++;
      }
      if (asset.has_recent_activity) recentChanges++;
      if (asset.highest_phase_rank > highestPhaseRank) {
        highestPhaseRank = asset.highest_phase_rank;
        highestPhase = asset.highest_phase;
      }
    }

    return {
      name: spoke.name,
      assetCount: spoke.products.length,
      trialCount: 0,
      p3Count,
      lateStageCount,
      recentChanges,
      highestPhase: highestPhase as string,
      highestPhaseRank,
    };
  });
}
