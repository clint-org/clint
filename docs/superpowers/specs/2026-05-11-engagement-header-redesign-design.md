# Engagement-landing header redesign: identity, adaptive brief, motion strip

**Date:** 2026-05-11
**Scope:** The "pulse header" block at the top of `src/client/src/app/features/engagement-landing/engagement-landing.component.{ts,html}` and the today-brief that currently sits below it.
**Related:** Supersedes the pulse-header portions of `docs/superpowers/specs/2026-05-10-home-redesign-design.md`. The intelligence + side-rail body below the header is unchanged.

## Why

The current header has three problems an analyst hits in the first second of opening an engagement:

1. **Redundant identity.** The eyebrow (`PFIZER · TEST · ENGAGEMENT`) and the `h1` (`Test`) restate what the contextual topbar already shows. "ENGAGEMENT" carries no information. "Test" appears twice on screen.
2. **Inventory KPIs.** The 5-up strip shows totals (`36 Active Trials`, `13 Companies`, `28 Assets`, `9 Catalysts < 90D`, `8 Intelligence`). These are inventory counts. They tell the analyst how much data exists, not what is moving. A pharma CI analyst opening this engagement at 8am does not need a recount of the dataset; they need to know what to watch this week.
3. **Brief and strip do overlapping jobs without coordinating.** The today brief says "3 catalysts this week", which is a count phrasing that the strip also handles, while the strip lacks the editorial specificity ("which catalyst") that the brief carries. Each surface is doing half of the other's job.

The redesign collapses the eyebrow + h1 + subtitle into a single mono identity row, repositions the inventory totals there as right-aligned meta, replaces the inventory strip with a motion strip, and makes the brief adaptive so it always surfaces the nearest notable event regardless of how far out it sits.

## Layout

One bordered container holds three rows. Existing block sequence around it is preserved (error banner above; today brief no longer separate; two-column body and recent materials below are unchanged).

```
┌───────────────────────────────────────────────────────────────────────────┐
│ TEST ENGAGEMENT · Active since Q2 2026          36 trials · 13 companies · 28 assets │  ← Row 1: identity (always)
├───────────────────────────────────────────────────────────────────────────┤
│ MON MAY 11   [THIS WEEK]   REDEFINE-2 topline expected Wed · Novo Nordisk · 2 more catalysts ahead → │  ← Row 2: brief (adaptive, may hide)
├───────────────────────────────────────────────────────────────────────────┤
│  3 P3 readouts │  7 Catalysts  │ +2 New intel │  1 Trial moves │  2 LOE  │  ← Row 3: motion strip (always)
│    next 90d    │    next 90d   │   last 7d    │    last 30d    │ next 365d│
└───────────────────────────────────────────────────────────────────────────┘
```

Container chrome: `border border-slate-200 bg-white`. Row 1 ends with `border-b border-slate-200`. Row 2 sits on `bg-brand-50` with `border-b border-brand-200`. Row 3 has no top border (the brief's bottom border serves) and uses the existing cell separators.

## Row 1: identity

A single horizontal row, mono uppercase tracked. Doubles as the page `h1` for screen readers.

- **Left cluster:** the `<h1>` element is the engagement name (`TEST ENGAGEMENT`), styled with `font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-slate-900`. The `h1` has no `sr-only` indirection. Immediately following it, a `<span>` carries the "Active since {quarter}" meta in `font-mono text-[10px] tracking-[0.08em] text-slate-400`. Source for the quarter label: existing `space.created_at` quartered (the same source `activeSinceLabel()` reads today).
- **Right cluster:** Three mono inventory chips in order: `<b>N</b> trials`, `<b>N</b> companies`, `<b>N</b> assets`. Color: `text-slate-400` for the unit word, `text-slate-600 font-semibold` for the number. Comma-separated by ` · `.
- **Responsive:** Below `max-[800px]`, the right cluster wraps under the left cluster on its own line. The row gains a touch of vertical padding to compensate.

## Row 2: adaptive brief

A single one-line row whose label and content adapt to the nearest catalyst on the horizon.

**Window rule:**
1. If any catalyst is within the next 7 days → window = `THIS WEEK`.
2. Else within the next 30 days → window = `THIS MONTH`.
3. Else within the next 90 days → window = `NEXT QUARTER`.
4. Else → row 2 is removed from the DOM; row 1 and row 3 stand alone with no gap.

**Row content (left to right):**
- **Date anchor:** `MON MAY 11` mono uppercase. Day-of-week is `text-slate-500`, the rest `text-slate-900`. Always today's date.
- **Window tag:** a small pill carrying the window label (`THIS WEEK` / `THIS MONTH` / `NEXT QUARTER`). Always teal: `bg-brand-100 text-brand-700 font-mono text-[9px] tracking-[0.16em] uppercase font-bold`. We deliberately do not vary the wash by urgency; the tag text alone differentiates the tier.
- **Lead text:** `<b>{title}</b> {when_phrase} · {company}` followed by an optional `· {N} more catalysts ahead` tail when the window has more than one event.
  - For `THIS WEEK`: `{when_phrase}` is a relative day (`today`, `tomorrow`, `Wed`, `Fri`).
  - For `THIS MONTH` and `NEXT QUARTER`: `{when_phrase}` is `expected {Mon DD}`.
- **Arrow:** Right-aligned chevron link that routes to `/t/:tid/s/:sid/catalysts?markerId={lead_marker_id}`.

**Background:** the whole row keeps `bg-brand-50` for every active state (week, month, quarter). Differentiation lives in the window tag, not the wash.

## Row 3: motion strip

Five fixed cells, always in the same order, always rendered. Each cell shows a live count from a fixed window. Cells are clickable links into the relevant filtered page.

| # | Label | Window | Color rule | Data source |
|---|-------|--------|------------|-------------|
| 1 | `P3 readouts` | next 90d | `text-amber-700` when count > 0; `text-slate-900` otherwise | `markers` joined via `marker_assignments` to `trials`, where `marker_types.category_id = 'c0000000-0000-0000-0000-000000000002'` (Data category, covering `topline-data`, `interim-data`, `full-data`) AND `trials.phase = 'Phase 3'` AND `markers.event_date BETWEEN now() AND now() + interval '90 days'` |
| 2 | `Catalysts` | next 90d | `text-amber-700` when count > 0 | All `markers` for the space where `event_date BETWEEN now() AND now() + interval '90 days'`. Superset of cell #1, intentional |
| 3 | `New intel` | last 7d | `text-cyan-700` when count > 0; prefix `+` on the value (`+2`) | `primary_intelligence` rows where `state = 'published'` AND `published_at >= now() - interval '7 days'` for the space |
| 4 | `Trial moves` | last 30d | `text-slate-900` always | Distinct `trial_id` from `trial_change_events` where `observed_at >= now() - interval '30 days'` AND (`event_type = 'phase_transitioned'` OR (`event_type = 'status_changed'` AND `payload->>'to' IN ('TERMINATED','WITHDRAWN','SUSPENDED','COMPLETED')`)) for the space |
| 5 | `Loss of excl.` | next 365d | `text-amber-700` when count > 0 | `markers` joined to `marker_types` where `marker_types.category_id = 'c0000000-0000-0000-0000-000000000005'` (Loss of Exclusivity category, covering `loe-date`, `generic-entry-date`) AND `markers.event_date BETWEEN now() AND now() + interval '365 days'` |

**Why these five, in this order:**

- **#1 P3 readouts**: single biggest market-moving event class. Promoted to hero position; warning color when present.
- **#2 Catalysts (all)**: the whole calendar within the same 90d window. Reads as the wider context for #1.
- **#3 New intel**: what the agency team has published since the analyst's last visit. Uses `+N` prefix and `text-cyan-700` to read as additive motion rather than a count of static stock.
- **#4 Trial moves**: what changed in the pipeline itself in the last 30 days (phase transitions and terminations). Slate by default (informational), no warning weight; the analyst clicks in to interpret.
- **#5 Loss of exclusivity**: strategically heavy but slow-moving, so the window is a year. Warning color when non-zero.

**Cell template (unchanged shape from current):** mono `text-2xl font-semibold` number, mono `text-[9px] tracking-[0.12em] uppercase` label, mono `text-[8px] tracking-[0.08em] uppercase text-slate-400` sub-label for the window. Each cell is a `routerLink`.

**Cell routes:**

| Cell | Route | Query |
|------|-------|-------|
| P3 readouts | `/t/:tid/s/:sid/catalysts` | `?phase=P3&within=90d` |
| Catalysts | `/t/:tid/s/:sid/catalysts` | `?within=90d` |
| New intel | `/t/:tid/s/:sid/intelligence` | `?since=7d` |
| Trial moves | `/t/:tid/s/:sid/activity` | `?eventTypes=phase_transitioned,status_changed&within=30d` |
| Loss of excl. | `/t/:tid/s/:sid/catalysts` | `?markerKind=loe&within=365d` |

If any of these query keys don't exist on the destination page today, add them as part of this work; the cell is dead-end-clickable otherwise.

## Data and service changes

### SpaceLandingStats interface

Extend `SpaceLandingStats` in `engagement-landing.service.ts` with the five motion fields:

```
p3_readouts_90d: number
catalysts_90d: number
new_intel_7d: number
trial_moves_30d: number
loe_365d: number
```

Inventory fields (`active_trials`, `companies`, `assets`) stay; they now feed Row 1 instead of the strip. The existing `catalysts_under_90d` field is replaced by `catalysts_90d` (same semantics, renamed for consistency).

### `get_space_landing_stats` RPC

Extend the existing RPC to return the five new counts in addition to the three inventory totals. Concrete queries (all scoped to the space and respecting RLS via the existing `has_space_access()` check):

- `p3_readouts_90d`: `select count(distinct m.id) from markers m join marker_assignments ma on ma.marker_id = m.id join trials t on t.id = ma.entity_id and ma.entity_type = 'trial' join marker_types mt on mt.id = m.marker_type_id where m.space_id = $1 and mt.category_id = 'c0000000-0000-0000-0000-000000000002' and t.phase = 'Phase 3' and m.event_date between now() and now() + interval '90 days'`
- `catalysts_90d`: `select count(*) from markers where space_id = $1 and event_date between now() and now() + interval '90 days'`
- `new_intel_7d`: `select count(*) from primary_intelligence where space_id = $1 and state = 'published' and published_at >= now() - interval '7 days'`
- `trial_moves_30d`: `select count(distinct trial_id) from trial_change_events where space_id = $1 and observed_at >= now() - interval '30 days' and (event_type = 'phase_transitioned' or (event_type = 'status_changed' and payload->>'to' in ('TERMINATED','WITHDRAWN','SUSPENDED','COMPLETED')))`
- `loe_365d`: `select count(distinct m.id) from markers m join marker_types mt on mt.id = m.marker_type_id where m.space_id = $1 and mt.category_id = 'c0000000-0000-0000-0000-000000000005' and m.event_date between now() and now() + interval '365 days'`

All filtered by `space_id` and respecting existing RLS. RPC stays `STABLE`, no audit-tier-1 marker required (read-only summary).

### Adaptive brief data

The brief needs a single "nearest catalyst within 90d" pick plus the window label and the count of additional catalysts in that window. This can come from the existing catalyst data already loaded for the side-rail card (`upcoming` signal in the component). Implementation in the component, no new RPC:

```
brief = computed(() => {
  const list = upcoming(); // already sorted by date
  if (!list.length) return null;
  const lead = list[0];
  const days = daysUntil(lead.eventDate);
  let window;
  if (days <= 7) window = 'THIS WEEK';
  else if (days <= 30) window = 'THIS MONTH';
  else if (days <= 90) window = 'NEXT QUARTER';
  else return null;
  const sameWindowCount = list.filter(c => daysUntil(c.eventDate) <= windowDays(window)).length;
  return { lead, window, additional: sameWindowCount - 1 };
});
```

`briefVisible` becomes `!statsLoading() && brief() !== null`.

### Component changes

`engagement-landing.component.ts`:
- Replace `pulseStats` computed signal with `motionStats` returning the five-field array. Keep the `route`, `label`, `value`, `warn` shape so the template loop stays the same.
- Add `inventoryTotals` computed returning `{ trials, companies, assets }` for Row 1.
- Add `identityLabel` computed returning the engagement name uppercase, plus an `activeSince` computed returning the quarter string. Drop `eyebrowParts`. The existing `activeSinceLabel` content can be reused; it just becomes a structured field rather than a single string.
- Replace `briefHtml` with `brief()` shape above; the template renders the structured pieces directly instead of innerHTML.

`engagement-landing.component.html`:
- Replace the `header` block (lines 13–85) with the three-row container described above.
- Remove the standalone today-brief block that follows (current lines ~88–101); it is now Row 2.
- Two-column body and recent materials below are untouched.

### Removed

- `eyebrowParts()` computed.
- `activeSinceLabel()` computed.
- `pulseStats()` computed.
- Standalone today-brief block in the template.
- `briefHtml` string-rendering pattern in favor of structured shape (also drops the `[innerHTML]` binding, a small a11y win).

## Accessibility

- Row 1 is the page's only `h1`. Mono styling does not change semantics. Read-aloud: "Test engagement, active since Q2 2026, 36 trials, 13 companies, 28 assets."
- Row 2 has `role="status"` and `aria-live="polite"`. When the brief is empty, it is fully removed from the DOM (not `display:none`) so it doesn't read as an empty region.
- Row 3 cell links keep `[attr.aria-label]="stat.label + ': ' + stat.value"` (already present).
- Loading state on cells: existing skeleton pattern preserved with `aria-busy`.
- AXE clean against the new block.

## Testing

The implementation plan will pair tests with each task. At minimum:

- **Unit (Vitest)**: a pure-function spec for the brief window-tiering rule (input: a sorted list of catalysts with event dates and a "now" anchor; output: window label + lead + additional count + `null` when nothing within 90d). Each tier and the empty case gets a case.
- **Unit (Vitest)**: a spec for the `motionStats` computed mapping, covering each cell's `warn` rule and route-link target.
- **Database (pgTAP)**: a spec on `get_space_landing_stats` against a seeded space with known shapes (one catalyst in week, one in month, one in quarter, one LOE in next year, two phase transitions in last 30d, one termination in last 30d, two intel briefs published in last 7d) asserting each returned count.

## Verification

- `cd src/client && ng lint && ng build` clean.
- Manual smoke against a seeded space:
  - State 1 (catalyst in next 7d): Row 2 shows `THIS WEEK` tag with concrete day-of-week phrase.
  - State 2 (nothing in 7d, something in 30d): Row 2 shows `THIS MONTH` tag with `expected {Mon DD}` phrase.
  - State 3 (nothing in 30d, something in 90d): Row 2 shows `NEXT QUARTER` tag.
  - State 4 (nothing in 90d): Row 2 removed; Rows 1 and 3 render with no gap.
  - All five motion cells render with correct counts; warning color appears on cells with non-zero counts that should warn.
- Manual click-through: each cell routes to its destination with the documented query params; each destination respects the filter.
- Inventory totals on Row 1 match the previous strip values (sanity check the RPC didn't drift).
- Empty engagement (zero of everything): all five cells show `0`; Row 1 shows `0 trials · 0 companies · 0 assets`; Row 2 hidden. Page does not look broken.
- Run `supabase db advisors --local --type all` after the RPC change: no new warnings.
- AXE pass on the redesigned block.

## Out of scope

- Changes to the catalysts page, intelligence page, or activity feed page beyond adding any missing query-string filters the cell routes depend on.
- FDA designation tracking (the `fda_designations` column was dropped from `trials` and designation changes are not in `trial_change_events`). If we want a designations signal later, that's its own design.
- Mobile (≤ 700px) breakpoint refinement of the strip beyond the existing 3-col fallback. Row 1 already handles its own wrap below 800px.
- Changes to the topbar / contextual breadcrumb. Identity row in the page header is independent.
- Adding new marker types or trial-event types.
