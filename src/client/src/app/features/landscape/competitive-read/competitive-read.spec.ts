import { describe, it, expect } from 'vitest';
import { buildLandscapeRead, fromCompanies, fromSpokes, ReadStats } from './index';

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

    it('escapes HTML in entity names', () => {
      const stats = makeStats([
        { name: '<Bio & Tech>', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
        { name: 'Novo', assetCount: 1, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
      ]);
      const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
      expect(result.text).toContain('&lt;Bio &amp; Tech&gt;');
      expect(result.text).not.toContain('<Bio');
    });

    it('returns empty when all recentChanges are zero (momentum suppressed)', () => {
      const stats = makeStats([
        { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
        { name: 'Novo', assetCount: 1, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
      ]);
      const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
      expect(result.segments.find((s) => s.clause === 'momentum')).toBeUndefined();
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
            assetCount: 1,
            p3Count: 0,
            lateStageCount: 0,
            highestPhase: 'P2',
            highestPhaseRank: 3,
          },
          {
            name: 'BI',
            assetCount: 1,
            p3Count: 0,
            lateStageCount: 0,
            highestPhase: 'P1',
            highestPhaseRank: 2,
          },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'sweep' });
        expect(result.text).toContain('Lilly');
        expect(result.text).toContain('sweep: all 3 Phase 3 assets in view');
      });

      it('sweep: does NOT fire with single entity (sole-entrant precedence)', () => {
        const stats = makeStats([
          {
            name: 'Lilly',
            assetCount: 3,
            p3Count: 3,
            lateStageCount: 3,
            highestPhase: 'P3',
            highestPhaseRank: 4,
          },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0].shape).toBe('sole-entrant');
      });

      it('tied: 2-way tie on lateStageCount, no trailing tail', () => {
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
            assetCount: 3,
            p3Count: 3,
            lateStageCount: 3,
            highestPhase: 'P3',
            highestPhaseRank: 4,
          },
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
            assetCount: 3,
            p3Count: 3,
            lateStageCount: 3,
            highestPhase: 'P3',
            highestPhaseRank: 4,
          },
          {
            name: 'BI',
            assetCount: 1,
            p3Count: 1,
            lateStageCount: 1,
            highestPhase: 'P3',
            highestPhaseRank: 4,
          },
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
            assetCount: 3,
            p3Count: 3,
            lateStageCount: 3,
            highestPhase: 'P3',
            highestPhaseRank: 4,
          },
          {
            name: 'BI',
            assetCount: 2,
            p3Count: 2,
            lateStageCount: 2,
            highestPhase: 'P3',
            highestPhaseRank: 4,
          },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0].shape).toBe('tied');
        expect(result.text).not.toContain('trailing');
      });

      it('fragmented: 3+ entities, all at 0 lateStage, tied on assetCount', () => {
        const stats = makeStats([
          { name: 'A', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'B', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'C', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'D', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'E', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'fragmented' });
        expect(result.text).toContain('5 sponsors at Phase 1, no late-stage activity');
      });

      it('fragmented: does NOT fire if entities differ on assetCount (clear-leader fires)', () => {
        const stats = makeStats([
          { name: 'A', assetCount: 3, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'B', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'C', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0].shape).toBe('clear-leader');
      });

      it('count-floor: 2 entities tied at 0 lateStage with equal assets', () => {
        const stats = makeStats([
          { name: 'A', assetCount: 2, trialCount: 3, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'B', assetCount: 2, trialCount: 3, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'count-floor' });
        expect(result.text).toContain('2 sponsors, 4 assets total');
      });
    });

    describe('radial Clause 2', () => {
      it('only-credible-challenger after clear-leader', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('only-credible-challenger');
        expect(result.text).toContain('Novo');
        expect(result.text).toContain('only credible challenger');
      });

      it('no-credible-challengers after sweep', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, lateStageCount: 0, highestPhase: 'P2', highestPhaseRank: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('no-credible-challengers');
        expect(result.text).toContain('closest is');
        expect(result.text).toContain('Novo');
        expect(result.text).toContain('Phase 2');
      });

      it('broader-portfolio after tied', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 4, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('broader-portfolio');
        expect(result.text).toContain('Lilly');
        expect(result.text).toContain('broader portfolio (4 assets vs 3)');
      });

      it('suppressed after sole-entrant', () => {
        const stats = makeStats([
          { name: 'Pfizer', assetCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments.find((s) => s.clause === 'view')).toBeUndefined();
      });
    });

    describe('density Clause 2', () => {
      it('clustered-at-phase when >=60% of assets in one phase', () => {
        const stats = makeStats([
          { name: 'A', assetCount: 4, p3Count: 4, lateStageCount: 4, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'B', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'C', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'density', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('clustered-at-phase');
        expect(result.text).toContain('4 of 6 assets clustered at Phase 3');
      });

      it('evenly-spread when no phase has >40%', () => {
        const stats = makeStats([
          { name: 'A', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'B', assetCount: 1, highestPhase: 'P2', highestPhaseRank: 3 },
          { name: 'C', assetCount: 1, highestPhase: 'P3', highestPhaseRank: 4, p3Count: 1, lateStageCount: 1 },
          { name: 'D', assetCount: 1, highestPhase: 'PRECLIN', highestPhaseRank: 1 },
        ]);
        const result = buildLandscapeRead({ view: 'density', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('evenly-spread');
        expect(result.text).toContain('evenly spread across phases');
      });

      it('silent when no clustering and not evenly spread (40-60% middle band)', () => {
        const stats = makeStats([
          { name: 'A', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'B', assetCount: 2, highestPhase: 'P2', highestPhaseRank: 3 },
          { name: 'C', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'density', groupBy: 'company', stats });
        expect(result.segments.find((s) => s.clause === 'view')).toBeUndefined();
      });
    });

    describe('timeline Clause 2', () => {
      it('catalyst-window with breakdown by entity', () => {
        const stats = makeStats([
          {
            name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4,
            upcomingCatalysts: [
              { daysOut: 21, trialName: 'SURMOUNT', eventDate: '2026-06-18' },
              { daysOut: 47, trialName: 'STEP-Future', eventDate: '2026-07-14' },
            ],
          },
          {
            name: 'Novo', assetCount: 1, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4,
            upcomingCatalysts: [
              { daysOut: 60, trialName: 'STEP-OSA', eventDate: '2026-07-27' },
            ],
          },
        ]);
        const result = buildLandscapeRead({ view: 'timeline', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('catalyst-window');
        expect(result.text).toContain('3 catalysts in next 90 days (2 Lilly, 1 Novo)');
      });

      it('all-from-one-entity after sweep', () => {
        const stats = makeStats([
          {
            name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4,
            upcomingCatalysts: [
              { daysOut: 21, trialName: 'A', eventDate: '2026-06-18' },
              { daysOut: 47, trialName: 'B', eventDate: '2026-07-14' },
              { daysOut: 70, trialName: 'C', eventDate: '2026-08-06' },
            ],
          },
          { name: 'Novo', assetCount: 1, lateStageCount: 0, highestPhase: 'P2', highestPhaseRank: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'timeline', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('all-from-one-entity');
        expect(result.text).toContain('3 readouts in next 90 days, all Lilly');
      });

      it('no-near-term-catalysts when no markers in next 90 days', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'timeline', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('no-near-term-catalysts');
        expect(result.text).toContain('no near-term catalysts');
      });

      it('next-catalyst after sole-entrant when within 90 days', () => {
        const stats = makeStats([
          {
            name: 'Pfizer', assetCount: 1, highestPhase: 'P3', highestPhaseRank: 4,
            upcomingCatalysts: [{ daysOut: 47, trialName: 'PFIZER-101', eventDate: '2026-07-14' }],
          },
        ]);
        const result = buildLandscapeRead({ view: 'timeline', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('next-catalyst');
        expect(result.text).toContain('next catalyst in 47 days: PFIZER-101 readout');
      });
    });

    describe('momentum Clause 3', () => {
      it('emits when non-leader has >= 3 recent changes (timeline view)', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, lateStageCount: 0, recentChanges: 5, highestPhase: 'P2', highestPhaseRank: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'timeline', groupBy: 'company', stats });
        const momentum = result.segments.find((s) => s.clause === 'momentum');
        expect(momentum?.shape).toBe('most-active');
        expect(result.text).toContain('Novo');
        expect(result.text).toContain('most active (5 recent changes)');
      });

      it('uses "recent events" wording for spoke views', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, lateStageCount: 0, recentChanges: 5, highestPhase: 'P2', highestPhaseRank: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.text).toContain('Novo');
        expect(result.text).toContain('most active (5 recent events)');
      });

      it('suppressed when below threshold (recentChanges == 2)', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, recentChanges: 2, highestPhase: 'P2', highestPhaseRank: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments.find((s) => s.clause === 'momentum')).toBeUndefined();
      });

      it('suppressed when same entity as view-clause target', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, p3Count: 1, lateStageCount: 1, recentChanges: 5, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.detail).toContain('Novo');
        expect(result.segments.find((s) => s.clause === 'momentum')).toBeUndefined();
      });

      it('suppressed for sole-entrant', () => {
        const stats = makeStats([
          { name: 'Pfizer', assetCount: 1, recentChanges: 10, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments.find((s) => s.clause === 'momentum')).toBeUndefined();
      });
    });
  });

  describe('distributional mode (group-by: indication / moa / roa)', () => {
    describe('headline shapes', () => {
      it('sole-bucket: all assets in one bucket', () => {
        const stats = makeStats([
          {
            name: 'Diabetes',
            assetCount: 6,
            p3Count: 3,
            lateStageCount: 3,
            highestPhase: 'P3',
            highestPhaseRank: 4,
          },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'indication', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'sole-bucket' });
        expect(result.text).toContain('All 6 assets in');
        expect(result.text).toContain('Diabetes');
      });

      it('dominant-bucket: top bucket has >=50%', () => {
        const stats = makeStats([
          {
            name: 'Diabetes',
            assetCount: 5,
            p3Count: 3,
            lateStageCount: 3,
            highestPhase: 'P3',
            highestPhaseRank: 4,
          },
          { name: 'Obesity', assetCount: 1, highestPhase: 'P2', highestPhaseRank: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'indication', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'dominant-bucket' });
        expect(result.text).toContain('Concentrated in');
        expect(result.text).toContain('Diabetes');
        expect(result.text).toContain(': 5 of 6 assets');
      });

      it('dominant-bucket: boundary strictly above 50% fires dominant', () => {
        const stats = makeStats([
          { name: 'A', assetCount: 4 },
          { name: 'B', assetCount: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'indication', stats });
        expect(result.segments[0].shape).toBe('dominant-bucket');
        expect(result.text).toContain('Concentrated in');
        expect(result.text).toContain(': 4 of 7 assets');
      });

      it('two-bucket-split: top 2 buckets sum to >=80%', () => {
        const stats = makeStats([
          { name: 'Diabetes', assetCount: 3 },
          { name: 'Obesity', assetCount: 2 },
          { name: 'NASH', assetCount: 1 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'indication', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'two-bucket-split' });
        expect(result.text).toContain('Split between');
        expect(result.text).toContain('Diabetes');
        expect(result.text).toContain('Obesity');
        expect(result.text).toContain(': 3 + 2 of 6 assets');
      });

      it('spread: floor case fires when no other shape qualifies', () => {
        const stats = makeStats([
          { name: 'A', assetCount: 2 },
          { name: 'B', assetCount: 2 },
          { name: 'C', assetCount: 2 },
          { name: 'D', assetCount: 2 },
          { name: 'E', assetCount: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'indication', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'spread' });
        expect(result.text).toContain('Spread across 5 indications, no single focus');
      });
    });

    describe('distributional view clauses', () => {
      it('radial: deepest-bucket after dominant-bucket', () => {
        const stats = makeStats([
          { name: 'Obesity', assetCount: 5, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'NASH', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'indication', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('deepest-bucket');
        expect(result.text).toContain('Obesity bucket has the deepest pipeline (3 at Phase 3)');
      });

      it('density: late-stage-concentrated-in', () => {
        const stats = makeStats([
          { name: 'Obesity', assetCount: 5, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'NASH', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'density', groupBy: 'indication', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('late-stage-concentrated-in');
        expect(result.text).toContain('Late-stage activity concentrated in Obesity');
      });

      it('timeline: bucket-quiet when no catalysts', () => {
        const stats = makeStats([
          { name: 'Obesity', assetCount: 5, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'NASH', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'timeline', groupBy: 'indication', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('bucket-quiet');
      });
    });
  });

  describe('asset group-by', () => {
    it('emits count-summary headline with cluster observation', () => {
      const stats = makeStats([
        { name: 'Tirzepatide', assetCount: 1, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
        { name: 'Orforglipron', assetCount: 1, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
        { name: 'Retatrutide', assetCount: 1, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
      ]);
      const result = buildLandscapeRead({ view: 'radial', groupBy: 'asset', stats });
      expect(result.segments[0].shape).toBe('asset-count-summary');
      expect(result.text).toContain('Showing 3 assets');
    });
  });

  describe('adapters', () => {
    it('fromSpokes produces expected ReadStats', () => {
      const spokes = [
        {
          id: 'sp1',
          name: 'Lilly',
          display_order: 0,
          highest_phase_rank: 4,
          products: [
            {
              id: 'a1', name: 'Tirzepatide', generic_name: null, logo_url: null,
              company_id: 'c1', company_name: 'Lilly',
              highest_phase: 'P3', highest_phase_rank: 4,
              trials: [], recent_markers: [], moas: [], roas: [], indications: [],
              intelligence_count: 0, has_recent_activity: true,
              latest_event_date: null, latest_event_type: null,
            },
          ],
        },
      ];
      const stats = fromSpokes(spokes as never);
      expect(stats).toHaveLength(1);
      expect(stats[0].name).toBe('Lilly');
      expect(stats[0].assetCount).toBe(1);
      expect(stats[0].p3Count).toBe(1);
      expect(stats[0].lateStageCount).toBe(1);
      expect(stats[0].recentChanges).toBe(1);
      expect(stats[0].highestPhase).toBe('P3');
      expect(stats[0].upcomingCatalysts).toBeUndefined();
    });

    it('fromCompanies produces expected ReadStats', () => {
      const companies = [
        {
          id: 'c1',
          space_id: 'sp',
          created_by: 'u',
          name: 'Lilly',
          logo_url: null,
          display_order: 0,
          created_at: '',
          updated_at: '',
          updated_by: null,
          assets: [
            {
              id: 'a1', space_id: 'sp', created_by: 'u', company_id: 'c1',
              name: 'Tirzepatide', generic_name: null, logo_url: null, display_order: 0,
              created_at: '', updated_at: '', updated_by: null,
              trials: [
                {
                  id: 't1', space_id: 'sp', created_by: 'u', asset_id: 'a1',
                  name: 'SURMOUNT', identifier: null, status: null, notes: null,
                  display_order: 0, created_at: '', updated_at: '', updated_by: null,
                  phase_type: 'P3', phase_start_date: null, phase_end_date: null,
                  markers: [], recent_changes_count: 4, most_recent_change_type: null,
                },
              ],
            },
          ],
        },
      ];
      const stats = fromCompanies(companies as never);
      expect(stats).toHaveLength(1);
      expect(stats[0].name).toBe('Lilly');
      expect(stats[0].assetCount).toBe(1);
      expect(stats[0].trialCount).toBe(1);
      expect(stats[0].p3Count).toBe(1);
      expect(stats[0].lateStageCount).toBe(1);
      expect(stats[0].recentChanges).toBe(4);
      expect(stats[0].highestPhase).toBe('P3');
    });
  });
});
