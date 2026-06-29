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

## Reference
- Spec: `docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md`
- Cutover plan: `docs/superpowers/plans/2026-06-28-event-model-consumer-producer-cutover.md`
- Stage 3 plan: `docs/superpowers/plans/2026-06-29-event-model-stage-3-ia-rename.md`
- QA digest: `docs/notes/event-model-qa-{coverage,test-paths,dev-issues}.md`
