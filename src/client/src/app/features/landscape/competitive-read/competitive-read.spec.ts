import { describe, it, expect } from 'vitest';
import { buildLandscapeRead, ReadStats } from './index';

function makeStats(input: (Partial<ReadStats> & { name: string })[]): ReadStats[] {
  return input.map((s) => ({
    name: s.name,
    assetCount: s.assetCount ?? 0,
    trialCount: s.trialCount ?? 0,
    p3Count: s.p3Count ?? 0,
    lateStageCount: s.lateStageCount ?? 0,
    recentChanges: s.recentChanges ?? 0,
    highestPhase: s.highestPhase ?? 'PRECLIN',
    highestPhaseRank: s.highestPhaseRank ?? 1,
    upcomingCatalysts: s.upcomingCatalysts,
  }));
}

describe('buildLandscapeRead', () => {
  describe('edge cases', () => {
    it('returns empty for empty stats', () => {
      const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats: [] });
      expect(result.segments).toHaveLength(0);
      expect(result.text).toBe('');
    });

    it('makeStats factory produces well-formed ReadStats', () => {
      const stats = makeStats([{ name: 'Acme' }]);
      expect(stats).toHaveLength(1);
      expect(stats[0].assetCount).toBe(0);
    });
  });
});
