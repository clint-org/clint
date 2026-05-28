# Landscape Competitive READ — Design

## Summary

Redesign the auto-generated one-line "READ" summary that appears in the landscape views (radial bullseye, density matrix, timeline). Replace three copy-pasted generators that share a bug class (the runner-up "deepest pipeline" claim fires even when the leader has more P3 assets) with a single shared module that adapts its sentence shape to the actual data, the active view, and the active group-by axis.

## Motivation

### The current READ is structurally biased toward one view

The READ template (`<X> leads | <Y> deepest pipeline | <Z> most active`) was defined in the original bullseye spec for the bullseye view, then copied verbatim into the timeline view. It works for radial competitive analysis and is incoherent for time-series analysis (the timeline READ says nothing about catalyst timing, which is what the chart is about).

### The "deepest" clause lies in common cases

The runner-up "deepest pipeline" clause picks the non-leader with the most P3 assets, but never compares against the leader's P3 count. When a leader sweeps the P3 phase, the runner-up still gets crowned "deepest" despite having strictly fewer P3 assets than the leader. Real example (observed in production seed data):

- Leader: Lilly — 3 assets, all at Phase 3
- Runner-up: Novo Nordisk — 2 assets, 1 at Phase 3, 1 at Phase 2
- READ output: `Lilly leads: 3 assets, 3 at P3 | Novo Nordisk deepest pipeline (2 P3)`

Novo is not "deepest" by any honest reading of the data.

### Three copies of the same logic

The generator exists in three forms across the landscape feature:

1. `src/client/src/app/features/landscape/competitive-read.ts` (`buildCompetitiveRead`, lines 92-171) — used by the timeline view via `timeline-insight-strip.component.ts:138`.
2. `src/client/src/app/features/landscape/bullseye-controls-panel.component.ts:267-360` — the `readText` computed.
3. `src/client/src/app/features/landscape/competitive-read-bar.component.ts:73-167` — a character-for-character copy of (2).

The density matrix view has its own variant in `density-controls-panel.component.ts:330-353` with different vocabulary ("most crowded" / "sparse at") but the same hand-rolled shape. Any bug fix touches all four sites.

### Group-by mismatch

The radial chart's GROUP BY control toggles between Company / Indication / MoA / RoA / Asset. The READ template uses "<X> leads" regardless. "Diabetes leads" or "GLP-1 leads" reads as nonsense — indications and mechanisms do not compete.

## Goals

- One shared READ generator. All four call sites call the same function.
- Honest headlines. The headline shape reflects the actual data shape: clear-leader, sweep, tied, fragmented, sole-entrant.
- View-flavored second clauses. Radial talks about competitive standing; density talks about concentration; timeline talks about upcoming catalysts.
- Mode switching by group-by axis. Competitive mode for Company group-by; distributional mode for Indication / MoA / RoA; count-summary mode for Asset.
- A scenario test matrix that locks down the shapes and prevents the original bug class from returning.

## Non-Goals

- AI-generated READ content. The READ stays deterministic and rule-based. See the "AI deferred" section below.
- Copy review pass. Once the logic is correct, a separate brand-style pass on the exact wording can follow.
- Localization. English only for now.
- A "why" expansion affordance on the READ. Reserved for a Phase 2.
- Changes to the underlying data shape (companies, assets, trials, markers, spokes) or to the chart components themselves.

## Design

### Three clauses

The READ is up to three clauses joined by ` | `:

1. **Headline** — shared across all three views. The same fact about who is winning.
2. **View clause** — different vocabulary per view. The view-specific observation that the chart cannot make obvious at a glance.
3. **Momentum clause** — shared across views. Calls out genuinely fresh activity from a non-leader. Optional; suppressed when nothing meaningful happened.

### Two modes

The headline operates in one of two modes depending on the active group-by axis:

| Group-by | Mode | Reason |
|---|---|---|
| Company | Competitive | Companies compete; "leads" makes sense |
| Indication | Distributional | Indications do not compete with each other |
| MoA | Distributional | Same |
| RoA | Distributional | Same |
| Asset | Count summary | Each spoke is one drug; no aggregation story |

### Competitive mode headline shapes

Classifier picks the first matching shape. Evaluation order: `sole-entrant` → `sweep` → `tied` → `clear-leader` → `fragmented`.

| Shape | Trigger | Template | Example |
|---|---|---|---|
| `sole-entrant` | Exactly 1 entity in view | `<X>: only entrant (N assets at Phase Y)` | `Pfizer: only entrant (1 asset at Phase 3)` |
| `sweep` | One entity holds 100% of late-stage (P3+) assets AND ≥2 entities present AND ≥2 late-stage assets exist | `<X> sweep: all N Phase 3 assets in view` | `Lilly sweep: all 3 Phase 3 assets in view` |
| `tied` | Top 2+ entities tied on `lateStageCount` AND tied count ≥ 1 | `<X> and <Y> tied: N P3 each` (+ ` (<Z> trailing at M)` only when ≥3 entities and #3 ≤ 50% of tied count) | `Lilly and Novo tied: 3 P3 each (Boehringer trailing at 1)` |
| `clear-leader` | One entity beats #2 on `lateStageCount` (fallback tiebreakers: `assetCount`, `trialCount`, `name`) | `<X> leads: N assets, M at Phase Y` | `Lilly leads: 3 assets, 3 at Phase 3` |
| `fragmented` | ≥3 entities, all at `lateStageCount = 0`, all tied on `assetCount` | `N sponsors at Phase Y, no late-stage activity` | `5 sponsors at Phase 1, no late-stage activity` |

If none of the above shapes qualifies (rare: 2 entities tied at 0 late-stage with equal asset counts; or 3+ entities all at 0 late-stage with differing asset counts where `clear-leader` would fire trivially), the classifier falls back to a count floor: `N sponsors, M assets total`. This floor exists to guarantee a non-empty headline whenever `stats.length > 0`.

Late-stage = P3 + P4 + APPROVED + LAUNCHED (matches existing `RING_DEV_RANK['P3']` threshold for spoke views and `LATE_STAGE_THRESHOLD` for company stats).

### Distributional mode headline shapes

Evaluation order: `sole-bucket` → `dominant-bucket` → `two-bucket-split` → `spread`.

| Shape | Trigger | Template | Example (Indication group-by) |
|---|---|---|---|
| `sole-bucket` | All assets in 1 group | `All N assets in <X>` | `All 6 assets in Diabetes` |
| `dominant-bucket` | One group has ≥50% of assets | `Concentrated in <X>: N of M assets` | `Concentrated in Diabetes: 5 of 6 assets` |
| `two-bucket-split` | Top 2 groups together hold ≥80% of assets | `Split between <X> and <Y>: N + M of P assets` | `Split between Diabetes and Obesity: 3 + 2 of 6 assets` |
| `spread` | Otherwise (floor case) — fires whenever none of the above qualifies | `Spread across N buckets, no single focus` | `Spread across 5 indications, no single focus` |

`spread` is the floor case: if no other distributional shape qualifies, `spread` fires unconditionally. This covers the 30%-50% middle band where no single bucket dominates and the top 2 do not exceed 80%.

### Asset group-by (count summary)

When the user groups by Asset, each spoke is one drug. Neither competitive nor distributional framing applies cleanly.

Headline: `Showing N assets across M sponsors`

The view clause still fires (the temporal / concentration / competitive observations work even when the headline is just a count). Momentum still fires when applicable.

### View clauses

Each view has a small template library. Picks the first applicable template based on the data, given the headline shape just emitted.

#### Radial (competitive standing flavor)

| Template | When | Example |
|---|---|---|
| `<X> only credible challenger (<asset> at Phase Y)` | After `clear-leader`; one non-leader has `p3Count ≥ 1` | `Novo only credible challenger (Semaglutide at Phase 3)` |
| `no credible challengers — closest is <X> at Phase Y` | After `sweep` | `no credible challengers — closest is Novo at Phase 2` |
| `tight race: <X> and <Y> within 1 asset` | After `clear-leader` where margin == 1 | `tight race: Lilly and Novo within 1 asset` |
| `<X> broader portfolio (N assets vs M)` | After `tied`; one tied entity has more total assets | `Lilly broader portfolio (4 assets vs 3)` |
| (suppressed) | After `sole-entrant`, `fragmented`, or no applicable template | |

#### Density (concentration flavor)

| Template | When | Example |
|---|---|---|
| `N of M assets clustered at Phase Y` | ≥60% of in-view assets sit in one phase | `5 of 6 assets clustered at Phase 3` |
| `Phase Y row dominated by one sponsor; Phase A–B sparse` | After `sweep`; describes the heat row | `Phase 3 row dominated by one sponsor; Phase 1–2 sparse` |
| `Phase Y contested — N of M assets there` | After `tied`; same heat, tied framing | `Phase 3 contested — 7 of 8 assets there` |
| `activity concentrated in earliest phase` | After `fragmented` | |
| `evenly spread across phases` | No single phase has >40% of assets | |
| (suppressed) | After `sole-entrant` or no applicable template | |

#### Timeline (temporal flavor)

| Template | When | Example |
|---|---|---|
| `N catalysts in next 90 days (<breakdown>)` | ≥1 marker with `event_date` in next 90 days; multiple entities involved | `3 catalysts in next 90 days (2 Lilly, 1 Novo)` |
| `N readouts in next 90 days — all <X>` | ≥1 marker in next 90 days, all from one entity | `3 readouts in next 90 days — all Lilly` |
| `next catalyst in N days: <trial> readout` | After `sole-entrant`, next catalyst within 90 days | `next catalyst in 47 days: PFIZER-101 readout` |
| `no near-term catalysts (next readout > N months)` | No markers in next 90 days; report the gap | `no near-term catalysts (next readout > 12 months)` |
| `next catalyst: <X> <trial> readout in N days` | After `tied`; pick the soonest tied entity's catalyst | `Next catalyst: Lilly SURMOUNT readout in 21 days` |

For distributional mode, the view clauses shift vocabulary:

| View | Distributional template | Example |
|---|---|---|
| Radial | `<X> bucket has the deepest pipeline (N at Phase 3)` | `Obesity bucket has the deepest pipeline (3 at Phase 3)` |
| Density | `Late-stage activity concentrated in <X>` / `<X> early-stage only — no Phase 3 assets` | `Late-stage activity concentrated in Obesity` |
| Timeline | `Next N readouts cluster in <X>` / `<X> bucket quiet — no catalysts in next 90 days` | `Next 3 readouts cluster in Obesity` |

### Momentum clause

- **Trigger:** any single non-leader entity has `recentChanges ≥ 3`.
- **Templates:**
  - Spoke views (radial, density): `<X> most active (N recent events)`
  - Timeline view: `<X> most active (N recent changes)`
- **Suppressed when:** same entity as the entity named in the view clause; OR below threshold; OR sole-entrant headline; OR `recentChanges` not populated.

Threshold bumped from the current `≥ 2` to `≥ 3` to reduce chatter; the current threshold fires on routine data updates and clutters most READs.

### Worked examples

Same underlying GLP-1 dataset (Lilly 3 P3, Novo 1 P3 + 1 P2, Boehringer 1 P3, Novo with 5 recent trial updates) across all three views, Company group-by:

| View | READ |
|---|---|
| Radial | `Lilly leads: 3 assets, 3 at Phase 3 \| Novo only credible challenger (Semaglutide at Phase 3) \| Novo most active (5 recent events)` |
| Density | `Lilly leads: 3 assets, 3 at Phase 3 \| 5 of 6 assets clustered at Phase 3 \| Novo most active (5 recent events)` |
| Timeline | `Lilly leads: 3 assets, 3 at Phase 3 \| 3 catalysts in next 90 days (2 Lilly, 1 Novo) \| Novo most active (5 recent changes)` |

Across group-bys (Radial view, same dataset):

| Group-by | READ |
|---|---|
| Company | `Lilly leads: 3 assets, 3 at Phase 3 \| Novo only credible challenger (Semaglutide at Phase 3)` |
| Indication | `Concentrated in Obesity: 5 of 6 assets \| Obesity bucket has the deepest pipeline (3 at Phase 3)` |
| MoA | `Split between GLP-1 and dual-agonist: 3 + 2 of 6 assets \| GLP-1 bucket has the deepest pipeline (3 at Phase 3)` |
| RoA | `Concentrated in Subcutaneous: 5 of 6 assets \| Oral bucket has only 1 asset (Orforglipron at Phase 3)` |
| Asset | `Showing 6 assets across 3 sponsors \| 5 of 6 at Phase 3` |

### Architecture

New module under `src/client/src/app/features/landscape/competitive-read/`:

```
competitive-read/
  index.ts                       # public API: buildLandscapeRead()
  read-stats.ts                  # ReadStats interface + adapters (fromCompanies, fromSpokes)
  competitive-headlines.ts       # 5 competitive-mode headline shapes
  distributional-headlines.ts    # 4 distributional-mode headline shapes
  view-clauses.ts                # 3 view-flavored Clause 2 libraries
  momentum-clause.ts             # shared Clause 3 logic
  competitive-read.spec.ts       # full scenario test matrix
```

The existing `src/client/src/app/features/landscape/competitive-read.ts` is removed. Its second export, `computeTimelineStats` (lines 173-214), is unrelated to the READ generator and moves to its own file `src/client/src/app/features/landscape/timeline-stats.ts` with a sibling `timeline-stats.spec.ts`.

#### Public API

```ts
// index.ts
export interface BuildReadInput {
  view: 'radial' | 'density' | 'timeline';
  groupBy: 'company' | 'indication' | 'moa' | 'roa' | 'asset';
  stats: ReadStats[];
}

export interface LandscapeRead {
  text: string;              // HTML-escaped, with <strong> wrappers
  segments: ReadSegment[];   // structured form for tests
}

export interface ReadSegment {
  clause: 'headline' | 'view' | 'momentum';
  shape: string;             // e.g. 'clear-leader', 'sweep', 'concentration'
  detail: string;
}

export function buildLandscapeRead(input: BuildReadInput): LandscapeRead;
```

```ts
// read-stats.ts
export interface ReadStats {
  name: string;
  assetCount: number;
  trialCount: number;
  p3Count: number;
  lateStageCount: number;    // P3 + P4 + APPROVED + LAUNCHED
  recentChanges: number;
  highestPhase: string;
  highestPhaseRank: number;
  upcomingCatalysts?: Array<{
    daysOut: number;
    trialName: string;
    eventDate: string;
  }>; // populated by fromCompanies only
}

export function fromCompanies(companies: Company[], today?: string): ReadStats[];
export function fromSpokes(spokes: BullseyeSpoke[]): ReadStats[];
```

Both adapters produce the same normalized `ReadStats` shape. The `upcomingCatalysts` field is only populated by `fromCompanies` (the only source with trial markers); timeline view clauses gate on its presence.

#### Call-site changes

| Site | Today | After |
|---|---|---|
| `bullseye-controls-panel.component.ts:267-360` | 90-line `readText` computed + helpers | `buildLandscapeRead({ view: 'radial', groupBy, stats: fromSpokes(spokes()) }).text` |
| `competitive-read-bar.component.ts:73-167` | Identical copy of the above | Same one-liner — deletes the duplicate |
| `density-controls-panel.component.ts:330-353` | "Most crowded / sparse at" logic | `buildLandscapeRead({ view: 'density', groupBy, stats: fromSpokes(spokes()) }).text` |
| `timeline-insight-strip.component.ts:138` (calls `competitive-read.ts:92`) | `buildCompetitiveRead(companies)` | `buildLandscapeRead({ view: 'timeline', groupBy: 'company', stats: fromCompanies(companies) }).text` |

The `escapeName()` helper currently duplicated in three files becomes a private utility in the new module.

### Edge cases

| Case | Behavior |
|---|---|
| `stats.length === 0` | Return `{ text: '', segments: [] }`. Component templates already conditionally render. |
| Filter result is empty | Same as above. Filter bar shows the active filters; READ stays silent. |
| `stats.length === 1` | `sole-entrant` headline. View clause emits only for timeline (catalyst info); suppressed for radial and density. |
| All `recentChanges === 0` | Momentum clause suppressed. |
| Spoke overflow (>15 spokes shown) | READ operates on the full `stats[]` array, not the displayed top-15 subset. The READ is about the filter scope, not the rendered subset. |
| HTML in entity names (e.g., `Bio & Tech`) | Single private `escapeName()` runs before any string interpolation; covered by test. |
| Tied at 0 P3 | Falls through to `fragmented` (no late-stage anywhere), not `tied` (which requires late-stage ≥ 1). |
| Asset group-by | Headline is the count summary; mode classifier short-circuits before reaching competitive/distributional logic. |
| Density clustering threshold edge (exactly 60% or 40%) | `≥60%` triggers clustered claim; `<40%` triggers evenly-spread claim. Between 40% and 60%: no claim (silent). |
| Distributional dominant-bucket exactly at 50% | Triggers `dominant-bucket`. Boundary is `≥50%`. |

### Testing strategy

One spec file at `competitive-read.spec.ts`. Structure mirrors the design — describe blocks per mode, per shape, per view, per momentum case.

```
describe('buildLandscapeRead')
  describe('competitive mode (group-by: company)')
    describe('headline shapes')
      - clear-leader: leader beats #2 by 1 on lateStageCount
      - clear-leader: leader beats #2 on assetCount tiebreaker
      - sweep: leader holds 100% of P3, others all earlier
      - sweep: does NOT fire with single entity (sole-entrant precedence)
      - tied: 2-way tie on lateStageCount, no trailing tail
      - tied: 3-way tie with trailing third at ≤50%, emits "trailing at M"
      - tied: 3-way tie with third within 50%, no trailing tail
      - tied: at 0 P3 falls through to fragmented
      - fragmented: 3+ entities, no late-stage anywhere
      - fragmented: does NOT fire if any entity has ≥2 assets
      - sole-entrant: single entity wins regardless of other counts
    describe('radial Clause 2')
      - only-credible-challenger after clear-leader
      - no-credible-challengers after sweep
      - broader-portfolio after tied
      - tight-race after clear-leader with margin == 1
      - suppressed after sole-entrant / fragmented
    describe('density Clause 2')
      - clustered-at-phase (>60%)
      - row-dominated after sweep
      - phase-contested after tied
      - earliest-phase-concentration after fragmented
      - evenly-spread (<40% in any phase)
      - silent between 40% and 60%
    describe('timeline Clause 2')
      - catalyst-window with breakdown by entity
      - all-from-one-entity after sweep
      - next-catalyst after sole-entrant
      - no-near-term-catalysts
    describe('momentum Clause 3')
      - emits when non-leader has ≥3 recent_changes
      - suppressed when same entity as view-clause target
      - suppressed when below threshold (== 2)
      - suppressed for sole-entrant
  describe('distributional mode (group-by: indication / moa / roa)')
    describe('headline shapes')
      - sole-bucket
      - dominant-bucket (≥50%)
      - two-bucket-split (top 2 sum ≥80%)
      - spread (no bucket ≥30%)
    describe('distributional view clauses')
      - radial: deepest-bucket
      - density: late-stage-concentrated-in
      - density: early-stage-only bucket
      - timeline: next-readouts-cluster-in
      - timeline: bucket-quiet (no catalysts)
  describe('asset group-by')
    - emits count summary headline + view-clause
  describe('edge cases')
    - empty input returns { text: '', segments: [] }
    - HTML escaping in names
    - all-recent-changes-zero suppresses momentum
    - boundary tests (60%, 40%, 50%, 80%, 30%)
  describe('adapters')
    - fromCompanies produces expected ReadStats from realistic Company[]
    - fromSpokes produces expected ReadStats from realistic BullseyeSpoke[]
```

Estimated ~45 tests. Single file is workable at this size; split if the file exceeds ~800 lines.

A test data factory builds `ReadStats[]` directly so tests do not have to construct full `Company` or `BullseyeSpoke` objects. The adapters get their own describe block exercising realistic input.

### AI deferred

An LLM-generated READ was considered and rejected for this surface. Rationale:

- Latency. The READ updates on every filter / group-by change. Deterministic JS is sub-millisecond; an LLM call is 500-2000ms even cached. A spinner where the READ used to be undermines the "instrument" brand position.
- Determinism for shareability. Two analysts on the same filter URL should see the same READ. LLM variability breaks that.
- Hallucination cost. A wrong sentence ("Lilly leads with 5 P3" when the chart shows 3) erodes trust permanently in a high-stakes domain. The asymmetry is too steep.
- Pattern matching is sufficient. The 5+4 headline shapes plus per-view vocabularies are a closed set; rules cover them.

A future "Generate competitive brief" affordance — explicitly AI-labeled, on-demand, longer-form — is a reasonable adjacent feature. Not in scope here.

## Migration

Single PR replacing all four call sites at once. Incremental migration is not worth the cost — the four sites use overlapping helpers, and partial migration would leave the duplication in a half-deleted state.

PR order of operations:

1. Land the new `competitive-read/` module with full scenario tests passing.
2. Switch the four call sites to `buildLandscapeRead()`.
3. Delete `competitive-read.ts` (old generator).
4. Move `computeTimelineStats()` to `timeline-stats.ts`.
5. Delete in-component `readText` computeds and `escapeName` / `formatPhase` helpers.

## Verification

- `cd src/client && ng lint && ng build` passes.
- `cd src/client && npm test` passes the new scenario matrix.
- Manual smoke: load the bullseye view at `/landscape/bullseye` for the seeded GLP-1 space, switch through all 5 group-by options, confirm READ text changes appropriately and never claims "deepest" for an entity with fewer P3s than the leader.
- Manual smoke on the timeline view: confirm the READ now mentions upcoming catalysts (the current READ does not).
- Manual smoke on the density view: confirm the headline uses competitive-mode for Company group-by and distributional-mode for Indication / MoA / RoA.

## Related specs

- `docs/specs/bullseye-spoke-redesign/spec.md` — original READ specification (the one this redesign supersedes).
- `docs/superpowers/specs/2026-04-12-multi-dimension-bullseye-design.md` — bullseye chart design (the consumer of the radial READ).
- `docs/superpowers/specs/2026-04-12-unified-landscape-design.md` — landscape view container that hosts all three views.
