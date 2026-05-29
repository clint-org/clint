# Landscape Competitive READ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three copy-pasted READ generators in the landscape feature with a single shared, view-aware, group-by-aware module that produces honest competitive summaries and passes a ~45-test scenario matrix.

**Architecture:** New module at `src/client/src/app/features/landscape/competitive-read/` exporting `buildLandscapeRead({ view, groupBy, stats }) → { text, segments }`. Two adapters (`fromCompanies`, `fromSpokes`) normalize input from the two existing call-site data shapes into a shared `ReadStats[]`. The orchestrator picks a mode (competitive / distributional / count-summary) based on `groupBy`, classifies the data shape for a headline, picks a view-flavored second clause, and optionally adds a momentum clause.

**Tech Stack:** Angular 21 (standalone, signals, OnPush), TypeScript, Vitest. No new dependencies. All work is in `src/client/`.

**Spec reference:** `docs/superpowers/specs/2026-05-28-landscape-competitive-read-design.md`

---

## File map

**Created:**
- `src/client/src/app/features/landscape/competitive-read/index.ts` — public API: `buildLandscapeRead()`, public types
- `src/client/src/app/features/landscape/competitive-read/read-stats.ts` — `ReadStats` interface + `fromCompanies()` + `fromSpokes()` adapters
- `src/client/src/app/features/landscape/competitive-read/competitive-headlines.ts` — 5 competitive-mode shapes + count-floor
- `src/client/src/app/features/landscape/competitive-read/distributional-headlines.ts` — 4 distributional-mode shapes (sole-bucket, dominant-bucket, two-bucket-split, spread-floor)
- `src/client/src/app/features/landscape/competitive-read/view-clauses.ts` — 3 view-flavored Clause 2 libraries + distributional vocab
- `src/client/src/app/features/landscape/competitive-read/momentum-clause.ts` — shared Clause 3
- `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts` — full scenario test matrix + inline `makeStats()` factory
- `src/client/src/app/features/landscape/timeline-stats.ts` — moved from `competitive-read.ts:173-214`
- `src/client/src/app/features/landscape/timeline-stats.spec.ts` — moved from `competitive-read.spec.ts:151-191`

**Modified:**
- `src/client/src/app/features/landscape/bullseye-controls-panel.component.ts` — replace 90-line `readText` computed (lines 267-360) with one-liner that calls `buildLandscapeRead()`
- `src/client/src/app/features/landscape/competitive-read-bar.component.ts` — same as above (lines 73-167); becomes a thin shell since the duplicate logic disappears
- `src/client/src/app/features/landscape/density-controls-panel.component.ts` — replace `readText` (lines 330-353) with `buildLandscapeRead()` call
- `src/client/src/app/features/landscape/timeline-insight-strip.component.ts` — update import path + call shape (line 138)

**Deleted:**
- `src/client/src/app/features/landscape/competitive-read.ts` — fully replaced
- `src/client/src/app/features/landscape/competitive-read.spec.ts` — replaced by spec in the new module + `timeline-stats.spec.ts`

---

## Task ordering and parallelism

Tasks 1-11 build the new module bottom-up: skeleton → headlines → view clauses → momentum → orchestrator → adapters. Tasks 12-17 migrate the four call sites and clean up old files. Task 18 is final verification.

Within phases, the following tasks are independent and can be parallelized when using subagent-driven execution:
- Tasks 2, 3, 4 (competitive headlines) — all touch the same file but each shape's code is self-contained
- Tasks 5, 6 (distributional headlines) — same file
- Tasks 7, 8, 9, 10 (view clauses, momentum) — different files
- Tasks 14, 15, 16 (migrating the three spoke-side components) — different files

Tasks 1, 11, 12, 13, 17, 18 are gating and must run in order.

---

### Task 1: Module skeleton, public types, and ReadStats

**Files:**
- Create: `src/client/src/app/features/landscape/competitive-read/index.ts`
- Create: `src/client/src/app/features/landscape/competitive-read/read-stats.ts`
- Create: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Create `read-stats.ts` with the ReadStats type and adapter signatures**

```typescript
import { Company } from '../../../core/models/company.model';
import { BullseyeSpoke } from '../../../core/models/landscape.model';

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

export function fromCompanies(_companies: Company[], _today?: string): ReadStats[] {
  throw new Error('not implemented');
}

export function fromSpokes(_spokes: BullseyeSpoke[]): ReadStats[] {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Create `index.ts` with public types and a stub orchestrator**

```typescript
import { ReadStats } from './read-stats';

export type LandscapeView = 'radial' | 'density' | 'timeline';
export type LandscapeGroupBy = 'company' | 'indication' | 'moa' | 'roa' | 'asset';

export interface BuildReadInput {
  view: LandscapeView;
  groupBy: LandscapeGroupBy;
  stats: ReadStats[];
}

export interface ReadSegment {
  clause: 'headline' | 'view' | 'momentum';
  shape: string;
  detail: string;
}

export interface LandscapeRead {
  text: string;
  segments: ReadSegment[];
}

export { ReadStats, ReadCatalyst, fromCompanies, fromSpokes } from './read-stats';

export function buildLandscapeRead(input: BuildReadInput): LandscapeRead {
  if (input.stats.length === 0) {
    return { text: '', segments: [] };
  }
  throw new Error('not implemented');
}

export function escapeName(name: string): string {
  return name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 3: Create `competitive-read.spec.ts` with the inline `makeStats` factory and one passing test for the empty case**

```typescript
import { describe, it, expect } from 'vitest';
import { buildLandscapeRead, ReadStats } from './index';

function makeStats(input: Array<Partial<ReadStats> & { name: string }>): ReadStats[] {
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
  });
});
```

- [ ] **Step 4: Run the spec to confirm it passes**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Scaffold landscape competitive-read module"
```

---

### Task 2: Competitive headline — sole-entrant and clear-leader

**Files:**
- Create: `src/client/src/app/features/landscape/competitive-read/competitive-headlines.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/index.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing tests for sole-entrant and clear-leader**

Append to `competitive-read.spec.ts` describe block:

```typescript
  describe('competitive mode (group-by: company)', () => {
    describe('headline shapes', () => {
      it('sole-entrant: single entity, no comparison', () => {
        const stats = makeStats([
          { name: 'Pfizer', assetCount: 1, trialCount: 2, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ clause: 'headline', shape: 'sole-entrant' });
        expect(result.text).toContain('Pfizer: only entrant (1 asset at Phase 3)');
      });

      it('clear-leader: leader beats #2 by 1 on lateStageCount', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 2, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ clause: 'headline', shape: 'clear-leader' });
        expect(result.text).toContain('Lilly leads: 3 assets, 3 at Phase 3');
      });

      it('clear-leader: tiebreak on assetCount when lateStage is tied at 0', () => {
        const stats = makeStats([
          { name: 'A', assetCount: 5, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'B', assetCount: 3, highestPhase: 'P1', highestPhaseRank: 2 },
          { name: 'C', assetCount: 3, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'clear-leader' });
        expect(result.text).toContain('A leads: 5 assets, furthest at Phase 1');
      });
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 3 tests failing with "not implemented".

- [ ] **Step 3: Create `competitive-headlines.ts` with classifier scaffolding and the two shapes**

```typescript
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
  const text = `<strong class="leader-name">${escapeName(s.name)}</strong>: ${detail}`;
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
  const text = `<strong class="leader-name">${escapeName(leader.name)}</strong> leads: ${detail}`;
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
```

- [ ] **Step 4: Wire the classifier into `buildLandscapeRead` in `index.ts`**

Replace the `throw new Error('not implemented')` block in `index.ts` `buildLandscapeRead` with:

```typescript
import { classifyCompetitive } from './competitive-headlines';

export function buildLandscapeRead(input: BuildReadInput): LandscapeRead {
  if (input.stats.length === 0) {
    return { text: '', segments: [] };
  }

  if (input.groupBy === 'company') {
    const headline = classifyCompetitive(input.stats);
    return { text: headline.text, segments: [headline.segment] };
  }

  throw new Error('not implemented');
}
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 4 tests passing (1 empty + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Add sole-entrant and clear-leader competitive headlines"
```

---

### Task 3: Competitive headline — sweep and tied

**Files:**
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-headlines.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing tests for sweep and tied shapes**

Append to the `competitive mode > headline shapes` describe block:

```typescript
      it('sweep: one entity holds 100% of late-stage with >=2 P3 and >=2 entities', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, p3Count: 0, lateStageCount: 0, highestPhase: 'P2', highestPhaseRank: 3 },
          { name: 'BI', assetCount: 1, p3Count: 0, lateStageCount: 0, highestPhase: 'P1', highestPhaseRank: 2 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'sweep' });
        expect(result.text).toContain('Lilly sweep: all 3 Phase 3 assets in view');
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
        expect(result.text).toContain('Lilly and Novo tied: 3 P3 each');
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
        expect(result.text).toContain('Lilly and Novo tied: 3 P3 each (BI trailing at 1)');
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 5 new tests failing (current classifier always returns clear-leader for >1 entity).

- [ ] **Step 3: Add sweep and tied shape functions to `competitive-headlines.ts`**

Add inside `competitive-headlines.ts` (before `classifyCompetitive`):

```typescript
function sweepHeadline(leader: ReadStats): HeadlineResult {
  const detail = `all ${leader.lateStageCount} Phase 3 assets in view`;
  const text = `<strong class="leader-name">${escapeName(leader.name)}</strong> sweep: ${detail}`;
  return {
    segment: { clause: 'headline', shape: 'sweep', detail },
    text,
    leader,
  };
}

function tiedHeadline(tied: ReadStats[], rest: ReadStats[]): HeadlineResult {
  const names = tied.map((s) => `<strong class="leader-name">${escapeName(s.name)}</strong>`).join(' and ');
  const tiedCount = tied[0].lateStageCount;
  let detail = `${tiedCount} P3 each`;
  let text = `${names} tied: ${detail}`;

  if (rest.length > 0 && rest[0].lateStageCount <= tiedCount / 2) {
    const trail = rest[0];
    text += ` (<strong>${escapeName(trail.name)}</strong> trailing at ${trail.lateStageCount})`;
    detail += ` (${trail.name} trailing at ${trail.lateStageCount})`;
  }

  return {
    segment: { clause: 'headline', shape: 'tied', detail },
    text,
    leader: tied[0],
  };
}
```

- [ ] **Step 4: Update `classifyCompetitive` to detect sweep and tied in priority order**

Replace the existing `classifyCompetitive` with:

```typescript
export function classifyCompetitive(stats: ReadStats[]): HeadlineResult {
  if (stats.length === 1) return soleEntrantHeadline(stats[0]);

  const sorted = sortForLeadership(stats);
  const totalLateStage = sorted.reduce((sum, s) => sum + s.lateStageCount, 0);

  if (sorted[0].lateStageCount === totalLateStage && totalLateStage >= 2) {
    return sweepHeadline(sorted[0]);
  }

  const tied = sorted.filter((s) => s.lateStageCount === sorted[0].lateStageCount);
  if (tied.length >= 2 && sorted[0].lateStageCount >= 1) {
    return tiedHeadline(tied, sorted.slice(tied.length));
  }

  return clearLeaderHeadline(sorted[0]);
}
```

- [ ] **Step 5: Run tests and verify all pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 9 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Add sweep and tied competitive headlines"
```

---

### Task 4: Competitive headline — fragmented and count-floor

**Files:**
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-headlines.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing tests for fragmented and count-floor**

Append to the `competitive mode > headline shapes` describe block:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 3 new tests failing.

- [ ] **Step 3: Add fragmented and count-floor shape functions to `competitive-headlines.ts`**

Add inside `competitive-headlines.ts` (before `classifyCompetitive`):

```typescript
function fragmentedHeadline(stats: ReadStats[]): HeadlineResult {
  const phase = phaseLabel(stats[0].highestPhase);
  const detail = `${stats.length} sponsors at ${phase}, no late-stage activity`;
  return {
    segment: { clause: 'headline', shape: 'fragmented', detail },
    text: detail,
  };
}

function countFloorHeadline(stats: ReadStats[]): HeadlineResult {
  const totalAssets = stats.reduce((sum, s) => sum + s.assetCount, 0);
  const detail = `${stats.length} sponsors, ${totalAssets} assets total`;
  return {
    segment: { clause: 'headline', shape: 'count-floor', detail },
    text: detail,
  };
}
```

- [ ] **Step 4: Extend `classifyCompetitive` to check fragmented and fall through to count-floor**

Replace `classifyCompetitive` with:

```typescript
export function classifyCompetitive(stats: ReadStats[]): HeadlineResult {
  if (stats.length === 1) return soleEntrantHeadline(stats[0]);

  const sorted = sortForLeadership(stats);
  const totalLateStage = sorted.reduce((sum, s) => sum + s.lateStageCount, 0);

  if (sorted[0].lateStageCount === totalLateStage && totalLateStage >= 2) {
    return sweepHeadline(sorted[0]);
  }

  const tied = sorted.filter((s) => s.lateStageCount === sorted[0].lateStageCount);
  if (tied.length >= 2 && sorted[0].lateStageCount >= 1) {
    return tiedHeadline(tied, sorted.slice(tied.length));
  }

  const allTiedAtAssetCount = sorted.every((s) => s.assetCount === sorted[0].assetCount);
  if (sorted.length >= 3 && totalLateStage === 0 && allTiedAtAssetCount) {
    return fragmentedHeadline(sorted);
  }

  if (sorted[0].lateStageCount === 0 && sorted[0].assetCount === sorted[1].assetCount) {
    return countFloorHeadline(sorted);
  }

  return clearLeaderHeadline(sorted[0]);
}
```

- [ ] **Step 5: Run tests and verify all pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 12 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Add fragmented and count-floor competitive headlines"
```

---

### Task 5: Distributional headlines — sole-bucket and dominant-bucket

**Files:**
- Create: `src/client/src/app/features/landscape/competitive-read/distributional-headlines.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/index.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing tests for sole-bucket and dominant-bucket**

Append to spec file (new top-level describe):

```typescript
  describe('distributional mode (group-by: indication / moa / roa)', () => {
    describe('headline shapes', () => {
      it('sole-bucket: all assets in one bucket', () => {
        const stats = makeStats([
          { name: 'Diabetes', assetCount: 6, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'indication', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'sole-bucket' });
        expect(result.text).toContain('All 6 assets in Diabetes');
      });

      it('dominant-bucket: top bucket has >=50%', () => {
        const stats = makeStats([
          { name: 'Diabetes', assetCount: 5, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Obesity', assetCount: 1, highestPhase: 'P2', highestPhaseRank: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'indication', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'dominant-bucket' });
        expect(result.text).toContain('Concentrated in Diabetes: 5 of 6 assets');
      });

      it('dominant-bucket: boundary at exactly 50%', () => {
        const stats = makeStats([
          { name: 'A', assetCount: 3 },
          { name: 'B', assetCount: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'indication', stats });
        expect(result.segments[0].shape).toBe('dominant-bucket');
        expect(result.text).toContain('Concentrated in A: 3 of 6 assets');
      });
    });
  });
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 3 new tests failing with "not implemented".

- [ ] **Step 3: Create `distributional-headlines.ts` with the first two shapes and a classifier stub**

```typescript
import { escapeName, ReadSegment } from './index';
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
```

Re-export `HeadlineResult` from `competitive-headlines.ts` if it isn't already; if needed, update `competitive-headlines.ts` to add `export` to the existing `HeadlineResult` interface.

- [ ] **Step 4: Wire `classifyDistributional` into `buildLandscapeRead`**

Update `index.ts` `buildLandscapeRead`:

```typescript
import { classifyCompetitive } from './competitive-headlines';
import { classifyDistributional } from './distributional-headlines';

export function buildLandscapeRead(input: BuildReadInput): LandscapeRead {
  if (input.stats.length === 0) {
    return { text: '', segments: [] };
  }

  const isDistributional =
    input.groupBy === 'indication' || input.groupBy === 'moa' || input.groupBy === 'roa';

  const headline = input.groupBy === 'company'
    ? classifyCompetitive(input.stats)
    : isDistributional
    ? classifyDistributional(input.stats)
    : classifyCompetitive(input.stats); // 'asset' falls through; handled later

  return { text: headline.text, segments: [headline.segment] };
}
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 15 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Add sole-bucket and dominant-bucket distributional headlines"
```

---

### Task 6: Distributional headlines — two-bucket-split and spread

**Files:**
- Modify: `src/client/src/app/features/landscape/competitive-read/distributional-headlines.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing tests for two-bucket-split and spread**

Append to the `distributional mode > headline shapes` describe block:

```typescript
      it('two-bucket-split: top 2 buckets sum to >=80%', () => {
        const stats = makeStats([
          { name: 'Diabetes', assetCount: 3 },
          { name: 'Obesity', assetCount: 2 },
          { name: 'NASH', assetCount: 1 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'indication', stats });
        expect(result.segments[0]).toMatchObject({ shape: 'two-bucket-split' });
        expect(result.text).toContain('Split between Diabetes and Obesity: 3 + 2 of 6 assets');
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 2 tests failing (one with "not implemented", one with wrong shape).

- [ ] **Step 3: Add two shape functions and finish the classifier in `distributional-headlines.ts`**

Add to `distributional-headlines.ts`:

```typescript
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

  if (sorted[0].assetCount / total >= 0.5) {
    return dominantBucketHeadline(sorted[0], total);
  }

  if (sorted.length >= 2 && (sorted[0].assetCount + sorted[1].assetCount) / total >= 0.8) {
    return twoBucketSplitHeadline(sorted[0], sorted[1], total);
  }

  return spreadHeadline(sorted, groupBy);
}
```

Note: `classifyDistributional` now takes a `groupBy` argument so the noun in `spread` matches the axis.

- [ ] **Step 4: Update `buildLandscapeRead` to pass `groupBy` to `classifyDistributional`**

In `index.ts`:

```typescript
const headline = input.groupBy === 'company'
  ? classifyCompetitive(input.stats)
  : isDistributional
  ? classifyDistributional(input.stats, input.groupBy)
  : classifyCompetitive(input.stats);
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 17 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Add two-bucket-split and spread distributional headlines"
```

---

### Task 7: Radial view clause

**Files:**
- Create: `src/client/src/app/features/landscape/competitive-read/view-clauses.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/index.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing tests for radial view-clause templates**

Append a new describe block:

```typescript
    describe('radial Clause 2', () => {
      it('only-credible-challenger after clear-leader', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, p3Count: 1, lateStageCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('only-credible-challenger');
        expect(result.text).toContain('Novo only credible challenger');
      });

      it('no-credible-challengers after sweep', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, lateStageCount: 0, highestPhase: 'P2', highestPhaseRank: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('no-credible-challengers');
        expect(result.text).toContain('closest is Novo at Phase 2');
      });

      it('broader-portfolio after tied', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 4, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        const viewSeg = result.segments.find((s) => s.clause === 'view');
        expect(viewSeg?.shape).toBe('broader-portfolio');
        expect(result.text).toContain('Lilly broader portfolio (4 assets vs 3)');
      });

      it('suppressed after sole-entrant', () => {
        const stats = makeStats([
          { name: 'Pfizer', assetCount: 1, highestPhase: 'P3', highestPhaseRank: 4 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.segments.find((s) => s.clause === 'view')).toBeUndefined();
      });
    });
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 4 new tests failing.

- [ ] **Step 3: Create `view-clauses.ts` with the radial library**

```typescript
import { escapeName, ReadSegment } from './index';
import { ReadStats } from './read-stats';
import { HeadlineResult } from './competitive-headlines';

const PHASE_LABEL: Record<string, string> = {
  PRECLIN: 'Preclinical',
  P1: 'Phase 1',
  P2: 'Phase 2',
  P3: 'Phase 3',
  P4: 'Phase 4',
  APPROVED: 'Approved',
  LAUNCHED: 'Launched',
};

export interface ViewClauseResult {
  segment: ReadSegment;
  text: string;
}

export function radialViewClause(
  headline: HeadlineResult,
  allStats: ReadStats[]
): ViewClauseResult | null {
  const shape = headline.segment.shape;

  if (shape === 'sole-entrant' || shape === 'fragmented' || shape === 'count-floor') {
    return null;
  }

  if (shape === 'clear-leader' && headline.leader) {
    const challenger = allStats
      .filter((s) => s !== headline.leader && s.p3Count > 0)
      .sort((a, b) => b.p3Count - a.p3Count)[0];
    if (challenger) {
      const detail = `${challenger.name} only credible challenger (${challenger.p3Count === 1 ? '1 asset' : `${challenger.p3Count} assets`} at Phase 3)`;
      return {
        segment: { clause: 'view', shape: 'only-credible-challenger', detail },
        text: `<strong>${escapeName(challenger.name)}</strong> only credible challenger (${challenger.p3Count === 1 ? '1 asset' : `${challenger.p3Count} assets`} at Phase 3)`,
      };
    }
  }

  if (shape === 'sweep' && headline.leader) {
    const closest = allStats
      .filter((s) => s !== headline.leader)
      .sort((a, b) => b.highestPhaseRank - a.highestPhaseRank)[0];
    if (closest) {
      const phase = PHASE_LABEL[closest.highestPhase] ?? closest.highestPhase;
      const detail = `no credible challengers — closest is ${closest.name} at ${phase}`;
      return {
        segment: { clause: 'view', shape: 'no-credible-challengers', detail },
        text: `no credible challengers — closest is <strong>${escapeName(closest.name)}</strong> at ${phase}`,
      };
    }
  }

  if (shape === 'tied' && headline.leader) {
    const tiedNames = new Set(
      allStats.filter((s) => s.lateStageCount === headline.leader!.lateStageCount).map((s) => s.name)
    );
    const tiedStats = allStats.filter((s) => tiedNames.has(s.name));
    const broadest = [...tiedStats].sort((a, b) => b.assetCount - a.assetCount)[0];
    const others = tiedStats.filter((s) => s !== broadest);
    if (broadest && others.length > 0 && broadest.assetCount > others[0].assetCount) {
      const detail = `${broadest.name} broader portfolio (${broadest.assetCount} assets vs ${others[0].assetCount})`;
      return {
        segment: { clause: 'view', shape: 'broader-portfolio', detail },
        text: `<strong>${escapeName(broadest.name)}</strong> broader portfolio (${broadest.assetCount} assets vs ${others[0].assetCount})`,
      };
    }
  }

  return null;
}
```

- [ ] **Step 4: Wire the view clause into `buildLandscapeRead`**

Update `index.ts`:

```typescript
import { classifyCompetitive } from './competitive-headlines';
import { classifyDistributional } from './distributional-headlines';
import { radialViewClause } from './view-clauses';

export function buildLandscapeRead(input: BuildReadInput): LandscapeRead {
  if (input.stats.length === 0) {
    return { text: '', segments: [] };
  }

  const isDistributional =
    input.groupBy === 'indication' || input.groupBy === 'moa' || input.groupBy === 'roa';

  const headline = input.groupBy === 'company'
    ? classifyCompetitive(input.stats)
    : isDistributional
    ? classifyDistributional(input.stats, input.groupBy)
    : classifyCompetitive(input.stats);

  const segments: ReadSegment[] = [headline.segment];
  const parts: string[] = [headline.text];

  let viewClause: ViewClauseResult | null = null;
  if (input.view === 'radial') {
    viewClause = radialViewClause(headline, input.stats);
  }

  if (viewClause) {
    segments.push(viewClause.segment);
    parts.push(viewClause.text);
  }

  return { text: parts.join(' | '), segments };
}
```

Add `import { ViewClauseResult } from './view-clauses';` near the top.

- [ ] **Step 5: Run tests and verify they pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 21 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Add radial view clause templates"
```

---

### Task 8: Density view clause

**Files:**
- Modify: `src/client/src/app/features/landscape/competitive-read/view-clauses.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/index.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing tests for density Clause 2**

Append:

```typescript
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 3 new tests failing.

- [ ] **Step 3: Add density view clause to `view-clauses.ts`**

Append to `view-clauses.ts`:

```typescript
function phaseCountFromHighest(stats: ReadStats[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of stats) {
    counts[s.highestPhase] = (counts[s.highestPhase] ?? 0) + s.assetCount;
  }
  return counts;
}

export function densityViewClause(
  _headline: HeadlineResult,
  allStats: ReadStats[]
): ViewClauseResult | null {
  const totalAssets = allStats.reduce((sum, s) => sum + s.assetCount, 0);
  if (totalAssets === 0) return null;

  const phaseCounts = phaseCountFromHighest(allStats);
  const entries = Object.entries(phaseCounts).sort((a, b) => b[1] - a[1]);
  const [topPhase, topCount] = entries[0];
  const topFraction = topCount / totalAssets;

  if (topFraction >= 0.6) {
    const phaseLabel = PHASE_LABEL[topPhase] ?? topPhase;
    const detail = `${topCount} of ${totalAssets} assets clustered at ${phaseLabel}`;
    return {
      segment: { clause: 'view', shape: 'clustered-at-phase', detail },
      text: detail,
    };
  }

  const maxFraction = entries[0][1] / totalAssets;
  if (maxFraction < 0.4) {
    const detail = 'evenly spread across phases';
    return {
      segment: { clause: 'view', shape: 'evenly-spread', detail },
      text: detail,
    };
  }

  return null;
}
```

- [ ] **Step 4: Wire `densityViewClause` into `buildLandscapeRead`**

In `index.ts`, change the view-clause branch:

```typescript
import { densityViewClause, radialViewClause } from './view-clauses';

// ...

let viewClause: ViewClauseResult | null = null;
if (input.view === 'radial') {
  viewClause = radialViewClause(headline, input.stats);
} else if (input.view === 'density') {
  viewClause = densityViewClause(headline, input.stats);
}
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 24 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Add density view clause templates"
```

---

### Task 9: Timeline view clause

**Files:**
- Modify: `src/client/src/app/features/landscape/competitive-read/view-clauses.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/index.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing tests for timeline Clause 2**

Append:

```typescript
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
        expect(result.text).toContain('3 readouts in next 90 days — all Lilly');
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 4 new tests failing.

- [ ] **Step 3: Add timeline view clause to `view-clauses.ts`**

Append:

```typescript
function catalystsInWindow(stats: ReadStats[]): { entity: string; count: number }[] {
  const map = new Map<string, number>();
  for (const s of stats) {
    const c = (s.upcomingCatalysts ?? []).filter((x) => x.daysOut >= 0 && x.daysOut <= 90).length;
    if (c > 0) map.set(s.name, c);
  }
  return Array.from(map.entries())
    .map(([entity, count]) => ({ entity, count }))
    .sort((a, b) => b.count - a.count);
}

export function timelineViewClause(
  headline: HeadlineResult,
  allStats: ReadStats[]
): ViewClauseResult | null {
  const breakdown = catalystsInWindow(allStats);
  const totalInWindow = breakdown.reduce((sum, b) => sum + b.count, 0);

  if (headline.segment.shape === 'sole-entrant') {
    const cats = allStats[0].upcomingCatalysts ?? [];
    const next = cats.filter((c) => c.daysOut >= 0).sort((a, b) => a.daysOut - b.daysOut)[0];
    if (next && next.daysOut <= 90) {
      const detail = `next catalyst in ${next.daysOut} days: ${next.trialName} readout`;
      return {
        segment: { clause: 'view', shape: 'next-catalyst', detail },
        text: detail,
      };
    }
    return null;
  }

  if (totalInWindow === 0) {
    const detail = 'no near-term catalysts (next readout > 12 months)';
    return {
      segment: { clause: 'view', shape: 'no-near-term-catalysts', detail },
      text: detail,
    };
  }

  if (breakdown.length === 1) {
    const detail = `${totalInWindow} ${totalInWindow === 1 ? 'readout' : 'readouts'} in next 90 days — all ${breakdown[0].entity}`;
    return {
      segment: { clause: 'view', shape: 'all-from-one-entity', detail },
      text: detail,
    };
  }

  const breakdownText = breakdown.map((b) => `${b.count} ${b.entity}`).join(', ');
  const detail = `${totalInWindow} ${totalInWindow === 1 ? 'catalyst' : 'catalysts'} in next 90 days (${breakdownText})`;
  return {
    segment: { clause: 'view', shape: 'catalyst-window', detail },
    text: detail,
  };
}
```

- [ ] **Step 4: Wire `timelineViewClause` into `buildLandscapeRead`**

In `index.ts`:

```typescript
import { densityViewClause, radialViewClause, timelineViewClause } from './view-clauses';

// ...

let viewClause: ViewClauseResult | null = null;
if (input.view === 'radial') {
  viewClause = radialViewClause(headline, input.stats);
} else if (input.view === 'density') {
  viewClause = densityViewClause(headline, input.stats);
} else if (input.view === 'timeline') {
  viewClause = timelineViewClause(headline, input.stats);
}
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 28 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Add timeline view clause templates"
```

---

### Task 10: Momentum clause

**Files:**
- Create: `src/client/src/app/features/landscape/competitive-read/momentum-clause.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/index.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing tests for momentum**

Append:

```typescript
    describe('momentum Clause 3', () => {
      it('emits when non-leader has >= 3 recent changes (timeline view)', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, lateStageCount: 0, recentChanges: 5, highestPhase: 'P2', highestPhaseRank: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'timeline', groupBy: 'company', stats });
        const momentum = result.segments.find((s) => s.clause === 'momentum');
        expect(momentum?.shape).toBe('most-active');
        expect(result.text).toContain('Novo most active (5 recent changes)');
      });

      it('uses "recent events" wording for spoke views', () => {
        const stats = makeStats([
          { name: 'Lilly', assetCount: 3, p3Count: 3, lateStageCount: 3, highestPhase: 'P3', highestPhaseRank: 4 },
          { name: 'Novo', assetCount: 1, lateStageCount: 0, recentChanges: 5, highestPhase: 'P2', highestPhaseRank: 3 },
        ]);
        const result = buildLandscapeRead({ view: 'radial', groupBy: 'company', stats });
        expect(result.text).toContain('Novo most active (5 recent events)');
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
        // Novo is the challenger in view clause AND would qualify for momentum; suppressed.
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 5 new tests failing.

- [ ] **Step 3: Create `momentum-clause.ts`**

```typescript
import { escapeName, LandscapeView, ReadSegment } from './index';
import { ReadStats } from './read-stats';
import { HeadlineResult } from './competitive-headlines';
import { ViewClauseResult } from './view-clauses';

const MOMENTUM_THRESHOLD = 3;

export interface MomentumResult {
  segment: ReadSegment;
  text: string;
}

export function momentumClause(
  view: LandscapeView,
  headline: HeadlineResult,
  viewClause: ViewClauseResult | null,
  allStats: ReadStats[]
): MomentumResult | null {
  if (headline.segment.shape === 'sole-entrant') return null;

  const viewClauseEntity =
    viewClause?.segment.detail.match(/^(\S+)/)?.[1] ?? null;

  const candidates = allStats
    .filter((s) => s !== headline.leader)
    .filter((s) => s.recentChanges >= MOMENTUM_THRESHOLD)
    .sort((a, b) => b.recentChanges - a.recentChanges);

  const winner = candidates[0];
  if (!winner) return null;

  if (viewClauseEntity && winner.name === viewClauseEntity) return null;

  const noun = view === 'timeline' ? 'recent changes' : 'recent events';
  const detail = `${winner.name} most active (${winner.recentChanges} ${noun})`;
  return {
    segment: { clause: 'momentum', shape: 'most-active', detail },
    text: `<strong>${escapeName(winner.name)}</strong> most active (${winner.recentChanges} ${noun})`,
  };
}
```

- [ ] **Step 4: Wire `momentumClause` into `buildLandscapeRead`**

In `index.ts`, after building `viewClause`:

```typescript
import { momentumClause } from './momentum-clause';

// ...

const momentum = momentumClause(input.view, headline, viewClause, input.stats);
if (momentum) {
  segments.push(momentum.segment);
  parts.push(momentum.text);
}

return { text: parts.join(' | '), segments };
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 33 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Add momentum clause"
```

---

### Task 11: Distributional view clauses, asset group-by, HTML escaping

**Files:**
- Modify: `src/client/src/app/features/landscape/competitive-read/view-clauses.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/index.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing tests for distributional view clauses, asset group-by, escaping**

Append:

```typescript
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

  describe('edge cases', () => {
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 6 new tests failing (escaping and zero-momentum may already pass; the distributional-view ones will fail).

- [ ] **Step 3: Add distributional view-clause functions to `view-clauses.ts`**

Append:

```typescript
function distributionalLeader(headline: HeadlineResult): ReadStats | null {
  return headline.leader ?? null;
}

export function distributionalRadialClause(headline: HeadlineResult): ViewClauseResult | null {
  const leader = distributionalLeader(headline);
  if (!leader) return null;
  if (leader.p3Count === 0) return null;
  const detail = `${leader.name} bucket has the deepest pipeline (${leader.p3Count} at Phase 3)`;
  return {
    segment: { clause: 'view', shape: 'deepest-bucket', detail },
    text: detail,
  };
}

export function distributionalDensityClause(headline: HeadlineResult): ViewClauseResult | null {
  const leader = distributionalLeader(headline);
  if (!leader) return null;
  if (leader.lateStageCount === 0) return null;
  const detail = `Late-stage activity concentrated in ${leader.name}`;
  return {
    segment: { clause: 'view', shape: 'late-stage-concentrated-in', detail },
    text: detail,
  };
}

export function distributionalTimelineClause(
  headline: HeadlineResult,
  allStats: ReadStats[]
): ViewClauseResult | null {
  const leader = distributionalLeader(headline);
  if (!leader) return null;

  const leaderCatalysts = (leader.upcomingCatalysts ?? []).filter(
    (c) => c.daysOut >= 0 && c.daysOut <= 90
  );

  if (leaderCatalysts.length > 0) {
    const detail = `Next ${leaderCatalysts.length} readouts cluster in ${leader.name}`;
    return {
      segment: { clause: 'view', shape: 'readouts-cluster-in', detail },
      text: detail,
    };
  }

  const anyCatalysts = allStats.some((s) =>
    (s.upcomingCatalysts ?? []).some((c) => c.daysOut >= 0 && c.daysOut <= 90)
  );
  if (!anyCatalysts) return null;

  const detail = `${leader.name} bucket quiet — no catalysts in next 90 days`;
  return {
    segment: { clause: 'view', shape: 'bucket-quiet', detail },
    text: detail,
  };
}
```

- [ ] **Step 4: Add asset group-by handling and distributional view-clause routing in `index.ts`**

Replace `buildLandscapeRead` with:

```typescript
import { classifyCompetitive } from './competitive-headlines';
import { classifyDistributional } from './distributional-headlines';
import {
  densityViewClause,
  distributionalDensityClause,
  distributionalRadialClause,
  distributionalTimelineClause,
  radialViewClause,
  timelineViewClause,
  ViewClauseResult,
} from './view-clauses';
import { momentumClause } from './momentum-clause';

export function buildLandscapeRead(input: BuildReadInput): LandscapeRead {
  if (input.stats.length === 0) {
    return { text: '', segments: [] };
  }

  if (input.groupBy === 'asset') {
    return buildAssetGroupRead(input);
  }

  const isDistributional =
    input.groupBy === 'indication' || input.groupBy === 'moa' || input.groupBy === 'roa';

  const headline = isDistributional
    ? classifyDistributional(input.stats, input.groupBy)
    : classifyCompetitive(input.stats);

  const segments: ReadSegment[] = [headline.segment];
  const parts: string[] = [headline.text];

  let viewClause: ViewClauseResult | null = null;
  if (isDistributional) {
    if (input.view === 'radial') viewClause = distributionalRadialClause(headline);
    else if (input.view === 'density') viewClause = distributionalDensityClause(headline);
    else if (input.view === 'timeline') viewClause = distributionalTimelineClause(headline, input.stats);
  } else {
    if (input.view === 'radial') viewClause = radialViewClause(headline, input.stats);
    else if (input.view === 'density') viewClause = densityViewClause(headline, input.stats);
    else if (input.view === 'timeline') viewClause = timelineViewClause(headline, input.stats);
  }

  if (viewClause) {
    segments.push(viewClause.segment);
    parts.push(viewClause.text);
  }

  const momentum = momentumClause(input.view, headline, viewClause, input.stats);
  if (momentum) {
    segments.push(momentum.segment);
    parts.push(momentum.text);
  }

  return { text: parts.join(' | '), segments };
}

function buildAssetGroupRead(input: BuildReadInput): LandscapeRead {
  const total = input.stats.length;
  const sponsors = new Set<string>();
  for (const s of input.stats) sponsors.add(s.name);
  const detail = `Showing ${total} assets across ${sponsors.size} sponsors`;
  return {
    text: detail,
    segments: [{ clause: 'headline', shape: 'asset-count-summary', detail }],
  };
}
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 39 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Add distributional view clauses, asset group-by, escaping tests"
```

---

### Task 12: Adapter `fromCompanies`

**Files:**
- Modify: `src/client/src/app/features/landscape/competitive-read/read-stats.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing tests for `fromCompanies`**

Append:

```typescript
  describe('adapters', () => {
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
```

Add `fromCompanies` to the imports at the top of the spec file:

```typescript
import { buildLandscapeRead, fromCompanies, ReadStats } from './index';
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 1 test failing with "not implemented".

- [ ] **Step 3: Implement `fromCompanies` in `read-stats.ts`**

Replace the stub:

```typescript
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
            upcomingCatalysts.push({ daysOut, trialName: trial.name, eventDate: marker.event_date });
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
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 40 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Implement fromCompanies adapter"
```

---

### Task 13: Adapter `fromSpokes`

**Files:**
- Modify: `src/client/src/app/features/landscape/competitive-read/read-stats.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read/competitive-read.spec.ts`

- [ ] **Step 1: Add failing test for `fromSpokes`**

Append to the `adapters` describe block:

```typescript
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
```

Update imports:

```typescript
import { buildLandscapeRead, fromCompanies, fromSpokes, ReadStats } from './index';
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 1 test failing with "not implemented".

- [ ] **Step 3: Implement `fromSpokes` in `read-stats.ts`**

Add to `read-stats.ts`:

```typescript
import { RING_DEV_RANK, RingPhase } from '../../../core/models/landscape.model';

const SPOKE_LATE_STAGE_THRESHOLD = RING_DEV_RANK['P3'];

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
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd src/client && npx vitest run src/app/features/landscape/competitive-read/competitive-read.spec.ts`
Expected: 41 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read/
git commit -m "Implement fromSpokes adapter"
```

---

### Task 14: Move `computeTimelineStats` to its own file

**Files:**
- Create: `src/client/src/app/features/landscape/timeline-stats.ts`
- Create: `src/client/src/app/features/landscape/timeline-stats.spec.ts`
- Modify: `src/client/src/app/features/landscape/competitive-read.ts` (remove lines 173-214)
- Modify: `src/client/src/app/features/landscape/competitive-read.spec.ts` (remove lines 151-191)

- [ ] **Step 1: Create `timeline-stats.ts` by copying lines 173-214 from `competitive-read.ts`**

```typescript
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
```

- [ ] **Step 2: Create `timeline-stats.spec.ts` by copying lines 151-191 from `competitive-read.spec.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { Company } from '../../core/models/company.model';
import { computeTimelineStats } from './timeline-stats';

function makeCompany(
  name: string,
  assets: { trials: { phase_type?: string; markers?: { event_date: string }[] }[] }[]
): Company {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    space_id: 'sp', created_by: 'u', name, logo_url: null, display_order: 0,
    created_at: '', updated_at: '', updated_by: null,
    assets: assets.map((a, i) => ({
      id: `a${i}`, space_id: 'sp', created_by: 'u', company_id: '',
      name: `Asset ${i}`, generic_name: null, logo_url: null, display_order: 0,
      created_at: '', updated_at: '', updated_by: null,
      trials: a.trials.map((t, j) => ({
        id: `t${i}-${j}`, space_id: 'sp', created_by: 'u', asset_id: `a${i}`,
        name: `Trial ${j}`, identifier: null, status: null, notes: null,
        display_order: 0, created_at: '', updated_at: '', updated_by: null,
        phase_type: t.phase_type ?? null, phase_start_date: null, phase_end_date: null,
        markers: (t.markers ?? []).map((m, k) => ({
          id: `m${k}`, space_id: 'sp', marker_type_id: '', title: '',
          projection: 'projected' as const, event_date: m.event_date, end_date: null,
          is_projected: true, no_longer_expected: false, marker_assignments: [],
        })),
        recent_changes_count: 0, most_recent_change_type: null,
      })),
    })),
  };
}

describe('computeTimelineStats', () => {
  it('returns zeros for empty input', () => {
    const result = computeTimelineStats([], '2026-01-01');
    expect(result).toEqual({ companyCount: 0, assetCount: 0, trialCount: 0, catalystCount90d: 0 });
  });

  it('counts companies, assets, trials', () => {
    const companies = [
      makeCompany('A', [
        { trials: [{ phase_type: 'P1' }, { phase_type: 'P2' }] },
        { trials: [{ phase_type: 'P3' }] },
      ]),
      makeCompany('B', [{ trials: [{ phase_type: 'P1' }] }]),
    ];
    const result = computeTimelineStats(companies, '2026-01-01');
    expect(result.companyCount).toBe(2);
    expect(result.assetCount).toBe(3);
    expect(result.trialCount).toBe(4);
  });

  it('counts catalysts within 90-day window', () => {
    const co = makeCompany('A', [
      {
        trials: [
          {
            phase_type: 'P3',
            markers: [
              { event_date: '2025-12-31' },
              { event_date: '2026-01-01' },
              { event_date: '2026-03-31' },
              { event_date: '2026-04-01' },
              { event_date: '2026-04-02' },
            ],
          },
        ],
      },
    ]);
    const result = computeTimelineStats([co], '2026-01-01');
    expect(result.catalystCount90d).toBe(3);
  });
});
```

- [ ] **Step 3: Run new spec to verify it passes**

Run: `cd src/client && npx vitest run src/app/features/landscape/timeline-stats.spec.ts`
Expected: 3 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/landscape/timeline-stats.ts src/client/src/app/features/landscape/timeline-stats.spec.ts
git commit -m "Move computeTimelineStats to its own file"
```

---

### Task 15: Migrate `timeline-insight-strip.component.ts`

**Files:**
- Modify: `src/client/src/app/features/landscape/timeline-insight-strip.component.ts`

- [ ] **Step 1: Read the current file to find the import and call**

Run: `cd /Users/aadityamadala/Documents/code/clint-v2 && grep -n "buildCompetitiveRead\|computeTimelineStats\|from './competitive-read'" src/client/src/app/features/landscape/timeline-insight-strip.component.ts`
Expected: lines around 138 reference `buildCompetitiveRead`.

- [ ] **Step 2: Replace the import and call**

Change the import:
```typescript
// OLD
import { buildCompetitiveRead, computeTimelineStats } from './competitive-read';

// NEW
import { buildLandscapeRead, fromCompanies } from './competitive-read/index';
import { computeTimelineStats } from './timeline-stats';
```

Change the call site (was `buildCompetitiveRead(companies)`):
```typescript
// OLD
const result = buildCompetitiveRead(companies);

// NEW
const result = buildLandscapeRead({
  view: 'timeline',
  groupBy: 'company',
  stats: fromCompanies(companies),
});
```

The returned shape is unchanged (`{ text, segments }`); template bindings keep working.

- [ ] **Step 3: Run lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/landscape/timeline-insight-strip.component.ts
git commit -m "Migrate timeline-insight-strip to buildLandscapeRead"
```

---

### Task 16: Migrate `bullseye-controls-panel.component.ts`

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-controls-panel.component.ts`

- [ ] **Step 1: Replace the readText computed (lines 267-344)**

Replace lines 267-344 (the `readText` computed and helpers) with:

```typescript
  protected readonly readText = computed<string>(() => {
    const result = buildLandscapeRead({
      view: 'radial',
      groupBy: this.grouping(),
      stats: fromSpokes(this.spokes()),
    });
    return result.text;
  });
```

Delete the helper methods `formatPhase` and `escapeName` from this component (lines 346-360).

- [ ] **Step 2: Update imports**

At the top of the file, add:
```typescript
import { buildLandscapeRead, fromSpokes } from './competitive-read/index';
```

Verify `SpokeStats` type and `RING_DEV_RANK`, `PHASE_COLOR` imports are still needed elsewhere in the file — if not used after the deletion, remove them.

- [ ] **Step 3: Verify the `grouping` input matches the new `LandscapeGroupBy` type**

The existing `SpokeGrouping` type from `landscape.model.ts` should map directly. If `SpokeGrouping` differs from `LandscapeGroupBy`, add a small cast or normalizer at the call site (single line). Confirm via:

Run: `cd /Users/aadityamadala/Documents/code/clint-v2 && grep -n "SpokeGrouping" src/client/src/app/core/models/landscape.model.ts`

If `SpokeGrouping` is identical (`'company' | 'indication' | 'moa' | 'roa' | 'asset'`), no cast is needed.

- [ ] **Step 4: Run lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/bullseye-controls-panel.component.ts
git commit -m "Migrate bullseye-controls-panel to buildLandscapeRead"
```

---

### Task 17: Migrate `competitive-read-bar.component.ts` and `density-controls-panel.component.ts`

**Files:**
- Modify: `src/client/src/app/features/landscape/competitive-read-bar.component.ts`
- Modify: `src/client/src/app/features/landscape/density-controls-panel.component.ts`

- [ ] **Step 1: Replace `competitive-read-bar.component.ts` readText (lines 73-150) and helpers (lines 152-167)**

Replace the entire `readText` computed and the two private helpers with:

```typescript
  readonly readText = computed<string>(() => {
    const result = buildLandscapeRead({
      view: 'radial',
      groupBy: this.grouping(),
      stats: fromSpokes(this.spokes()),
    });
    return result.text;
  });
```

Add imports:
```typescript
import { buildLandscapeRead, fromSpokes } from './competitive-read/index';
```

Remove the now-unused `SpokeStats` interface (lines 10-19) and `RING_DEV_RANK` / `RingPhase` imports if unused.

- [ ] **Step 2: Replace `density-controls-panel.component.ts` readText (lines 330-353)**

Find the current `readText` computed and replace its body with:

```typescript
  protected readonly readText = computed<string>(() => {
    const result = buildLandscapeRead({
      view: 'density',
      groupBy: this.grouping(),
      stats: fromSpokes(this.spokes()),
    });
    return result.text;
  });
```

Add the same import line:
```typescript
import { buildLandscapeRead, fromSpokes } from './competitive-read/index';
```

Remove any now-unused local helpers and types.

- [ ] **Step 3: Run lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/landscape/competitive-read-bar.component.ts src/client/src/app/features/landscape/density-controls-panel.component.ts
git commit -m "Migrate competitive-read-bar and density-controls-panel to buildLandscapeRead"
```

---

### Task 18: Delete old `competitive-read.ts` and `competitive-read.spec.ts`, run final verification

**Files:**
- Delete: `src/client/src/app/features/landscape/competitive-read.ts`
- Delete: `src/client/src/app/features/landscape/competitive-read.spec.ts`

- [ ] **Step 1: Confirm no remaining references to the old generator**

Run: `cd /Users/aadityamadala/Documents/code/clint-v2 && grep -rn "from './competitive-read'\|from '../../competitive-read'\|buildCompetitiveRead" src/client/src/`
Expected: zero matches (the new module is imported from `./competitive-read/index`, not `./competitive-read`).

- [ ] **Step 2: Delete the old files**

```bash
rm src/client/src/app/features/landscape/competitive-read.ts
rm src/client/src/app/features/landscape/competitive-read.spec.ts
```

- [ ] **Step 3: Run full lint, build, and test suite**

```bash
cd src/client && ng lint && ng build && npx vitest run src/app/features/landscape/
```

Expected: lint passes, build passes, all tests pass (≥41 new module tests + 3 timeline-stats tests).

- [ ] **Step 4: Manual smoke verification**

Start the dev server and exercise the three views:

```bash
cd src/client && npm run start:local
```

Then in a browser at `http://localhost:4200`:

1. Sign in to a tenant space with the seeded GLP-1 data.
2. Navigate to `/landscape/bullseye`. Confirm the READ headline reads sensibly (no "deepest pipeline" claim when Lilly is the sweep leader). Cycle through all 5 GROUP BY options (Company, Indication, MoA, RoA, Asset). Confirm headline vocabulary changes between competitive and distributional modes.
3. Navigate to `/landscape/timeline`. Confirm the READ now mentions upcoming catalysts (the old READ did not).
4. Navigate to `/landscape/density`. Confirm the READ uses the competitive headline for Company group-by and distributional for Indication / MoA / RoA.

- [ ] **Step 5: Commit**

```bash
git add -u src/client/src/app/features/landscape/
git commit -m "Remove old competitive-read.ts and spec"
```

---

## Self-Review

### Spec coverage

| Spec section | Covered by |
|---|---|
| Three clauses (headline + view + momentum) | Tasks 2-4 (headlines), 7-9, 11 (view clauses), 10 (momentum) |
| Two modes (competitive / distributional) | Tasks 2-4 (competitive), 5-6 (distributional) |
| 5 competitive headline shapes | Tasks 2-4 |
| 4 distributional headline shapes | Tasks 5-6 |
| Asset group-by count summary | Task 11 |
| Radial view-clause library | Task 7 |
| Density view-clause library | Task 8 |
| Timeline view-clause library | Task 9 |
| Distributional view-clause library | Task 11 |
| Momentum threshold ≥3, wording per view | Task 10 |
| Edge cases (empty, escaping, zero momentum) | Tasks 1, 11 |
| Adapters (`fromCompanies`, `fromSpokes`) | Tasks 12, 13 |
| Move `computeTimelineStats` | Task 14 |
| Migrate 4 call sites | Tasks 15-17 |
| Delete old generator + spec | Task 18 |
| Manual smoke (3 views, 5 group-bys) | Task 18 Step 4 |

All spec requirements have at least one task. No gaps.

### Type consistency

- `ReadStats` interface defined in Task 1, referenced by name in every subsequent task.
- `LandscapeRead`, `ReadSegment`, `BuildReadInput`, `LandscapeView`, `LandscapeGroupBy` defined in Task 1, used consistently.
- `HeadlineResult` defined in Task 2 (`competitive-headlines.ts`), imported by `distributional-headlines.ts` (Task 5), `view-clauses.ts` (Task 7), `momentum-clause.ts` (Task 10).
- `ViewClauseResult` defined in Task 7, used in Tasks 8-11.
- `MomentumResult` defined in Task 10.
- `escapeName()` defined in Task 1 in `index.ts`, used by all clause modules.
- Function names match across tasks: `classifyCompetitive` (Tasks 2-4), `classifyDistributional` (Tasks 5-6 — note signature change in Task 6 to add `groupBy` parameter), `radialViewClause` / `densityViewClause` / `timelineViewClause` / `distributionalRadialClause` / `distributionalDensityClause` / `distributionalTimelineClause` (Tasks 7-9, 11), `momentumClause` (Task 10).
- `MOMENTUM_THRESHOLD = 3` constant lives in `momentum-clause.ts` (Task 10).

### Placeholder scan

No "TBD" / "implement later" / "handle edge cases" / "similar to Task N" patterns found. Every step contains the actual code or command.

The `throw new Error('not implemented')` lines in Tasks 1 and 5 are intentional scaffolding to make later TDD steps fail loudly until the real implementation lands; they are replaced in the same or next task.
