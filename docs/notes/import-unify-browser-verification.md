# AI Import Event-Model Unification: Browser Verification (dev)

Date: 2026-06-29
Feature: `feat/event-import-unify` (merged to develop; migration `20260629050100`)
Verifier: end-to-end browser run against dev.clintapp.com
Environment: BI dev tenant, dedicated throwaway space "Import QA Unify (browser verify)"
(`02cbe930-7f17-46c4-942b-bc854b625cee` / space `da3e9cde-c7d6-459e-93a1-73c5c603cca1`).

This complements the automated gates (unit 1499, worker 196, integration 480, advisors,
grants, features) with a real end-to-end exercise of the deployed unified import pipeline:
the Claude extraction, the review screen, commit, and the rendered result.

## Scope tested

All three import styles, plus repetitive same-input (dedup), with real extraction:

1. FROM TEXT (controlled press release: Novo Nordisk / CagriSema / REDEFINE-2).
2. FROM TEXT re-import of the identical source (dedup / duplicate guard).
3. NCT LIST (NCT04184622, NCT03987919) via CT.gov resolution.
4. FROM URL (en.wikipedia.org/wiki/Tirzepatide).

## Results: PASS

Unified event model confirmed end to end:

- One unified `events` bucket. Extraction emitted SPECIFIC event_types by name, each
  rendered with the correct taxonomy glyph in the review tree and on the timeline:
  `Topline Data` (green circle), `Regulatory Filing` (orange diamond), `Approval`
  (blue flag). The review per-leaf glyph (broken by the cutover) is restored.
- Commit landed correct data: event_type, anchor (trial/asset), date (incl. an end-date
  range for "Q3 2026"), projection ("company guidance" -> projected), description, and an
  IMPORTED provenance badge. Verified in the event detail panel and on the timeline.
- Dedup / no-regression confirmed at THREE layers on a same-source re-import:
  1. Pre-extraction duplicate guard ("This exact source was already imported. Continue
     anyway").
  2. Review-layer: re-extracted events flagged EXISTING and auto-deselected.
  3. Commit-level guard ("nothing was added. Commit anyway").
  After "Commit anyway" of the all-existing proposal, counts stayed unchanged
  (1 trial / 1 company / 1 asset) - no duplicate rows created.
- Cross-source entity dedup: NCT import deduped Novo Nordisk to the existing company;
  URL import deduped Lilly / Tirzepatide / SURPASS-2 / SURMOUNT-1 to the NCT-imported
  entities, while still adding the new events.
- NCT path: companies/assets/trials resolved (multi-asset SURPASS-2 modeled correctly
  with primary + also-tested), and ZERO events emitted (per the nct-prompt change).
- URL path: staged progress UI (Fetch source -> Extract entities -> Enrich from CT.gov),
  then 12 events across multiple event_types (Topline Data + FDA/EMA/Health Canada
  Approvals) anchored to the trial.
- Import, review, timeline, and event-detail screens all render correctly and clearly;
  the AI-disabled-org case degrades gracefully with a clear toast.

No bugs in what gets imported. The import-data path is correct.

## Open observation (handed to the dashboard/read-layer owner, NOT an import-data bug)

Cross-widget inconsistency in the "events in next 90 days" counter. For the same
projected CagriSema Regulatory Filing (2026-07-01 to 2026-09-30, within 90 days of
2026-06-29):

- Home stat bar shows "1 EVENT NEXT 90D".
- Home "Next 90 days" panel shows "0 events".
- Timeline STATS shows "0 events (90d)".

The event data is correct and renders everywhere; the disagreement is in the dashboard /
landscape READ RPCs' 90-day aggregation (repointed by the cutover + Stage 3, not by the
import-unification change). The widgets likely apply different filters (projection /
anchor / actual-vs-projected). Needs a single agreed definition across the stat bar, the
Next-90-days panel, the Timeline stat, and Future Events. Independent of the import
pipeline.

## Notes

- The two QA spaces created for this run ("Import QA Unify (browser verify)" in BI;
  "Import QA - Event Unification" in Pfizer, empty - that tenant has AI import disabled)
  are throwaway and safe to delete.
- The `tags` deferral holds (tags extracted + shown in review, not written on commit)
  until the p_metadata fast-follow.
