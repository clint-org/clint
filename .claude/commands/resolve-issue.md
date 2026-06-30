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
