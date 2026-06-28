# Materials sample-aware reconciliation

Date: 2026-06-28
Status: design approved, pending spec review
Workstream: WS1 materials durability (DR remediation program)

## Problem

The weekly materials reconcile job compares the DB pointer set
(`public.materials.file_path`) against the R2 object set and the B2 object set,
and exits non-zero (opening a GitHub issue) on any divergence. Activating its
cron on prod surfaced a blocker.

Prod has 304 finalized `materials` rows across 4 demo/seed spaces ("Obesity
Seeded", "Obesity Competitive Landscape", "Test", "Cardio Vascular", 76 each),
and dev has a similar seeded subset. These rows are intentional: seed and
playground flows create materials to show "what files would look like when
added", with no real uploaded file behind them. Two facts make them collide
with reconcile:

1. Their `file_path` carries a legacy `materials/` prefix
   (`materials/<space>/<material>/<file>`). The live upload path never produces
   that prefix. The canonical key is `<space>/<material>/<file>`, written by the
   worker at `worker/index.ts` and stored by the client via
   `updateFilePathDirect` after upload. So the prefix is a reliable marker of
   seed-origin rows.
2. They have no backing R2 object at all.

To reconcile, every seed material reads as a "dangling" pointer (row, no
object). An active cron would therefore open a divergence issue every week,
dominated by hundreds of false danglers, and the count grows as seeding
continues for demos and learning users. Real signal (a genuine upload that lost
its file) would be buried.

Reconcile is read-only: it never deletes a material or mutates a space. The only
side effect is the notify-failure job opening or updating an issue. So the risk
is alert-fatigue and masked signal, not data loss.

## Goal

Teach reconcile to distinguish an intentionally fileless material (seed, demo,
playground: expected, no alert) from a genuine dangler (a real upload that lost
its file: alert). Establish a clean baseline so the three materials crons
(mirror, reconcile, drain-monitor) can activate together.

## Non-goals

- No change to the live upload, download, or drain key conventions. They are
  already self-consistent on the no-prefix canonical key.
- No sample badge or broader materials UI rework. The only UI change is to stop
  a sample download from 404ing.
- No new reconcile classes or stateful baselining.

## Design

### 1. Schema: `materials.is_sample`

New migration adds:

```sql
alter table public.materials
  add column is_sample boolean not null default false;
```

Backfill and normalize existing seed rows in the same migration:

```sql
update public.materials
set is_sample = true,
    file_path = regexp_replace(file_path, '^materials/', '')
where file_path like 'materials/%';
```

The `materials/` prefix is the exact marker for seed-origin rows (the live app
never writes it), so this flags precisely the seeded rows and normalizes their
path to the canonical no-prefix form. Real uploads are untouched and keep
`is_sample = false`.

In-migration smoke (assertion-style, fails the migration on violation):

- `is_sample` column exists and is `not null default false`.
- After backfill, no row has a `file_path` matching `materials/%`.
- The count of `is_sample = true` rows on a freshly seeded local DB is greater
  than zero (guards against a seed function that forgets the flag).

### 2. Seed functions emit the flag

`public._seed_demo_materials` (and any persona or playground seed that inserts
materials) sets `is_sample = true` and uses the canonical no-prefix key
`<space>/<material>/<file>`. Redefined via `create or replace` based on the
live `pg_get_functiondef` body, not an old migration copy, to avoid reverting
newer logic.

### 3. `is_sample` reaches the client

The material list and detail RPCs the UI reads (for example
`list_materials_for_space`, `list_recent_materials_for_space`) include
`is_sample` in their returned row shape, redefined from their live bodies. The
TypeScript material model gains `is_sample: boolean`.

When a user opens or downloads a material where `is_sample` is true, the client
skips the sign-download call entirely (which would 404 on the missing object)
and shows an informational alert, "Sample material: no file attached." No badge
or list-level treatment is added. This closes the latent 404 on the demo spaces
without a broader UI change.

### 4. Reconcile: exclude samples, tier severity

`scripts/materials/reconcile.mjs`:

- DB set query becomes `select file_path from public.materials where not
  is_sample`. Samples can never count as dangling.
- Severity tiers on exit:
  - `dangling` (a real upload lost its file) fails the job.
  - `mirror_gap` (in R2, not yet in B2: backup is behind) fails the job.
  - `orphan` (R2 object with no DB row) is included in the JSON summary and
    printed to the run log, but does not fail the job.
- The notify-failure issue copy is updated to describe the tiered model so a
  reader knows orphans are informational.
- Unit tests cover: a sample row is never dangling; a non-sample missing object
  is dangling and fails; a mirror_gap fails; an orphan alone does not fail; the
  JSON still reports all three classes.

### 5. One-time orphan cleanup via the drain queue

The current orphans (3 on prod, 9 on dev: abandoned old test uploads with no DB
row, all older than the 7-day R2 lock) are removed by enqueuing their keys into
`public.r2_pending_deletes`. The lock-aware, volume-guarded worker drain deletes
them on its next fire. The exact key list is presented for sign-off before any
insert. If the batch trips the drain volume guard, that is the guard working as
designed: approve a single over-cap run via the existing approve workflow.

### 6. Baseline verify and activate

1. Apply migrations to dev, run the mirror then reconcile manually on dev,
   confirm a clean exit (no dangling, no mirror_gap; orphans clear after the
   drain runs).
2. Repeat on prod.
3. Uncomment the three schedule crons (mirror, reconcile, drain-monitor),
   keeping the verified per-env, bucket-scoped secret wiring.
4. Merge to develop (dev deploy), then release develop to main (prod
   environment approval) so the crons run from the default branch.

### 7. Docs

Update `docs/runbook/14-disaster-recovery.md` reconcile section to describe the
`is_sample` exclusion and the tiered severity model.

## Testing

- Migration in-migration smoke (section 1).
- Seed function: a seeded local DB has `is_sample = true` sample rows with
  no-prefix paths.
- `reconcile.mjs` unit tests (section 4).
- Manual baseline dispatch on dev and prod (section 6).

## Risks and mitigations

- Backfill over-reaches: mitigated because the `materials/` prefix is provably
  absent from live-upload paths; the smoke asserts no prefixed paths remain.
- A future seed forgets the flag: the in-migration smoke asserting a positive
  `is_sample` count on a freshly seeded DB catches a seed that regresses.
- Orphan enqueue trips the volume guard: expected and handled by the existing
  approve workflow; the cleanup is a one-time, signed-off batch.

## Rollout order

1. Schema + backfill migration.
2. Seed function migration.
3. List/detail RPC migration (adds `is_sample`).
4. `reconcile.mjs` change + tests.
5. Client model + sample-download alert.
6. One-time orphan enqueue on dev and prod (signed off).
7. Baseline verify, uncomment crons, release.
8. Runbook update.
