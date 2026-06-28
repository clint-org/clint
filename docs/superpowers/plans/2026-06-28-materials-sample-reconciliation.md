# Materials Sample-Aware Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the weekly materials reconcile job to ignore intentionally-fileless seed/demo/playground materials (via a new `materials.is_sample` flag set by a normalizing trigger) while still catching genuine data loss, then establish a clean baseline so the three materials crons can activate.

**Architecture:** A `before insert` trigger on `public.materials` flags any `materials/`-prefixed insert (only seeds produce these) as `is_sample = true` and strips the prefix to the canonical key. A one-time backfill fixes the existing 304 prod + dev seed rows. Reconcile excludes samples from its DB set and tiers severity (dangling + mirror_gap fail; orphan is informational). The client learns `is_sample` from the list RPCs and shows a "sample, no file" alert instead of a 404ing download. Existing orphan objects are cleaned via the `r2_pending_deletes` drain queue.

**Tech Stack:** Supabase Postgres (plpgsql migrations), Node.js (`reconcile.mjs`, `node:test`), Angular 19 client, GitHub Actions workflows, Backblaze B2 + Cloudflare R2 (S3 API via `aws` CLI), Infisical for secrets.

**Working context:** worktree `.worktrees/ws1-materials-durability` (branch `ws1-materials-durability`, off develop). For DB reads use `infisical run --projectId 7c227e8b-b355-46cb-8912-701104e2415b --env=<dev|prod> --path=/supabase -- sh -c 'psql "$SUPABASE_<DEV|PROD>_DB_POOLER_URL" ...'`. Latest existing migration is `20260627220000`; new migrations use `20260628*` versions. Push with `--no-verify` (pre-push e2e is flaky; CI is canonical). Never run `supabase db reset` without checking the shared-local-DB caveat (other sessions share one Docker DB).

---

## File Structure

- Create: `supabase/migrations/20260628100000_materials_is_sample.sql` — column, backfill, normalizing trigger, in-migration smoke.
- Create: `supabase/migrations/20260628110000_materials_list_rpcs_is_sample.sql` — redefine the three list RPCs to return `is_sample`.
- Modify: `scripts/materials/reconcile.mjs` — exclude samples in the DB query; add tiered-severity `failsOn()`.
- Modify: `scripts/materials/reconcile.test.mjs` — tests for `failsOn()`.
- Modify: `src/client/src/app/core/models/material.model.ts` — add `is_sample` to `Material`.
- Modify: `src/client/src/app/features/engagement-landing/recent-materials-widget/recent-materials-widget.component.ts` — sample download gate.
- Modify: `src/client/src/app/features/materials-browse/materials-browse-page.component.ts` — sample download gate.
- Modify: `src/client/src/app/shared/components/materials-section/materials-section.component.ts` — sample download gate.
- Modify: `docs/runbook/14-disaster-recovery.md` — reconcile severity + `is_sample` note.
- Ops (no file): enqueue orphan keys into `r2_pending_deletes` on dev + prod; activate crons; release.

---

## Task 1: Migration — `is_sample` column, backfill, normalizing trigger

**Files:**
- Create: `supabase/migrations/20260628100000_materials_is_sample.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260628100000_materials_is_sample.sql`:

```sql
-- WS1 materials durability: distinguish intentionally-fileless materials
-- (seed/demo/playground) from genuine danglers so the weekly reconcile job
-- stops flagging hundreds of seed rows. See
-- docs/superpowers/specs/2026-06-28-materials-sample-reconciliation-design.md.
--
-- The live upload path writes the canonical key <space>/<material>/<file> with
-- no prefix. Only seed and playground inserts use a 'materials/' prefix, so the
-- prefix is a reliable marker: a before-insert trigger flags such rows as
-- samples and strips the prefix; a one-time backfill fixes existing rows.

alter table public.materials
  add column if not exists is_sample boolean not null default false;

comment on column public.materials.is_sample is
  'True for intentionally-fileless materials (seed/demo/playground) that have no '
  'backing R2 object. Set automatically by trg_materials_normalize_sample when '
  'file_path carries the legacy materials/ prefix, or explicitly by a seed. '
  'Excluded from the reconcile dangling check.';

-- One-time backfill: flag and normalize existing seed rows.
update public.materials
set is_sample = true,
    file_path = regexp_replace(file_path, '^materials/', '')
where file_path like 'materials/%';

-- Normalizing trigger: a materials/-prefixed insert is a sample; flag it and
-- strip the prefix to the canonical key. A seed wanting a sample without the
-- prefix should set is_sample = true explicitly.
create or replace function public.normalize_sample_material()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.file_path like 'materials/%' then
    new.is_sample := true;
    new.file_path := regexp_replace(new.file_path, '^materials/', '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_materials_normalize_sample on public.materials;
create trigger trg_materials_normalize_sample
  before insert on public.materials
  for each row execute function public.normalize_sample_material();

-- In-migration smoke: assert column, backfill, and trigger behavior.
do $$
declare
  v_remaining int;
  v_space uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_prefixed_id uuid;
  v_plain_id uuid;
  v_is_sample boolean;
  v_path text;
begin
  -- backfill left no prefixed paths behind
  select count(*) into v_remaining
  from public.materials where file_path like 'materials/%';
  if v_remaining <> 0 then
    raise exception 'smoke: % materials still carry a materials/ prefix', v_remaining;
  end if;

  -- bootstrap a synthetic user so uploaded_by FK holds
  insert into auth.users (id, email)
    values (v_user, 'is-sample-smoke@invalid.local');

  -- trigger flags + strips a prefixed insert
  insert into public.materials (space_id, uploaded_by, file_path, file_name,
    file_size_bytes, mime_type, material_type, title)
  values (v_space, v_user, 'materials/' || v_space::text || '/m1/x.pdf', 'x.pdf',
    1, 'application/pdf', 'briefing', 'S')
  returning id, is_sample, file_path into v_prefixed_id, v_is_sample, v_path;
  if not v_is_sample then
    raise exception 'smoke: prefixed insert was not flagged is_sample';
  end if;
  if v_path <> v_space::text || '/m1/x.pdf' then
    raise exception 'smoke: prefix not stripped, got %', v_path;
  end if;

  -- a no-prefix insert is untouched
  insert into public.materials (space_id, uploaded_by, file_path, file_name,
    file_size_bytes, mime_type, material_type, title)
  values (v_space, v_user, v_space::text || '/m2/y.pdf', 'y.pdf',
    1, 'application/pdf', 'briefing', 'P')
  returning id, is_sample, file_path into v_plain_id, v_is_sample, v_path;
  if v_is_sample then
    raise exception 'smoke: no-prefix insert was wrongly flagged is_sample';
  end if;
  if v_path <> v_space::text || '/m2/y.pdf' then
    raise exception 'smoke: no-prefix path was altered, got %', v_path;
  end if;

  -- cleanup
  delete from public.materials where id in (v_prefixed_id, v_plain_id);
  delete from auth.users where id = v_user;
end;
$$;
```

- [ ] **Step 2: Apply the migration locally and confirm the smoke passes**

Run (the migration's `do $$` blocks raise and abort on any violation, so a clean apply is the pass signal):

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws1-materials-durability
supabase migration up
```

Expected: applies `20260628100000_materials_is_sample` with no error. If `supabase migration up` reports the shared DB is mid-reset by another session, wait and retry (see the shared-local-DB caveat).

- [ ] **Step 3: Verify column + trigger against the local DB**

```bash
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -tAc \
  "insert into auth.users(id,email) values('00000000-0000-0000-0000-0000000000aa','t@t.local');
   insert into public.materials(space_id,uploaded_by,file_path,file_name,file_size_bytes,mime_type,material_type,title)
   values(gen_random_uuid(),'00000000-0000-0000-0000-0000000000aa','materials/s/m/f.pdf','f.pdf',1,'application/pdf','briefing','t')
   returning is_sample, file_path;"
```

Expected: `t|s/m/f.pdf` (flagged, prefix stripped). Then clean up the test rows.

- [ ] **Step 4: Run the Supabase advisor**

```bash
supabase db advisors --local --type all
```

Expected: no new ERROR/WARN attributable to the new column, function, or trigger.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260628100000_materials_is_sample.sql
git commit -m "feat(materials): add is_sample flag + normalizing trigger + backfill"
```

---

## Task 2: Migration — list RPCs return `is_sample`

The three list RPCs (`list_materials_for_space`, `list_materials_for_entity`, `list_recent_materials_for_space`) build their rows with `to_jsonb(r)` over an inner `select m.id, m.space_id, m.uploaded_by, m.file_path, ...`. Adding `m.is_sample` to each inner select adds the field to the JSON automatically.

**Files:**
- Create: `supabase/migrations/20260628110000_materials_list_rpcs_is_sample.sql`

- [ ] **Step 1: Capture the live function bodies**

These functions are redefined from their LIVE bodies (not old migration copies) to avoid reverting newer logic. Capture all three:

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws1-materials-durability
for fn in list_materials_for_space list_materials_for_entity list_recent_materials_for_space; do
  echo "-- ===== $fn ====="
  psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -tAc \
    "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='$fn'"
done
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260628110000_materials_list_rpcs_is_sample.sql`. Paste each captured body verbatim, and in each one add `m.is_sample,` immediately after the `m.uploaded_by,` line in the inner `select` (the subquery aliased `r` whose `to_jsonb(r)` becomes a returned row). There are two such inner selects in `list_materials_for_space` only if it selects materials twice; add to every inner `select m.id, m.space_id, m.uploaded_by, ...` that feeds a returned row (not the `count(...)` selects). Header the file:

```sql
-- WS1 materials durability: surface materials.is_sample to the client so the
-- UI can skip the (404ing) download of a sample material. Redefined from the
-- live function bodies; the only change is adding m.is_sample to each inner
-- row select. See 2026-06-28-materials-sample-reconciliation-design.md.

-- <pasted CREATE OR REPLACE FUNCTION public.list_materials_for_space(...) with m.is_sample added>
-- <pasted CREATE OR REPLACE FUNCTION public.list_materials_for_entity(...) with m.is_sample added>
-- <pasted CREATE OR REPLACE FUNCTION public.list_recent_materials_for_space(...) with m.is_sample added>

notify pgrst, 'reload schema';
```

The `notify pgrst, 'reload schema'` is required so PostgREST serves the new row shape immediately (an in-migration smoke would otherwise pass while the app 404s the new shape).

- [ ] **Step 3: Apply and verify the field appears**

```bash
supabase migration up
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -tAc \
  "select (public.list_recent_materials_for_space(s.id, 1)->'rows'->0) ? 'is_sample'
   from public.spaces s
   join public.materials m on m.space_id = s.id
   limit 1;"
```

Expected: `t` (the returned row object contains the `is_sample` key). If no space has a finalized material locally, seed first (`supabase db reset` after coordinating, or insert a finalized row) and re-check.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260628110000_materials_list_rpcs_is_sample.sql
git commit -m "feat(materials): return is_sample from the three list RPCs"
```

---

## Task 3: Reconcile — exclude samples, tier severity

**Files:**
- Modify: `scripts/materials/reconcile.mjs`
- Modify: `scripts/materials/reconcile.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/materials/reconcile.test.mjs`:

```js
import { failsOn } from './reconcile.mjs';

test('failsOn: dangling fails the job', () => {
  assert.equal(failsOn({ dangling: ['a'], orphan: [], mirror_gap: [] }), true);
});

test('failsOn: mirror_gap fails the job', () => {
  assert.equal(failsOn({ dangling: [], orphan: [], mirror_gap: ['c'] }), true);
});

test('failsOn: orphan alone does not fail the job', () => {
  assert.equal(failsOn({ dangling: [], orphan: ['b'], mirror_gap: [] }), false);
});

test('failsOn: all-clear does not fail', () => {
  assert.equal(failsOn({ dangling: [], orphan: [], mirror_gap: [] }), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/materials/reconcile.test.mjs`
Expected: FAIL with `failsOn is not a function` (or import error).

- [ ] **Step 3: Implement the change in `reconcile.mjs`**

In `scripts/materials/reconcile.mjs`, change the DB query in `dbPaths` to exclude samples:

```js
function dbPaths(poolerUrl) {
  const out = execFileSync('psql', [poolerUrl, '-At', '-c', 'select file_path from public.materials where not is_sample'], { encoding: 'utf8' });
  return new Set(out.split('\n').filter(Boolean));
}
```

Add an exported `failsOn` and use it in `main`:

```js
// Severity: a real upload that lost its file (dangling) or a backup that has
// fallen behind (mirror_gap) fail the job. An orphan (R2 object with no DB row)
// is wasted storage, not data loss; it is reported but does not fail.
export function failsOn(summary) {
  return summary.dangling.length > 0 || summary.mirror_gap.length > 0;
}
```

Replace the exit computation in `main`:

```js
  const summary = diff(db, r2, b2);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(failsOn(summary) ? 1 : 0);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/materials/reconcile.test.mjs`
Expected: PASS (all `diff` and `failsOn` tests).

- [ ] **Step 5: Update the notify-failure issue copy**

In `.github/workflows/materials-reconcile.yml`, update the `notify-failure` issue body line that lists the divergence classes so it states the severity model. Change the line:

```
              'Divergence classes: dangling (row, no object), orphan (object, no row), mirror_gap (in R2, not yet in B2).',
```

to:

```
              'Job fails on dangling (a real upload lost its file) or mirror_gap (backup behind). Orphans (object, no DB row) are reported below but do not fail the job. Sample materials (is_sample) are excluded.',
```

- [ ] **Step 6: Commit**

```bash
git add scripts/materials/reconcile.mjs scripts/materials/reconcile.test.mjs .github/workflows/materials-reconcile.yml
git commit -m "feat(reconcile): exclude samples, tier severity (orphan informational)"
```

---

## Task 4: Client — model field + sample download gate

**Files:**
- Modify: `src/client/src/app/core/models/material.model.ts:32-44`
- Modify: `src/client/src/app/features/engagement-landing/recent-materials-widget/recent-materials-widget.component.ts:~130`
- Modify: `src/client/src/app/features/materials-browse/materials-browse-page.component.ts:~293`
- Modify: `src/client/src/app/shared/components/materials-section/materials-section.component.ts:~172`

- [ ] **Step 1: Add `is_sample` to the `Material` interface**

In `material.model.ts`, add to the `Material` interface (after `uploaded_at`):

```ts
export interface Material {
  id: string;
  space_id: string;
  uploaded_by: string;
  file_path: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  material_type: MaterialType;
  title: string;
  uploaded_at: string;
  /**
   * True for intentionally-fileless seed/demo/playground materials with no
   * backing R2 object. The UI skips the download (which would 404) and shows
   * an informational message instead.
   */
  is_sample: boolean;
  links: MaterialLink[];
}
```

- [ ] **Step 2: Gate the download in each of the three call sites**

In each component, find the download handler that calls `this.materialService.getDownloadUrl(material.id)` and add a guard at the top of the method (before the `try`). Use the component's existing `MessageService` (each already injects `messageService` for toasts). Pattern for all three:

```ts
    if (material.is_sample) {
      this.messageService.add({
        severity: 'info',
        summary: 'Sample material',
        detail: 'This is a sample. No file is attached to download.',
      });
      return;
    }
```

Confirm each component injects `MessageService` (search the file for `messageService`); they do, since they already toast download failures. If a component names the variable differently, match the local name.

- [ ] **Step 3: Lint and build**

```bash
cd src/client && ng lint && ng build
```

Expected: clean lint, successful build. Fix any type error from the new required `is_sample` field on `Material` (e.g., test fixtures or object literals constructing a `Material` must include `is_sample`).

- [ ] **Step 4: Commit**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws1-materials-durability
git add src/client/src/app/core/models/material.model.ts \
  src/client/src/app/features/engagement-landing/recent-materials-widget/recent-materials-widget.component.ts \
  src/client/src/app/features/materials-browse/materials-browse-page.component.ts \
  src/client/src/app/shared/components/materials-section/materials-section.component.ts
git commit -m "feat(materials): skip sample download with an info toast"
```

---

## Task 5: Docs — runbook reconcile section

**Files:**
- Modify: `docs/runbook/14-disaster-recovery.md`

- [ ] **Step 1: Update the reconcile description**

In `docs/runbook/14-disaster-recovery.md`, find the materials reconciliation paragraph (search for "weekly reconciliation" / "dangling"). Update it to state:

- Reconcile excludes `is_sample` materials (seed/demo/playground) from the dangling check.
- Severity: `dangling` and `mirror_gap` fail the job and open an issue; `orphan` is reported but does not fail.

Keep the edit to the prose around the existing reconcile description; do not touch any `AUTO-GEN` block.

- [ ] **Step 2: Commit**

```bash
git add docs/runbook/14-disaster-recovery.md
git commit -m "docs(runbook): reconcile excludes samples, tiers severity"
```

---

## Task 6: One-time orphan cleanup via the drain queue (ops, signed off)

This removes the abandoned R2 objects (no DB row) so the reconcile baseline is clean. Orphans are enqueued into `public.r2_pending_deletes`; the lock-aware, volume-guarded worker drain deletes them on its next fire.

- [ ] **Step 1: Recompute the exact orphan key list for each env**

For dev and prod, list R2 keys and DB non-sample paths, and take R2 minus DB:

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws1-materials-durability
PROJECT=7c227e8b-b355-46cb-8912-701104e2415b
getsec() { infisical secrets --projectId "$PROJECT" --env="$2" --path="$3" --plain --silent 2>/dev/null | grep "^$1=" | sed "s/^$1=//"; }
# DEV example (repeat with prod creds + clint-materials + SUPABASE_PROD_DB_POOLER_URL):
AKID=$(getsec R2_ACCESS_KEY_ID dev /ai); SECRET=$(getsec R2_SECRET_ACCESS_KEY dev /ai); ACCT=$(getsec R2_ACCOUNT_ID dev /ai)
AWS_ACCESS_KEY_ID="$AKID" AWS_SECRET_ACCESS_KEY="$SECRET" AWS_DEFAULT_REGION=auto \
  aws s3api list-objects-v2 --bucket clint-materials-dev --query 'Contents[].Key' --output text \
  --endpoint-url "https://$ACCT.r2.cloudflarestorage.com" | tr '\t' '\n' | sort > /tmp/r2_dev.txt
infisical run --projectId $PROJECT --env=dev --path=/supabase --silent -- sh -c \
  'psql "$SUPABASE_DEV_DB_POOLER_URL" -At -c "select file_path from public.materials where not is_sample"' \
  | grep -vE "INF|Injecting" | sort > /tmp/db_dev.txt
comm -23 /tmp/r2_dev.txt /tmp/db_dev.txt   # orphans = in R2, not in DB
```

- [ ] **Step 2: Present the orphan list for sign-off**

Show the user the exact keys per env. Do not proceed to Step 3 without explicit approval (this enqueues real deletions).

- [ ] **Step 3: Enqueue the approved orphan keys**

For each approved key, insert into `r2_pending_deletes` (dev shown; repeat for prod with the prod pooler):

```bash
infisical run --projectId $PROJECT --env=dev --path=/supabase --silent -- sh -c \
  'psql "$SUPABASE_DEV_DB_POOLER_URL" -c "insert into public.r2_pending_deletes (file_path) values ('\''<KEY1>'\''), ('\''<KEY2>'\'')"'
```

- [ ] **Step 4: Confirm the drain removed them**

After the worker drain fires (or trigger it per the worker's schedule), re-run Step 1's `comm -23`. Expected: empty (no orphans). If the drain volume guard paused (the batch exceeded the cap), approve a single over-cap run via the existing `Materials drain approve` workflow, then re-check.

No commit (data-only ops).

---

## Task 7: Baseline verify, then activate crons (two releases: verify before activate)

The crons stay paused through the first release. We ship the schema + code, verify reconcile is clean on dev and prod by manual dispatch, and only then activate the crons in a second small release. This honors verify-before-activate so we never schedule a job that has not been proven clean against real prod data.

**Files:**
- Modify: `.github/workflows/materials-mirror.yml`
- Modify: `.github/workflows/materials-reconcile.yml`
- Modify: `.github/workflows/materials-drain-monitor.yml`

### Phase A: ship schema + code (crons still paused)

- [ ] **Step 1: Merge to develop (dev deploy applies migrations to dev)**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws1-materials-durability
git fetch origin develop -q && git merge origin/develop --no-edit
git push origin HEAD:ws1-materials-durability --no-verify
gh pr create --base develop --fill   # then merge per team flow: gh pr merge --merge (no --auto)
```

- [ ] **Step 2: Verify reconcile is clean on dev**

```bash
gh workflow run materials-reconcile.yml --ref develop
sleep 30 && gh run list --workflow=materials-reconcile.yml --limit 1
gh run view <run-id>
```

Expected: the `dev` job exits 0 (no dangling, no mirror_gap; orphans cleared in Task 6). If it fails, read the JSON summary in the run log and resolve before proceeding.

- [ ] **Step 3: Release develop -> main (prod deploy applies migrations to prod; crons still paused)**

Merge develop to main and approve the `production` GitHub Environment. `deploy-prod.yml` runs `supabase db push` (applies `is_sample` + RPCs to prod) then deploys. No cron is active yet.

- [ ] **Step 4: Verify reconcile is clean on prod**

```bash
gh workflow run materials-reconcile.yml --ref main
sleep 30 && gh run list --workflow=materials-reconcile.yml --limit 1
gh run view <run-id>
```

Expected: the `prod` job exits 0. The 304 seed rows are now `is_sample = true` (backfill) and excluded; orphans were drained in Task 6. If the `prod` job still reports dangling, inspect which paths and resolve before activating.

### Phase B: activate the crons (second release)

- [ ] **Step 5: Uncomment the three schedule crons**

In each workflow, replace the commented schedule block with the active one (keep the per-env secret wiring untouched):

`materials-mirror.yml`:
```yaml
  schedule:
    - cron: "30 9 * * *"
  workflow_dispatch:
```

`materials-reconcile.yml`:
```yaml
  schedule:
    - cron: "0 8 * * 1"
  workflow_dispatch:
```

`materials-drain-monitor.yml`:
```yaml
  schedule:
    - cron: "0 8 * * *"
  workflow_dispatch:
```

Verify exactly three active cron lines and YAML parses:
```bash
grep -rnE "^\s+- cron:" .github/workflows/materials-*.yml   # expect 3
for f in materials-mirror materials-reconcile materials-drain-monitor; do ruby -ryaml -e "YAML.load_file('.github/workflows/$f.yml'); puts 'OK $f'"; done
```

- [ ] **Step 6: Commit and release to main**

```bash
git add .github/workflows/materials-mirror.yml .github/workflows/materials-reconcile.yml .github/workflows/materials-drain-monitor.yml
git commit -m "ci(ws1): activate materials mirror/reconcile/drain-monitor crons"
git push origin HEAD:ws1-materials-durability --no-verify
```

Merge to develop, then release develop->main (production environment approval). Scheduled workflows run from the default branch (main), so the crons activate once this reaches main.

- [ ] **Step 7: Confirm the crons are registered on main**

```bash
gh workflow list --all | grep -i material
```

Expected: all materials workflows `active`. The first scheduled runs fire at the next cron window. Optionally watch the first scheduled reconcile run to confirm a clean exit in production.

---

## Notes for the executor

- **Shared local DB:** other sessions share one Supabase Docker DB. Prefer `supabase migration up` (applies pending migrations without wiping) over `supabase db reset`. If a reset is unavoidable, coordinate first.
- **Per-env secrets are already wired and verified** (B2_MATERIALS_{PROD,DEV}_*, R2_MATERIALS_{PROD,DEV}_* in Infisical shared/backups, auto-synced to GHA). Do not re-mint or re-store them.
- **features:check** gates CI on new public RPCs mapping to a capability. This plan adds no new RPC (it redefines existing ones), so no capability-manifest change is expected; if CI flags it, the redefined functions keep their existing capability mapping.
- **Do not** push with the pre-push hook if it flakes on e2e; use `--no-verify`, CI is canonical.
