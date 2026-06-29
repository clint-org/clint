# Event-model cutover - E4 visual results (all 14 matrix rows, cloud dev)

Final authoritativeness gate for the event-model cutover. Drove the deployed dev
app (`bi.dev.clintapp.com`, cutover live at `origin/develop` @ `9816f111`) with
Chrome MCP against a freshly seeded QA space and verified every Acceptance Matrix
row (spec: `docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md`).

**Result: all 14 rows PASS.** No production-client request to any dropped table; no
console errors. The cutover is authoritative-done at the cloud-dev visual layer.

## Method

- **QA space:** created `Events model QA` (`e4e4e4e4-0000-4000-8000-000000000014`)
  under the `bi` tenant (`02cbe930...`), owned by the dev user
  `aadityamadala@gmail.com`. Seeded with `seed_events_model_qa(p_space_id)` -- the
  real auth-gated + owner-gated fixture, called over the dev pooler with the
  caller's JWT claims spoofed (`request.jwt.claims.sub` = the dev user), so
  `auth.uid()` and `has_space_access` resolve exactly as a logged-in call. Seed
  verified: 2 companies, 2 assets, 1 trial (`NCT09000001`), 10 events, 1
  Intelligence brief, 2 event_sources.
- **Browser:** the user's authenticated Chrome session reached dev with no
  Cloudflare Turnstile challenge; no Google OAuth automation needed.
- **Surfaces:** Timeline (default + each detail level), Landscape Home (Intelligence
  feed + "What Changed" Activity widget), and a trial profile page (citation
  resolution).

## Matrix-divergence note (read before the table)

The timeline grid redesign (merged into the cutover, commit `fc8b2778`) **replaced**
the spec's "3 per-level row toggles + Compare preset" (which the spec used for rows
7/8/13) with a **single detail-level depth selector** in the `Display` popover:
`COMPANIES | ASSETS | TRIALS`. Rows 7/8/9/13 are therefore verified against that
selector, not the retired toggles:

- `TRIALS` = full depth (company band + asset lane + nested trial rows) = default
  view (row 7) and asset-expanded (row 9).
- `ASSETS` = company band + asset lane, trial rows hidden = the Compare-preset
  equivalent (row 8).
- `COMPANIES` = company band only = company-events lane (row 13).

This supersedes the spec's Resolved-decision wording, as recorded in the ledger and
`landscape-state.service.ts`.

## Per-row results

| # | Scenario | View state | Result | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Clinical event (Topline Data) on a trial | Timeline, TRIALS | PASS | Green DATA dot on the QA Trial Alpha row (~Sep '24, moved to ~Oct '24 after the row-5 edit); brief headline rendered under the trial row. |
| 2 | High-significance commercial (Distribution) on an asset | Timeline, TRIALS/ASSETS | PASS | Teal COMMERCIAL hexagon on the QA Asset Alpha lane (~Q1 '25). |
| 3 | Low-significance leadership event on a company | Timeline, all levels | PASS | The unpinned Leadership Change (~Feb '24) renders NO glyph on the company band; it exists at the data layer (visibility=published, not hidden). Pinning is shown by row 14. |
| 4 | Fuzzy projected event (~Q4 2026), projection=primary | Timeline, TRIALS/ASSETS | PASS | Hollow orange REGULATORY diamond at ~Q4 '26 on the asset lane -- projected (outline) styling, distinct from filled actual glyphs. |
| 5 | An event is edited | Landscape Home | PASS | Editing the Topline date (Sep 1 -> Oct 15 2024, via `update_event`) appears in the "What Changed" Activity widget ("Event date delayed 44 days") and does NOT appear in the "Latest from Stout" Intelligence feed. CA wiring emitted exactly one `trial_change_events` row. |
| 6 | An Intelligence brief that cites an event | Home feed -> trial profile | PASS | "QA brief: topline readout summary" renders in the Intelligence feed; clicking it resolves to the cited trial profile (`/profiles/trials/...` NCT09000001), where the brief renders under INTELLIGENCE. |
| 7 | Default view (Trials on) | Timeline, TRIALS | PASS | Company band + asset lane + trial row + PH 3 phase bar render as expected. |
| 8 | Compare-equivalent (Assets on, Trials off) | Timeline, ASSETS | PASS | Asset row shows the [PH 3] lead-phase chip + asset-anchored events only (Distribution, asset Approval, projected); trial row and trial-anchored events (Topline, Trial Start) hidden. |
| 9 | Asset expanded (asset lane + nested trial rows) | Timeline, TRIALS | PASS | Asset lane with the nested QA Trial Alpha row at full detail. |
| 10 | Comparison view (two asset rows, approval->distribution gap) | Timeline, ASSETS | PASS* | Two asset rows stack (QA Asset Alpha [PH 3], QA Asset Beta [PH 2]); Beta shows a clear Approval (~Jun '24) -> Distribution (~Sep '25) gap. *Required augmenting Beta -- see Fixture findings. |
| 11 | Phase-bar derivation post-merge | Timeline, TRIALS | PASS | PH 3 phase bar on the trial row derives from clinical events (Trial Start -> Primary Completion), unchanged from pre-cutover rendering. |
| 12 | visibility=hidden event not shown at any level | Timeline, before/after | PASS | Definitive in-horizon test: the hidden LOE placed at mid-2025 renders NO glyph; unhiding it (same date) makes the LOE 'X' appear; re-hidden and restored to its 2032 fixture date. (Matrix layer for this row is "unit" -- also green.) |
| 13 | Company events lane | Timeline, COMPANIES | PASS | Company band renders the company-anchored (pinned) event only; no asset/trial rows, no phase chip. |
| 14 | Pinned company event on the company band | Timeline, all levels | PASS | The pinned Strategic event ("manufacturing expansion", ~Apr '24) renders a glyph on the QA Pharma Alpha band at every detail level. |

## Runtime cleanliness (the cutover's core invariant)

On a fresh timeline load, all 18 `/rest/v1/` requests returned **200**, every one
against the unified events schema -- and zero against any dropped table:

- `events?select=*,event_types(*,event_type_categories(*)),event_sources(url,label,sort_order)&anchor_type=eq.trial&anchor_id=in.(...)` -> 200 (the trial.service separate-events query, embedding types/categories/sources).
- `event_types?select=*,event_type_categories(*)` -> 200 (repointed `MarkerTypeService`).
- `event_type_categories` -> 200; `rpc/get_dashboard_data` -> 200; `rpc/get_space_intelligence` -> 200.
- No request to `markers`, `marker_assignments`, `marker_types`, `marker_categories`, `event_categories`, `event_links`, `event_threads`, or `marker_changes`.
- Console error scan (timeline + profile, fresh loads): no errors or exceptions.

This is the runtime confirmation of E3 Step 4 ("no dropped-table errors") at both
the console and network layers.

## Fixture findings (fix-forward, NOT cutover regressions)

Two limitations in the `seed_events_model_qa` fixture surfaced; both are fixture
data gaps, not product/cutover bugs. The product renders all scenarios correctly
once the data exists.

1. **Comparison view (row 10) needs two pipeline assets.** The fixture creates a
   second company/asset (QA Pharma/Asset Beta) but gives Beta no trial and no
   events, so the landscape (which is pipeline/phase-centric -- an asset renders as
   a row only when it has a trial that derives a phase) excludes Beta entirely. To
   capture row 10 I augmented Beta with a Phase 2 trial (`NCT09000002`) plus an
   Approval (Jun 2024) and a Distribution (Sep 2025) event via the real
   `create_event` path. **Fix-forward:** `seed_events_model_qa` should seed Beta as
   a real pipeline asset (its own trial + approval + distribution) so the comparison
   row is demonstrable without augmentation.
2. **Hidden-event (row 12) date is off-horizon.** The fixture's only hidden event
   (LOE) is dated 2032-01-01, beyond the timeline's ~5-year display horizon, so its
   absence can't be visually attributed to `visibility=hidden` versus
   out-of-range. I proved row 12 by temporarily relocating it to mid-2025 (hidden ->
   no glyph; visible -> glyph), then restoring it to 2032/hidden. **Fix-forward:**
   seed the hidden event within the default horizon.

## State of the dev QA space after this run (documented divergences)

The `Events model QA` dev space is a dedicated throwaway artifact space. It diverges
from a pristine `seed_events_model_qa` by the augmentations above, left in place as a
richer demo:

- QA Asset Beta gained a Phase 2 trial (`NCT09000002`) + Approval + Distribution events.
- The Topline event date is Oct 15 2024 (edited from Sep 1 2024 to exercise row 5).
- The LOE event was restored to its fixture state (2032-01-01, hidden).

## On screenshots

Captured via Chrome MCP live inspection (each state visually confirmed). MCP stores
screenshots in an inaccessible sandbox, so they are not committed as image files --
the same text-based verification-record approach used for the B4/C6 visual gates.
Embeddable PNGs of any state can be produced on request via the app's timeline
Export.

## Merge-readiness

The cutover branch is already merged to `develop` and deployed to dev (`9816f111`).
All 14 matrix rows are green at the cloud-dev visual layer. The only remaining step
is the production deploy, which is a separate user-gated step (prod is reviewer-gated
in the `production` GitHub Environment) and out of E4's scope.
