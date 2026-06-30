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

## Step 4: HARD STOP -- log dev evidence to the issue, then present it
- LOG AS YOU GO: persist the dev evidence to the issue BEFORE asking for prod approval, so every dev change is durably reviewable on the issue before it reaches prod.
  - Upload the dev shots: `node src/client/scripts/upload-evidence.mjs <n> <abs>/before-dev.png before-dev.png` and `... <abs>/after-dev.png after-dev.png` (each prints `EVIDENCE_URL=...`). For a pure data/RPC bug with no visual, include the proof inline instead (a markdown table of the verifying query output, the dev deploy run link).
  - Post a "Dev verification" comment: `gh issue comment <n> --repo clint-org/clint --body "..."` embedding the dev EVIDENCE_URLs as markdown images (or the data proof), the `deploy-dev.yml` run link, and exactly what was verified on dev.
- Then show the user `before-dev.png` and `after-dev.png` inline and summarize what changed. Do NOT proceed to prod until the user approves. This is the one mandatory in-command gate; the user may also inspect dev themselves here.

## Step 5: Ship to prod (gated)
- On approval, open the `develop -> main` PR with `Closes #<n>` in the body, and merge it. The prod deploy runs only after the user approves the `production` GitHub Environment in the Actions UI -- a second, infra-level gate. Wait for `deploy-prod.yml` to go green.

## Step 6: Verify on prod + capture
- Drive Claude-in-Chrome against the user's already-logged-in browser to the affected prod surface and screenshot the fixed state to `<abs>/after-prod.png`. (Claude-in-Chrome on prod sidesteps the prod auth + Cloudflare dance; do not use Playwright here.)

## Step 7: Log the resolution
- Upload the prod shot: `node src/client/scripts/upload-evidence.mjs <n> <abs>/after-prod.png after-prod.png` (prints `EVIDENCE_URL=...`). The dev shots were already uploaded + posted at Step 4.
- Post a resolution comment: `gh issue comment <n> --repo clint-org/clint --body "..."` with the outcome, the fixing PR, and the after-prod evidence URL as a markdown image (referencing the Step-4 dev verification).
- The issue auto-closes when the `develop -> main` PR merges (Closes #N on the default branch). Confirm it closed; if the PR is still pending prod approval, leave the status comment and let it close on merge.

## Cleanup
- Remove the worktree and the merged `fix/<slug>` branch (local + remote).
