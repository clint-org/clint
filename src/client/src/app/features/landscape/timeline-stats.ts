import { Company } from '../../core/models/company.model';

export interface TimelineStats {
  companyCount: number;
  assetCount: number;
  trialCount: number;
  catalystCount90d: number;
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
  // A trial can be nested under more than one asset (master protocols), so count
  // DISTINCT trials and catalysts by id; otherwise the totals double-count a
  // multi-asset trial and its markers once per asset it appears under.
  const seenTrials = new Set<string>();
  const seenCatalysts = new Set<string>();

  for (const co of companies) {
    companyCount++;
    for (const asset of co.assets ?? []) {
      assetCount++;
      for (const trial of asset.trials ?? []) {
        seenTrials.add(trial.id);
        for (const marker of trial.markers ?? []) {
          if (
            marker.event_date &&
            marker.event_date >= todayStr &&
            marker.event_date <= cutoffStr
          ) {
            seenCatalysts.add(marker.id);
          }
        }
      }
    }
  }

  return {
    companyCount,
    assetCount,
    trialCount: seenTrials.size,
    catalystCount90d: seenCatalysts.size,
  };
}
