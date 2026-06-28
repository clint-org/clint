# WS1 Materials Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tenant-uploaded materials durable: immutable in-account for 7 days, copied off-cloud to Backblaze B2 under a 30-day compliance lock, continuously reconciled, with a deletion path that survives the lock and refuses to run away.

**Architecture:** Three protection layers plus a drain rework. (1) `cloudflare_r2_bucket_lock` gives 7-day in-account immutability. (2) A daily GitHub Actions job mirrors R2 to a dedicated, compliance-locked B2 bucket, add-only. (3) A weekly job reconciles `public.materials` against R2 and B2 and opens a GitHub issue on divergence. The drain worker is taught to (a) reschedule a delete that R2 rejects because the object is still locked (error `10069`), and (b) refuse to run when an anomalous number of brand-new deletes are queued (deny-by-default volume guard with a one-shot operator override).

**Tech Stack:** OpenTofu (cloudflare `~> 5`, Backblaze `b2 ~> 0.10`, Scalr state), Supabase Postgres (SECURITY DEFINER RPCs, Vault-gated worker secret), Cloudflare Worker (TypeScript, native R2 binding), Vitest + Miniflare, GitHub Actions (`aws s3` + `psql`), Infisical-synced secrets.

---

## Reference facts (verified, do not re-derive)

- **R2 lock resource (provider v5):** `cloudflare_r2_bucket_lock` with `account_id`, `bucket_name`, `rules = [{ id, enabled, prefix?, condition = { type, max_age_seconds?, date? } }]`. 7 days = `type = "Age"`, `max_age_seconds = 604800`. Applies to existing objects; cannot be added to a delete path mid-flight without the drain understanding rejections (hence rollout order). Source: https://developers.cloudflare.com/api/terraform/resources/r2/subresources/buckets/subresources/locks/
- **Locked-delete error:** R2 returns code `10069`, S3 `ObjectLockedByBucketPolicy`, HTTP 403. Through the native Workers binding `env.MATERIALS_BUCKET.delete(key)` it throws an `Error` whose message contains `Object is protected by a bucket lock rule and cannot be modified or deleted. (10069)`. Detection: message includes `10069` or matches `/bucket lock/i`.
- **Worker-secret gate:** `public._verify_r2_drain_worker_secret(p_secret)` raises `42501` on mismatch; called as the first statement of every worker-facing RPC. Vault entry name `r2_drain_worker_secret`. Pattern from `supabase/migrations/20260521121500_r2_drain_rpcs.sql`.
- **Queue table** `public.r2_pending_deletes`: `id uuid`, `file_path text`, `queued_at`, `attempted_at`, `succeeded_at`, `attempt_count int`, `last_error text`. Succeeded rows are retained (claim filters `succeeded_at is null and attempt_count < p_max_attempts`). A brand-new enqueue has `attempted_at IS NULL`; `claim_pending_r2_deletes` stamps `attempted_at` on claim. This is the anomaly signal: count rows with `succeeded_at IS NULL AND attempted_at IS NULL`.
- **materials** table: `id`, `space_id`, `file_path`, `file_name`, `uploaded_at` (no soft-delete column). Keys are `{space_id}/{material_id}/{file_name}`.
- **Drain wiring:** `src/client/worker/index.ts:155-166` builds `R2DeleteClient` from `env.MATERIALS_BUCKET` and calls `drainR2DeleteQueue({SUPABASE_URL, SUPABASE_ANON_KEY, R2_WORKER_SECRET}, r2Client)`. Cron `0 7 * * *` in `src/client/wrangler.jsonc:35-37`. Binding `MATERIALS_BUCKET -> clint-materials` (prod), `clint-materials-dev` (dev override).
- **callRpc:** `src/client/worker/supabase.ts` -> `callRpc<T>(cfg, authHeader, fnName, args)`, throws `SupabaseRpcError {code?,message?,httpStatus?}`.
- **Tests:** Vitest. `npm run test:worker` (config `worker/vitest.config.mts`, has Miniflare R2 via `cloudflare:test`). Drain specs in `src/client/worker/test/r2-drain/`. `MockR2` fake with `failOn(path, message)`.
- **Issue-sink pattern:** `.github/workflows/backup-db.yml:70-111` `notify-failure` job (dedup by label via `actions/github-script`). Reuse verbatim with new labels.
- **B2 bucket pattern:** `infra/tofu/shared/b2.tf` `b2_bucket.db_backups` (compliance lock + lifecycle). Materials buckets copy the lock, OMIT `lifecycle_rules` (live files must persist).
- **Secrets in GHA:** mirror reuses `R2_BACKUP_*` style; the materials jobs need a B2 key that can write the materials buckets and the prod DB pooler creds (`SUPABASE_PROD_DB_POOLER_URL`, already a GHA secret). New secrets are added to Infisical and synced (WS4). Tofu B2 management uses the account-wide `B2_APPLICATION_KEY*` already in `shared/iac`.

---

## File structure

| Path | Create/Modify | Responsibility |
|------|---------------|----------------|
| `infra/tofu/prod/r2.tf` | Modify | add `cloudflare_r2_bucket_lock.materials` (7d) |
| `infra/tofu/dev/r2.tf` | Modify | add `cloudflare_r2_bucket_lock.materials_dev` (7d) |
| `infra/tofu/shared/b2.tf` | Modify | add `b2_bucket.materials_backup` + `materials_backup_dev` (30d compliance, no lifecycle) |
| `supabase/migrations/<ts>_r2_drain_volume_guard.sql` | Create | `r2_drain_control` table; `r2_drain_gate`, `mark_r2_delete_deferred` RPCs; in-migration smoke; `notify pgrst` |
| `src/client/worker/r2-drain/queue.ts` | Modify | gate call, lock-defer classification, extended summary |
| `src/client/worker/test/r2-drain/queue.spec.ts` | Modify | gate + defer unit tests |
| `scripts/materials/mirror.sh` | Create | add-only `aws s3 sync` R2 -> B2 for one env |
| `scripts/materials/reconcile.mjs` | Create | three-way diff -> JSON summary + exit code |
| `.github/workflows/materials-mirror.yml` | Create | daily mirror, notify-failure issue |
| `.github/workflows/materials-reconcile.yml` | Create | weekly reconcile, divergence issue |
| `.github/workflows/materials-drain-monitor.yml` | Create | daily, reads control via psql, opens `materials-drain-paused` issue |
| `.github/workflows/materials-drain-approve.yml` | Create | manual dispatch, sets one-shot override via psql |
| `docs/runbook/14-disaster-recovery.md` | Modify | rewrite domain 2 to the immutability model; close action-register rows |
| memory `project_dr_remediation_program` | Modify | record WS1 state |

---

## Phase 1: IaC (immutability + off-cloud buckets)

### Task 1: B2 materials backup buckets

**Files:**
- Modify: `infra/tofu/shared/b2.tf`

- [ ] **Step 1: Add the two buckets**

```hcl
# Off-cloud copy of tenant materials (WS1). Separate from clint-db-backups so the
# db-backups 365-day lifecycle never reaps live materials. Compliance Object Lock
# (30 days) is the anti-ransomware floor on the freshest copies; the mirror is
# add-only so nothing is ever pruned here in v1 (see WS1 spec). No lifecycle_rules
# on purpose: live materials must persist indefinitely.
resource "b2_bucket" "materials_backup" {
  bucket_info = {}
  bucket_name = "clint-materials-backup"
  bucket_type = "allPrivate"

  default_server_side_encryption {
    algorithm = "AES256"
    mode      = "SSE-B2"
  }

  file_lock_configuration {
    is_file_lock_enabled = true
    default_retention {
      mode = "compliance"
      period {
        duration = 30
        unit     = "days"
      }
    }
  }
}

resource "b2_bucket" "materials_backup_dev" {
  bucket_info = {}
  bucket_name = "clint-materials-backup-dev"
  bucket_type = "allPrivate"

  default_server_side_encryption {
    algorithm = "AES256"
    mode      = "SSE-B2"
  }

  file_lock_configuration {
    is_file_lock_enabled = true
    default_retention {
      mode = "compliance"
      period {
        duration = 30
        unit     = "days"
      }
    }
  }
}
```

- [ ] **Step 2: Validate**

Run: `cd infra/tofu/shared && infisical run --env=shared --path=/iac -- tofu validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Plan (no apply yet)**

Run: `cd infra/tofu/shared && infisical run --env=shared --path=/iac -- tofu plan`
Expected: plan shows `2 to add` (the two b2_bucket resources), `0 to change, 0 to destroy`. Inspect that no other resource is touched.

- [ ] **Step 4: Commit**

```bash
git add infra/tofu/shared/b2.tf
git commit -m "feat(ws1): codify B2 materials backup buckets (30d compliance lock)"
```

> **GATED LIVE APPLY (Task 1a, run during Phase 6):** `tofu apply` in `shared/` creates real buckets with a compliance lock. Compliance locks are not removable before expiry. Confirm with the operator before applying. Command: `cd infra/tofu/shared && infisical run --env=shared --path=/iac -- tofu apply`.

### Task 2: R2 bucket locks (7-day immutability)

**Files:**
- Modify: `infra/tofu/prod/r2.tf`
- Modify: `infra/tofu/dev/r2.tf`

- [ ] **Step 1: prod lock**

Append to `infra/tofu/prod/r2.tf`:
```hcl
# WS1 materials durability: 7-day in-account immutability. Objects cannot be
# deleted or overwritten for 604800s (7 days) after they are written. The clock
# starts at write; the lock is a floor on lifetime, not a ceiling. This blocks the
# drain's legitimate deletes during the window too, so the drain is made lock-aware
# (reschedules on error 10069) BEFORE this is applied (see rollout order).
resource "cloudflare_r2_bucket_lock" "materials" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.materials.name
  rules = [{
    id      = "materials-7day-immutability"
    enabled = true
    condition = {
      type            = "Age"
      max_age_seconds = 604800
    }
  }]
}
```

- [ ] **Step 2: dev lock**

Append to `infra/tofu/dev/r2.tf`:
```hcl
# WS1 materials durability: 7-day in-account immutability (dev). See prod/r2.tf.
resource "cloudflare_r2_bucket_lock" "materials_dev" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.materials_dev.name
  rules = [{
    id      = "materials-7day-immutability"
    enabled = true
    condition = {
      type            = "Age"
      max_age_seconds = 604800
    }
  }]
}
```

- [ ] **Step 3: Validate both roots**

Run: `cd infra/tofu/prod && infisical run --env=shared --path=/iac -- tofu validate && cd ../dev && infisical run --env=shared --path=/iac -- tofu validate`
Expected: both `Success! The configuration is valid.` If `cloudflare_r2_bucket_lock` is unknown, run `tofu init -upgrade` first to pull provider v5 schema.

- [ ] **Step 4: Plan both (no apply)**

Run: `cd infra/tofu/prod && infisical run --env=shared --path=/iac -- tofu plan`
Expected: `1 to add` (`cloudflare_r2_bucket_lock.materials`), nothing else. Repeat in `dev/`.

- [ ] **Step 5: Commit**

```bash
git add infra/tofu/prod/r2.tf infra/tofu/dev/r2.tf
git commit -m "feat(ws1): codify 7-day R2 bucket lock on materials buckets"
```

> **GATED LIVE APPLY (Task 2a, run LAST in Phase 6, after the drain is lock-aware and deployed):** apply dev first, verify the drain defers cleanly, then prod. Commands: `cd infra/tofu/dev && infisical run --env=shared --path=/iac -- tofu apply`, then prod.

---

## Phase 2: Database (lock-defer + volume guard)

### Task 3: Volume-guard migration

**Files:**
- Create: `supabase/migrations/<timestamp>_r2_drain_volume_guard.sql` (generate ts via `supabase migration new r2_drain_volume_guard`)

- [ ] **Step 1: Write the migration**

```sql
-- migration: r2_drain_volume_guard
-- purpose (WS1 materials durability):
--   1. mark_r2_delete_deferred: record a delete that R2 refused because the object
--      is still under its 7-day bucket lock (error 10069). Stamps last_error but
--      does NOT advance attempt_count, so the row stays claimable and the drain
--      retries it on a later daily run once the lock expires. Without this, lock
--      rejections would burn the 5-attempt budget and orphan the object.
--   2. r2_drain_control + r2_drain_gate: a deny-by-default volume guard. Before a
--      run deletes anything, the worker calls r2_drain_gate; if the count of
--      brand-new (attempted_at IS NULL) pending deletes exceeds the cap, the gate
--      returns allowed=false and the worker deletes nothing. A one-shot override
--      (set by the approve workflow) raises the cap for a single run.
-- all functions are worker-secret gated via _verify_r2_drain_worker_secret.

-- ---------------------------------------------------------------------------
-- control singleton
-- ---------------------------------------------------------------------------
create table public.r2_drain_control (
  id                   int primary key default 1 check (id = 1),
  max_per_run          int not null default 200,
  override_max         int,
  override_set_at      timestamptz,
  override_consumed_at timestamptz,
  last_paused_at       timestamptz,
  last_paused_count    int
);
insert into public.r2_drain_control (id) values (1) on conflict (id) do nothing;

revoke all on public.r2_drain_control from public, anon, authenticated;

comment on table public.r2_drain_control is
  'WS1 single-row control for the r2-drain volume guard. max_per_run is the deny-by-default cap on brand-new pending deletes per run; override_* is a one-shot raise set by the approve workflow; last_paused_* records the most recent guard trip for the monitor workflow. Written by r2_drain_gate (SECURITY DEFINER) and by operators via direct SQL (GHA approve/monitor with DB creds).';

-- ---------------------------------------------------------------------------
-- mark_r2_delete_deferred
-- ---------------------------------------------------------------------------
create or replace function public.mark_r2_delete_deferred(
  p_secret text,
  p_id     uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._verify_r2_drain_worker_secret(p_secret);
  -- deliberately does NOT touch attempt_count: a lock deferral is "not yet", not a
  -- failed attempt. attempted_at was already stamped by claim_pending_r2_deletes,
  -- which keeps this row out of the volume-guard's new-row count.
  update public.r2_pending_deletes
     set last_error = p_reason
   where id = p_id;
end;
$$;

revoke execute on function public.mark_r2_delete_deferred(text, uuid, text) from public, anon;
grant  execute on function public.mark_r2_delete_deferred(text, uuid, text) to authenticated;

comment on function public.mark_r2_delete_deferred(text, uuid, text) is
  'R2 drain RPC (WS1). Worker-secret gated. Records that a delete was deferred because the object is still under its R2 bucket lock (error 10069). Leaves attempt_count unchanged so the row is retried on a later run after the lock expires.';

-- ---------------------------------------------------------------------------
-- r2_drain_gate
-- ---------------------------------------------------------------------------
create or replace function public.r2_drain_gate(p_secret text)
returns table (
  allowed           boolean,
  unattempted_count int,
  effective_cap     int,
  reason            text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new        int;
  v_base_cap   int;
  v_override   int;
  v_consumed   timestamptz;
  v_eff_cap    int;
begin
  perform public._verify_r2_drain_worker_secret(p_secret);

  select count(*) into v_new
    from public.r2_pending_deletes
   where succeeded_at is null
     and attempted_at is null;

  select max_per_run, override_max, override_consumed_at
    into v_base_cap, v_override, v_consumed
    from public.r2_drain_control
   where id = 1;

  v_eff_cap := v_base_cap;
  if v_override is not null and v_consumed is null then
    v_eff_cap := greatest(v_base_cap, v_override);
  end if;

  if v_new > v_eff_cap then
    update public.r2_drain_control
       set last_paused_at = now(), last_paused_count = v_new
     where id = 1;
    return query select false, v_new, v_eff_cap, 'volume_exceeded'::text;
    return;
  end if;

  -- consume the override only if it was actually needed to permit this run.
  if v_override is not null and v_consumed is null and v_new > v_base_cap then
    update public.r2_drain_control set override_consumed_at = now() where id = 1;
  end if;

  return query select true, v_new, v_eff_cap, 'ok'::text;
end;
$$;

revoke execute on function public.r2_drain_gate(text) from public, anon;
grant  execute on function public.r2_drain_gate(text) to authenticated;

comment on function public.r2_drain_gate(text) is
  'R2 drain RPC (WS1). Worker-secret gated. Deny-by-default volume guard: returns allowed=false (deleting nothing) when the count of brand-new pending deletes (attempted_at IS NULL) exceeds the effective cap. A one-shot override raises the cap for a single run and is consumed on use. Records the trip in r2_drain_control for the monitor workflow.';

-- ---------------------------------------------------------------------------
-- reload PostgREST so the new RPC signatures are visible immediately
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- smoke
-- ---------------------------------------------------------------------------
do $$
declare
  v_secret text;
  v_allowed boolean;
  v_new int;
  v_cap int;
  v_ids uuid[];
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'r2_drain_worker_secret';
  if v_secret is null then
    raise exception 'r2_drain_volume_guard smoke FAIL: vault entry missing';
  end if;

  delete from public.r2_pending_deletes;
  update public.r2_drain_control set max_per_run = 3, override_max = null, override_set_at = null, override_consumed_at = null where id = 1;

  -- under cap (0 new) -> allowed
  select allowed into v_allowed from public.r2_drain_gate(v_secret);
  if not v_allowed then raise exception 'smoke FAIL: empty queue should be allowed'; end if;

  -- seed 5 brand-new pending rows (attempted_at null) -> over cap of 3 -> denied
  insert into public.r2_pending_deletes (file_path)
  select 'materials/smoke/' || gen_random_uuid() || '/x.pdf' from generate_series(1,5);
  select allowed, unattempted_count, effective_cap into v_allowed, v_new, v_cap from public.r2_drain_gate(v_secret);
  if v_allowed or v_new <> 5 then raise exception 'smoke FAIL: 5 new over cap 3 should deny (got allowed=%, new=%)', v_allowed, v_new; end if;

  -- set a one-shot override of 10 -> allowed, and override consumed
  update public.r2_drain_control set override_max = 10, override_set_at = now(), override_consumed_at = null where id = 1;
  select allowed into v_allowed from public.r2_drain_gate(v_secret);
  if not v_allowed then raise exception 'smoke FAIL: override should permit the run'; end if;
  if (select override_consumed_at from public.r2_drain_control where id = 1) is null then
    raise exception 'smoke FAIL: override should be consumed after use';
  end if;

  -- second call with override now consumed -> denied again
  select allowed into v_allowed from public.r2_drain_gate(v_secret);
  if v_allowed then raise exception 'smoke FAIL: consumed override should not permit a second run'; end if;

  -- mark_r2_delete_deferred leaves attempt_count untouched
  select array_agg(id) into v_ids from public.r2_pending_deletes limit 1;
  perform public.mark_r2_delete_deferred(v_secret, v_ids[1], 'deferred: object locked (10069)');
  if (select attempt_count from public.r2_pending_deletes where id = v_ids[1]) <> 0 then
    raise exception 'smoke FAIL: defer must not advance attempt_count';
  end if;

  -- teardown
  delete from public.r2_pending_deletes;
  update public.r2_drain_control set max_per_run = 200, override_max = null, override_set_at = null, override_consumed_at = null, last_paused_at = null, last_paused_count = null where id = 1;

  raise notice 'r2_drain_volume_guard smoke test: PASS';
end$$;
```

- [ ] **Step 2: Apply locally and watch the smoke**

Run: `supabase db reset`
Expected: migrations apply; log line `r2_drain_volume_guard smoke test: PASS`.

- [ ] **Step 3: Advisors**

Run: `supabase db advisors --local --type all`
Expected: no new ERROR/WARN attributable to the new objects. `r2_drain_control` has all grants revoked (no anon/authenticated table access), so no RLS-exposure lint. If a lint fires, address before commit.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_r2_drain_volume_guard.sql
git commit -m "feat(ws1): r2 drain lock-defer RPC + deny-by-default volume guard"
```

---

## Phase 3: Worker drain rework (TDD)

### Task 4: Lock-defer classification

**Files:**
- Modify: `src/client/worker/r2-drain/queue.ts`
- Test: `src/client/worker/test/r2-drain/queue.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `queue.spec.ts` (reuse the existing `MockR2` + fetch-mock harness in that file; mirror its RPC-mock helper):
```typescript
it('defers (does not fail) when R2 rejects a delete due to bucket lock', async () => {
  const r2 = new MockR2();
  r2.failOn('locked/key.pdf', 'delete: Object is protected by a bucket lock rule and cannot be modified or deleted. (10069)');
  // queue returns one row for locked/key.pdf with attempt_count 0
  const rpc = mockRpcSequence({
    r2_drain_gate: { allowed: true, unattempted_count: 1, effective_cap: 200, reason: 'ok' },
    claim_pending_r2_deletes: [{ id: 'row-1', file_path: 'locked/key.pdf', attempt_count: 0 }],
    mark_r2_delete_deferred: null,
  });
  const summary = await drainR2DeleteQueue(baseEnv, r2);
  expect(summary.deferred).toBe(1);
  expect(summary.failed).toBe(0);
  // deferral routes to mark_r2_delete_deferred, NOT mark_r2_delete_failed
  expect(rpc.called('mark_r2_delete_deferred')).toBe(true);
  expect(rpc.called('mark_r2_delete_failed')).toBe(false);
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd src/client && npm run test:worker -- -t "defers"`
Expected: FAIL (`summary.deferred` undefined / `mark_r2_delete_deferred` never called).

- [ ] **Step 3: Implement**

In `queue.ts`: extend `DrainSummary` and the error branch.
```typescript
export interface DrainSummary {
  drained: number;
  succeeded: number;
  failed: number;
  deferred: number;          // NEW: locked, rescheduled
  max_attempts_hit: number;
  paused: boolean;           // NEW: volume guard tripped (Task 5)
  unattempted: number;       // NEW: new-row count observed by the gate (Task 5)
}

function isLockError(message: string): boolean {
  return message.includes('10069') || /bucket lock/i.test(message);
}
```
In the per-row catch block, branch before `markFailed`:
```typescript
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  if (isLockError(message)) {
    await markDeferred(env, row.id, truncateError(`deferred: ${message}`));
    deferred += 1;
    continue;
  }
  const nextAttempt = row.attempt_count + 1;
  await markFailed(env, row.id, nextAttempt, message);
  failed += 1;
  if (nextAttempt >= maxAttempts) { maxAttemptsHit += 1; }
}
```
Add `markDeferred` mirroring `markSucceeded`, calling RPC `mark_r2_delete_deferred` with `{ p_secret, p_id: id, p_reason }`. Initialise `deferred = 0`, include `deferred`, `paused: false`, `unattempted` in the returned summary.

- [ ] **Step 4: Run, verify pass**

Run: `cd src/client && npm run test:worker -- -t "defers"`
Expected: PASS. Then full file: `npm run test:worker` (existing tests still green; update their expected summaries to include `deferred: 0, paused: false, unattempted: <n>`).

- [ ] **Step 5: Commit**

```bash
git add src/client/worker/r2-drain/queue.ts src/client/worker/test/r2-drain/queue.spec.ts
git commit -m "feat(ws1): drain reschedules R2 bucket-lock rejections instead of failing"
```

### Task 5: Volume gate in the drain

**Files:**
- Modify: `src/client/worker/r2-drain/queue.ts`
- Test: `src/client/worker/test/r2-drain/queue.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
it('deletes nothing and reports paused when the gate denies the run', async () => {
  const r2 = new MockR2();
  const rpc = mockRpcSequence({
    r2_drain_gate: { allowed: false, unattempted_count: 5000, effective_cap: 200, reason: 'volume_exceeded' },
  });
  const summary = await drainR2DeleteQueue(baseEnv, r2);
  expect(summary.paused).toBe(true);
  expect(summary.drained).toBe(0);
  expect(r2.deleted).toEqual([]);
  expect(rpc.called('claim_pending_r2_deletes')).toBe(false); // never even claims
});

it('proceeds normally when the gate allows the run', async () => {
  const r2 = new MockR2();
  const rpc = mockRpcSequence({
    r2_drain_gate: { allowed: true, unattempted_count: 2, effective_cap: 200, reason: 'ok' },
    claim_pending_r2_deletes: [{ id: 'row-1', file_path: 'ok/key.pdf', attempt_count: 0 }],
    mark_r2_delete_succeeded: null,
  });
  const summary = await drainR2DeleteQueue(baseEnv, r2);
  expect(summary.paused).toBe(false);
  expect(summary.succeeded).toBe(1);
  expect(r2.deleted).toEqual(['ok/key.pdf']);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd src/client && npm run test:worker -- -t "gate"`
Expected: FAIL (no gate call yet).

- [ ] **Step 3: Implement the gate call**

At the top of `drainR2DeleteQueue`, before `claimPending`:
```typescript
const gate = await callGate(env);
if (!gate.allowed) {
  return { drained: 0, succeeded: 0, failed: 0, deferred: 0, max_attempts_hit: 0, paused: true, unattempted: gate.unattempted_count };
}
```
Add `callGate` mirroring `claimPending`, calling RPC `r2_drain_gate` with `{ p_secret: env.R2_WORKER_SECRET }`, returning `{ allowed: boolean; unattempted_count: number; effective_cap: number; reason: string }`. Set `paused: false` and `unattempted: gate.unattempted_count` in the normal return.

- [ ] **Step 4: Run, verify pass**

Run: `cd src/client && npm run test:worker`
Expected: all PASS.

- [ ] **Step 5: Lint + typecheck**

Run: `cd src/client && ng lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/client/worker/r2-drain/queue.ts src/client/worker/test/r2-drain/queue.spec.ts
git commit -m "feat(ws1): deny-by-default volume gate in the r2 drain"
```

---

## Phase 4: Workflows (mirror, reconcile, monitor, approve)

### Task 6: Mirror script + workflow

**Files:**
- Create: `scripts/materials/mirror.sh`
- Create: `.github/workflows/materials-mirror.yml`

- [ ] **Step 1: Mirror script (add-only sync)**

`scripts/materials/mirror.sh`:
```bash
#!/usr/bin/env bash
# Add-only mirror of one R2 materials bucket to its B2 backup bucket.
# No --delete: a bad R2 deletion must never propagate to the off-cloud copy.
set -euo pipefail

: "${R2_SRC_BUCKET:?}" "${R2_S3_ENDPOINT:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"
: "${B2_DST_BUCKET:?}" "${B2_S3_ENDPOINT:?}" "${B2_KEY_ID:?}" "${B2_APP_KEY:?}"

workdir="$(mktemp -d)"; trap 'rm -rf "$workdir"' EXIT

echo "[mirror] pull R2 -> local"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  aws s3 sync "s3://$R2_SRC_BUCKET" "$workdir" --endpoint-url "$R2_S3_ENDPOINT" --only-show-errors

echo "[mirror] push local -> B2 (add-only, no delete)"
AWS_ACCESS_KEY_ID="$B2_KEY_ID" AWS_SECRET_ACCESS_KEY="$B2_APP_KEY" \
  aws s3 sync "$workdir" "s3://$B2_DST_BUCKET" --endpoint-url "$B2_S3_ENDPOINT" --only-show-errors

echo "[mirror] done: $R2_SRC_BUCKET -> $B2_DST_BUCKET"
```
(Streaming local staging is acceptable at current scale; note in the script header that a future event-driven mirror replaces this for sub-24h RPO.)

- [ ] **Step 2: Dry-run locally against dev**

Run (with dev creds via Infisical): `infisical run --env=dev --path=/backups -- bash -c 'R2_SRC_BUCKET=clint-materials-dev ... scripts/materials/mirror.sh'`
Expected: completes; objects appear in `clint-materials-backup-dev`. (Skip if dev B2 bucket not yet applied; this step belongs to Phase 6.)

- [ ] **Step 3: Workflow**

`.github/workflows/materials-mirror.yml`: daily `cron: "30 9 * * *"` (after backups), two static jobs (prod, dev) calling the script with `R2_*` (Worker R2 keys, prod/dev `*/ai` in Infisical-synced GHA secrets or the backup R2 keys with materials-bucket scope) and `B2_*` (materials-bucket-scoped key), plus a `notify-failure` job copied verbatim from `backup-db.yml` with label `materials-mirror-failure`.

- [ ] **Step 4: Lint the workflow**

Run: `actionlint .github/workflows/materials-mirror.yml` (or rely on CI). Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/materials/mirror.sh .github/workflows/materials-mirror.yml
git commit -m "feat(ws1): daily add-only R2->B2 materials mirror"
```

### Task 7: Reconciliation script + workflow

**Files:**
- Create: `scripts/materials/reconcile.mjs`
- Create: `.github/workflows/materials-reconcile.yml`

- [ ] **Step 1: Reconcile script**

`scripts/materials/reconcile.mjs` (Node, no new deps; uses `aws` CLI via child_process and `psql` for the DB list, or `@aws-sdk` if already vendored — prefer shelling to `aws s3api list-objects-v2` and `psql -c "copy (select file_path from materials) to stdout"`). Produces three sets and prints a JSON summary `{ dangling: [...], orphan: [...], mirror_gap: [...] }`; exits `0` if all empty, `1` otherwise.
```javascript
import { execFileSync } from 'node:child_process';

function r2Keys(bucket, endpoint, env) {
  const out = execFileSync('aws', ['s3api', 'list-objects-v2', '--bucket', bucket,
    '--endpoint-url', endpoint, '--query', 'Contents[].Key', '--output', 'text'],
    { env, encoding: 'utf8' });
  return new Set(out.split(/\s+/).filter(Boolean));
}
function dbPaths(poolerUrl) {
  const out = execFileSync('psql', [poolerUrl, '-At', '-c',
    'select file_path from public.materials'], { encoding: 'utf8' });
  return new Set(out.split('\n').filter(Boolean));
}
const db = dbPaths(process.env.DB_POOLER_URL);
const r2 = r2Keys(process.env.R2_BUCKET, process.env.R2_S3_ENDPOINT,
  { ...process.env, AWS_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY });
const b2 = r2Keys(process.env.B2_BUCKET, process.env.B2_S3_ENDPOINT,
  { ...process.env, AWS_ACCESS_KEY_ID: process.env.B2_KEY_ID, AWS_SECRET_ACCESS_KEY: process.env.B2_APP_KEY });

const dangling = [...db].filter(k => !r2.has(k));   // row, no object
const orphan   = [...r2].filter(k => !db.has(k));   // object, no row
const mirrorGap= [...r2].filter(k => !b2.has(k));   // in R2, not in B2
const summary = { dangling, orphan, mirror_gap: mirrorGap };
console.log(JSON.stringify(summary, null, 2));
process.exit(dangling.length + orphan.length + mirrorGap.length === 0 ? 0 : 1);
```

- [ ] **Step 2: Self-test with fixtures**

Create a tiny vitest spec `scripts/materials/reconcile.spec.mjs` that imports the diff logic (refactor the three filters into an exported `diff(db, r2, b2)` pure function) and asserts each divergence type is detected. Run `node --test` or add to the units config.
```javascript
import { diff } from './reconcile.mjs';
// dangling: in db not r2; orphan: in r2 not db; gap: in r2 not b2
const r = diff(new Set(['a','b']), new Set(['b','c']), new Set(['b']));
// a dangling, c orphan, c... compute and assert
```
(Refactor `reconcile.mjs` to `export function diff(db,r2,b2)` and call it from a `main()` guarded by `import.meta.url` check, so it is unit-testable.)

- [ ] **Step 3: Workflow**

`.github/workflows/materials-reconcile.yml`: weekly `cron: "0 8 * * 1"`, prod + dev jobs run the script; on non-zero exit, a `notify-failure`-style job opens/updates a `materials-reconcile-divergence` issue with the JSON summary in the body. Reuse the github-script dedup pattern.

- [ ] **Step 4: Commit**

```bash
git add scripts/materials/reconcile.mjs scripts/materials/reconcile.spec.mjs .github/workflows/materials-reconcile.yml
git commit -m "feat(ws1): weekly materials reconciliation (dangling/orphan/mirror-gap)"
```

### Task 8: Drain monitor + approve workflows

**Files:**
- Create: `.github/workflows/materials-drain-monitor.yml`
- Create: `.github/workflows/materials-drain-approve.yml`

- [ ] **Step 1: Monitor workflow**

Daily `cron: "0 8 * * *"` (after the 07:00 worker drain). One job per env runs psql against the env pooler:
```sql
select last_paused_at, last_paused_count,
       (select count(*) from public.r2_pending_deletes where succeeded_at is null and attempted_at is null) as new_pending,
       (select string_agg(file_path, e'\n') from (
          select file_path from public.r2_pending_deletes
          where succeeded_at is null and attempted_at is null
          order by queued_at limit 10) s) as sample
from public.r2_drain_control where id = 1;
```
A github-script step opens/updates a `materials-drain-paused` issue when `last_paused_at` is within the last 25 hours, including `last_paused_count` and the sample keys, and the one-line approve instruction (link to the approve workflow). Reuse the dedup pattern.

- [ ] **Step 2: Approve workflow**

`workflow_dispatch` with inputs `environment` (prod|dev) and `max` (integer). One step runs psql:
```sql
update public.r2_drain_control
   set override_max = :max, override_set_at = now(), override_consumed_at = null
 where id = 1;
```
passing `-v max=${{ inputs.max }}` and the env pooler URL. Guarded so only repo admins can dispatch (it is a write to prod). Echoes the new override for the audit log.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/materials-drain-monitor.yml .github/workflows/materials-drain-approve.yml
git commit -m "feat(ws1): drain volume-guard monitor + one-shot approve workflows"
```

---

## Phase 5: Docs + memory

### Task 9: Runbook domain 2 rewrite + action register

**Files:**
- Modify: `docs/runbook/14-disaster-recovery.md`

- [ ] **Step 1:** Rewrite section "### 2. Materials / object storage" recovery procedure to the immutability model (no "restore prior version"; R2 bucket lock + add-only B2 mirror + reconciliation + lock-aware drain + volume guard), and the "Recovery from a wrongful bulk delete" steps from the spec. Update the domain-2 row in the failure-domain table (Detection: weekly reconciliation; RPO 24h / RTO 4h; mitigation: lock + B2). Flip action-register row P1 and the `r2_pending_deletes` drain-guardrail row to `done` with a one-line WS1 summary. Update the concentration-risk Mermaid note that materials have "NO BACKUP".
- [ ] **Step 2:** Run `cd src/client && npm run docs:arch` if any auto-gen block is affected (domain tables are hand-written prose; likely no-op). Verify no `<!-- AUTO-GEN -->` block was hand-edited.
- [ ] **Step 3: Commit**

```bash
git add docs/runbook/14-disaster-recovery.md
git commit -m "docs(ws1): rewrite DR domain 2 to the materials immutability model"
```

### Task 10: Memory update

- [ ] Update `project_dr_remediation_program` memory: WS1 shipped (R2 7d lock, B2 30d add-only mirror, weekly reconcile, lock-aware + volume-guarded drain), the gated-apply caveat status, and the deferred follow-ups (B2 lagged-prune, event-driven mirror, provenance auto-approve). Update `MEMORY.md` pointer line.

---

## Phase 6: Live applies, deploy, end-to-end (GATED)

Run only after Phases 1-5 are committed and merged-ready. Each live step is hard to reverse; confirm with the operator at the step.

- [ ] **Step 1:** Provision the worker secret if not present on the target project: `vault.create_secret('<random>', 'r2_drain_worker_secret')` (prod + dev). Confirm `R2_WORKER_SECRET` Worker secret matches.
- [ ] **Step 2:** Push DB migration: merge to `develop` (dev deploy runs `supabase db push`), verify dev smoke; then prod via the gated prod deploy.
- [ ] **Step 3:** `tofu apply` shared (B2 materials buckets) — GATED (compliance lock). Verify buckets exist.
- [ ] **Step 4:** Add the mirror/reconcile/monitor secrets to Infisical (B2 materials key, R2 materials-read key) and confirm sync to GHA.
- [ ] **Step 5:** Deploy the worker (drain now lock-aware + gated) via the normal pipeline. Confirm a manual drain run is green and `r2_drain_gate` is called (worker logs).
- [ ] **Step 6:** Run `materials-mirror.yml` once (workflow_dispatch) for dev then prod; confirm objects land in B2.
- [ ] **Step 7:** `tofu apply` dev R2 lock — GATED. Upload a dev test object, attempt delete, confirm `10069` rejection; enqueue a delete, confirm the drain defers (not fails). Then `tofu apply` prod R2 lock — GATED.
- [ ] **Step 8:** Run `materials-reconcile.yml` once; confirm clean. Inject a divergence (orphan test key) and confirm the issue opens; clean up.
- [ ] **Step 9:** Restore exercise: copy a key from B2 back into a throwaway R2 bucket; confirm bytes match. Log it in the runbook drill log (the live WS6 drill references this).
- [ ] **Step 10:** Push branch, open PR into `develop` (merge `develop` in first, resolve conflicts), let CI gate (lint, build, units, integration, iac-pr-check, features-drift), then merge.

---

## Self-review notes

- **Spec coverage:** R2 lock (Task 2), B2 mirror add-only (Tasks 1,6), reconciliation 3-way (Task 7), lock-aware drain (Task 4), check-first volume guard deny-by-default + one-shot approve (Tasks 3,5,8), wrongful-bulk-delete recovery (Task 9 runbook), greenfield no-migration (rollout), no bucket recreation (Task 2 in place), deferred follow-ups recorded (Task 10). All spec sections map to a task.
- **Rollout order guard:** drain lock-awareness (Tasks 4-5, deployed Step 5) precedes R2 lock apply (Step 7), per the spec's mandatory ordering.
- **Type consistency:** `DrainSummary` fields (`deferred`, `paused`, `unattempted`) defined in Task 4, used in Tasks 4-5. RPC names (`r2_drain_gate`, `mark_r2_delete_deferred`) consistent between Task 3 (SQL) and Tasks 4-5 (worker). Control columns consistent between Task 3 and Task 8.
- **Open implementation choice (resolve at Task 6/7):** exact Infisical secret names/paths for the materials B2 key and R2 read key; pick names consistent with the `shared/backups` and `*/ai` conventions and add the matrix rows.
