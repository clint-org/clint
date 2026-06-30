# Issue resolution flow — design

Date: 2026-06-30
Status: draft (lean v1; full prod→dev clone deferred)

## Motivation

We log diagnosed bugs as GitHub issues (the `/log-issue` command already exists). What is missing is a consistent, evidence-backed **resolution loop**: reproduce the bug, fix it on dev, prove the fix visually, ship to prod behind a human gate, prove it again on prod, and log the resolution with before/after evidence on the issue. Today that is done ad hoc and the visual proof is never captured. This design makes the loop a repeatable command.

We deliberately scope v1 to the orchestration and drop the heaviest subsystem (a full prod→dev space clone). A targeted repro is enough for the bugs we see, and the real prod fix we shipped this session (issue #157, the CT.gov `c`-badge) was reproduced with a one-trial fixture and an integration test — no clone needed.

## Commands

Two commands, one already built:

- **`/log-issue`** (exists) — the entry point. Assembles a structured root-cause writeup from the current conversation and creates a GitHub issue (`bug` label). Unchanged by this design except documentation already notes that `Closes #N` only auto-closes on a merge to the default branch (`main`).
- **`/resolve-issue <issue#>`** (new) — the resolution loop below. Takes an open issue number, drives reproduce → fix → prove → ship → verify → log, and closes the issue (via the prod merge).

Keeping them separate matches real use: you log many issues but resolve them one at a time, sometimes later. `/resolve-issue` reads the issue body (the `/log-issue` writeup) as its brief.

## The resolution loop (`/resolve-issue`)

1. **Load + branch.** Read the issue (title, root cause, proposed fix). Create an isolated worktree on a `fix/<slug>` branch off `develop` (per repo convention: feature work branches from develop, not main).

2. **Reproduce on dev + capture BEFORE.** Reproduce the bug with a **targeted repro** — the minimal seed that triggers it (e.g. one trial + one anticipated marker), an existing dev sandbox space, or the bug's own integration test. Drive **Playwright** (dev auth = inject the `sb-auth-dev` cookie, the existing `e2e-dev` recipe) to the affected surface and screenshot the broken state → `before-dev.png`.

3. **Fix on dev + capture AFTER.** Implement the fix test-first (the change ships with its test, per repo convention). Deploy the branch to dev by merging to `develop` (triggers `deploy-dev.yml`). Re-run the same Playwright navigation → `after-dev.png`.

4. **Hard-stop — you review.** The loop pauses and presents the dev before/after inline. This is the single mandatory human gate. Nothing touches prod until you approve. (You can also go look at dev yourself here.)

5. **Ship to prod.** On approval, open/merge the `develop → main` PR. The prod deploy rides the existing `production` GitHub Environment approval gate — a second, infra-level human gate that can never be bypassed. The migration + fix reach prod via `deploy-prod.yml` (`supabase db push` then `wrangler deploy`).

6. **Verify on prod + capture.** Once prod is live, drive **Claude-in-Chrome** against your already-logged-in browser (sidesteps the prod auth / Cloudflare dance) to the same surface and screenshot the fixed state → `after-prod.png`.

7. **Log the resolution.** Upload the three PNGs to R2 under `issues/<n>/`, then post a resolution comment on the issue: outcome summary, the fixing PR, and the before/after evidence links. The issue auto-closes when the fix reaches `main` (it was opened against the dev-first flow, so `Closes #N` on the prod PR is what closes it).

## Tooling split (decided)

- **Dev → Playwright.** Throwaway sandbox you re-run often; auth is a trivial cookie inject; you want a deterministic, re-runnable before/after artifact. Reuses the `src/client/e2e-dev/` harness.
- **Prod → Claude-in-Chrome.** You are already logged in; it sidesteps prod auth + the Cloudflare bot fingerprint; prod is exactly where you want a live, your-own-eyes check.

## Evidence hosting (R2)

GitHub renders issue-comment images only from public URLs (its camo proxy fetches them). So the screenshots need a public path. Convention: a dedicated public R2 bucket exposed at a subdomain (e.g. `evidence.clintapp.com/issues/<n>/<name>.png`), via an R2 custom domain or a small Worker route. This bucket holds only synthetic dev sandbox shots and post-fix prod shots of the affected surface — no bulk client data. **Setup dependency:** this bucket + public route does not exist yet and is a prerequisite for step 7 (tracked in the plan).

## Human gates (decided)

The dev loop (steps 2–3) runs automatically. There is exactly one mandatory pause in our control — **step 4, before prod** — plus the independent `production` GitHub Environment approval at step 5. The dev-side check is opt-in: you look at step 4 when a bug feels visually risky; otherwise approve and proceed.

## Auto-close semantics

Because fixes land on `develop` first, `Closes #N` does not fire until the change reaches the **default branch (`main`)**. While the fix sits on dev, `/resolve-issue` keeps the issue current with a status comment (merge SHA, dev-verified). The issue closes itself when `develop → main` ships to prod. This is correct: an issue is "resolved" when the user-visible bug is gone in prod, not when it is merged to dev.

## Deferred: `/clone-space` (full prod→dev clone)

Cut from v1. If a future bug genuinely cannot be reproduced without real prod data, build `/clone-space` then and slot it into step 2 as an alternate repro source. Its sketch (for when that day comes): copy one prod space's readable graph (companies → assets → trials → indications/conditions → events) into a fresh, auto-expiring dev "Clone Sandbox" tenant; remap all `created_by`/member user refs to a dev system user and add the requester as owner; tag with a 7-day expiry and GC sweep; gate non-demo spaces behind an explicit confirm. The open dependency it would force — **write access to the dev DB** (current Infisical secret is read-only; would use the dev service-role key via the API) — is another reason to defer until needed.

## Out of scope / YAGNI

- No full prod→dev clone (deferred above).
- No CI integration of the visual checks — `/resolve-issue` is user-run, not a gate.
- No automated prod auth for Playwright (prod uses Claude-in-Chrome precisely to avoid maintaining a stored prod session).
- No screenshot diffing/pixel-compare — the human gate and a live prod look are the acceptance check, not an automated visual-regression assertion.

## Open items (resolve in the plan)

1. Stand up the public R2 evidence bucket + route (`evidence.clintapp.com/issues/...`). Resolved: `clint-evidence` R2 bucket (`infra/tofu/prod/r2.tf`) plus a public read-only `/evidence/*` Worker route (`src/client/worker/evidence.ts`), serving keys under the `issues/` prefix.
2. Confirm the `e2e-dev` Playwright harness can be driven ad hoc against an arbitrary dev surface with a captured screenshot (vs only its scripted specs). Resolved: `src/client/e2e-dev/tests/capture.spec.ts` captures any dev surface ad hoc, driven by `CAPTURE_PATH` / `CAPTURE_OUT` / optional `CAPTURE_SEED` env vars, on the existing HEADED harness.
3. Decide the `/resolve-issue` pause mechanism: a single command that stops mid-turn at step 4 and resumes on your reply, vs a two-call split (`/resolve-issue` for steps 1–4, a `--ship` continuation for 5–7). Resolved: a single command that hard-stops at Step 4 (present dev before/after) and resumes on the user's reply; no two-call split.
