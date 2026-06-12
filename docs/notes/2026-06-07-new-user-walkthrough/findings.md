# New-user walkthrough: findings

**Date:** 2026-06-07
**Environment:** dev (`dev.clintapp.com`), signed in as Stout agency, BI tenant
**Method:** Navigated as a new user with limited guidance via a headless browser. Created two spaces in the BI tenant: **Claude Demo** (seeded via the hidden `/seed-demo` route) and **Import Test** (left empty, then populated through all three import paths). Screenshots in `./screens/`.

Findings are numbered so we can walk them one by one. Each has a severity, where it lives, what was observed, how to reproduce, and a suggested direction. Severity is reviewer judgment, not a formal triage.

---

## Reviewer summary

The core product is genuinely strong: dense, on-brand, and fast, with four well-built landscape views and an import pipeline that does real work. The issues below are mostly at the edges (auth lifecycle, mobile, the AI extraction path, and a few counting/labeling inconsistencies). Two deserve priority: the signed-out auth retry storm (#1) and the text-import marker data loss (#2), because both are silent and both touch trust in the data.

---

## High

### 1. Auth refresh-token retry storm when signed out
- **Area:** Auth / apex landing (`dev.clintapp.com`)
- **Observed:** Landing on the apex with a stale/invalid chunked `sb-auth` cookie (the cross-subdomain `.clintapp.com` session cookie) fires a burst of ~219 requests to `auth/v1/token?grant_type=refresh_token`: the first few return `400` (invalid refresh token), the rest `429` (rate limited), plus repeated `Lock broken by another request with the 'steal' option`. The burst settles only after hitting the rate-limit ceiling.
- **Repro:** With an expired/invalid `sb-auth` cookie present, load `dev.clintapp.com`. Clearing the cookie returns the page to 0 console errors, confirming the trigger.
- **Impact:** Hammers the auth endpoint and can `429` the user's own next legitimate sign-in. A real user reaches this state via an expired session, sign-out elsewhere, or token rotation.
- **Direction:** On `400 invalid_grant`, clear the session cookie and stop after 1-2 attempts; add backoff; resolve the navigator-lock contention that produces concurrent steal-retries.

### 2. Text-import "unlinked markers" are lost on confirm
- **Area:** Import (From text) -> review -> confirm
- **Observed:** A press-release text import staged 2 future-catalyst markers ("SYNCHRONIZE-1 Topline Data Readout" 2027-01-01..06-30, "Survodutide FDA Submission (Obesity)" late 2027). Both were checked and included in "Confirm 8 items". After confirm they appear nowhere: the SYNCHRONIZE-1 trial shows "No markers yet", the Survodutide asset has none, and Future Catalysts is empty. The *events* from the same import persisted (the MASH strategic event landed on the asset); the *markers* did not.
- **Repro:** `screens/import-text-review.png` (2 markers staged) -> confirm -> `screens/import-test-catalysts.png` (Future Catalysts empty) and `screens/markers-anchor-broke.png` / `synchronize1-detail.png` ("No markers yet").
- **Impact:** The headline value of text import (capturing catalysts) is silently dropped. The analyst sees a successful confirm but the catalysts never materialize.
- **Direction:** Persist and attach "unlinked" markers to their referenced trial/asset on confirm, or surface them in an "unlinked markers" inbox. At minimum, do not report them in the confirm count if they will not be written.

---

## Medium

### 3. The fixed "DEV v0.0.1" badge blocks the import Confirm button
- **Area:** Env banner (`app-env-banner`) vs import review footer
- **Observed:** The badge is `position:fixed; bottom-3 right-3; z-50` and sits directly over the review footer's primary "Confirm N items" CTA, intercepting pointer events. The automated click failed for 5s with the badge named as the interceptor; it only succeeded via a programmatic click.
- **Impact:** On dev/local, the primary action on the import review screen is partially or fully unclickable. Confirm whether the banner renders in any prod-like build.
- **Direction:** Give the badge `pointer-events:none`, or keep the review footer's action clear of the bottom-right fixed zone.

### 4. Timelines do not auto-scroll to "now"
- **Area:** Landscape Timeline, asset timeline, trial timeline
- **Observed:** All three open parked on empty early years (space timeline ~2009-2013, asset/trial ~2016-2020). The scroll container is ~5163px wide but loads at `scrollLeft 307` (~8%); the actual pipeline activity sits ~85% to the right.
- **Repro:** `screens/seeded-timeline.png` (empty early years on load) vs `screens/seeded-timeline-scrolled.png` (rich data at 2024-2029).
- **Impact:** For a CI tool, the user lands on a blank grid and must scroll to find the data.
- **Direction:** Default the horizontal scroll to today (or the data's center of mass).

### 5. Workspace finder does not validate that a workspace exists
- **Area:** Apex landing "Find your workspace"
- **Observed:** A made-up subdomain (`acmepharma`) redirects straight to a normal-looking "Sign in to Clint" page; nothing signals the workspace is not real.
- **Repro:** `screens/acmepharma-login.png`.
- **Direction:** Gate the redirect with `check_subdomain_available` (or equivalent) and show a "workspace not found" state.

### 6. Workspace finder "Go" button is off-screen on mobile
- **Area:** Apex landing, narrow viewports
- **Observed:** At 390px the Go button renders at x=396-439, entirely past the viewport edge and outside the card (card ends at 341). The input row never wraps/stacks.
- **Repro:** `screens/landing-mobile.png`.
- **Direction:** Make the finder row responsive (stack the button below the input on narrow screens).

### 7. AI extraction MOA hallucination (data accuracy)
- **Area:** Import (From text) extraction
- **Observed:** Source text said survodutide is "a glucagon/GLP-1 receptor dual agonist". It was extracted and saved as "GLP-1/GIP/glucagon receptor tri-agonist" (which is retatrutide's MOA). The wrong MOA persisted to the asset record.
- **Repro:** `screens/import-text-review.png`, `screens/survodutide-detail.png`, `screens/import-test-assets.png`.
- **Impact:** Incorrect competitive data enters the DB unless the analyst catches it in review.
- **Direction:** Tighten the extraction prompt/grounding for MOA; consider flagging MOA as "needs review" when the model adds receptors not present in the source.

### 8. Engagement-inventory trial count is inconsistent and mis-pluralized
- **Area:** Home engagement landing vs Manage > Trials
- **Observed:** Home counts active trials only but labels it "trials". With 3 completed + 1 active trial, Home shows "1 trials" while the Trials page shows 4. Immediately after the NCT import (3 completed trials) Home briefly showed "3 trials" then settled to "0 trials".
- **Repro:** `screens/import-test-landing.png` ("3 trials" right after import), then Home "1 trials" vs `screens/import-test-trials.png` (4 rows).
- **Direction:** Align the count definition with the Trials page (or relabel, e.g. "active trials"); fix "1 trials" pluralization.

---

## Lower / informational

### 9. Grounding drops signal tied to unnamed trials
- **Area:** Import (From text) grounding
- **Observed:** The release's actual headline (positive Phase 2 MASH topline, 83% endpoint, planned Phase 3 MASH) was dropped because the MASH trial had no name/NCT in the source: "name not found in source text" / "no trial_refs point to a grounded trial". Only the named obesity trial (SYNCHRONIZE-1) survived.
- **Repro:** `screens/import-text-dropped.png` (the "Dropped (4)" bucket).
- **Note:** Transparent (there is a Dropped bucket with reasons), but easy to miss and there is no "promote from dropped" action. Conservative grounding is reasonable; the tradeoff is lost signal when a source describes an unnamed trial.

### 10. URL import misdiagnoses ct.gov as "behind a paywall"
- **Area:** Import (From URL)
- **Observed:** `https://clinicaltrials.gov/study/NCT04184622` returned "Article appears to be behind a paywall. Paste the text instead." ct.gov is not paywalled; the fetcher could not extract text from the JS-rendered page. It also does not recognize a `clinicaltrials.gov/study/NCT...` URL and route it to the NCT resolver (which works perfectly).
- **Repro:** `screens/import-url-result.png`.
- **Note:** The error and one-click "Paste the text instead" fallback are good UX. Direction: detect NCT IDs in pasted URLs and route to the NCT path; broaden the failure message beyond "paywall".

### 11. Trial-detail in-page anchors corrupt the URL
- **Area:** Trial detail sub-nav (`href="#markers"` etc.)
- **Observed:** Clicking the "Markers" anchor scrolled the section into view but changed the URL to `bi.dev.clintapp.com/#markers`, dropping the tenant/space/trial route. A refresh there would lose context.
- **Direction:** Use `routerLink` with `fragment`, or `[routerLink]="[]" fragment="markers"`, so the anchor scrolls without rewriting the path.

### 12. Command palette empty-scope copy
- **Area:** Command palette (Cmd+K)
- **Observed:** Searching with no matches shows "No matches in ." with an empty scope name (should be the space name).

### 13. Minor pre-auth nits
- Footer "Contact" is `mailto:privacy@clintapp.com` (privacy mailbox, mismatched label).
- Top-right "Sign in" and "Sign in to your agency portal" both link to `/login` but are framed as different destinations.
- An empty `<p-dialog role="alertdialog">` is permanently mounted in the DOM (assertive-role with no content; minor a11y smell).
- `/dashboard` while signed out returns a 404. This is correct (no such route); noted only to rule it out.

---

## What worked well (kept for balance)

- **`seed-demo`** produced rich, realistic data instantly (36 trials, 13 companies, 28 assets). `screens/seeded-home.png`.
- **Four landscape views** are dense, on-brand, and fast: Timeline Gantt (`seeded-timeline-scrolled.png`), Bullseye phase-radar (`seeded-bullseye.png`), Heatmap MOA x phase matrix (`seeded-heatmap.png`), Future Catalysts (`seeded-future-catalysts.png`).
- **NCT import is flawless end to end:** 3 NCT IDs -> 2 companies, 3 assets, 3 trials with MOA/ROA, phase, status, indication, CT.gov enrichment, dedup grouping, accessible editable `treegrid`, and correct persistence. `screens/import-nct-review.png`, `screens/import-test-trials.png`.
- **AI text extraction is capable:** caught both partner companies, future catalysts as date-ranged markers, and a high-priority regulatory event with inline-editable fields. `screens/import-text-review.png`.
- **Empty states and copy** are well written throughout, including role-aware guidance.
- **Auto-generated "READ" summaries** on the landscape views are a strong analyst touch.

## Test artifacts left in place
- BI tenant > **Claude Demo** space (seeded demo data).
- BI tenant > **Import Test** space (NCT import: SURMOUNT-1, STEP 1, TRIUMPH-1; text import: Survodutide / SYNCHRONIZE-1 / BI + Zealand). Safe to delete when done.
