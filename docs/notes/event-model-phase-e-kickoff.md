# Event-model cutover - Phase E kickoff prompt

Paste this into a fresh session to run Phase E (the final phase of the
consumer+producer cutover). Phase D is done+pushed at origin/feat/event-model
@ `0b1f5a82`. The timeline UI reapplication from `proto/timeline-ux` is a
SEPARATE follow-up session, NOT part of Phase E (per that branch's handoff doc:
reapply after the cutover is green).

```
Continue the Clint event-model rewrite: execute the consumer+producer cutover plan at
  docs/superpowers/plans/2026-06-28-event-model-consumer-producer-cutover.md using
  subagent-driven-development (fresh subagent per task, review between tasks, commit per task).
  THIS SESSION = Phase E (drift gates + docs + visual artifact, E1-E4, plus the two pre-existing
  markers-drift breaks and the final whole-branch review) ONLY. Stop after E4's visual artifact is
  recorded and the branch is ready to merge pending human review.

  Parent spec: docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md - its Acceptance
  Matrix is the definition of done. Resume state: memory note project_event_model_rewrite.md (READ IT
  FIRST - Phase 0 + A + B + C + the folded "A-derived" sources model (S1-S5) + Activity wiring (CA) +
  Phase D (cleanup/admin) are all done+pushed at origin/feat/event-model @ 0b1f5a82; the app loads clean
  on the unified events schema; events.source_url is dropped, event_sources is the citation table, the
  registry link is derived; deletes leave no orphaned events and keep Tier-1 audit). The SDD ledger at
  .superpowers/sdd/progress.md has the full per-task history.

  Setup:
  1. cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/event-model ; confirm pwd and
     git branch --show-current = feat/event-model. (If the worktree is gone, recreate it and
     symlink src/client/node_modules from the main checkout.)
  2. git fetch origin && git merge origin/develop (keep both migration sets; watch for duplicate
     migration-version collisions like Phase D hit - rename the UNDEPLOYED file; do NOT switch the
     main checkout's branch).
  3. Ensure local Supabase is up; supabase db reset FROM THE WORKTREE (the local DB is shared across
     worktrees). NOTE: the parallel timeline-prototyping session (proto/timeline-ux) runs against a
     STATIC fixture and will NOT touch the DB or your ports - so the shared DB is effectively yours.
     Do NOT do timeline visual polish (rows/lanes/phase-bars/glyphs/toggles/Compare) and do NOT merge
     proto/timeline-ux - that redesign is reapplied as a SEPARATE session AFTER Phase E makes the
     cutover green (per its handoff doc).

  Rules:
  - features:check has been RED by design the whole cutover (CI-only gate, not a deploy gate). E1 is
    where it goes green: map every repointed/new RPC to a capability and remove mappings for dropped
    functions. New/changed surfaces to map (from the ledger): event_registry_url, create_event's new
    p_sources param, update_event_sources, and the event_sources TABLE; drop update_marker_assignments
    and the 4 retired marker trigger/changelog fns. See reference_features_drift_check memory.
  - E2 runbook regen: npm run docs:arch (local Supabase up); fold in S6 docs - the runbook events
    feature doc, a glossary "Event" entry, and help pages on the A-derived sources model (event_sources
    + derived registry link). Update hand-written prose only where it now misstates the source table;
    never hand-edit inside AUTO-GEN markers.
  - E3 full-suite gate: ng lint + ng build clean, npm run test:units green, integration per the
    local-integration memory recipe, db reset + advisors + grants:check clean. FIX the two known
    pre-existing markers-drift breaks as part of E3 (they block a clean deploy):
    (a) linked-entities-picker.component.ts reads dropped from('markers') - repoint onto events (or
        remove); it hard-fails the picker (zero options render).
    (b) event-sources-edit-flow.spec.ts + event-links-edit-flow.spec.ts query dropped
        event_categories / events.category_id - repoint or retire (they were kept out of green-gate
        run sets; bring them green now). event_links/event_threads are Stage-3 untouched, so scope these
        to the dropped-table drift only.
  - E4 authoritative visual artifact: the FULL Acceptance Matrix rows 1-14 at the visual layer on cloud
    dev. Step 1 merges feat/event-model -> develop (user-gated dev deploy; db push applies the cutover
    migrations - this is the deploy, so confirm with the user before merging). Seed a dev "Events model
    QA" space via seed_events_model_qa or manual create_event (dev has NO event data until then - a
    deploy renders an EMPTY timeline otherwise). Drive dev.clintapp.com with Chrome MCP using the
    pre-authenticated dev profile (clear Turnstile per reference_playwright_cloudflare_fingerprint). One
    screenshot per matrix scenario at each toggle state (default / Compare preset / full detail). Save
    the report under docs/notes/ and link it from the plan. The cutover is authoritative-done only when
    all 14 rows are green; any fail is a fix-forward task.
  - Backend work still follows the plan's Global Constraints + docs/supabase-guides (every SQL fn from
    its LIVE pg_get_functiondef; new timestamped migration with in-file self-cleaning smoke + trailing
    notify pgrst, 'reload schema'; preserve record_audit_event + -- @audit:tier1 on audited fns) for any
    fn touched in E3's fixes.
  - Final whole-branch review: after E1-E3 are green, dispatch the SDD broad whole-branch review
    (requesting-code-review's code-reviewer on the most capable model) over the full feat/event-model
    diff vs its merge-base, feeding it the carry-forward Minors logged across the ledger (Phase B/C/D
    final-review notes). Triage which must be fixed before merge.
  - Testing is first-class: E3 is the full-suite gate, E4 is the all-14-rows visual artifact. No phase
    is done until its matrix rows are green. Run integration in isolation (shared local DB; export
    SUPABASE_SERVICE_ROLE_KEY from `supabase status -o env` - name is SERVICE_ROLE_KEY - first).
  - Commit per task (no emojis, no em dashes, no Claude attribution). Push only at the end, after the
    gates pass; the pre-push e2e hook is flaky, so push --no-verify only after verifying the real suites
    pass. The develop merge (E4 Step 1) is the dev deploy - user-gated, do not do it unprompted.
  - Subagents: anchor them to the absolute worktree path, forbid pushing / --no-verify / out-of-scope
    fixes (commit only). Use a free port if you serve (proto holds :8200/:8201; your own dev servers are
    :8100/:8123).

  When Phase E is green, the final whole-branch review is triaged, and the E4 artifact is recorded, stop
  and report a phase summary + the all-14-rows visual results + the branch's merge-readiness. The
  timeline UI reapplication from proto/timeline-ux is a SEPARATE follow-up session, not part of Phase E.
```

## Follow-up after Phase E (separate sessions)

- **Timeline UI reapplication** from `proto/timeline-ux` (reapply the ~4 grid
  component diffs onto real event data, drop the dev-only `/proto/timeline`
  harness + fixture + logos). Its handoff: `docs/notes/timeline-proto-handoff.md`
  on that branch.
- **Stage 3** IA/terminology rename (Intelligence/Activity/Event routes + labels,
  merged Event form, taxonomy admin, event_links/event_threads).
- **Stage 5** existing-test sweep + glossary + `stout-intro.html` deck refresh.
