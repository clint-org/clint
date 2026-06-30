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

## Step 3: Fix on dev (test-first)
- Implement the fix with its test inline (every behavior-shipping change carries its test). For DB changes: new migration based on the LIVE `pg_get_functiondef`, run `supabase db reset` + the relevant integration spec + `supabase db advisors --local --type all` + `npm run migrations:check-redefs`.
- Merge the branch to `develop` (`git push origin HEAD:develop` after merging origin/develop) to trigger `deploy-dev.yml`. Wait for the dev deploy to go green (`gh run list --workflow deploy-dev.yml`).

## Step 3a: Surface inventory -- enumerate EVERY surface the fix touches (do not skip)
This is the step that stops "I captured the obvious screen and missed the others." A fix almost never touches one surface. Before capturing anything, write an explicit inventory and capture every entry; a surface you don't list is a surface you won't review.
- Derive the inventory mechanically from the diff, not from memory. For each changed file/RPC, name the user-facing surface(s) it renders on:
  - **Producers** -- forms/dialogs/wizards that write the changed field (e.g. the create/edit form, the import review grid + edit dialog).
  - **Consumers** -- every read surface that displays it: list and detail/profile pages, side panels, the bullseye/heatmap/timeline, exports (PPTX/PDF), and any help page whose copy describes it.
  - **AI/import path** -- if the change touches extraction, `commit_source_import`, or any `event_types`/derivation logic, the `/import` review grid + edit dialog are in scope. Confirm the new field is both shown and (where applicable) editable there; "the AI extracts it" is not the same as "the reviewer can see and correct it."
- For each surface: a route to capture, or a one-line reason it needs none (e.g. "no visual change"). Capture each broken state to `<abs>/before-<surface>.png` and, after the dev deploy is green, the fixed state to `<abs>/after-<surface>.png`. Reuse `e2e-dev/tests/capture.spec.ts` for plain routes; write a dedicated seeded capture spec when a surface needs interaction (dialog open, panel deep-link, AI extraction).
- Pure data/RPC surfaces with no visual get a text proof (query output table) instead of a shot, but they still appear in the inventory.

## Step 4: HARD STOP -- log ALL surface evidence to the issue, then present it
- LOG AS YOU GO: persist the dev evidence to the issue BEFORE asking for prod approval, so every dev change is durably reviewable on the issue before it reaches prod.
  - Upload EVERY shot from the Step-3a inventory: `node src/client/scripts/upload-evidence.mjs <n> <abs>/<file>.png <file>.png` (each prints `EVIDENCE_URL=...`). For a pure data/RPC surface, include the proof inline instead (a markdown table of the verifying query output, the dev deploy run link).
  - Post a "Dev verification" comment: `gh issue comment <n> --repo clint-org/clint --body "..."` that lists the full surface inventory and embeds each surface's before/after EVIDENCE_URL as markdown images (or its data proof), plus the `deploy-dev.yml` run link.
- COMPLETENESS CHECK before the gate: re-read the diff and confirm every user-facing surface it touches has a shot (or a stated reason it has none) on the issue. If any are missing, capture them before presenting -- this is the check whose absence let the AI review screen slip on #159.
- Then show the user the before/after shots inline and summarize what changed. Do NOT proceed to prod until the user approves. This is the one mandatory in-command gate; the user may also inspect dev themselves here.

## Step 5: Ship to prod (gated)
- On approval, open the `develop -> main` PR with `Closes #<n>` in the body, and merge it. The prod deploy runs only after the user approves the `production` GitHub Environment in the Actions UI -- a second, infra-level gate. Wait for `deploy-prod.yml` to go green.

## Step 6: Verify on prod + capture
- Drive Claude-in-Chrome against the user's already-logged-in browser to the prod surfaces from the Step-3a inventory and screenshot the fixed state(s) to `<abs>/after-prod-<surface>.png`. At minimum re-verify the primary surface from the issue; cover the others when prod data allows. (Claude-in-Chrome on prod sidesteps the prod auth + Cloudflare dance; do not use Playwright here.)

## Step 7: Log the resolution
- Upload the prod shot: `node src/client/scripts/upload-evidence.mjs <n> <abs>/after-prod.png after-prod.png` (prints `EVIDENCE_URL=...`). The dev shots were already uploaded + posted at Step 4.
- Post a resolution comment: `gh issue comment <n> --repo clint-org/clint --body "..."` with the outcome, the fixing PR, and the after-prod evidence URL as a markdown image (referencing the Step-4 dev verification).
- The issue auto-closes when the `develop -> main` PR merges (Closes #N on the default branch). Confirm it closed; if the PR is still pending prod approval, leave the status comment and let it close on merge.

## Cleanup
- Remove the worktree and the merged `fix/<slug>` branch (local + remote).
