# Playwright QA sweep — analyst + reviewer (pharma client side)

Date: 2026-06-23
Environment: local `ng serve` (config `local`) on `localhost:4200` against local Supabase (`127.0.0.1:54321`).
Tenant: Demo Pharma CI (`00000000-0000-0000-0000-0000000d0010`).

## Method

Created three users under the demo tenant via the GoTrue admin API and injected
their Supabase sessions into `localStorage` (`sb-127-auth-token`) to drive the
real app headlessly (no Google OAuth):

- **owner** (`qa-owner@clint.local`) — tenant owner + space owner
- **analyst** (`qa-analyst@clint.local`) — space `editor`
- **reviewer** (`qa-reviewer@clint.local`) — space `viewer`

Two spaces: **QA Fresh** (empty) and **QA Seeded** (populated via `seed_demo_data`:
13 companies / 28 assets / 36 trials / 76 materials).

Passes run:
1. **Route-load sweep** — 177 page loads (every route × 3 personas × fresh/seeded),
   capturing console errors, uncaught exceptions, failed network requests (>=400),
   unexpected 404s, and access-control outcome vs. expectation.
2. **Analyst CRUD** — create/edit/delete of companies, assets, trials, marker types,
   indications, with DB verification.
3. **Reviewer/owner permission pass** — viewer read-only affordances; owner members
   invite, field visibility, general settings, and the seed-demo feature.

## Result summary

- **177 route loads: 0 uncaught JS errors, 0 failed (non-logo) network requests,
  0 unexpected 404s.** Every page that should render for a given role rendered.
- **Analyst CRUD: all create/edit/delete flows pass** and persist to the DB.
- **Access control is correct everywhere except the route-guard gap below.**
- **Seed-demo, member invite, general-settings save: all work.**

## Findings

### 1. [Medium] Editor-only management routes lack `editGuard` — viewer can open them by URL
`src/client/src/app/app.routes.ts` (~lines 391-414). The list routes
(`manage/companies`, `manage/assets`, `manage/trials`) have `canActivate: [editGuard]`,
but these do **not**:
- `manage/trials/:id`
- `manage/companies/:id`
- `manage/assets/:id`
- `manage/engagement`

A `viewer` is correctly redirected from the list pages but reaches the detail and
engagement pages directly by URL (verified for all four).

**Mitigation (why not High):** the detail components gate their edit/delete affordances
on `spaceRole.canEdit()` (e.g. `trial-detail.component.ts:144`), so a viewer sees a
read-only view with no write controls, and RLS still blocks writes. The exposure is a
defense-in-depth / consistency gap plus minor read access to "manage" surfaces (the
same data is largely visible through normal read views).

**Fix:** add `canActivate: [editGuard]` to those four routes.

### 2. [Low] Viewer sees non-functional "..." row kebabs on the Taxonomies page
On `settings/taxonomies` (Indications/MOA/ROA), a `viewer` sees an overflow "..." kebab
on every row that opens an **empty** menu (verified: 5 visible triggers, 0 menu items
on open). The menu items are correctly role-gated (`taxonomies-page.component.ts` builds
Edit/Delete only `if (spaceRole.canEdit())`), but `RowActionsComponent`
(`shared/components/row-actions.component.ts`) always renders its trigger regardless of
whether `items()` is empty, and the taxonomies template does not guard it.

Violates design-system rule #5 ("hide actions the current role cannot take; no
greyed-out / non-functional affordances"). The marker-types page does **not** have this
problem (shows 0 kebabs for viewers).

**Fix:** hide the trigger when empty — either `@if (areaRowMenu(area).length)` around
`<app-row-actions>` in the taxonomies template, or add `@if (items().length)` inside
`RowActionsComponent` (global, low-risk — other callers already produce empty arrays for
viewers and rely on the component to render nothing useful).

### 3. [Info — local env only] `/api/logo` returns 500 under `ng serve`
Company logos request `/api/logo?url=...`, which is a Cloudflare Worker route
(`src/client/worker/logo-proxy.ts`) not served by `ng serve`, so it 500s locally and
logos render as "--". Production's Worker serves these. No product action needed.

### 4. [Coverage gap] Import / review flow not exercised
`/import` and `/import/:aiCallId/review` redirect to the engagement landing for
owner+editor too, because AI/import is feature-flag-gated off on the demo tenant. The
import/review flow could not be exercised in this environment.

## What was verified working (highlights)

- All data views render for all roles: engagement landing, timeline, bullseye, all 5
  heatmap cuts, catalysts, intelligence browse, materials, events/activity, help pages.
- Empty states on the fresh space are correct ("No companies yet. Add one to get started.").
- Access control: viewer denied management lists, import, and all owner-only space/tenant
  settings; analyst denied owner-only settings; tenant settings denied to non-tenant-members.
- Analyst CRUD: companies, assets, trials (create + edit-via-detail + delete-with-typed-
  confirmation), marker types, indications — all clean, DB-verified. Required-field gating
  works (asset requires company; trial requires asset).
- Owner: general-settings save works; member invite creates a pending invite; seed-demo
  seeds a fresh space end-to-end and redirects to `/catalysts` with 0 errors.
- Viewer read-only affordances: no Add buttons (taxonomies/marker-types), no New Event,
  no edit/delete kebab on trial detail.

## Not auto-verified (harness selector limits; pages render error-free per the sweep)

- Member invite **revoke** and field-visibility **toggle save** — interaction selectors
  failed; the pages themselves load without errors and the invite/create path passed.

---

# Phase 2 — Deep interaction QA (2026-06-24)

Drove every interactive surface as analyst (editor), reviewer (viewer), owner
(tenant+space owner), and a new **agency** persona (Stout member, required to
author intelligence). All DB-verified where possible. Personas:
`qa-owner / qa-analyst / qa-reviewer / qa-agency @clint.local`.

## What was exercised and works (clean)

- **Grids** (manage/companies + browse): global search with `?q=` URL sync,
  column sort with `?sort=` sync, column filter, no-results copy
  ("No companies match your filters."), reset-to-defaults, and Excel export
  (real `.xlsx` download). 8/8.
- **Command palette (Cmd/Ctrl+K)**: open, empty state (Recent/Commands),
  entity search, scope toggle (Tab -> "All spaces"), command navigation
  (`>timeline`), Esc close, and **role-gating** ("Import from source" visible to
  editor, hidden from viewer). 18/18, zero page errors.
- **Visualizations**: bullseye (23 dots, dot-select sets `?product`, background
  clears, company filter -> chip -> clear), heatmap (sort toggle, row-select,
  grouping switch to by-company), timeline (36 phase bars, marker hover tooltip,
  legend, MOA/ROA/Notes column toggles). 18/18, zero page errors.
- **Markers** (analyst, trial detail): add (category -> type -> title -> date),
  edit, delete (typed "delete" confirm). All clean, DB-verified.
- **Intelligence** (agency persona): draft -> publish -> modify -> republish
  (with change note) -> withdraw. All clean, DB-verified (state transitions
  draft/published/archived). Correctly gated: a space editor is NOT shown the
  "Add primary intelligence" button (authoring is agency-only, by design).
- **Materials**: list (76), upload dialog + validation, clear error on failure
  ("Upload sign failed (500)"), delete flow (DB-verified count drop). Uploader
  permission enforced.
- **Import page** (as tenant owner): 3 tabs (NCT/URL/text), NCT format
  validation, **duplicate detection** ("1 of 1 NCTs already in this space"),
  text length validation.
- **Engagement landing** re-renders stats on navigation (no realtime; by design).

## New findings

### 5. [Medium] Space editor is wrongly blocked from AI import
`importGuard` (`import.guard.ts`) allows space `owner`/`editor`, then reads
`ai_config.ai_enabled` via PostgREST. But `ai_config` SELECT RLS is
**tenant-owner / platform-admin only**. A space editor (the pharma-client
"contributor"/analyst) reads `null`, so the guard concludes AI is off and
redirects with the **misleading** toast "AI-assisted import is not enabled for
this organization" — even when it IS enabled. A space owner who is not also a
tenant owner is blocked the same way. Verified: with AI enabled, `ai_config`
read returns `[{"ai_enabled":true}]` for the tenant owner and `[]` for the
editor/viewer. Fix: let space editors/owners read `ai_config` for their tenant
(scoped policy), or have the guard check via a SECURITY DEFINER RPC.

### 6. [Low] Failed material upload leaves an orphaned row
`register_material` inserts the DB row before the file PUT. When `sign-upload`
fails, the row is left un-finalized (hidden from readers, so invisible in the
UI) but lingers in `materials`. Confirmed: one failed upload left exactly one
`finalized_at IS NULL` row. Low severity (invisible), but accumulates on every
failed/abandoned upload; worth a cleanup or deferring the insert until the file
lands.

### 7. [Low-Med] Materials delete is uploader-only
`canDelete = uploaded_by === currentUser.id`. A space owner/editor cannot delete
a material a teammate uploaded; only the original uploader can. If intentional,
fine; if not, owners should be able to manage all materials in their space.
Confirm intent.

## Copy / language findings (product copy, not seed data)

- [Med] **"READ ->" CTA** on every analysis card (intelligence browse)
  contradicts the renamed "Analysis" terminology. Use "Analysis" / "Open
  analysis".
- [Med] **Stale migration banner** "Your timeline is now under the Timeline tab.
  GOT IT" is baked into the persistent header of every landscape view (including
  the Timeline tab itself). Remove or make a one-time dismissible toast.
- [Med] **Terminology drift** for the container: the nav tab "Engagement" sits
  beside space-scoped tabs while the page says "for the whole SPACE";
  tenant-settings mixes "workspace" and "tenant" on one screen. Standardize.
- [Low-Med] **"75 ITEMS" / "0 ITEMS"** for materials uses a generic noun; should
  be "materials" (rule 3).
- [Low-Med] **"Upload material" button vs "Register material"** empty-state copy
  and the design-system convention. Pick one verb.
- [Low-Med] **Audit log exposes the raw role enum** (`"role":"editor"`/`viewer`)
  while the rest of the UI uses Contributor/Reader. Map to display labels.
- [Low] Material drop-zone empty states jump to the action without naming the
  empty ("Drop a file or browse to add a material" with no "No materials yet").
- [Low] "New Event" could be the domain verb "Log event"; "Add company" trigger
  vs "Create Company" dialog confirm (Add/Create inconsistency).
- [Low] "cat/90d" cryptic stat abbreviation; "TRIAL MOVE" vs "TRIAL MOVES"
  pluralization; lone "+8" stat prefix; duplicate "Save limits" buttons in
  tenant settings (ambiguous which section they save).
- [Low] Events empty-state copy uses " -- " as a prose dash (em-dash style),
  against the no-em-dash house rule. (No literal em-dash chars found anywhere.)

## Seed-data quality (not a code defect)

- Seeded analyses and markers omit **possessive apostrophes** throughout
  ("Pfizers", "Novos", "franchises") — 0 of 30 analysis headlines and 0 of 270
  marker titles contain an apostrophe in the DB. Makes demos read as broken to a
  pharma reader. Fix in `seed.sql` (likely avoided to dodge SQL escaping).

## Local-environment limitations (could not exercise)

The Cloudflare Worker (`workerd`) runs under `ng serve` but returns 500 on every
`/api/*` route (missing `ANTHROPIC_API_KEY` / `EXTRACT_SOURCE_WORKER_SECRET` /
R2 creds locally). So these happy paths were NOT exercisable and need a deployed
dev/prod env (or `wrangler dev` with secrets):
- AI extraction (URL / text / NCT) and the **import review/approve screen**.
- Real material **file upload to R2** and **download** (only the register/update/
  delete DB RPCs and the failure UX were tested).
- Company logo proxy (`/api/logo`) — logos render as "--" locally.
