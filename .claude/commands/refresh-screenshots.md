Refresh the Stout intro deck product screenshots. $ARGUMENTS = optional comma-separated shot names to refresh (default: all). You may also pass `sync` (run CT.gov sync first) and/or `commit` (commit + push when done).

You are refreshing the screenshots embedded in the Stout intro deck (`src/client/public/internal/stout-intro.html`) using the durable capture tool `src/client/scripts/capture-deck-shots.mjs`. Follow this exactly.

## Phase 0: Parse args + context

1. Read `src/client/scripts/deck-capture.README.md` for current options, and the memory note `reference_deck_screenshot_capture.md` for the target space, viewer-role gotcha, and sync/AI prerequisites.
2. From `$ARGUMENTS`, extract:
   - **Shot names** (any of: `whitelabel-stout-login, engagement-landing, timeline, heatmap, activity, bullseye, catalysts, events, source-import, command-palette, materials, intelligence, trial-detail`). If none given, capture all.
   - **`sync`** flag → set `SYNC=1` (clicks the trial-detail "Sync" button on the intelligence/trial-detail trials; only needed right after a fresh space reseed, since the seed does not set CT.gov fields).
   - **`commit`** flag → commit + push the changed PNGs at the end.
3. The script's `DEFAULT_DECK_URL` points at the canonical prod space ("Obesity Competitive Landscape", `780b5021...` under the Pfizer tenant). Override only if the user gave a different `DECK_URL`.

## Phase 1: Capture

Run from `src/client/`:

```
[SYNC=1] ONLY=<shots> node scripts/capture-deck-shots.mjs
```

- Omit `ONLY=` to capture all shots. Run it in the background and monitor the output file.
- A headed Chrome opens. If the profile is logged out, tell the user to **sign in once** in the window (`aadityamadala@gmail.com` for the authoring view; a pure-client space-viewer account for the client-facing intelligence byline — see the memory note). The login persists in gitignored `.shots-profile-run/`, so most runs skip it.
- `whitelabel-stout-login` only captures when logged out (brand-only page); skip it on a logged-in run.
- The `source-import` shot needs the tenant's `ai_config.ai_enabled=true`, or importGuard redirects.

## Phase 2: Verify

- **View every changed PNG** (read the image), do not trust the run log alone. A tiny/near-empty file means a too-early capture or a guard redirect — re-shoot with a longer wait or fix the block.
- Confirm the header reads "Obesity Competitive Landscape", no env/AI-incident banner is showing, and the shot shows the intended state (selection, scroll, tooltip, populated section, etc.).
- If a shot is wrong, fix that shot's block in `capture-deck-shots.mjs` (selection / scroll / hover / pasted text / `settle` wait), or apply a post-capture `sharp` crop, then re-run `ONLY=<that shot>` and re-verify. Iterate until correct.

## Phase 3: Commit (only if `commit` was passed, or the user confirms)

- Stage **only** the changed PNGs (and any script edits) explicitly — never `git add -A` (the `.shots-profile-run/` profile holds a real session, and the shared checkout may carry another session's WIP; verify `git diff --cached` is only your files).
- Intermediate `source-import-processing.png` / `source-import-results.png` are gitignored; only the composite is committed.
- `git push --no-verify origin develop` (the pre-push e2e flakes on cold start; CI is canonical). Pushing develop deploys to dev; promote to prod only on explicit ask.

## Output

Report which shots were captured, how each verified (one line each), and what (if anything) was committed/pushed. If you fixed a capture block, note the change.
