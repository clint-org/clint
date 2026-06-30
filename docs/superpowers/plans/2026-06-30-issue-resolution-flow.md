# Issue Resolution Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/resolve-issue <issue#>` command that drives a logged GitHub bug from reproduce → fix on dev → visual proof → human-gated prod ship → prod visual proof → resolution comment with before/after evidence.

**Architecture:** A slash-command (markdown) orchestrates pieces that already exist plus three new, independently testable units: a public R2 "evidence" host (one Cloudflare bucket + one read-only Worker route) so screenshots are fetchable by GitHub's image proxy; a generic dev screenshot capture spec built on the existing `e2e-dev` Playwright harness; and a tiny upload helper that puts a PNG to the bucket and returns its public URL. The full prod→dev space clone is explicitly out of scope (deferred per the design).

**Tech Stack:** Cloudflare Workers + R2, OpenTofu (infra), Playwright (`e2e-dev` harness, HEADED via `run.sh`), Claude-in-Chrome (prod), `gh` CLI, GitHub Actions deploy (`deploy-dev.yml` / `deploy-prod.yml`).

## Global Constraints

- Slash commands live in `.claude/commands/<name>.md`; first line is the human description; `$ARGUMENTS` carries args. Plain markdown, no frontmatter.
- No emojis, no em dashes in any content. No "Co-Authored-By" / Claude attribution in commit messages.
- Feature work branches from `develop` (not `main`); hotfixes branch from `main`. Dev deploys on push to `develop`; prod deploys only via `develop → main` PR gated by the `production` GitHub Environment approval.
- Worker code is gated in CI by `npm run test:worker` only; `worker/tsconfig.json` has ~39 pre-existing `tsc` errors that are NOT a gate. Do not attempt to fix unrelated worker tsc errors.
- R2 buckets are managed in `infra/tofu/{shared,dev,prod}/r2.tf` and applied via Scalr (`clintapp.scalr.io`, env `clint`). Worker bindings live in `src/client/wrangler.jsonc`.
- `e2e-dev` runs HEADED (headless never clears the Cloudflare challenge) via `src/client/e2e-dev/run.sh`, which wraps Playwright in `infisical run --env dev --path /supabase`.
- `Closes #N` auto-closes a GitHub issue only on merge to the default branch (`main`), never on a `develop` merge. Repo is `clint-org/clint`.
- Evidence images must be served from a public (no-auth) URL or GitHub's camo proxy will not render them.

---

## File Structure

- `infra/tofu/prod/r2.tf` (modify) — add the `clint-evidence` R2 bucket resource.
- `src/client/wrangler.jsonc` (modify) — bind `EVIDENCE_BUCKET` to `clint-evidence` on the prod `clint` Worker.
- `src/client/worker/evidence.ts` (create) — `handleEvidenceGet(request, env)`: public, read-only GET of an `issues/<n>/<file>` object from `EVIDENCE_BUCKET`.
- `src/client/worker/index.ts` (modify) — route `GET /evidence/*` to `handleEvidenceGet` before the SPA fallback.
- `src/client/worker/test/evidence.spec.ts` (create) — vitest coverage for the route.
- `src/client/e2e-dev/tests/capture.spec.ts` (create) — generic "navigate a dev surface and screenshot it" spec, parameterized by env vars.
- `src/client/e2e-dev/helpers/capture.ts` (create) — pure helper: resolve capture params from env, validate.
- `scripts/upload-evidence.mjs` (create, repo root) — put a local PNG to `clint-evidence` via `wrangler r2 object put` and print the public URL.
- `.claude/commands/resolve-issue.md` (create) — the orchestrator command.

---

## Task 1: Public R2 evidence bucket + Worker route

**Files:**
- Modify: `infra/tofu/prod/r2.tf`
- Modify: `src/client/wrangler.jsonc`
- Create: `src/client/worker/evidence.ts`
- Modify: `src/client/worker/index.ts`
- Test: `src/client/worker/test/evidence.spec.ts`

**Interfaces:**
- Produces: `handleEvidenceGet(request: Request, env: Env): Promise<Response>` — `GET /evidence/issues/<n>/<file>.png` streams the matching `EVIDENCE_BUCKET` object with `content-type: image/png`, `cache-control: public, max-age=86400`; returns 404 if absent, 405 for non-GET, 400 if the key escapes the `issues/` prefix. `Env` gains `EVIDENCE_BUCKET: R2Bucket`.

- [ ] **Step 1: Write the failing test**

Create `src/client/worker/test/evidence.spec.ts` (mirror the binding-mock style of `worker/test/r2-drain/binding-integration.spec.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { handleEvidenceGet } from '../evidence';

function bucketWith(objects: Record<string, string>) {
  return {
    get: async (key: string) =>
      key in objects
        ? { body: new Response(objects[key]).body, httpMetadata: { contentType: 'image/png' } }
        : null,
  } as unknown as R2Bucket;
}

const env = (objects: Record<string, string>) =>
  ({ EVIDENCE_BUCKET: bucketWith(objects) }) as unknown as Parameters<typeof handleEvidenceGet>[1];

describe('handleEvidenceGet', () => {
  it('streams an existing issues/ object', async () => {
    const res = await handleEvidenceGet(
      new Request('https://clintapp.com/evidence/issues/157/after-prod.png'),
      env({ 'issues/157/after-prod.png': 'PNGDATA' })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await res.text()).toBe('PNGDATA');
  });

  it('404s a missing object', async () => {
    const res = await handleEvidenceGet(
      new Request('https://clintapp.com/evidence/issues/157/missing.png'),
      env({})
    );
    expect(res.status).toBe(404);
  });

  it('405s a non-GET', async () => {
    const res = await handleEvidenceGet(
      new Request('https://clintapp.com/evidence/issues/157/x.png', { method: 'POST' }),
      env({ 'issues/157/x.png': 'X' })
    );
    expect(res.status).toBe(405);
  });

  it('400s a key that escapes the issues/ prefix', async () => {
    const res = await handleEvidenceGet(
      new Request('https://clintapp.com/evidence/../secrets.txt'),
      env({ 'issues/157/x.png': 'X' })
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/client && npx vitest run --config worker/vitest.config.mts worker/test/evidence.spec.ts`
Expected: FAIL — `Cannot find module '../evidence'`.

- [ ] **Step 3: Implement the route handler**

Create `src/client/worker/evidence.ts`:

```ts
import type { Env } from './index';

/**
 * Public, read-only GET of an evidence screenshot. Only objects under the
 * `issues/` prefix are reachable; the key is taken verbatim from the path after
 * `/evidence/` and rejected if it does not start with `issues/` or contains `..`.
 * No listing, no write, no auth — these are synthetic dev shots and post-fix prod
 * shots linked from GitHub issue comments (GitHub's camo proxy needs a public URL).
 */
export async function handleEvidenceGet(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
  const key = new URL(request.url).pathname.replace(/^\/evidence\//, '');
  if (!key.startsWith('issues/') || key.includes('..')) {
    return new Response('bad key', { status: 400 });
  }
  const obj = await env.EVIDENCE_BUCKET.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/png',
      'cache-control': 'public, max-age=86400',
    },
  });
}
```

- [ ] **Step 4: Wire the route + binding**

In `src/client/worker/index.ts`, add the `EVIDENCE_BUCKET` field to the `Env` interface (`EVIDENCE_BUCKET: R2Bucket;`), import the handler (`import { handleEvidenceGet } from './evidence';`), and add this BEFORE the `url.pathname.startsWith('/api/')` block and the SPA fallback:

```ts
    if (url.pathname.startsWith('/evidence/')) {
      return handleEvidenceGet(request, env);
    }
```

In `src/client/wrangler.jsonc`, under the prod `r2_buckets` array (the one with `MATERIALS_BUCKET`), add:

```jsonc
		{
			"binding": "EVIDENCE_BUCKET",
			"bucket_name": "clint-evidence"
		}
```

In `infra/tofu/prod/r2.tf`, add:

```hcl
# clint-evidence holds public bug-resolution screenshots linked from GitHub
# issue comments. Read-only public access is via the Worker `/evidence/*` route
# (src/client/worker/evidence.ts), NOT a public bucket ACL.
resource "cloudflare_r2_bucket" "evidence" {
  account_id    = var.cloudflare_account_id
  name          = "clint-evidence"
  jurisdiction  = "default"
  location      = "ENAM"
  storage_class = "Standard"
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd src/client && npx vitest run --config worker/vitest.config.mts worker/test/evidence.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full worker suite (no regressions)**

Run: `cd src/client && npm run test:worker`
Expected: PASS, including the new file.

- [ ] **Step 7: Commit**

```bash
git add src/client/worker/evidence.ts src/client/worker/test/evidence.spec.ts src/client/worker/index.ts src/client/wrangler.jsonc infra/tofu/prod/r2.tf
git commit -m "feat(worker): public /evidence route + clint-evidence R2 bucket"
```

> Apply note (not a code step): the bucket is created by Scalr applying `infra/tofu/prod`, and the route ships with the prod Worker deploy. Both ride the normal gated pipeline; no manual `wrangler deploy`.

---

## Task 2: Evidence upload helper

**Files:**
- Create: `scripts/upload-evidence.mjs`

**Interfaces:**
- Produces: CLI `node scripts/upload-evidence.mjs <issue#> <local-png-path> <name>` → uploads to `clint-evidence/issues/<issue#>/<name>` via `wrangler r2 object put --remote` and prints the line `EVIDENCE_URL=https://clintapp.com/evidence/issues/<issue#>/<name>` on success (non-zero exit on failure).

- [ ] **Step 1: Write the failing test**

Create `scripts/upload-evidence.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { publicUrlFor, objectKeyFor } from './upload-evidence.mjs';

test('objectKeyFor builds the issues prefix key', () => {
  assert.equal(objectKeyFor('157', 'after-prod.png'), 'issues/157/after-prod.png');
});

test('publicUrlFor builds the clintapp evidence URL', () => {
  assert.equal(
    publicUrlFor('157', 'after-prod.png'),
    'https://clintapp.com/evidence/issues/157/after-prod.png'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/upload-evidence.test.mjs`
Expected: FAIL — cannot find `./upload-evidence.mjs`.

- [ ] **Step 3: Implement the helper**

Create `scripts/upload-evidence.mjs`:

```js
import { execFileSync } from 'node:child_process';

const BUCKET = 'clint-evidence';
const BASE = 'https://clintapp.com/evidence';

export const objectKeyFor = (issue, name) => `issues/${issue}/${name}`;
export const publicUrlFor = (issue, name) => `${BASE}/${objectKeyFor(issue, name)}`;

function main() {
  const [issue, file, name] = process.argv.slice(2);
  if (!issue || !file || !name) {
    console.error('usage: node scripts/upload-evidence.mjs <issue#> <local-png-path> <name>');
    process.exit(2);
  }
  execFileSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${objectKeyFor(issue, name)}`, '--file', file, '--remote', '--content-type', 'image/png'],
    { stdio: 'inherit' }
  );
  console.log(`EVIDENCE_URL=${publicUrlFor(issue, name)}`);
}

// Run only when invoked directly, not when imported by the test.
if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/upload-evidence.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/upload-evidence.mjs scripts/upload-evidence.test.mjs
git commit -m "feat(scripts): upload-evidence R2 helper for issue screenshots"
```

---

## Task 3: Generic dev screenshot capture spec

**Files:**
- Create: `src/client/e2e-dev/helpers/capture.ts`
- Create: `src/client/e2e-dev/tests/capture.spec.ts`

**Interfaces:**
- Consumes: `createScratchWorld`, `openAs`, `settle` from `e2e-dev/fixtures.ts` / `helpers`.
- Produces: a Playwright spec that, given `CAPTURE_PATH` (an app route like `/timeline`) and `CAPTURE_OUT` (a png path), provisions a scratch world, opens it as `owner`, navigates with `settle`, and writes a full-page screenshot to `CAPTURE_OUT`. Optional `CAPTURE_SEED` names a seed helper exported from `helpers/seed.ts` to populate the world first. `captureParamsFromEnv(env): { path; out; seed? }` is the pure, tested param resolver.

- [ ] **Step 1: Write the failing test (the pure param resolver)**

Create `src/client/e2e-dev/helpers/capture.spec.ts` (a worker-vitest-independent unit; run with the root vitest units config):

```ts
import { describe, it, expect } from 'vitest';
import { captureParamsFromEnv } from './capture';

describe('captureParamsFromEnv', () => {
  it('reads path and out', () => {
    expect(captureParamsFromEnv({ CAPTURE_PATH: '/timeline', CAPTURE_OUT: '/tmp/a.png' })).toEqual({
      path: '/timeline',
      out: '/tmp/a.png',
      seed: undefined,
    });
  });

  it('passes through an optional seed name', () => {
    expect(
      captureParamsFromEnv({ CAPTURE_PATH: '/x', CAPTURE_OUT: '/tmp/x.png', CAPTURE_SEED: 'oneTrial' })
        .seed
    ).toBe('oneTrial');
  });

  it('throws when a required var is missing', () => {
    expect(() => captureParamsFromEnv({ CAPTURE_PATH: '/x' })).toThrow(/CAPTURE_OUT/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/client && npm run test:units -- capture`
Expected: FAIL — cannot find `./capture`.

- [ ] **Step 3: Implement the param resolver**

Create `src/client/e2e-dev/helpers/capture.ts`:

```ts
export interface CaptureParams {
  path: string;
  out: string;
  seed?: string;
}

/** Resolve capture params from a (process.env-like) record; throw on missing required vars. */
export function captureParamsFromEnv(env: Record<string, string | undefined>): CaptureParams {
  const path = env['CAPTURE_PATH'];
  const out = env['CAPTURE_OUT'];
  if (!path) throw new Error('CAPTURE_PATH is required');
  if (!out) throw new Error('CAPTURE_OUT is required');
  return { path, out, seed: env['CAPTURE_SEED'] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src/client && npm run test:units -- capture`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the capture spec**

Create `src/client/e2e-dev/tests/capture.spec.ts`:

```ts
import { test } from '@playwright/test';
import { createScratchWorld, openAs, settle } from '../fixtures';
import { captureParamsFromEnv } from '../helpers/capture';
import * as seeds from '../helpers/seed';

// Single ad-hoc capture driven by env vars. Run via:
//   CAPTURE_PATH=/timeline CAPTURE_OUT=/abs/before-dev.png ./e2e-dev/run.sh e2e-dev/tests/capture.spec.ts
test('capture dev surface', async ({ browser }) => {
  const params = captureParamsFromEnv(process.env);
  const world = await createScratchWorld();
  try {
    if (params.seed) {
      const fn = (seeds as Record<string, unknown>)[params.seed];
      if (typeof fn !== 'function') throw new Error(`unknown CAPTURE_SEED: ${params.seed}`);
      await (fn as (w: typeof world) => Promise<void>)(world);
    }
    const { page, context } = await openAs(browser, world, 'owner');
    try {
      await settle(page, params.path);
      await page.screenshot({ path: params.out, fullPage: true });
    } finally {
      await context.close();
    }
  } finally {
    await world.teardown();
  }
});
```

> If `helpers/seed.ts` does not already export a callable that takes a `ScratchWorld`, add the bug-specific seed there when a given `/resolve-issue` run needs one — the spec resolves it by name. No seed export is required for surfaces that reproduce without data.

- [ ] **Step 6: Smoke the capture spec against dev**

Run:
```bash
cd src/client && CAPTURE_PATH=/ CAPTURE_OUT=/tmp/capture-smoke.png ./e2e-dev/run.sh e2e-dev/tests/capture.spec.ts
```
Expected: PASS (HEADED), and `/tmp/capture-smoke.png` exists and is a non-empty PNG (`file /tmp/capture-smoke.png` reports PNG image data).

- [ ] **Step 7: Commit**

```bash
git add src/client/e2e-dev/helpers/capture.ts src/client/e2e-dev/helpers/capture.spec.ts src/client/e2e-dev/tests/capture.spec.ts
git commit -m "feat(e2e-dev): generic env-driven dev surface screenshot capture"
```

---

## Task 4: The `/resolve-issue` command

**Files:**
- Create: `.claude/commands/resolve-issue.md`

**Interfaces:**
- Consumes: Task 1 route, Task 2 `scripts/upload-evidence.mjs`, Task 3 `capture.spec.ts`, the existing `/log-issue` issue body, `gh`, the `e2e-dev` harness, Claude-in-Chrome.
- Produces: the documented operator loop. This task ships prose, not code; its "test" is a dry-run walkthrough (Step 3).

- [ ] **Step 1: Write the command**

Create `.claude/commands/resolve-issue.md`:

```markdown
Drive a logged GitHub bug to a verified, evidence-backed resolution. Argument: $ARGUMENTS (the issue number, e.g. `157`).

Repo: `clint-org/clint`. Prereq: the issue was created by `/log-issue` (its body carries the root-cause writeup this command treats as the brief).

---

## Step 1: Load and branch
- `gh issue view <n> --repo clint-org/clint` -- read title, root cause, proposed fix.
- Create an isolated worktree on `fix/<slug>` off `develop` (feature work branches from develop). Symlink `node_modules` from the main checkout for tests.

## Step 2: Reproduce on dev + capture BEFORE
- Reproduce with the minimal repro the issue describes: a one-entity seed, an existing dev sandbox, or the bug's own integration/unit test. If a seed is needed, add a named export to `src/client/e2e-dev/helpers/seed.ts` that populates a `ScratchWorld`.
- Capture the broken surface:
  `cd src/client && CAPTURE_PATH=<route> CAPTURE_OUT=<abs>/before-dev.png [CAPTURE_SEED=<name>] ./e2e-dev/run.sh e2e-dev/tests/capture.spec.ts`
  (HEADED; never headless -- the Cloudflare challenge needs a real browser.)
- If the bug cannot be reproduced visually (pure data/RPC bug), say so and record a text repro instead; the before shot is then optional.

## Step 3: Fix on dev (test-first) + capture AFTER
- Implement the fix with its test inline (every behavior-shipping change carries its test). For DB changes: new migration based on the LIVE `pg_get_functiondef`, run `supabase db reset` + the relevant integration spec + `supabase db advisors --local --type all` + `npm run migrations:check-redefs`.
- Merge the branch to `develop` (`git push origin HEAD:develop` after merging origin/develop) to trigger `deploy-dev.yml`. Wait for the dev deploy to go green (`gh run list --workflow deploy-dev.yml`).
- Re-capture the same surface to `<abs>/after-dev.png` with the same CAPTURE command.

## Step 4: HARD STOP -- present dev evidence
- Show the user `before-dev.png` and `after-dev.png` inline and summarize what changed. Do NOT proceed to prod until the user approves. This is the one mandatory in-command gate; the user may also inspect dev themselves here.

## Step 5: Ship to prod (gated)
- On approval, open the `develop -> main` PR with `Closes #<n>` in the body, and merge it. The prod deploy runs only after the user approves the `production` GitHub Environment in the Actions UI -- a second, infra-level gate. Wait for `deploy-prod.yml` to go green.

## Step 6: Verify on prod + capture
- Drive Claude-in-Chrome against the user's already-logged-in browser to the affected prod surface and screenshot the fixed state to `<abs>/after-prod.png`. (Claude-in-Chrome on prod sidesteps the prod auth + Cloudflare dance; do not use Playwright here.)

## Step 7: Log the resolution
- Upload the shots:
  `node scripts/upload-evidence.mjs <n> <abs>/before-dev.png before-dev.png`
  (repeat for after-dev.png, after-prod.png); each prints `EVIDENCE_URL=...`.
- Post a resolution comment: `gh issue comment <n> --repo clint-org/clint --body "..."` with the outcome, the fixing PR, and the three evidence URLs as markdown images.
- The issue auto-closes when the `develop -> main` PR merges (Closes #N on the default branch). Confirm it closed; if the PR is still pending prod approval, leave the status comment and let it close on merge.

## Cleanup
- Remove the worktree and the merged `fix/<slug>` branch (local + remote).
```

- [ ] **Step 2: Lint the helper script and worker (sanity)**

Run: `node --test scripts/upload-evidence.test.mjs && cd src/client && npm run test:worker`
Expected: PASS (the command references only verified scripts/routes).

- [ ] **Step 3: Dry-run walkthrough**

Read `.claude/commands/resolve-issue.md` end to end against the just-resolved #157 as a mental dry run: every command (`gh`, the CAPTURE invocation, `upload-evidence.mjs`, `gh issue comment`) references a real, tested artifact and a real path. Fix any step that names a file/flag that does not exist. No code change if the walkthrough is clean.

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/resolve-issue.md
git commit -m "feat(commands): add /resolve-issue resolution loop"
```

---

## Task 5: Documentation + handoff note

**Files:**
- Modify: `docs/superpowers/specs/2026-06-30-issue-resolution-flow-design.md` (mark open items 1-3 resolved)

**Interfaces:**
- Consumes: nothing. Produces: the design's "Open items" section reconciled with what was built.

- [ ] **Step 1: Reconcile the open items**

In the design doc's "Open items" section, mark each resolved with how: (1) `clint-evidence` bucket + `/evidence/*` Worker route (Task 1); (2) `capture.spec.ts` drives an arbitrary dev surface ad hoc (Task 3); (3) pause mechanism chosen = a single command that hard-stops at Step 4 and resumes on user reply (Task 4).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-30-issue-resolution-flow-design.md
git commit -m "docs(spec): reconcile resolution-flow open items with implementation"
```

---

## Self-Review

- **Spec coverage:** `/log-issue` (exists, unchanged) ✓; `/resolve-issue` loop steps 1-7 → Task 4 ✓; dev-Playwright capture → Task 3 ✓; prod Claude-in-Chrome → Task 4 Step 6 ✓; hard-stop-before-prod gate → Task 4 Step 4 ✓; R2 evidence host → Tasks 1-2 ✓; auto-close semantics → Task 4 Step 7 ✓; `/clone-space` deferred (no task, by design) ✓.
- **Placeholders:** none; every code step shows real code and the command prose references only artifacts built in Tasks 1-3.
- **Type consistency:** `handleEvidenceGet(request, env)` signature is identical in Task 1 test, impl, and the index route; `objectKeyFor`/`publicUrlFor`/`EVIDENCE_URL` line consistent across Task 2; `captureParamsFromEnv` shape (`path`/`out`/`seed`) identical across Task 3.
```
