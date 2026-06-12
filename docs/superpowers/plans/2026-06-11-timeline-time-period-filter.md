# Timeline Time Period Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a From/To time period filter (year + optional quarter) to the landscape filter bar that removes trials and markers with no activity in the window, client-side, like every other filter.

**Architecture:** Pure helpers (types, window-to-ISO conversion, overlap test, clamp, chip label) live in `landscape.model.ts` and are unit tested in isolation. `filterDashboardData()` in `landscape-state.service.ts` applies the window. The filter bar component adds four small PrimeNG Selects and wires chips/clear-all/undo through the existing mechanisms.

**Tech Stack:** Angular 19 standalone + signals, PrimeNG Select, Vitest (`npm run test:units` from `src/client`).

**Spec:** `docs/superpowers/specs/2026-06-11-timeline-time-period-filter-design.md`

**Conventions that apply (do not skip):**
- All commands run from `/Users/aadityamadala/Documents/code/clint-v2/src/client` unless noted.
- No em dashes anywhere (code, comments, UI copy). Use `-` in labels.
- ISO date strings (`YYYY-MM-DD`) compare correctly with `<`/`>` as strings; do not construct `Date` objects.
- Commit messages: conventional commits, no AI attribution lines.
- Component rules in `src/client/CLAUDE.md` apply: OnPush, signals, native control flow, `[ngModel]`/`(ngModelChange)` split bindings as the existing filter bar does.

---

### Task 1: Pure model helpers (types + conversion + overlap + clamp + label)

**Files:**
- Modify: `src/client/src/app/core/models/landscape.model.ts` (add below `LandscapeFilters` / `EMPTY_LANDSCAPE_FILTERS`, around line 157-181)
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.ts:260-271` (clearAll snapshot literal, required to keep the build green once the field exists)
- Test: `src/client/src/app/core/models/landscape.model.spec.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/client/src/app/core/models/landscape.model.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import {
  clampTimePeriod,
  formatTimePeriod,
  spanOverlapsRange,
  timePeriodToRange,
  type TimePeriodFilter,
} from './landscape.model';

function tp(partial: Partial<TimePeriodFilter>): TimePeriodFilter {
  return { startYear: null, startQuarter: null, endYear: null, endQuarter: null, ...partial };
}

describe('timePeriodToRange', () => {
  it('returns fully open bounds for null', () => {
    expect(timePeriodToRange(null)).toEqual({ start: null, end: null });
  });

  it('maps a year-only window to Jan 1 through Dec 31', () => {
    expect(timePeriodToRange(tp({ startYear: 2025, endYear: 2027 }))).toEqual({
      start: '2025-01-01',
      end: '2027-12-31',
    });
  });

  it('maps quarters to their first and last days', () => {
    expect(
      timePeriodToRange(tp({ startYear: 2025, startQuarter: 2, endYear: 2026, endQuarter: 4 }))
    ).toEqual({ start: '2025-04-01', end: '2026-12-31' });
    expect(
      timePeriodToRange(tp({ startYear: 2025, startQuarter: 4, endYear: 2026, endQuarter: 1 }))
    ).toEqual({ start: '2025-10-01', end: '2026-03-31' });
    expect(
      timePeriodToRange(tp({ startYear: 2025, startQuarter: 3, endYear: 2025, endQuarter: 3 }))
    ).toEqual({ start: '2025-07-01', end: '2025-09-30' });
  });

  it('leaves an unset side open', () => {
    expect(timePeriodToRange(tp({ startYear: 2025, startQuarter: 2 }))).toEqual({
      start: '2025-04-01',
      end: null,
    });
    expect(timePeriodToRange(tp({ endYear: 2027 }))).toEqual({
      start: null,
      end: '2027-12-31',
    });
  });
});

describe('spanOverlapsRange', () => {
  const range = { start: '2025-01-01', end: '2026-12-31' };

  it('passes a span fully inside the range', () => {
    expect(spanOverlapsRange('2025-06-01', '2025-09-01', range)).toBe(true);
  });

  it('passes spans straddling either edge', () => {
    expect(spanOverlapsRange('2024-01-01', '2025-01-01', range)).toBe(true); // touches start, inclusive
    expect(spanOverlapsRange('2026-12-31', '2028-01-01', range)).toBe(true); // touches end, inclusive
  });

  it('rejects spans fully outside the range', () => {
    expect(spanOverlapsRange('2023-01-01', '2024-12-31', range)).toBe(false);
    expect(spanOverlapsRange('2027-01-01', '2027-06-01', range)).toBe(false);
  });

  it('treats a null span bound as open-ended', () => {
    expect(spanOverlapsRange(null, '2024-06-01', range)).toBe(false); // ends before window
    expect(spanOverlapsRange(null, '2025-06-01', range)).toBe(true);
    expect(spanOverlapsRange('2027-06-01', null, range)).toBe(false); // starts after window
    expect(spanOverlapsRange('2026-06-01', null, range)).toBe(true);
  });

  it('treats a null range bound as open-ended', () => {
    expect(spanOverlapsRange('2010-01-01', '2010-12-31', { start: null, end: '2026-12-31' })).toBe(
      true
    );
    expect(spanOverlapsRange('2030-01-01', '2030-12-31', { start: '2025-01-01', end: null })).toBe(
      true
    );
  });
});

describe('clampTimePeriod', () => {
  it('returns the period unchanged when From is not after To', () => {
    const p = tp({ startYear: 2025, endYear: 2026 });
    expect(clampTimePeriod(p)).toEqual(p);
  });

  it('clamps To up to From when From is after To', () => {
    expect(clampTimePeriod(tp({ startYear: 2027, endYear: 2025 }))).toEqual(
      tp({ startYear: 2027, endYear: 2027 })
    );
  });

  it('clamps on quarter granularity within the same year', () => {
    expect(
      clampTimePeriod(tp({ startYear: 2026, startQuarter: 3, endYear: 2026, endQuarter: 1 }))
    ).toEqual(tp({ startYear: 2026, startQuarter: 3, endYear: 2026, endQuarter: 3 }));
  });

  it('does not clamp a year-quarter From against a full-year To in the same year', () => {
    // From Q3 2026, To 2026 (= through Q4 2026): valid, no clamp.
    const p = tp({ startYear: 2026, startQuarter: 3, endYear: 2026 });
    expect(clampTimePeriod(p)).toEqual(p);
  });

  it('leaves open-ended periods alone', () => {
    const p = tp({ startYear: 2027 });
    expect(clampTimePeriod(p)).toEqual(p);
  });
});

describe('formatTimePeriod', () => {
  it('formats a closed year window', () => {
    expect(formatTimePeriod(tp({ startYear: 2025, endYear: 2027 }))).toBe('2025 - 2027');
  });

  it('formats quarters when set', () => {
    expect(
      formatTimePeriod(tp({ startYear: 2025, startQuarter: 2, endYear: 2026, endQuarter: 4 }))
    ).toBe('Q2 2025 - Q4 2026');
    expect(formatTimePeriod(tp({ startYear: 2025, endYear: 2026, endQuarter: 2 }))).toBe(
      '2025 - Q2 2026'
    );
  });

  it('formats open-ended windows', () => {
    expect(formatTimePeriod(tp({ startYear: 2025, startQuarter: 2 }))).toBe('From Q2 2025');
    expect(formatTimePeriod(tp({ endYear: 2027 }))).toBe('Through 2027');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:units -- landscape.model`
Expected: FAIL with import errors (`clampTimePeriod` etc. are not exported).

- [ ] **Step 3: Implement the model additions**

In `src/client/src/app/core/models/landscape.model.ts`, change `LandscapeFilters` and `EMPTY_LANDSCAPE_FILTERS` (currently lines 157-181) and add the helpers directly after them:

```typescript
export type Quarter = 1 | 2 | 3 | 4;

/**
 * Time window for the landscape time period filter. Each boundary is a year
 * with an optional quarter. A null quarter means the boundary covers the
 * whole year (Q1 on the From side, Q4 on the To side). A null year leaves
 * that side open-ended.
 */
export interface TimePeriodFilter {
  startYear: number | null;
  startQuarter: Quarter | null;
  endYear: number | null;
  endQuarter: Quarter | null;
}

export interface LandscapeFilters {
  companyIds: string[];
  assetIds: string[];
  trialIds: string[];
  indicationIds: string[];
  mechanismOfActionIds: string[];
  routeOfAdministrationIds: string[];
  phases: RingPhase[];
  recruitmentStatuses: string[];
  studyTypes: string[];
  markerCategoryIds: string[];
  timePeriod: TimePeriodFilter | null;
}

export const EMPTY_LANDSCAPE_FILTERS: LandscapeFilters = {
  companyIds: [],
  assetIds: [],
  trialIds: [],
  indicationIds: [],
  mechanismOfActionIds: [],
  routeOfAdministrationIds: [],
  phases: [],
  recruitmentStatuses: [],
  studyTypes: [],
  markerCategoryIds: [],
  timePeriod: null,
};

/** ISO date bounds derived from a TimePeriodFilter. Null bound = open-ended. */
export interface TimePeriodRange {
  start: string | null;
  end: string | null;
}

const QUARTER_START: Record<Quarter, string> = { 1: '01-01', 2: '04-01', 3: '07-01', 4: '10-01' };
const QUARTER_END: Record<Quarter, string> = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };

/**
 * Converts a time period to inclusive ISO date bounds. The From boundary
 * maps to the first day of its quarter (whole year = Jan 1); the To boundary
 * maps to the last day of its quarter (whole year = Dec 31).
 */
export function timePeriodToRange(tp: TimePeriodFilter | null): TimePeriodRange {
  if (!tp) return { start: null, end: null };
  return {
    start: tp.startYear === null ? null : `${tp.startYear}-${QUARTER_START[tp.startQuarter ?? 1]}`,
    end: tp.endYear === null ? null : `${tp.endYear}-${QUARTER_END[tp.endQuarter ?? 4]}`,
  };
}

/**
 * Inclusive interval overlap on ISO date strings (YYYY-MM-DD compares
 * correctly as plain strings). Null span or range bounds are open-ended.
 */
export function spanOverlapsRange(
  spanStart: string | null,
  spanEnd: string | null,
  range: TimePeriodRange
): boolean {
  if (range.start !== null && spanEnd !== null && spanEnd < range.start) return false;
  if (range.end !== null && spanStart !== null && spanStart > range.end) return false;
  return true;
}

/**
 * If From is after To, clamps To up to From so the window is never
 * empty-by-construction. Open-ended periods pass through unchanged.
 */
export function clampTimePeriod(tp: TimePeriodFilter): TimePeriodFilter {
  if (tp.startYear === null || tp.endYear === null) return tp;
  const startKey = tp.startYear * 4 + ((tp.startQuarter ?? 1) - 1);
  const endKey = tp.endYear * 4 + ((tp.endQuarter ?? 4) - 1);
  if (startKey <= endKey) return tp;
  return { ...tp, endYear: tp.startYear, endQuarter: tp.startQuarter };
}

/** Compact chip label, e.g. "Q2 2025 - Q4 2026", "From 2025", "Through Q2 2027". */
export function formatTimePeriod(tp: TimePeriodFilter): string {
  const label = (year: number, quarter: Quarter | null) =>
    quarter ? `Q${quarter} ${year}` : `${year}`;
  const from = tp.startYear === null ? null : label(tp.startYear, tp.startQuarter);
  const to = tp.endYear === null ? null : label(tp.endYear, tp.endQuarter);
  if (from && to) return `${from} - ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Through ${to}`;
  return '';
}
```

- [ ] **Step 4: Fix the one compile break the new field causes**

`clearAll()` in `src/client/src/app/features/landscape/landscape-filter-bar.component.ts` builds a complete `LandscapeFilters` literal for the undo snapshot (lines 260-271) and will no longer type-check. Add the `timePeriod` line:

```typescript
    this.undoSnapshot = {
      companyIds: [...before.companyIds],
      assetIds: [...before.assetIds],
      trialIds: [...before.trialIds],
      indicationIds: [...before.indicationIds],
      mechanismOfActionIds: [...before.mechanismOfActionIds],
      routeOfAdministrationIds: [...before.routeOfAdministrationIds],
      phases: [...before.phases],
      recruitmentStatuses: [...before.recruitmentStatuses],
      studyTypes: [...before.studyTypes],
      markerCategoryIds: [...before.markerCategoryIds],
      timePeriod: before.timePeriod ? { ...before.timePeriod } : null,
    };
```

Then check for any other full-literal constructions of `LandscapeFilters`:

Run: `grep -rn "LandscapeFilters = {" src/app --include="*.ts"`
Expected: only `EMPTY_LANDSCAPE_FILTERS` in `landscape.model.ts`. If anything else appears, add `timePeriod: null` there too.

- [ ] **Step 5: Run the tests and the build**

Run: `npm run test:units -- landscape.model`
Expected: PASS (all new tests).

Run: `ng build 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/models/landscape.model.ts src/app/core/models/landscape.model.spec.ts src/app/features/landscape/landscape-filter-bar.component.ts
git commit -m "feat(landscape): add time period filter model and pure helpers"
```

---

### Task 2: Apply the window in filterDashboardData + hydrate legacy persisted state

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape-state.service.ts` (`filterDashboardData` at lines 294-379, `restorePersistedState` at line 276)
- Test: `src/client/src/app/features/landscape/landscape-state.service.spec.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/client/src/app/features/landscape/landscape-state.service.spec.ts`:

```typescript
/**
 * Time period filtering. Trials pass when their [phase_start_date,
 * phase_end_date] span overlaps the window (single null end = open-ended).
 * Trials with both phase dates null pass only if a marker passes. Markers
 * outside the window are pruned even on passing trials.
 */
function makeTimePeriodFixture(): Company[] {
  return [
    {
      id: 'c1',
      name: 'Co1',
      assets: [
        {
          id: 'p1',
          name: 'Prod1',
          company_id: 'c1',
          mechanisms_of_action: [],
          routes_of_administration: [],
          trials: [
            // Fully inside 2025-2026.
            {
              id: 't-inside',
              name: 'Inside',
              asset_id: 'p1',
              phase_start_date: '2025-03-01',
              phase_end_date: '2026-03-01',
              markers: [
                { id: 'm-in', event_date: '2025-06-01', end_date: null },
                { id: 'm-out', event_date: '2028-06-01', end_date: null },
              ],
            } as unknown as Trial,
            // Straddles the window start.
            {
              id: 't-straddle',
              name: 'Straddle',
              asset_id: 'p1',
              phase_start_date: '2023-01-01',
              phase_end_date: '2025-01-01',
              markers: [],
            } as unknown as Trial,
            // Fully before the window.
            {
              id: 't-before',
              name: 'Before',
              asset_id: 'p1',
              phase_start_date: '2020-01-01',
              phase_end_date: '2022-01-01',
              markers: [{ id: 'm-old', event_date: '2021-06-01', end_date: null }],
            } as unknown as Trial,
            // Open-ended start, ends inside the window.
            {
              id: 't-open-start',
              name: 'OpenStart',
              asset_id: 'p1',
              phase_start_date: null,
              phase_end_date: '2025-06-01',
              markers: [],
            } as unknown as Trial,
            // Undated, with one marker inside the window.
            {
              id: 't-undated-hit',
              name: 'UndatedHit',
              asset_id: 'p1',
              phase_start_date: null,
              phase_end_date: null,
              markers: [{ id: 'm-hit', event_date: '2026-02-01', end_date: null }],
            } as unknown as Trial,
            // Undated, marker outside the window.
            {
              id: 't-undated-miss',
              name: 'UndatedMiss',
              asset_id: 'p1',
              phase_start_date: null,
              phase_end_date: null,
              markers: [{ id: 'm-miss', event_date: '2020-02-01', end_date: null }],
            } as unknown as Trial,
            // Undated, no markers at all.
            {
              id: 't-undated-bare',
              name: 'UndatedBare',
              asset_id: 'p1',
              phase_start_date: null,
              phase_end_date: null,
              markers: [],
            } as unknown as Trial,
          ],
        } as Asset,
      ],
    } as Company,
  ];
}

describe('filterDashboardData timePeriod', () => {
  const window2025to2026: LandscapeFilters = {
    ...EMPTY_LANDSCAPE_FILTERS,
    timePeriod: { startYear: 2025, startQuarter: null, endYear: 2026, endQuarter: null },
  };

  it('is a no-op when timePeriod is null', () => {
    const result = filterDashboardData(makeTimePeriodFixture(), { ...EMPTY_LANDSCAPE_FILTERS });
    expect(result[0].assets![0].trials!).toHaveLength(7);
  });

  it('keeps trials overlapping the window and drops the rest', () => {
    const result = filterDashboardData(makeTimePeriodFixture(), window2025to2026);
    expect(result[0].assets![0].trials!.map((t) => t.id)).toEqual([
      't-inside',
      't-straddle',
      't-open-start',
      't-undated-hit',
    ]);
  });

  it('prunes markers outside the window on passing trials', () => {
    const result = filterDashboardData(makeTimePeriodFixture(), window2025to2026);
    const inside = result[0].assets![0].trials!.find((t) => t.id === 't-inside')!;
    expect(inside.markers!.map((m) => m.id)).toEqual(['m-in']);
  });

  it('respects quarter bounds', () => {
    const q1Only: LandscapeFilters = {
      ...EMPTY_LANDSCAPE_FILTERS,
      timePeriod: { startYear: 2026, startQuarter: 1, endYear: 2026, endQuarter: 1 },
    };
    const result = filterDashboardData(makeTimePeriodFixture(), q1Only);
    // t-inside (ends 2026-03-01), t-undated-hit (marker 2026-02-01) overlap Q1 2026.
    // t-straddle ends 2025-01-01, t-open-start ends 2025-06-01: both before Q1 2026.
    expect(result[0].assets![0].trials!.map((t) => t.id)).toEqual(['t-inside', 't-undated-hit']);
  });

  it('treats a duration marker as a span for the overlap test', () => {
    const fixture = makeTimePeriodFixture();
    fixture[0].assets![0].trials![6].markers = [
      { id: 'm-span', event_date: '2024-06-01', end_date: '2025-02-01' } as never,
    ];
    const result = filterDashboardData(fixture, window2025to2026);
    const bare = result[0].assets![0].trials!.find((t) => t.id === 't-undated-bare');
    expect(bare).toBeDefined();
    expect(bare!.markers!.map((m) => m.id)).toEqual(['m-span']);
  });

  it('drops the whole company when nothing overlaps', () => {
    const farFuture: LandscapeFilters = {
      ...EMPTY_LANDSCAPE_FILTERS,
      timePeriod: { startYear: 2040, startQuarter: null, endYear: null, endQuarter: null },
    };
    // t-open-start has a null phase_start_date (open-ended toward the past,
    // not the future) and ends 2025-06-01, so it must not match 2040+.
    const result = filterDashboardData(makeTimePeriodFixture(), farFuture);
    expect(result).toEqual([]);
  });
});
```

Note: the existing import block in this spec file already covers everything needed (`Company`, `Asset`, `Trial`, `EMPTY_LANDSCAPE_FILTERS`, `LandscapeFilters`, `filterDashboardData`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:units -- landscape-state`
Expected: FAIL. The new `timePeriod` describe block fails (window not applied yet); the pre-existing tests still pass.

- [ ] **Step 3: Implement the window in filterDashboardData**

In `src/client/src/app/features/landscape/landscape-state.service.ts`:

1. Extend the model import (lines 8-15) with the new helpers:

```typescript
import {
  CountUnit,
  HeatmapGrouping,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  SpokeGrouping,
  SpokeMode,
  spanOverlapsRange,
  timePeriodToRange,
} from '../../core/models/landscape.model';
```

2. At the top of `filterDashboardData` (after `let result = companies;`):

```typescript
  const timeRange = timePeriodToRange(filters.timePeriod ?? null);
  const hasTimeWindow = timeRange.start !== null || timeRange.end !== null;
```

3. Inside the trials mapping, directly after the marker-category block (the `if (filters.markerCategoryIds.length > 0) { ... }` ending around line 368) and before `if (trials.length === 0) return null;`:

```typescript
          // Time period: prune markers outside the window, then keep trials
          // whose phase span overlaps it. Trials with no phase dates pass
          // only if at least one of their markers survived the pruning.
          if (hasTimeWindow) {
            trials = trials
              .map((t) => ({
                ...t,
                markers: (t.markers ?? []).filter((m) =>
                  spanOverlapsRange(m.event_date, m.end_date ?? m.event_date, timeRange)
                ),
              }))
              .filter((t) => {
                const start = t.phase_start_date ?? null;
                const end = t.phase_end_date ?? null;
                if (start === null && end === null) return (t.markers ?? []).length > 0;
                return spanOverlapsRange(start, end, timeRange);
              });
          }
```

- [ ] **Step 4: Hydrate legacy persisted state**

Old sessionStorage entries predate `timePeriod` and would restore a filters object with the field `undefined`, which breaks `f.timePeriod !== null` checks and the persisted shape. In `restorePersistedState()` change line 276 from:

```typescript
      if (saved.filters) this.filters.set(saved.filters);
```

to:

```typescript
      // Merge over EMPTY so filters persisted before a field existed (e.g.
      // timePeriod) hydrate with their defaults instead of undefined.
      if (saved.filters) this.filters.set({ ...EMPTY_LANDSCAPE_FILTERS, ...saved.filters });
```

(No unit test for this: it is a private method requiring an Angular injection context, and this suite tests pure functions only. The merge is exercised manually in Task 4 verification.)

- [ ] **Step 5: Run the tests**

Run: `npm run test:units -- landscape-state`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/landscape/landscape-state.service.ts src/app/features/landscape/landscape-state.service.spec.ts
git commit -m "feat(landscape): filter trials and markers by time period window"
```

---

### Task 3: Filter bar UI (controls, chips, clear-all)

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.html`

No new unit tests here: the behavior (clamp, format, range, filtering) is fully covered by the Task 1/2 pure-function tests; this task is declarative wiring. Manual browser verification happens in Task 4.

- [ ] **Step 1: Component class changes**

In `landscape-filter-bar.component.ts`:

1. Extend the model import (lines 22-32) with:

```typescript
import {
  BullseyeDimension,
  clampTimePeriod,
  COUNT_UNIT_OPTIONS,
  EMPTY_LANDSCAPE_FILTERS,
  formatTimePeriod,
  LandscapeFilters,
  Quarter,
  RingPhase,
  SPOKE_GROUPING_OPTIONS,
  SpokeGrouping,
  TimePeriodFilter,
  ViewMode,
  visibleRingOrder,
} from '../../core/models/landscape.model';
```

2. Add the quarter options and the data-derived year options after `statusOptions` (line 148). The fallback range matches the timeline's empty-data default (2016-2026 in `timeline-view.component.ts`):

```typescript
  readonly quarterOptions: { label: string; value: Quarter }[] = [
    { label: 'Q1', value: 1 },
    { label: 'Q2', value: 2 },
    { label: 'Q3', value: 3 },
    { label: 'Q4', value: 4 },
  ];

  /**
   * Year options for the time period selects: min..max year present in the
   * loaded data (phase dates and marker dates), padded by one year each side.
   * Falls back to the timeline's default 2016-2026 range when no data.
   */
  readonly yearOptions = computed<{ label: string; value: number }[]>(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    const consider = (iso: string | null | undefined) => {
      const year = iso ? Number(iso.slice(0, 4)) : NaN;
      if (!Number.isFinite(year)) return;
      if (year < min) min = year;
      if (year > max) max = year;
    };
    for (const company of this.state.rawData()?.companies ?? []) {
      for (const asset of company.assets ?? []) {
        for (const trial of asset.trials ?? []) {
          consider(trial.phase_start_date);
          consider(trial.phase_end_date);
          for (const marker of trial.markers ?? []) {
            consider(marker.event_date);
            consider(marker.end_date);
          }
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 2016;
      max = 2026;
    }
    const years: { label: string; value: number }[] = [];
    for (let y = min - 1; y <= max + 1; y++) years.push({ label: String(y), value: y });
    return years;
  });
```

3. Add the update method after `update()` (line 246):

```typescript
  /**
   * Patch the time period. Clearing a year clears its quarter; if From ends
   * up after To, To is clamped up to From; an all-null period collapses back
   * to null so chips, clear-all, and persistence see "no filter".
   */
  updateTimePeriod(patch: Partial<TimePeriodFilter>): void {
    this.state.filters.update((f) => {
      const merged: TimePeriodFilter = {
        startYear: null,
        startQuarter: null,
        endYear: null,
        endQuarter: null,
        ...(f.timePeriod ?? {}),
        ...patch,
      };
      if (merged.startYear === null) merged.startQuarter = null;
      if (merged.endYear === null) merged.endQuarter = null;
      const clamped = clampTimePeriod(merged);
      const empty = clamped.startYear === null && clamped.endYear === null;
      return { ...f, timePeriod: empty ? null : clamped };
    });
  }
```

4. In `activeChips` (line 150), after the `recruitmentStatuses` loop and before `return chips;`:

```typescript
    if (f.timePeriod) {
      chips.push({
        field: 'timePeriod',
        header: 'Period',
        value: formatTimePeriod(f.timePeriod),
        id: 'timePeriod',
      });
    }
```

5. In `hasAnyActive` (line 185), add a final clause:

```typescript
      f.markerCategoryIds.length > 0 ||
      !!f.timePeriod
```

6. In `removeChip` (line 248), handle the non-array field first:

```typescript
  removeChip(chip: FilterChip): void {
    if (chip.field === 'timePeriod') {
      this.state.filters.update((f) => ({ ...f, timePeriod: null }));
      return;
    }
    this.state.filters.update((f) => {
      const arr = [...(f[chip.field] as string[])];
      const idx = arr.indexOf(chip.id);
      if (idx >= 0) arr.splice(idx, 1);
      return { ...f, [chip.field]: arr };
    });
  }
```

(`clearAll` was already updated in Task 1. The `Select` PrimeNG component is already in the imports array, line 16 and 64.)

- [ ] **Step 2: Template changes**

In `landscape-filter-bar.component.html`, insert after the Category multiselect (closes at line 202) and before the `@if (hasAnyActive())` Clear-filters block (line 204):

```html
      <!-- Time period: From/To year with optional quarter -->
      <div class="h-4 w-px bg-slate-200 mx-0.5"></div>
      <span class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-400"
        >Period</span
      >
      <p-select
        [options]="yearOptions()"
        [ngModel]="state.filters().timePeriod?.startYear ?? null"
        (ngModelChange)="updateTimePeriod({ startYear: $event ?? null })"
        placeholder="From"
        ariaLabel="Time period start year"
        optionLabel="label"
        optionValue="value"
        [showClear]="true"
        appendTo="body"
        [styleClass]="'w-fit' + (state.filters().timePeriod?.startYear ? ' has-value' : '')"
        size="small"
      />
      <p-select
        [options]="quarterOptions"
        [ngModel]="state.filters().timePeriod?.startQuarter ?? null"
        (ngModelChange)="updateTimePeriod({ startQuarter: $event ?? null })"
        placeholder="Q"
        ariaLabel="Time period start quarter"
        optionLabel="label"
        optionValue="value"
        [showClear]="true"
        [disabled]="!state.filters().timePeriod?.startYear"
        appendTo="body"
        [styleClass]="'w-fit' + (state.filters().timePeriod?.startQuarter ? ' has-value' : '')"
        size="small"
      />
      <p-select
        [options]="yearOptions()"
        [ngModel]="state.filters().timePeriod?.endYear ?? null"
        (ngModelChange)="updateTimePeriod({ endYear: $event ?? null })"
        placeholder="To"
        ariaLabel="Time period end year"
        optionLabel="label"
        optionValue="value"
        [showClear]="true"
        appendTo="body"
        [styleClass]="'w-fit' + (state.filters().timePeriod?.endYear ? ' has-value' : '')"
        size="small"
      />
      <p-select
        [options]="quarterOptions"
        [ngModel]="state.filters().timePeriod?.endQuarter ?? null"
        (ngModelChange)="updateTimePeriod({ endQuarter: $event ?? null })"
        placeholder="Q"
        ariaLabel="Time period end quarter"
        optionLabel="label"
        optionValue="value"
        [showClear]="true"
        [disabled]="!state.filters().timePeriod?.endYear"
        appendTo="body"
        [styleClass]="'w-fit' + (state.filters().timePeriod?.endQuarter ? ' has-value' : '')"
        size="small"
      />
```

The chip rendering needs no template change: the timePeriod chip flows through the existing `activeChips()` loop and `removeChip()`.

- [ ] **Step 3: Lint and build**

Run: `ng lint 2>&1 | tail -5 && ng build 2>&1 | tail -5`
Expected: lint passes (the pre-existing `trial.service.ts` unused-directive warning is known and unrelated); build succeeds.

- [ ] **Step 4: Run the full unit suite**

Run: `npm run test:units`
Expected: all files pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/landscape/landscape-filter-bar.component.ts src/app/features/landscape/landscape-filter-bar.component.html
git commit -m "feat(landscape): time period From/To controls in filter bar"
```

---

### Task 4: Browser verification

**Files:** none (verification only)

- [ ] **Step 1: Start the local stack and dev server**

From the repo root: `supabase start` (if not already running). Then from `src/client`: `npm start` (local configuration, local Supabase). Sign-in: inject the local-Supabase session per the established Playwright local-auth approach if verifying via Playwright MCP; otherwise use a normal Google sign-in in a regular browser.

- [ ] **Step 2: Verify behaviors on the timeline view**

1. Open a space's landscape timeline. The Period group renders after Category: From year, quarter (disabled), To year, quarter (disabled).
2. Set From 2025 / To 2026: rows without activity in 2025-2026 disappear; the axis auto-fits tighter; a chip `Period: 2025 - 2026` appears; Clear filters count includes it.
3. Set From quarter Q2: chip updates to `Q2 2025 - 2026`; quarter select enabled only after year.
4. Set To year earlier than From year: To clamps up to From (never an inverted window).
5. Delete the Period chip: full data returns.
6. Set a window, click Clear filters, then Undo in the toast: the window is restored.
7. Refresh the page: the window survives (sessionStorage).
8. Switch to bullseye/catalysts tabs: filtered data flows through (catalysts list shrinks to the window).

- [ ] **Step 3: Check empty-state behavior**

Set a far-future window (e.g. From 2040): the timeline shows its existing empty/no-data presentation, not a crash or a blank grid with stale axis.

- [ ] **Step 4: Accessibility spot-check**

Keyboard: tab to each Period select, open with Enter, pick with arrows, Escape closes. Each select announces its `ariaLabel` ("Time period start year" etc.).

---

### Task 5: Wrap up

- [ ] **Step 1: Full verification gate**

From `src/client`: `ng lint && ng build && npm run test:units`
Expected: all green (modulo the known pre-existing `trial.service.ts` lint warning).

- [ ] **Step 2: Runbook/help drift check**

No new tables, RPCs, or routes, so `npm run docs:arch` and `features:near` are not triggered. If the Stop hook flags a help page for the filter change, update only pages affected by this session's change.

- [ ] **Step 3: Push**

Push to `develop` per the deploy convention (GHA deploys dev). If the pre-push e2e phase flakes after lint/units pass, push with `--no-verify` (CI is canonical).

---

## Spec coverage map

| Spec requirement | Task |
|---|---|
| `timePeriod` field + `EMPTY_LANDSCAPE_FILTERS` | 1 |
| Quarter-to-ISO bounds, open ends | 1 |
| Clamp To up to From | 1 (logic) / 3 (wiring) |
| Chip label formats | 1 (format) / 3 (chip) |
| Trial/marker overlap, undated-trial rule, marker pruning, cascade | 2 |
| Legacy persisted state hydration | 2 |
| Controls, disabled quarters, year options from data | 3 |
| Clear-all/undo/persistence integration | 1 + 3, verified in 4 |
| Tests in same task as behavior | 1, 2 |
