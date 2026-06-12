# Timeline Time Period Filter

Date: 2026-06-11
Status: Approved

## Summary

Add a time period filter to the landscape filter bar. Users select an optional From and To boundary, each at year or quarter granularity (e.g. 2025 to 2027, or Q2 2025 to Q4 2026). The filter behaves like every other filter in the pane: it removes non-matching data client-side, the timeline axis then auto-fits to what remains, and chips, clear-all with undo, and sessionStorage persistence apply unchanged.

## Decisions made during brainstorming

1. **Semantics: filter the data.** Only trials and markers with activity overlapping the window remain visible, in all views. Not an axis clamp.
2. **Granularity: years plus quarters.** Each boundary is a year with an optional quarter.
3. **Undated trials: keep if a marker qualifies.** A trial with no phase dates stays visible only if at least one of its markers falls inside the window.

## Filter model

`LandscapeFilters` (src/client/src/app/core/models/landscape.model.ts) gains one nullable field:

```typescript
timePeriod: {
  startYear: number | null;
  startQuarter: 1 | 2 | 3 | 4 | null;   // null = Q1 of startYear
  endYear: number | null;
  endQuarter: 1 | 2 | 3 | 4 | null;     // null = Q4 of endYear
} | null
```

- `null`, or both years null, means no time filtering. Behavior is identical to today.
- `EMPTY_LANDSCAPE_FILTERS` sets `timePeriod: null`, so clear-all, the undo toast, and the persistence effect in `LandscapeStateService` work without special cases.
- A quarter without its year is not representable in the UI: quarter selects are disabled until their year is chosen, and clearing a year clears its quarter.

## Filtering semantics

Implemented in `filterDashboardData()` (src/client/src/app/features/landscape/landscape-state.service.ts). The window converts once per filter run to ISO date bounds `[windowStart, windowEnd]`:

- `startYear`/`startQuarter` maps to the first day of that quarter (Q1 = Jan 1, Q2 = Apr 1, Q3 = Jul 1, Q4 = Oct 1). Null quarter means Jan 1.
- `endYear`/`endQuarter` maps to the last day of that quarter (Q1 = Mar 31, Q2 = Jun 30, Q3 = Sep 30, Q4 = Dec 31). Null quarter means Dec 31.
- A null year on either side leaves that side unbounded.

Pass rules (interval overlap, inclusive):

- **Marker:** passes if `[event_date, end_date ?? event_date]` overlaps the window.
- **Trial:** passes if `[phase_start_date, phase_end_date]` overlaps the window. A single null phase date is treated as open-ended on that side. If both phase dates are null, the trial passes only if at least one of its markers passes.
- **Marker pruning:** markers outside the window are removed even when their parent trial passes, so nothing renders outside the chosen period's relevance.
- **Cascade:** unchanged. Assets and companies with no surviving trials drop out; the timeline auto-fit (timeline-view.component.ts) then narrows the axis to the surviving data.

## UI

One labeled "Period" group in `landscape-filter-bar.component.html`, placed after the existing entity filters (Category) and before the Clear-filters button; the zoom toggle sits at the start of the bar:

- Two PrimeNG Selects for From year and To year. Options are derived from the loaded data's min and max year, padded by one year on each side.
- Two small PrimeNG Selects for From quarter and To quarter (Q1 to Q4), each clearable back to a full-year state and disabled until its year is set.
- **Cross-field guard:** if From would end up after To, clamp To up to From rather than allowing an empty-by-construction window.
- **Active filter chip:** renders the window compactly, year only when quarter is unset (examples: `2025 - 2027`, `Q2 2025 - Q4 2026`, `From Q2 2025`, `Through 2027`). Deleting the chip nulls the entire `timePeriod`.
- Per the established signals rule: every bound property that participates in a `computed()` is a signal, including the four select bindings.

## Out of scope

- Relative presets ("Next 12 months"). Can be layered on later if usage shows demand.
- Axis clamping or viewport pinning. Auto-fit remains the only axis behavior.
- Server-side filtering. The RPC's unused `startYear`/`endYear` parameters stay unused.
- DB or migration changes. None required.

## Testing

Vitest specs ship in the same task as the behavior (npm run test:units):

- Window-to-ISO conversion: quarter boundaries, null quarters, open ends.
- Trial overlap: fully inside, straddling each edge, fully outside, one null phase date, both null with and without a qualifying marker.
- Marker overlap: point markers, duration markers via `end_date`, pruning under a passing trial.
- Clamp rule: From after To clamps To up to From.
- Empty/null `timePeriod` leaves data untouched.
