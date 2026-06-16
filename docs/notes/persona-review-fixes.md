# Combined fix work-order — persona review + UI review

Single source of truth for the remaining fix stream. Merges two independent reviews of the live app, both run 2026-06-12 to 2026-06-15, code locations verified against `develop`:

- **Persona walkthrough** (`P1`–`P4` below): two cold personas (Stout MD tenant-owner, daily CI analyst space-editor) drove the real app via Playwright with no source access. Findings in *both* sessions are load-bearing.
- **UI design review** (`UI-N` items): screen-by-screen design/interaction/consistency/a11y pass of dev.clintapp.com. Full archive with screenshots in `docs/notes/ui-review-2026-06-12.md`; screenshots in `/tmp/clint-ui-review/`.

Status legend: `[ ]` open · `[x]` fixed · `[~]` partial · `[-]` won't fix / by design.

Verification commands at the bottom. Pair a Vitest/integration spec with every task that ships behavior (house rule — no deferred test phase).

---

## Already shipped this session (on `develop`) — do not redo

These UI-review items are done, deployed to dev, and verified in-browser. Detail + commits in `ui-review-2026-06-12.md`.

- `[x]` **UI-1** Landscape filter bar wraps instead of clipping (`landscape-filter-bar.component.html`).
- `[x]` **UI-2** Timeline marker date captions decollide per row, 38px greedy gap (`marker-label-layout.ts`). *See P3.3 — persona found a residual "Majun2626" case to re-verify.*
- `[x]` **UI-3** Import guard awaits `SpaceRoleService.ensureRole()` instead of racing the role fetch.
- `[x]` **UI-4 / UI-5** Timeline small-text WCAG AA: marker captions darken to 4.5:1 via `textColorOnWhite()`; slate-400 meaningful labels bumped; legend strip fixed.
- `[x]` **UI-6** Disabled solid buttons neutralize to slate (was Aura's reduced-opacity brand hue reading as a different enabled color).
- `[x]` **UI-7** Engagement resolves to the Intelligence section + tab; audit-log title in topbar; trial-detail anchor-link affordance.
- `[x]` **UI-8** "Clear filters" renders only when filters are active (shared grid toolbar).
- `[x]` **UI-9** Future Catalysts: PROJECTED is quiet text, green CONFIRMED pill marks exceptions.
- `[x]` **UI-11** Status tag: red tone for terminated/withdrawn; active tone → brand tokens (whitelabel-safe).
- `[x]` **UI-17 (color half)** Role badges use brand tone, not hard-coded teal. *Treatment mismatch still open — see UI-17 below.*
- `[x]` **UI-25** Command-palette "PhPhase 3" → phase label from `phase_type` (`search_palette` migration + integration tests).

---

## P1 — Converged / blocking (both personas, or load-bearing)

### P1.1 — Export is the most valuable feature and hard to find
Both personas. MD found it by blind-clicking; analyst (literal task "produce something for Friday's deck") searched the palette for "export" (0 results), checked all four views, abandoned the task.

**Corrected against code (ghosts removed):**
- ~~Icon-only trigger with no accessible name~~ → **already fixed.** The shared `<app-export-button>` (`shared/export/export-button.component.ts`) renders a visible "Export" label + `fa-file-arrow-down` icon + `aria-label`. No change needed.
- ~~Extend export to Bullseye / Future Catalysts~~ → **already present.** Bullseye (export host), Heatmap, and Catalysts (grid export) all expose export. No change needed.

**Genuinely open:**
- `[ ]` **Palette entry for export.** No export command in `core/services/palette-command.registry.ts` (only `go-*` nav). Add an "Export…" command, enabled when the active view publishes `topbarState.exportActions()`, that triggers the current view's export. **(S)**
- `[ ]` **Stamp the export filename** with space + date. Currently generic: `png-export.service.ts:54` → `clinical-trial-dashboard.png`; `landscape.component.ts:146` → `bullseye.png`; pptx likewise generic. Build `{spaceSlug}-{view}-{YYYY-MM-DD}.{ext}`. **(S)**
- `[ ]` **UI-21 (folded): export placement + menu-item icons.** Export sits top-right on Landscape but in-content top-left on Events/Companies/Assets/Trials; search box right-aligned on Catalysts, left on Events; heatmap export menu items (Image PNG / Excel XLSX) lack the file-type icons Materials rows have. Normalize placement and add format icons to the menu. **(S)**

### P1.2 — Author identity is broken in the judgment layer
Both personas + **UI-26** (same bug). Positioning is "the platform makes the firm's judgment visible," but judgment is attributed to placeholder garbage. Three surfaces, two root causes (locations re-verified on current `develop`):

1. `[ ]` **Intelligence feed byline "BY CLINT".** `intelligence-feed.component.ts:49` renders `By {{ agencyName() }}` (computed at `:68`) — always the agency name. Demo agency is named "Clint" → "BY CLINT". **This is by-design** (firm attribution), but in a whitelabel engagement it should resolve to the tenant's agency display name (e.g. "Stout"), and the persona expected an analyst. **Decision needed:** byline to the firm (resolve whitelabel display name) vs. authoring analyst. Recommend: firm display name for the feed byline; analyst names belong on the intelligence block (below).
2. `[ ]` **Contributors line shows UUID-prefix initials** ("00"/"31" for the analyst persona; "52" in the UI-review on BI). `intelligence-block.component.ts:34` `authorMap` defaults to `{}`; `:101,:104` fall back to `initialsFromId()` (`:156`) = first two chars of the UUID. Parents never pass `[authorMap]`:
   - `trial-detail.component.html:179` (`<app-intelligence-block>`, no `[authorMap]`)
   - `engagement-detail.component.html:16` (same gap)
   - `intelligence-history-panel.component.ts:42,:186` (identical unfed fallback)
3. **Root data gap:** the intelligence RPCs return raw UUIDs, no display-name join — `build_intelligence_payload()` and siblings in `supabase/migrations/20260501113858_primary_intelligence_rpcs.sql`. **No UUID→display-name utility exists yet.**

**Fix (server-side, preferred):** extend the intelligence RPCs to return a `{user_id: display_name}` map, mirroring the existing `lookup_user_by_email` / marker-history SECURITY DEFINER pattern that already joins `auth.users` (runbook `06-backend-architecture.md:638`). Display name = `auth.users.raw_user_meta_data->>'full_name'` → email local-part fallback. Wire it into all three `authorMap` inputs. Seed demo reads with a plausible analyst name (`20260501130349_extend_seed_demo_intelligence_and_materials.sql`, `_seed_demo_primary_intelligence()` sets `last_edited_by = p_uid` only). **(S–M)**

### P1.3 — Silent permission failures
Both personas lost real time. Both violate the repo's own empty-state audit rules 13.5 (role-appropriate affordances) and 13.6 (never silent).

- `[ ]` **(a) Spaces list: no-access card click is a dead no-op.** MD (tenant owner, no `space_members` row) clicked the only card; nothing, repeatedly. `space-list.component.ts:225` `openSpace()` just navigates; `space.guard.ts:30` denies via `has_space_access` and `createUrlTree(['/t', tenantId, 'spaces'])` — redirects to the page you're already on → silent. Access rule is correct by design (firewall, runbook 09); the **silent UX** is the bug. **Fix:** the list should mark accessible vs no-access cards up front (the query knows membership) and either disable with an explanatory tooltip or offer a request/join path; at minimum the guard redirect carries a toast. Relates to **UI-15** (spaces page). **(M)**
- `[ ]` **(b) "Add primary intelligence" shown to roles that can't publish.** Analyst (space editor) saw the button, wrote the note, got a 403 with only a tiny "Save failed" label and a silent revert. `upsert_primary_intelligence` gates on `is_agency_member_of_space` and raises `42501` (`20260509130100_intelligence_history_rpcs.sql:34,149,185,232`) — correct by design (intelligence is the agency's deliverable). **Fix:** hide/disable the affordance for non-agency space roles; on any write failure surface a real error toast, not the inline "Save failed" label. **(M)**

### P1.4 — "Live data" story fails on contact (MD's stated pilot blocker)
MD clicked "Sync from CT.gov" (500 from `/api/ctgov/sync-trial`); registry panel shows "(not set)" directly under a header asserting "PH 3".

- `[~]` **Error toast already exists in code.** `trial-detail.component.ts` `syncCtgov()` wraps in try/catch with `messageService.add({severity:'error'})`; `change-event.service.ts triggerSingleTrialSync()` throws on `!res.ok`. The missing toast was almost certainly **the local Worker not running** (no `/api/*` in the bare dev server), not a defect. **Action:** verify with the Worker up; if it fires, no change. If it still swallows, check the post-success `Promise.all([loadTrial, loadSnapshot, loadTrialActivity])` for a throw path bypassing the catch.
- `[ ]` **Contradictory phase display is a real UX issue.** Header uses `phase_type || phase` (`trial-detail.component.html:102`); CT.gov panel uses only `phase` (`:363`). Intentionally separate fields (analyst-owned `phase_type` vs CT.gov-synced `phase`), but "PH 3" above "(not set)" reads as a data bug. **Fix:** label the panel phase "CT.gov registry phase (as reported)" and/or show `phase_type_source` so the analyst override is legible. **(S)**

---

## P2 — Workflow blockers + design consistency

### Analyst workflow (persona, single-session but block daily use)
- `[ ]` **P2.1 No fuzzy/quarter marker dates.** Event Date is a required exact date; "Q4 2026" forced inventing Nov 15 with an apology in the description. Core gap for a forward-catalyst tracker. Model change. **(M)**
- `[ ]` **P2.2 "Projection" field mislabeled.** Options are Stout / Company / Primary / Actual — that's *provenance/source*, not projected-vs-actual. Rename/relabel. **(S)**
- `[ ]` **P2.3 Catalyst detail panel has no edit affordance** (Future Catalysts) — must navigate into the trial's markers table. **(S)**
- `[ ]` **P2.4 Intelligence Feed has no compose entry point** — authoring is only reachable from an entity's primary-intelligence drawer. **(S)**
- `[ ]` **P2.5 Events row accessible name "View details for null"** despite correct visible titles. **(S)**
- `[ ]` **P2.6 Raw enum casing leaks into event titles**, e.g. "Status: RECRUITING→ACTIVE_NOT_RECRUITING". Humanize. **(S)** *Related to UI-29 trials columns.*
- `[ ]` **P2.7 Materials page is download-only at page level** — upload/create only exists per-entity via drag-drop. **(S–M)**

### Design consistency (UI review)
- `[ ]` **UI-10 Events table readability.** Title truncates mid-word ("Primary Completion Date (P…"); ENTITY wraps trial codes badly ("SURPASS-"/"2"). Give the title column priority, no-wrap trial codes; consider showing sort+filter glyphs on hover/active only. **(S)**
- `[ ]` **UI-12 Heatmap left-panel idiom mismatch.** GROUP BY is stacked full-width buttons; COUNT right below is a segmented control. Bullseye has the same stacked GROUP BY. Unify the idiom. **(S)**
- `[ ]` **UI-13 Heatmap labels.** Row labels ellipsize with no tooltip ("GIPR antagonist + GLP-1 a…"); "LNCH"/"APP" headers cryptic next to P1–P4. Add tooltips, spell out headers. **(S)**
- `[ ]` **UI-14 Bullseye.** PH 2/PH 3 ring labels collide with dots; center reads "Filtered" when nothing is; "12 spokes" jargon; unclear Period relevance. **(S–M)**
- `[ ]` **UI-15 Spaces page ghost cell.** Empty grid column renders as a gray slab (`gap-px` + `bg-slate-200` hairline technique). Fill empty cells white / dashed "New space" ghost card / cap grid width. *Pairs with P1.3(a).* **(S)**
- `[ ]` **UI-16 Super-admin agency rows: bare red trash as the only action.** One click from the most destructive tier-1 op. Move into kebab/detail with type-to-confirm. Also tighten "MAX TENANTS"/"TENANTS" columns. **(S–M)**
- `[~]` **UI-17 Members role column treatment mismatch.** Color half done. Still open: self shows a static badge, others a dropdown — same column, two visuals, no explanation. **(S)**
- `[ ]` **UI-18 Agency Branding form.** Raw "unknown@unknown.invalid" default surfaced in contact email; empty right half wants a live brand preview (color + logo on a mini header). *Save-disabled half resolved by UI-6.* **(S–M)**
- `[ ]` **UI-22 Detail mini-timelines clip phase bars flat at the left edge** with no "starts earlier" affordance. **(S)**
- `[ ]` **UI-23 Trial detail header repeats the name** ("ATTAIN-1  ATTAIN-1" when display name == raw name). Suppress the duplicate. **(S)**

---

## P3 — Polish / first impression

### Persona (MD first-impression)
- `[ ]` **P3.1 Shared tenant link lands on a blank shell** with no guidance to pick a space; "Select space" then opens a second page to select again. *Distinct from UI-19 (default-host marketing landing); this is the authenticated tenant root.* **(S)**
- `[ ]` **P3.2 Hero trials drill into empty sections** ("No read yet", "0 reads", "No materials") — uneven demo depth. Demo-data. *Groups with UI-40.* **(S)**
- `[ ]` **P3.3 Marker captions still garble at year zoom** in places ("Majun2626") — verify whether UI-2's decollision fix (commit `26be5492`) has a gap (it dedupes per row by x; overlapping same-x markers in different rows, or sub-38px clusters with the today-line, may slip). Re-verify on dev, extend the gap logic if confirmed. **(S)**

### UI review polish
- `[ ]` **UI-19 Default-host landing is the weakest screen.** Centered logo + tagline + one card in dead space; doesn't show the product. Consider a product-render/live-timeline backdrop; "Go" button label terse. *Decision-heavy — confirm direction before building.* **(M)**
- `[ ]` **UI-20 Command palette polish.** No backdrop scrim; entity rows use plain color squares as icons; no footer keyboard hints; list cuts off mid-row with no scroll fade. **(S–M)**
- `[ ]` **UI-24 Plural/abbreviation copy glitches.** "1 P3 READOUTS", "1 TRIAL MOVES", "+1 NEW READS"; "12 co" vs "21 assets"; company detail STATS "1 co" (redundant). **(S)**
- `[ ]` **UI-26** → folded into **P1.2**.
- `[ ]` **UI-27 Audit log date format.** "6/12/26, 12:02 AM" vs "Jun 12, 2026" elsewhere; "(none)" actor vs "--" convention; Apply/Clear manual filter pattern differs from auto-apply lists. **(S)**
- `[ ]` **UI-28 Catalysts list details.** Bare "Trial End" title lacks context; trailing gray dot unexplained; "Clinical Trial" category wraps inconsistently. *Overlaps P2.3 catalyst panel.* **(S)**
- `[ ]` **UI-29 Trials list columns.** BRIEF TITLE "--" for all but one row, wide; PHASES header ambiguous; header sort+filter icons wrap on narrow columns. **(S)**
- `[ ]` **UI-30 Companies table layout.** Tiny inconsistent logos mid-table; ORDER far right with kebab; full pagination chrome for 12 rows (also Marker Types at 13). **(S)**
- `[ ]` **UI-31 Marker Types: Trial Start/End glyphs nearly invisible** in the MARKER column. **(S)**
- `[ ]` **UI-32 Archived spaces: "Back to spaces" appears three times.** One/two max. **(S)**
- `[ ]` **UI-33 Toast placement overlaps header stats** (top-right toast covered the counts on Home). Offset below the page header. *Relates to P1.3/P1.4 error toasts.* **(S)**
- `[ ]` **UI-34 DEV badge overlaps content** bottom-right (timeline legend, last catalyst row). Nudge or make dismissible. **(S)**
- `[ ]` **UI-35 User menu is sparse** (email + sign out + version only; no account/help/tenant switch). Decide intent. **(S)**
- `[ ]` **UI-36 Empty-table chrome.** Pending invites renders full column headers above "No pending invites." Collapse to the message. **(S)**
- `[ ]` **UI-37 Asset detail EVENTS double-frames its empty state** (section header card + separate empty box). Tighten to one block. **(S)**

---

## P4 — Stale documentation (verified contradictions)

Migration 75 (`20260429010000_owner_only_explicit_space_access.sql`) removed implicit tenant→space access; `has_space_access` now requires an explicit `space_members` row. Per the docs-no-drift rule, fix in the same change set as related code (ideally alongside P1.3).

- `[ ]` **P4.1** `CLAUDE.md:136` — "Tenant members get implicit editor/viewer space access via `has_space_access()`." Stale — correct. Also `tenant_members.role` is now `owner`-only (mig 75); the "`owner | member`" framing is stale too.
- `[ ]` **P4.2** `docs/runbook/08-authentication-security.md:94` — "…tenant membership (implicit editor/viewer)…". Stale.
- `[ ]` **P4.3** `docs/runbook/11-developer-guide.md:197` — "Tenant members get implicit editor/viewer space access via `has_space_access`" + `owner | member`. Stale.
- `[-]` `docs/runbook/07-database-schema.md:165` (migration-42 row) — historical migration-log entry; leave as history (mig-75 row at :175 records the reversal).

---

## Data issues surfaced by the UI (fix in data; the UI made them visible)

- `[ ]` **UI-38 Duplicate timeline rows.** SURPASS-2 twice (same NCT), SELECT twice under Wegovy. If per-indication rows are intended, disambiguate in the UI; else dedupe. **(S–M)**
- `[ ]` **UI-39 Mounjaro MOA wrongly tags "SGLT2 inhibitor"** alongside "GIP/GLP-1 dual agonist" (wrong for tirzepatide). Seed fix. **(S)**
- `[ ]` **UI-40 / P3.2 Test garbage + uneven demo depth.** "asdfdas"/"asdf" events; "test" + "sdf sdf sdf" in a published read; "Mounjaro!"; hero trials with empty sections. Clean seed so demos read credibly. **(S–M)**

---

## Suggested execution order (one stream)

1. **P4 docs** — pure text, no risk, unblocks the mental model. (S)
2. **P1.4 phase labeling + P2 small relabels** — P2.2 (Projection), P2.6 (enum humanize), P2.5 (null a11y name), UI-23, UI-24, UI-27. Low-risk polish. (S each)
3. **P1.2 author identity** — RPC display-name map + wire `authorMap` through 3 parents + seed + UI-26 byline decision. (S–M)
4. **P1.1 export** — palette entry + filename stamp + UI-21 placement/icons. (S–M)
5. **P1.3 silent permission failures** — role-aware affordances + real error toasts (+ UI-15 spaces, UI-33 toast offset). (M)
6. **P2.1 fuzzy dates** — model change, larger. (M)
7. **Remaining UI consistency** (UI-10, 12, 13, 14, 16, 17, 18, 22, 28–37) and **data** (UI-38/39/40, P3.2). Batch by surface.
8. **Decision-gated** — UI-19 landing, UI-20 palette, the three open questions below. Confirm direction first.

## Open questions (need direction before building)

- **P1.2 byline:** firm display-name vs authoring-analyst for the intelligence-feed byline? (Recommend firm for the feed, analyst names on the block.)
- **UI-19 landing:** show the product (static or live timeline render) behind the workspace finder?
- **Filters affordance:** collapse the Landscape filter row into one "Filters" control with applied-filter chips (the READ line already summarizes editorially)?
- **Events/Catalysts:** lead with a one-line READ like Home/Timeline?

## Verification

```bash
cd src/client && ng lint && ng build
# after any migration change:
supabase db advisors --local --type all
npm run docs:arch        # if migrations / routes / package.json changed
npm run test:units
# integration (export SUPABASE_SERVICE_ROLE_KEY from `supabase status`):
npx vitest run --config integration/vitest.config.ts
```
