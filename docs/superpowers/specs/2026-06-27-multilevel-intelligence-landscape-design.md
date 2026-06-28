# Multi-level intelligence on the landscape views

Date: 2026-06-27
Status: Design approved, pending implementation plan

## Problem

Intelligence entries (authored deliverables, stored as `primary_intelligence_anchors` + `primary_intelligence`) can be anchored to a `trial`, a `product` (asset), a `company`, or a `space`. The three landscape views surface intelligence inconsistently:

- **Timeline** (`get_dashboard_data`) only joins anchors with `entity_type = 'trial'`. Trial intelligence shows as a PI mark in the trial cell, with an optional headline second line gated by the "Intelligence headlines" toggle.
- **Bullseye / Heatmap** (`get_bullseye_data` / `get_positioning_data`) only surface intelligence at the **asset** level (dot/cell badge), rolling trial intelligence up into its asset.
- **Company-anchored intelligence is surfaced nowhere on these views.** It only appears on the company profile page (`list_intelligence_for_entity`).

Concretely: three published `entity_type = 'company'` anchors were created for Novo Nordisk in space `ca340e7c-…`. They are stored and published correctly but are invisible on Timeline, Bullseye, and Heatmap because no landscape RPC queries company-level anchors. The schema allows company anchors; the display layer was never wired for them.

## Guiding rule

> Intelligence renders on the visual element that represents its entity. Where a view has no element for that entity, it does not render there.

This keeps every badge meaning exactly one thing (no ambiguity between "this asset has a read" and "this asset's parent company has a read"), and it scales cleanly across views that have different structural granularity.

Decisions that follow from the rule:

- **No counts** at any level (too noisy; a count can occur at any level so showing it anywhere invites showing it everywhere).
- **Presence = PI mark.** Same mark component used today (`app-pi-mark`).
- **Headline = the lead brief's headline**, shown only when the existing "Intelligence headlines" toggle is on. Lead selection mirrors the existing trial logic: `order by is_lead desc, published_at desc nulls last`, take the first published `headline`.
- **No new click/interaction.** Marks are indicators; the cells/dots/rows already navigate to the entity profile, which is where briefs are read.

## Entity-type reminder (the silent-failure trap)

Anchor `entity_type` differs by level and must be used exactly:

| Level | `entity_type` value |
|-------|---------------------|
| Trial | `'trial'` |
| Asset | `'product'` |
| Company | `'company'` |

The asset level uses `'product'`, not `'asset'`. A join using the wrong value returns zero rows with no error. Every new join below must use the correct value for its level.

## Behavior matrix

| | Company intelligence | Asset intelligence | Trial intelligence |
|---|---|---|---|
| **Timeline** | company cell: mark + (toggled) headline — NEW | asset cell: mark + (toggled) headline — NEW | trial cell: mark + (toggled) headline — exists today |
| **Bullseye** | spoke label: mark, **only when grouped by company** — NEW | dot badge — exists today | rolls up into its asset dot — exists today |
| **Heatmap** | row label: mark, **only when grouped by company** — NEW | cell badge — exists today | rolls up into its asset cell — exists today |

When bullseye/heatmap are grouped by a non-company dimension (asset / MOA / indication / ROA), company-level intelligence is intentionally **not** shown on those views — there is no company element to attach it to. It remains visible on the Timeline and the company profile.

## Implementation

### 1. Timeline — `get_dashboard_data`

Add two lateral joins that mirror the existing trial join (`pi_trial` in `20260627130600_intelligence_feed_and_landscape_multi.sql`):

- **Company join (`pi_company`):** anchors where `entity_type = 'company'` and `entity_id = <company id>` and the anchor has a published `primary_intelligence` version. Emit on the company object:
  - `has_intelligence` = `(headline is not null)`
  - `intelligence_headline` = lead-first published `headline`
- **Asset join (`pi_asset`):** anchors where `entity_type = 'product'` and `entity_id = <asset id>` and published. Emit on the asset object:
  - `has_intelligence`
  - `intelligence_headline`

Both joins filter by `space_id = p_space_id` and `primary_intelligence.state = 'published'`, and order `is_lead desc, published_at desc nulls last` to pick the lead headline, exactly as the trial join does.

End the migration with `notify pgrst, 'reload schema'` (RPC return shape changes).

### 2. Client models + mapping

- Add `has_intelligence: boolean` and `intelligence_headline: string | null` to the Company and Asset models (Trial already has them).
- Extend `dashboard.service.ts` mapping to carry the new company/asset fields through from the RPC payload.

### 3. Timeline template — `dashboard-grid.component.html`

- **Company cell** (renders once per company, near line 156): add `<app-pi-mark [size]="11" />` when `row.companyHasIntelligence` (or equivalent flattened field); add the second-line headline block (copy of the trial headline block) gated by `showIntelligenceHeadlines() && hasIntelligence && headline`.
- **Asset cell** (renders once per asset, near line 174): same treatment.
- **Trial cell**: unchanged.
- The flattening in `dashboard-grid.component.ts` (`FlattenedTrial`) must carry the company/asset intelligence fields so they are available on the `isFirstInCompany` / `isFirstInAsset` rows.

### 4. Bullseye — `get_bullseye_data` / `get_positioning_data`

- When the grouping dimension is **company**, add a `has_intelligence` flag to each spoke, computed from anchors where `entity_type = 'company'` and `entity_id = <spoke's company id>` and published.
- Template (`bullseye-chart.component.html`, spoke label group near line 81): render `<app-pi-mark>` next to the spoke label `<text>` when `spoke.has_intelligence`. No headline, no count.
- Asset dots and trial roll-up: unchanged.

### 5. Heatmap — same RPC family

- When the grouping dimension is **company**, add a `has_intelligence` flag to each bubble/row, computed the same way (`entity_type = 'company'`, `entity_id = <row's company id>`, published).
- Template (`heatmap.component.ts`, row label cell near line 371): render `<app-pi-mark>` next to the row label text when `row.bubble.has_intelligence`. No headline, no count.
- Cell badges: unchanged.

## Testing

### Migration in-file smoke
Seed (in the migration smoke block) a published company anchor and a published asset (`product`) anchor for a known entity in a test space, then assert:

- `get_dashboard_data` returns `has_intelligence = true` and the lead headline at both the company object and the asset object.
- `get_bullseye_data` (and the positioning RPC) returns the company `has_intelligence` flag when grouped by company, and does **not** surface company intelligence under a non-company grouping.

Call internal functions directly rather than secret-gated RPC wrappers where applicable (see migration-smoke secret gotcha).

### Vitest
- `dashboard.service.spec.ts`: extend the mapping test to assert the new company/asset `has_intelligence` + `intelligence_headline` fields are mapped through.
- Grid render test: assert the PI mark appears in the company and asset cells when `has_intelligence`, and that the headline second line appears only when `showIntelligenceHeadlines()` is on.

## Out of scope

- Roll-down (cascade) of company intelligence onto child asset/trial elements.
- Counts / badge numerics at any level.
- A dedicated company-level row on the timeline (the existing per-company company cell is the attachment point).
- Surfacing company intelligence on bullseye/heatmap under non-company groupings.
- `entity_type = 'space'` anchors (not part of this change).

## Verification

```bash
cd src/client && ng lint && ng build
supabase db reset            # runs migration + in-file smoke
supabase db advisors --local --type all
npm run test:units
```

Run `npm run docs:arch` after the migration change and commit the regen.
