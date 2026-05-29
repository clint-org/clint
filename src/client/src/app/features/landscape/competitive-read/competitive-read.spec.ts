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

  describe('competitive mode (group-by: company)', () => {
    describe('headline shapes', () => {
      it('sole-entrant: single entity, no comparison', () => {
        const stats = makeStats([
          { name: 'Pfizer', assetCount: 1, trialCount: 2, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ clause: 'headline', shape: 'sole-entrant' });
        expect(result.text).toContain('Pfizer');
        expect(result.text).toContain('only entrant (1 asset at Phase 3)');
      });

      it('clear-leader: leader beats #2 by 1 on lateStageCount', () => {
        const stats = makeStats([
          {
            name: 'Lilly',
            assetCount: 3,
            p3Count: 3,
            lateStageCount: 3,
            highestPhase: 'P3',
            highestPhaseRank: 4,
          },
          {
            name: 'Novo',
            assetCount: 2,
            p3Count: 1,
            lateStageCount: 1,
            highestPhase: 'P3',
            highestPhaseRank: 4,
          },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ clause: 'headline', shape: 'clear-leader' });
        expect(result.text).toContain('Lilly');
        expect(result.text).toContain('leads: 3 assets, 3 at Phase 3');
      });

      it('clear-leader: tiebreak on assetCount when lateStage is tied at 0', () => {
        const stats = makeStats([
          { name: 'A', assetCount: 5, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'B', assetCount: 3, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'C', assetCount: 3, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'clear-leader' });
        expect(result.text).toContain('A');
        expect(result.text).toContain('leads: 5 assets, furthest at Phase 1');
      });

      it('sweep: one entity holds 100% of late-stage with >=2 P3 and >=2 entities', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, p3Count: 0, lateStageCount: 0, highestPhase: 'P2', highestPhaseRank: 3 },
          { name: 'BI', assetCount: 1, p3Count: 0, lateStageCount: 0, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'sweep' });
        expect(result.text).toContain('Lilly');
        expect(result.text).toContain('sweep: all 3 Phase 3 assets in view');
      });

      it('sweep: does NOT fire with single entity (sole-entrant precedence)', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0].shape).toBe('sole-entrant');
      });

      it('tied: 2-way tie on lateStageCount, no trailing tail', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'tied' });
        expect(result.text).toContain('Lilly');
        expect(result.text).toContain('Novo');
        expect(result.text).toContain('tied: 3 P3 each');
        expect(result.text).not.toContain('trailing');
      });

      it('tied: 3-way with trailing third at <=50% emits "trailing at M"', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'BI', assetCount: 1, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'tied' });
        expect(result.text).toContain('Lilly');
        expect(result.text).toContain('Novo');
        expect(result.text).toContain('tied: 3 P3 each');
        expect(result.text).toContain('BI');
        expect(result.text).toContain('trailing at 1');
      });

      it('tied: 3-way with third within 50%, no trailing tail', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'BI', assetCount: 2, p3Count: 2, lateStageCount: 2, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0].shape).toBe('tied');
        expect(result.text).not.toContain('trailing');
      });
    });
  });
});
