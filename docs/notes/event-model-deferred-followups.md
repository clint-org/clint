# Event-model overhaul: deferred follow-ups

As of 2026-06-29. The event-model overhaul is integrated and live on dev
(`dev.clintapp.com`). Three parallel streams plus a migration smoke-fix landed across
six green dev deploys. This note collects the work that was intentionally deferred or
surfaced during QA, so nothing is lost.

## What shipped (all live on dev)

| Merge | Content |
|-------|---------|
| `29188445` | Migration smoke-fix: in-migration smokes made remote-safe (skip/impersonate, no 42501) |
| `3cbc0681` | Stage 3 Part C M1: IA rename (catalysts -> future-events, events -> activity + Activity page), D2 taxonomy uniqueness; fixed QA-005, QA-007 |
| `7e88d20a` | Stage 3 Part C M2: merged Event form reachable from trial detail (QA-004), help-page reframe, committed rename-guard |
| `d2560179` | Import unification: AI source-import pipeline writes one events bucket via `commit_source_import`; all dedup preserved |
| `15577c43` | Stage 3 Part C final: taxonomy admin tabs, standalone marker screens retired (completes Tasks 1-15) |
| `9e09d170` | Seed-demo refresh: asset-lane commercial events, Attruby launch re-anchored to asset, company-band leadership |
| `16e8f8f6` | QA-010 fix: Future Events sources events from all anchor levels |

QA closed during the drive: QA-001 (by-design), QA-004, QA-005, QA-007, QA-010.

## Deferred / open follow-ups

### Blocked on the user (Stage 5 deck)
- **Stout intro deck screenshots.** Deck copy and routes are refreshed (Stage 3 commit
  `a3a0e904`, held off develop), but the product screenshots need a one-time Google
  sign-in to a dev space to recapture (e.g. `future-events.png`, current shots are
  pre-Part-C). Stage 3 will recapture and finish the deck once given a dev space URL and
  a logged-in capture profile. The deck commit is deliberately kept out of develop until
  the shots are current. Owner: user (login) + Stage 3 (recapture).

### Events RPC hardening
- **QA-003: `update_event` is full-replace.** Passing `null` `p_no_longer_expected` (and
  other nulls) 500s. Make it null-tolerant (COALESCE to existing) BEFORE import builds its
  tags fast-follow on `update_event`. Owner: Stage 3 / events RPC.
- **QA-008: `create_event` input validation gaps.** Accepts inverted range (end < start),
  empty title, 6000-char title, and extreme dates (year 3000 / 0900). Add validation.
  Minor. Owner: events RPC.
- **QA-011: taxonomy-admin significance "None" raw error.** Selecting significance None in
  the taxonomy admin surfaces a raw error. Minor. Owner: Stage 3 / taxonomy admin.

### Import tags fast-follow
- AI-extracted tags are kept in the schema and review UI but **not written on commit**;
  the fast-follow rides on `create_event`/`update_event` `p_metadata`, which is now on
  develop. Build it after QA-003 (update_event null-tolerance) so partial updates don't
  500. Owner: import.

### Not event-model (for the core team)
- **QA-002: legacy `phase` text column left NULL on manual trial create.** `phase_type`
  is set, the legacy `phase` text is not; the UI reads `phase_type` fine. Decide drop vs
  backfill (relates to the ct.gov trial-dates spec, which plans dropping `phase_*` columns).
  Owner: core/ctgov.
- **QA-009: agency Audit log ACTOR column shows "--".** `actor_user_id` is captured but
  `actor_email` is null and the UI renders email. Pre-existing, unrelated to the event
  model. Owner: core/audit team.

### Seed-demo remodel (migration `20260629080000`, live on dev)

The demo seed was remodeled so events land on the correct lane (trial = clinical, asset =
regulatory/commercial, company = corporate), with no duplicate facts, evergreen dates
(single orchestrator shift against `R = 2026-06-29`), and the full `actual`/`primary`/
`company`/`forecasted` projection vocabulary. Spec:
`docs/superpowers/specs/2026-06-29-seed-demo-remodel-design.md`. Deferred from that work:

- **Frontend: legend glyphs + `p` badge (the explicit follow-up). DONE (live on dev).**
  1. Legend glyph for every event type (Commercial / Distribution hexagon, Financial,
     Leadership, Strategic): shipped earlier by Stage 3 (`cafc74f5`), with a
     glyph-shape-coverage guard spec.
  2. `p` badge: `resolveMarkerVisual` now emits `p` for a `primary` projection on
     asset/company anchors, while trial `primary` stays badge-less (the CT.gov registry
     default). `_dashboard_anchor_events` surfaces `anchor_type` on each grid event
     (migration `20260629100000`) so the main-timeline resolver can tell the lanes apart;
     the `Marker` model carries `anchor_type`. SVG glyph renders the letter generically;
     PPTX never drew badge letters, so it was unaffected. (commits `8977d30d`, `33cd2dfa`.)
- **Corporate band density (product call).** `_seed_demo_events` keeps ~5 corporate events
  at `significance='high'` with `visibility=null`; high-sig events surface on the band
  regardless of pin state, so the band is denser than spec section 5's "pin the high-impact
  ones, leave the rest feed-only" intent. Decide whether to demote some to lower
  significance for a leaner band. Owner: product / seed.
- **Structural-marker evergreen coupling (maintainer note).** The structural per-trial
  `Trial Start`/`Trial End` phase-bar markers come from `_seed_demo_trials` ->
  `_create_trial_date_markers`, authored from real phase dates, not against `R`. The
  orchestrator shift uses `R` as the universal baseline; this holds only because those phase
  dates are historical/far-future. If `_seed_demo_trials` ever authors near-`R` dates,
  revisit. Owner: seed.
- **Optional: author CT-388 P2 at `R + interval`.** It is currently pre-`R` and stays
  evergreen only via the `_seed_demo_recent_activity` `+120` slip (self-guarding, since the
  producers always co-run and the smoke asserts it post-chain). Marginally more robust to
  author it ahead of `R` directly. Owner: seed.

## Reference
- Spec: `docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md`
- Cutover plan: `docs/superpowers/plans/2026-06-28-event-model-consumer-producer-cutover.md`
- Stage 3 plan: `docs/superpowers/plans/2026-06-29-event-model-stage-3-ia-rename.md`
- QA digest: `docs/notes/event-model-qa-{coverage,test-paths,dev-issues}.md`
