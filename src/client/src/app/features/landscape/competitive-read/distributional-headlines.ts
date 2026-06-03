import { escapeName } from './index';
import { ReadStats } from './read-stats';
import { HeadlineResult } from './competitive-headlines';

function sortByAssetCount(stats: ReadStats[]): ReadStats[] {
  return [...stats].sort((a, b) => {
    if (b.assetCount !== a.assetCount) return b.assetCount - a.assetCount;
    return a.name.localeCompare(b.name);
  });
}

function soleBucketHeadline(s: ReadStats): HeadlineResult {
  const detail = `All ${s.assetCount} assets in ${s.name}`;
  return {
    segment: { clause: 'headline', shape: 'sole-bucket', detail },
    text: `All ${s.assetCount} assets in <strong class="leader-name">${escapeName(s.name)}</strong>`,
    leader: s,
  };
}

function dominantBucketHeadline(top: ReadStats, total: number): HeadlineResult {
  const detail = `Concentrated in ${top.name}: ${top.assetCount} of ${total} assets`;
  return {
    segment: { clause: 'headline', shape: 'dominant-bucket', detail },
    text: `Concentrated in <strong class="leader-name">${escapeName(top.name)}</strong>: ${top.assetCount} of ${total} assets`,
    leader: top,
  };
}

const GROUP_BY_NOUN: Record<string, string> = {
  indication: 'indications',
  moa: 'mechanisms',
  roa: 'routes',
};

function twoBucketSplitHeadline(first: ReadStats, second: ReadStats, total: number): HeadlineResult {
  const detail = `Split between ${first.name} and ${second.name}: ${first.assetCount} + ${second.assetCount} of ${total} assets`;
  const text = `Split between <strong class="leader-name">${escapeName(first.name)}</strong> and <strong class="leader-name">${escapeName(second.name)}</strong>: ${first.assetCount} + ${second.assetCount} of ${total} assets`;
  return {
    segment: { clause: 'headline', shape: 'two-bucket-split', detail },
    text,
    leader: first,
  };
}

function spreadHeadline(stats: ReadStats[], groupBy: string): HeadlineResult {
  const noun = GROUP_BY_NOUN[groupBy] ?? 'buckets';
  const detail = `Spread across ${stats.length} ${noun}, no single focus`;
  return {
    segment: { clause: 'headline', shape: 'spread', detail },
    text: detail,
  };
}

export function classifyDistributional(stats: ReadStats[], groupBy: string): HeadlineResult {
  const sorted = sortByAssetCount(stats);
  const total = sorted.reduce((sum, s) => sum + s.assetCount, 0);

  if (sorted.length === 1) return soleBucketHeadline(sorted[0]);

  if (sorted[0].assetCount / total > 0.5) {
    return dominantBucketHeadline(sorted[0], total);
  }

  if (sorted.length >= 2 && (sorted[0].assetCount + sorted[1].assetCount) / total >= 0.8) {
    return twoBucketSplitHeadline(sorted[0], sorted[1], total);
  }

  return spreadHeadline(sorted, groupBy);
}
