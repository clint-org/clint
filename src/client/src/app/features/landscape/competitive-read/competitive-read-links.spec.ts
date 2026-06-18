import { describe, it, expect } from 'vitest';
import { buildLandscapeRead, ReadStats } from './index';
import { parseReadTextRuns } from './read-text-runs';

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

const LEADER = {
  name: 'Eli Lilly',
  assetCount: 4,
  p3Count: 3,
  lateStageCount: 3,
  highestPhase: 'P3',
  highestPhaseRank: 4,
} as const;

describe('competitive READ segment links', () => {
  describe('every segment carries its own html mirroring the joined text', () => {
    it('html parts concatenate (with " | ") into LandscapeRead.text', () => {
      const stats = makeStats([
        { ...LEADER },
        {
          name: 'Novo Nordisk',
          assetCount: 1,
          p3Count: 1,
          lateStageCount: 1,
          recentChanges: 5,
          highestPhase: 'P3',
          highestPhaseRank: 4,
        },
      ]);
      const read = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
      expect(read.segments.every((s) => typeof s.html === 'string' && s.html.length > 0)).toBe(true);
      expect(read.segments.map((s) => s.html).join(' | ')).toBe(read.text);
    });
  });

  describe('headline link mapping (company mode)', () => {
    it('clear-leader -> company-filter on the leader', () => {
      const stats = makeStats([
        { ...LEADER },
        { name: 'Novo', assetCount: 2, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
      ]);
      const read = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
      const headline = read.segments[0];
      expect(headline.shape).toBe('clear-leader');
      expect(headline.link).toEqual({ kind: 'company-filter', companyName: 'Eli Lilly' });
    });

    it('sweep -> company-filter on the leader', () => {
      const stats = makeStats([
        { ...LEADER },
        { name: 'Novo', assetCount: 1, p3Count: 0, lateStageCount: 0, highestPhase: 'P2', highestPhaseRank: 3 },
        { name: 'BI', assetCount: 1, p3Count: 0, lateStageCount: 0, highestPhase: 'P1', highestPhaseRank: 2 },
      ]);
      const read = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
      expect(read.segments[0].shape).toBe('sweep');
      expect(read.segments[0].link).toEqual({ kind: 'company-filter', companyName: 'Eli Lilly' });
    });

    it('sole-entrant -> company-filter on radial, catalysts-view on timeline', () => {
      const stats = makeStats([
        { name: 'Pfizer', assetCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
      ]);
      const radial = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
      const timeline = buildLandscapeRead({ view: 'timeline', groupBy: 'company', stats });
      expect(radial.segments[0].link).toEqual({ kind: 'company-filter', companyName: 'Pfizer' });
      expect(timeline.segments[0].link).toEqual({ kind: 'catalysts-view', companyName: 'Pfizer' });
    });

    it('tied -> no link (two leaders named in one segment)', () => {
      const stats = makeStats([
        { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
        { name: 'Novo', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
      ]);
      const read = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
      expect(read.segments[0].shape).toBe('tied');
      expect(read.segments[0].link).toBeUndefined();
    });

    it('fragmented / count-floor -> no link (aggregate, no anchor company)', () => {
      const fragmented = buildLandscapeRead({
        view: 'radial',
        groupBy: 'company',
        stats: makeStats([
          { name: 'A', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'B', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'C', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
        ]),
      });
      expect(fragmented.segments[0].shape).toBe('fragmented');
      expect(fragmented.segments[0].link).toBeUndefined();
    });
  });

  describe('view-clause link mapping (company mode)', () => {
    it('only-credible-challenger -> company-filter on the challenger', () => {
      const stats = makeStats([
        { ...LEADER },
        { name: 'Novo', assetCount: 1, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
      ]);
      const read = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
      const view = read.segments.find((s) => s.clause === 'view');
      expect(view?.shape).toBe('only-credible-challenger');
      expect(view?.link).toEqual({ kind: 'company-filter', companyName: 'Novo' });
    });

    it('timeline catalyst-window -> catalysts-view (no single company)', () => {
      const stats = makeStats([
        {
          ...LEADER,
          upcomingCatalysts: [
            { daysOut: 21, trialName: 'SURMOUNT', eventDate: '2026-06-18' },
            { daysOut: 47, trialName: 'STEP', eventDate: '2026-07-14' },
          ],
        },
        {
          name: 'Novo',
          assetCount: 1,
          p3Count: 1,
          lateStageCount: 1,
          highestPhase: 'P3',
          highestPhaseRank: 4,
          upcomingCatalysts: [{ daysOut: 60, trialName: 'OSA', eventDate: '2026-07-27' }],
        },
      ]);
      const read = buildLandscapeRead({ view: 'timeline', groupBy: 'company', stats });
      const view = read.segments.find((s) => s.clause === 'view');
      expect(view?.shape).toBe('catalyst-window');
      expect(view?.link).toEqual({ kind: 'catalysts-view' });
    });

    it('timeline all-from-one-entity -> catalysts-view filtered to that company', () => {
      const stats = makeStats([
        {
          ...LEADER,
          upcomingCatalysts: [
            { daysOut: 21, trialName: 'A', eventDate: '2026-06-18' },
            { daysOut: 47, trialName: 'B', eventDate: '2026-07-14' },
            { daysOut: 70, trialName: 'C', eventDate: '2026-08-06' },
          ],
        },
        { name: 'Novo', assetCount: 1, lateStageCount: 0, highestPhase: 'P2', highestPhaseRank: 3 },
      ]);
      const read = buildLandscapeRead({ view: 'timeline', groupBy: 'company', stats });
      const view = read.segments.find((s) => s.clause === 'view');
      expect(view?.shape).toBe('all-from-one-entity');
      expect(view?.link).toEqual({ kind: 'catalysts-view', companyName: 'Eli Lilly' });
    });
  });

  describe('momentum link mapping (company mode)', () => {
    it('most-active -> company-filter on the most-active company', () => {
      const stats = makeStats([
        { ...LEADER },
        { name: 'Novo', assetCount: 1, lateStageCount: 0, recentChanges: 9, highestPhase: 'P2', highestPhaseRank: 3 },
      ]);
      const read = buildLandscapeRead({ view: 'timeline', groupBy: 'company', stats });
      const momentum = read.segments.find((s) => s.clause === 'momentum');
      expect(momentum?.shape).toBe('most-active');
      expect(momentum?.link).toEqual({ kind: 'company-filter', companyName: 'Novo' });
    });
  });

  describe('distributional mode emits no links (bucket names are not companies)', () => {
    it('every segment link is undefined under group-by indication', () => {
      const stats = makeStats([
        { name: 'Obesity', assetCount: 5, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
        { name: 'NASH', assetCount: 1, highestPhase: 'P1', highestPhaseRank: 2 },
      ]);
      const read = buildLandscapeRead({ view: 'radial', groupBy: 'indication', stats });
      expect(read.segments.length).toBeGreaterThan(0);
      expect(read.segments.every((s) => s.link === undefined)).toBe(true);
    });
  });
});

describe('parseReadTextRuns', () => {
  it('splits leader emphasis, secondary emphasis, and plain text', () => {
    const html =
      '<strong class="leader-name">Eli Lilly</strong> leads: 4 assets | <strong>Novo</strong> most active';
    const runs = parseReadTextRuns(html);
    expect(runs).toEqual([
      { text: 'Eli Lilly', emphasis: 'leader' },
      { text: ' leads: 4 assets | ', emphasis: 'none' },
      { text: 'Novo', emphasis: 'strong' },
      { text: ' most active', emphasis: 'none' },
    ]);
  });

  it('unescapes entities so the rendered text is the literal name', () => {
    const html = '<strong class="leader-name">&lt;Bio &amp; Tech&gt;</strong>: only entrant';
    const runs = parseReadTextRuns(html);
    expect(runs[0]).toEqual({ text: '<Bio & Tech>', emphasis: 'leader' });
    expect(runs[1]).toEqual({ text: ': only entrant', emphasis: 'none' });
  });

  it('treats markup-free text as a single plain run', () => {
    expect(parseReadTextRuns('5 sponsors at Phase 1, no late-stage activity')).toEqual([
      { text: '5 sponsors at Phase 1, no late-stage activity', emphasis: 'none' },
    ]);
  });
});
