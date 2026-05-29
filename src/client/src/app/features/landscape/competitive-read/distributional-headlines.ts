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

export function classifyDistributional(stats: ReadStats[]): HeadlineResult {
  const sorted = sortByAssetCount(stats);
  const total = sorted.reduce((sum, s) => sum + s.assetCount, 0);

  if (sorted.length === 1) return soleBucketHeadline(sorted[0]);

  if (sorted[0].assetCount / total >= 0.5) {
    return dominantBucketHeadline(sorted[0], total);
  }

  throw new Error('not implemented'); // Task 6 covers the rest
}
