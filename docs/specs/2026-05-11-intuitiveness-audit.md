# Intuitiveness audit — analyst surfaces

Date: 2026-05-11
Scope: user-facing analyst surfaces only (auth, onboarding, spaces, engagement-landing, landscape, catalysts, manage, materials, activity, events, space-settings). Admin / super-admin / agency portals excluded.
Lens: two passes — first-touch (new analyst, day 1-3) and expert friction (power user, week 4+). Findings tagged with which lens applies.
Rubric: `src/client/CLAUDE.md` section 13 (Empty-state audit). This audit is, in effect, a conformance pass against that section.

## How to read this doc

- **P0** blocks a task or causes the user to give up / file a ticket.
- **P1** causes confusion or re-work but the user gets through.
- **P2** polish — the surface is usable but feels generic.
- Findings cite `file:line` so triage can open the file and act.
- "Suggested affordance" is the concrete remedy, copy-ready. Severity decides order within each section.

The brand floor (`docs/brand.md`): no tour modals, no coachmarks, no "Welcome aboard!" copy, no emoji. Nudges are terse hints, tooltips on jargon, empty-state copy that names the next action, status confirmations after destructive actions, and contextual links to existing `/help/*` pages.

---

## P0 — first-touch, blocks task

### 1. MOA / ROA filter chips have no glossary affordance
- `src/client/src/app/features/landscape/landscape-filter-bar.component.html:130, 149`
- Placeholders are the literal abbreviations `MOA` and `ROA`. `ariaLabel` carries the full name for screen readers, but sighted day-1 users see only the acronyms.
- Affordance: add `pTooltip="Mechanism of action"` and `pTooltip="Route of administration"` (position `top`) on each multiselect. Optional: keep the placeholder abbreviated for density and let the tooltip carry the gloss.

### 2. Bullseye view has no inline explanation of rings vs spokes
- `src/client/src/app/features/landscape/bullseye-chart.component.html` (chart sits under `landscape-shell` `/bullseye/*` routes)
- Rings encode phase, spokes encode the active dimension. The mapping lives only in the SVG `<desc>` (screen-reader only). Sighted users — including the first-time analyst — get a circular blob with no legend.
- Affordance: small inline legend in the bullseye toolbar (`Rings = phase  ·  Spokes = {dimension label}`) with the dimension label derived from `spokeMode()`. Link the word "Rings" to `/help/phases` (already exists).

### 3. Positioning sub-tabs are unexplained, and `MOA + TA` is cryptic
- `src/client/src/app/features/landscape/landscape-shell.component.ts:113-121`
- Five tabs (`by-moa`, `by-therapy-area`, `by-moa-therapy-area`, `by-company`, `by-roa`) with terse labels. New users have no signal for which grouping answers which question.
- Affordance: `pTooltip` on each tab. `MOA + TA` → `"Assets grouped by mechanism of action, broken out by therapy area"`. Others similarly precise.

### 4. Catalysts page has zero framing — no definition, no scope
- `src/client/src/app/features/catalysts/catalysts-page.component.html:1-13`
- The template is a toolbar + table. No subtitle, no "what is a catalyst," no link to a definition. A day-1 analyst lands on a table of unfamiliar terms (PDUFA, AdCom, P2 readout).
- Affordance: page-shell subtitle line: `"Upcoming regulatory, trial, and commercial events that may move the competitive landscape."` (~12 words). Keep it inline; do not add a banner card.

### 5. Onboarding code field doesn't distinguish tenant vs space invite codes
- `src/client/src/app/features/onboarding/onboarding.component.ts:42-50`
- Same field accepts both an 8-char tenant code and a 32-char hex space code. Error on mismatch is generic ("Invalid or expired invite code"). First-time user doesn't know which they have.
- Affordance: under the input, a one-line hint: `"Paste the code from your invite email. Tenant codes are 8 characters; space codes are longer."` Make the error message route-aware: distinguish "not found" from "expired" from "wrong scope (tenant code on a space invite or vice versa)."

### 6. Engagement-landing intelligence empty state names no actor
- `src/client/src/app/features/engagement-landing/engagement-landing.component.html:230-239`
- Copy says reads "will appear here" once the agency publishes. It does not tell a pharma-client analyst who to ask or how their agency is wired in.
- Affordance: add a second sentence: `"Reach out to your agency lead or check the activity feed for in-progress drafts."` If the agency contact is queryable (`tenant_members` with `role='owner'`), surface their name inline.

---

## P0 — expert friction, blocks task

### 7. No keyboard path between tenants or spaces
- `src/client/src/app/core/layout/contextual-topbar.component.ts:40-86` (tenant + space dropdowns)
- Power users with N tenants / M spaces switch by mouse only. There is no command palette, no `cmd+k`, no shortcut hint.
- Affordance: bind `cmd+k` to open the tenant dropdown (or space dropdown when scoped to a tenant), and add the hint `⌘K` after the dropdown trigger label. Roadmap-grade: replace both dropdowns with a single command palette over tenants + spaces + recent entities.

### 8. Sidebar logo navigates home but has no tooltip
- `src/client/src/app/core/layout/app-shell.component.ts:608-613`
- Click navigates to spaces list. There's no `pTooltip` and no visual hover affordance distinct from the rest of the nav rail.
- Affordance: add `pTooltip="Spaces"` (position `right`, matching nav-rail convention) on the logo button.

---

## P1 — first-touch, causes confusion

### 9. Two divergent definitions of "space" in the same component
- `src/client/src/app/features/spaces/space-list.component.ts:48-50` vs `:99-102`
- The empty state defines a space well: `"Each space is a firewalled engagement scoped to a domain..."`. The create-space dialog re-defines it generically: `"A space is a workspace for organizing and visualizing a set of clinical trials..."`. Same user, same component, two definitions in one session.
- Affordance: reuse the empty-state copy in the dialog. Pick one canonical definition for the space concept and use it everywhere.

### 10. Zoom select-button uses single-letter labels with no gloss
- `src/client/src/app/features/landscape/landscape-filter-bar.component.html:19-27`
- `Y / Q / M / D` is dense but opaque to day-1 users.
- Affordance: `pTooltip` per option ("Yearly", "Quarterly", "Monthly", "Daily"). Keep the single-letter labels — they fit the data-instrument feel.

### 11. Marker legend exists but only at the bottom of the timeline
- `src/client/src/app/features/landscape/timeline-view.component.html` (legend lives in `legend.component.html:106-123`)
- Day-1 users see the marker dots before they reach the legend. A `/help/markers` page exists but isn't surfaced near the data.
- Affordance: small `?` icon in the timeline header that links to `/help/markers`. Repeat the pattern wherever markers render (engagement-landing if it shows markers, future-catalysts table).

### 12. Activity page header gives no concept of "activity"
- `src/client/src/app/features/engagement-activity/engagement-activity-page.component.html:4-9`
- Header is `Activity` + space name. A new user has no idea what populates this feed or how often.
- Affordance: subtitle line: `"Trial changes detected from CT.gov polling and analyst edits. New entries appear at the top."` (`<p class="text-sm text-slate-500">`)

### 13. Source filter (`CT.gov` vs `Analyst`) is unlabeled in the data
- `src/client/src/app/features/engagement-activity/engagement-activity-page.component.html:33-44`
- The filter exists but each row doesn't carry a source badge explaining which entries came from where.
- Affordance: row badge or column for source, with `pTooltip` on the header: `"CT.gov: automated polling detects trial metadata changes. Analyst: manual entries by team members."`

### 14. Materials filter chips use the literal database enum values
- `src/client/src/app/features/materials-browse/materials-browse-page.component.ts` (template chip filters)
- Chips show `briefing`, `conference_report`, `ad_hoc`, `priority_notice` and entity types `trial`, `marker`, `company`, `asset`, `engagement` — raw enum casing.
- Affordance: humanize the labels in the filter options (`Briefing`, `Conference report`, `Priority notice`, `Ad hoc`). The database column can stay snake_case; the display label should not be it.

### 15. Onboarding page header reads as create-flow, not join-flow
- `src/client/src/app/features/onboarding/onboarding.component.ts:42-46`
- Label is `Welcome`. Header is `headerTitle()`. A first-touch user, especially on the apex domain, can read it as "set up your workspace" rather than "redeem an invite."
- Affordance: change the uppercase label from `Welcome` to `Accept invite`. Keep the header dynamic.

### 16. "Open in bullseye" mapping is non-obvious
- `src/client/src/app/features/landscape/positioning-view.component.ts:210-219`
- The button maps `moa+ta` to `by-therapy-area` (not `by-moa`). User clicks expecting MOA, sees TA, backs out.
- Affordance: `pTooltip` on the button that names the target dimension explicitly: `"Open in Bullseye — grouped by Therapy area"` (dynamic per current grouping).

### 17. Field visibility settings page lacks framing
- `src/client/src/app/features/space-settings/space-field-visibility-settings.component.html:4-5`
- Title `Field visibility` + subtitle `Choose which CT.gov fields appear on each surface.` doesn't explain what a "surface" is or which fields are scoped to this control.
- Affordance: expand to `"Choose which CT.gov trial fields appear on each page in this space — trial list, trial detail, timeline. Changes save on confirm and apply for every member."` Add a preview affordance (next item).

---

## P1 — expert friction, causes re-work

### 18. Filter chips have no "clear all" affordance
- `src/client/src/app/features/landscape/landscape-filter-bar.component.html:234-241` (current "Clear" button)
- Clear button silently resets every filter — including unrelated chips like phase + therapy area + company. A user mid-drill-down loses context with no undo.
- Affordance: change the Clear button to "Clear filters (N)" showing the active-filter count, and toast on click: `"Filters cleared. Undo"` with a 5s undo affordance that restores the previous filter state.

### 19. Member role change confirms but doesn't name the diff
- `src/client/src/app/features/space-settings/space-members.component.ts:364-377` (changeRole)
- Toast says `"Role updated."` Doesn't tell an owner managing 50 members which permissions they just granted or revoked.
- Affordance: toast: `"Role updated to {role}. {Name} can now {capability summary}."` Or pre-flight modal showing the diff (gained / lost capabilities).

### 20. Member removal confirmation doesn't name blast radius
- `src/client/src/app/features/space-settings/space-members.component.ts:379-398` (removeMember)
- Modal asks "Remove {name} from this space?" Doesn't say what they lose access to or whether their drafts / comments stay.
- Affordance: enrich confirm copy: `"Remove {name}? They will lose access to all data in this space. Any drafts they own remain attached to their account but become invisible to other members."`

### 21. Generic delete-confirmation copy doesn't name cascades
- `src/client/src/app/shared/components/confirm-delete.ts` (used by `company-list`, `asset-list`, `trial-list`)
- Modal says "Delete company. This cannot be undone." Doesn't distinguish whether the cascade unlinks vs deletes child rows.
- Affordance: add a `details` slot to `confirmDelete()` and pass entity-specific copy:
  - Company: `"Associated assets are unlinked, not deleted. Markers and intelligence remain."`
  - Asset: `"Associated trials are unlinked, not deleted."`
  - Trial: `"Markers and trial notes are deleted. Intelligence and materials remain but lose their trial link."`

### 22. Validation errors are framework-generic
- forms across `manage/*`, especially trial-create-dialog and marker-form
- "Name is required" is fine. But uniqueness errors surface the raw constraint name from Postgres (e.g. `duplicate key value violates unique constraint "trials_name_space_unique"`).
- Affordance: map known constraints to human messages in a single helper. `trials_name_space_unique` → `"A trial with this name already exists in this space. Add a suffix to distinguish (e.g. NCT0000…)."`

### 23. Marker form blocks submit when no trials are selected — without explanation
- `src/client/src/app/features/manage/markers/marker-form.component.ts:220-234, 307-308`
- Save button is disabled (`canSubmit` requires `selectedTrialIds.length > 0`). No inline hint explains the requirement; user thinks the form is broken.
- Affordance: when `selectedTrialIds` is empty, show validation message under the trials selector: `"At least one trial. Markers always belong to a trial timeline."`

### 24. List pages have no "clear filters" or "showing N of M" affordance
- `manage/companies`, `manage/assets`, `manage/trials`, `engagement-activity`, `events`, `materials-browse`
- Per-column filters on `p-table` are individually clearable; there is no global reset. Power users have to walk each column.
- Affordance: add `Clear filters` button to the shared `grid-toolbar` component, gated on `grid.isFiltered()`. Also surface `"Showing {visible} of {total}"` next to it.

### 25. Filter and grid state don't persist between visits
- `events-page.component.ts:128-177`, `engagement-activity-page.component.html:48-82`, `materials-browse-page.component.ts`
- Sort, column visibility, active filters all reset on navigation. Power users re-apply their config on every page entry.
- Affordance: serialize grid state to `localStorage` keyed by `tenant + space + page`. Add a small `Reset to defaults` link in the toolbar when state is non-default.

### 26. "Referenced in" empty branch is silent about source of truth
- `src/client/src/app/features/manage/trials/trial-detail.component.html:240-265`
- Empty copy is `"No published reads link to this trial yet."` Curated reads that exist as drafts or in a sibling space won't show; the user doesn't know why.
- Affordance: amend copy: `"No published reads link to this trial. Drafts and reads from other spaces are not shown here."`

### 27. Audit log column meanings are opaque
- `src/client/src/app/features/space-settings/space-audit-log.component.ts:9-15`
- Columns are `Action`, `Actor`, `Resource`, `Metadata`. `Action` values like `member.invited`, `space.deleted` need a glossary; `Metadata` is raw JSON.
- Affordance: header `?` tooltip on `Action` listing top values. Render `Metadata` as a chip set of key/value pairs, not a JSON blob. (Mid-size effort; flag as a follow-up.)

---

## P2 — first-touch, polish

### 28. Login provider buttons don't say "an account will be created"
- `src/client/src/app/features/auth/login.component.ts:93-148`
- Two SSO buttons with no copy clarifying that a new user can sign in and be onboarded.
- Affordance: small line under the buttons (only when `hasSelfJoin()` is true): `"Sign in with your work email. If you don't have an account yet, one is created automatically."`

### 29. Space cards lack a "this is clickable" visual anchor at rest
- `src/client/src/app/features/spaces/space-list.component.ts:68-86`
- Hover changes background; the arrow icon is `text-slate-300` until hover. First-timers in a list of 1-2 spaces may not realize the card is interactive.
- Affordance: arrow color from `text-slate-300` to `text-slate-400`, with `group-hover:text-brand-600`. Or convert the card to an explicit `Open →` link in the bottom-right corner.

### 30. Empty states across `manage/*` don't name entity relationships
- `manage/companies/company-list.component.html:78`, `manage/assets/asset-list.component.html:141`, `manage/trials/trial-list.component.html:194`
- Each says "No X yet. Add one to get started." Doesn't tell a new analyst that asset belongs to company or trial belongs to asset + therapy area.
- Affordance: adjust copy:
  - Assets: `"No assets yet. Add one. Each asset belongs to a company."`
  - Trials: `"No trials yet. Add one. Each trial links to an asset and a therapeutic area."`
  - Markers: `"No markers yet. Add one. Markers always belong to a trial timeline."`

### 31. Seed-demo spinner gives no progress signal
- `src/client/src/app/features/spaces/seed-demo.component.ts:27`
- "Seeding demo data" with a spinner. Can run for several seconds. User wonders if it hung.
- Affordance: add a secondary line: `"Creating companies, assets, trials, and markers — this takes a few seconds."`

### 32. Phase legend doesn't link to `/help/phases` from where users see phases
- `src/client/src/app/features/landscape/timeline-view.component.html` (phase bars) and `bullseye-chart.component.html` (rings)
- `/help/phases` exists. No surface that shows phase color links to it.
- Affordance: one small `?` icon in the legend; click → route to `/help/phases`.

---

## P2 — expert friction, polish

### 33. Timeline zoom controls don't show the resolved date range
- `src/client/src/app/features/landscape/timeline-view.component.ts:44-61`
- Power users zoom and re-filter often. The resolved window isn't shown anywhere.
- Affordance: inline label next to the zoom buttons: `"Showing 2024-2026"` (computed from the resolved range, updates on zoom + filter change).

### 34. Positioning view doesn't confirm grouping change
- `src/client/src/app/features/landscape/positioning-view.component.ts` + `landscape-shell.component.ts:113-121`
- Switching between MOA / TA / MOA+TA / Company / ROA changes axes and bubble layout without a confirmation cue. Users sometimes don't notice the change immediately.
- Affordance: ensure the X-axis label (already computed in `xAxisLabel`) is always visible and tracks the active grouping in real time. Optional: 150ms transition on bubble positions to make the regrouping visible.

### 35. Field visibility has no preview before save
- `src/client/src/app/features/space-settings/space-field-visibility-settings.component.html:40-58`
- User toggles checkboxes, hits Save, then has to navigate away to see what changed.
- Affordance: thumbnail preview of each affected surface (trial list, trial detail, timeline) showing which fields will be visible. Mid-effort; mark as follow-up.

### 36. Marker types: System vs Custom distinction lacks "when to use which"
- `src/client/src/app/features/manage/marker-types/marker-type-list.component.html:2-6, 60-64`
- Intro says system markers are shared, custom are space-scoped. Doesn't give an example of when an analyst should reach for a custom type.
- Affordance: extend intro: `"Use a custom marker type for project-specific events not in the shared set (e.g. 'First Patient In', 'DBV Review')."`

### 37. Catalysts sync footer doesn't name cadence
- `src/client/src/app/features/engagement-activity/engagement-activity-page.component.html:139-155`
- Last-sync timestamp shown; sync frequency isn't.
- Affordance: tooltip on `Last sync`: `"Activity polls CT.gov on a schedule set by your agency. Manual entries appear immediately."`

### 38. Sidebar logo, account menu, and dropdowns have no `Esc to close` hint
- `src/client/src/app/core/layout/app-shell.component.ts:249-305`
- Power users expect dismiss-on-Esc and it works, but it isn't advertised.
- Affordance: small footer line in each overlay: `"Esc to close"` in `text-[10px] text-slate-400 font-mono`.

---

## Cross-cutting notes

These don't fit a single line; they're structural patterns the audit kept hitting.

**Existing rubric is the right baseline.** `src/client/CLAUDE.md` section 13 already encodes most of what this audit measures: empty states must name the next action, action labels must use domain vocabulary in imperative form, icon-only buttons must use `pTooltip`, errors must name what failed and what to do. The audit is mostly finding places that pre-date this rubric or where the rubric was applied loosely. A follow-up pass on the `manage/*` empty states alone would close ~6 findings.

**Three help pages exist; analytical surfaces don't link to them.** `/help/markers`, `/help/phases`, `/help/roles`. Each is high quality. They are reachable from `space-members` and the timeline footer legend, but not from the surfaces where users first see markers or phases (engagement-landing, bullseye, catalysts, manage/trials). One small `?` icon per surface, each linking to the matching help page, closes the discoverability gap without UI clutter. Adding a fourth help page (e.g. "Glossary" for MOA/ROA/Catalyst) requires a deliberate decision per the rubric — try inline tooltips first.

**Confirmations consistently under-name consequences.** Delete cascades, member removal, role changes, field-visibility saves, filter clears — all have either no confirmation or a confirmation that asks "are you sure" without naming what changes. This pattern recurs across `manage/*`, `space-settings/*`, and `landscape-filter-bar`. A single `<confirm-with-consequences>` shared component, taking a `details` slot, would standardize this.

**Power-user state persistence is absent.** Filter chips, grid columns, sort order, drawer state — all reset on navigation. For a tool used daily by analysts who track the same handful of programs week-over-week, this is the single largest expert-friction gap. `localStorage` keyed by `{tenant, space, route}` solves it for most surfaces.

**Jargon-on-jargon load is the first-touch fundamental.** A day-1 analyst opening the app encounters: tenant, space, engagement, intelligence, read, material, marker, catalyst, event, activity, MOA, ROA, NCT, phase (P1-P4), projection, asset vs company, therapy area, custom vs system. Each term is correct domain vocabulary, but none has a tooltip on first appearance. Inline tooltips on labels (`pTooltip` on column headers, chip labels, and form fields) plus the `?` icon strategy above closes most of this.

**No findings in:** the auth callback error path (the "Return to sign in" link is already there), the events page main empty state (the unfiltered copy already names what events are), and the space-members intro paragraph (all three roles are named and link to `/help/roles`). These are template patterns the rest of the app should copy.

---

## Suggested triage order

If you can only do one batch, do this:

1. **All `pTooltip` additions on jargon** (findings 1, 3, 10, 13, 32, others) — ~30 minutes, closes most first-touch P0/P1 in the analytical views.
2. **Empty-state copy pass on `manage/*` + activity + intelligence** (findings 6, 12, 14, 30) — ~1 hour, closes the highest-impact day-1 confusion.
3. **`Clear filters` + active-filter count + state persistence** (findings 18, 24, 25) — ~2-3 hours, closes the single largest expert-friction gap.
4. **Consequence-naming confirmation component** (findings 19, 20, 21) — ~half-day, prevents the most expensive class of user mistake (accidental deletes, accidental access changes).
5. **Bullseye + positioning legends and tab tooltips** (findings 2, 3, 16) — ~1 hour, makes the two most-visited analytical views legible to a day-1 user.

Everything else is incremental polish.
