# Follow-ups

[Back to test plan](2026-04-29-whitelabel-access-model.md), [matrix](ui-editability-matrix.md), [checker](role-access-checker.md).

---

Tracker for issues surfaced during the access-model test pass that were intentionally deferred: bugs to fix later, refactors that would shrink several bugs into one, and UX inconsistencies. Each entry has a status, scope, suggested fix, and origin so a future session can pick any item up cold.

Statuses: `open` (not started), `in-progress` (work begun in a branch but not landed), `done` (shipped).

## Open

### 1. Toast vs banner inconsistency for transient action feedback
- **Status:** open
- **Scope:** trial-detail.component, plus any other manage page that uses both patterns
- **Symptom:** save success uses `messageService.add({severity:'success',...})` toast, save error uses `error.set(msg)` rendering a `<p-message severity="error">` banner at the top. Same component, two different patterns for the same kind of action. Violates the "transient action gives me transient feedback" mental model the rest of the app sets.
- **Fix shape:** grep `error.set(` vs `messageService.add({severity:'error'`) across `src/client/src/app/features/`. For transient action errors (save, delete, add), normalize to toast. Reserve banners for persistent context (suspended tenant, session expiring, access-revoked-mid-session).
- **Estimate:** ~1 hour sweep
- **Surfaced:** 2026-05-01 access-model test pass, Phase 2 (Platform Admin) UI check 4, when the expected save denial rendered as a banner instead of a toast

### 2. Event-form opens empty when editing an existing event
- **Status:** open
- **Scope:** `src/client/src/app/features/events/event-form.component.ts`
- **Symptom:** Clicking edit on an existing event opens the dialog with no fields populated. New-event form still works.
- **Suspected root cause:** form fields (title, description, eventDateValue, categoryId, priority, tags, sources, threadId, linkedEventIds at lines 302-314) are plain class properties bound via `[(ngModel)]`, not signals. `loadExisting()` writes to them after `getEventDetail` resolves, but the dialog has already rendered with empty values and change detection doesn't refresh the bindings.
- **Fix shape:** convert the form fields to signals; bind via `[ngModel]="title()" (ngModelChange)="title.set($event)"`. Mirrors the pattern memory-rule "ANY plain prop bound via `[(ngModel)]` that participates in a computed() MUST be a signal."
- **Estimate:** 30 minutes
- **Surfaced:** 2026-05-01 access-model test pass, while exercising Section 4 Contributor write checks as `aadimadala`

### 3. Space settings danger zone visible to all space members
- **Status:** open
- **Scope:** `src/client/src/app/features/space-settings/space-general.component.ts`
- **Symptom:** Description textarea, Save button, AND the Danger Zone "Delete space" button render for any space member regardless of role. Server-side enforcement holds (RLS rejects updates and deletes for non-owners), so no data corruption, but the UI is a footgun. A Contributor or Reader sees a Delete button that is wired up and confirmation-gated, then nothing happens when they click through.
- **Fix shape:** part of the broader role-gating sweep (#5). Expose `currentUserRole` via the new `SpaceRoleService`, then `@if (canEdit())` around the form fields and `@if (isOwner())` around the danger zone.
- **Surfaced:** 2026-05-01 access-model test pass, while exercising Section 4 Contributor as `aadimadala`

### 4. No `spaceGuard` on `/t/:tenantId/s/:spaceId/*`
- **Status:** open
- **Scope:** new file `src/client/src/app/core/guards/space.guard.ts`, plus a one-line addition to the route in `app.routes.ts`
- **Symptom:** A tenant member who is not a space member can navigate to a space URL and see the chrome (catalysts page renders empty since RLS hides every row). UI cosmetic only; data is protected by `has_space_access` and per-table RLS.
- **Fix shape:** mirror the `tenantGuard` shape. Read `:spaceId` from route params, call `has_space_access(p_space_id)` (or directly check `space_members` membership), redirect to `/t/:tenantId/spaces` on failure. Add `spaceGuard` to the canActivate of the `s/:spaceId` block.
- **Estimate:** 30 minutes
- **Surfaced:** 2026-04-30, noted in `08-authentication-security.md` as the next guard gap after `tenantGuard` shipped

### 5. Role-aware UI gating sweep (umbrella refactor)
- **Status:** open
- **Scope:** new `SpaceRoleService` (or extend an existing service) + template sweep across catalysts, companies, products, trials, trial-detail, events page, event-form, marker-types, taxonomies, space-general, space-members
- **Symptom:** Most data-management pages render write controls (Add, Edit inline, Delete row-actions, form Save buttons) regardless of the current user's `space_members.role`. Server enforcement holds (RLS rejects writes for `viewer`), so a Reader who clicks Edit gets a save error instead of seeing no Edit affordance. UX leak, not a security issue.
- **Fix shape:**
  1. New `SpaceRoleService` (signal-based) that resolves `currentUserRole` for the current `:spaceId` route param. Source of truth: a single `space_members` query keyed by `(spaceId, auth.uid())`. Cache per route activation.
  2. Expose derived signals: `isOwner()`, `canEdit()` (owner or editor), `canRead()` (any member).
  3. Sweep every data-management template: wrap write controls in `@if (canEdit())` (most cases) or `@if (isOwner())` (settings danger zone, member management).
  4. Sub-bugs that go away after this lands: #3 (space-general danger zone), #6, #7, #8 below.
- **Estimate:** 4-6 hours (one focused session)
- **Surfaced:** 2026-05-01 access-model test pass, surfaced by the editability matrix as patterns 2-5 of 6

### 6. Catalysts / companies / products / trials / trial-detail show write controls to Reader
- **Status:** open (rolls up under #5)
- **Scope:** `features/catalysts/`, `features/manage/companies/`, `features/manage/products/`, `features/manage/trials/`
- **Fix shape:** template `@if (canEdit())` once `SpaceRoleService` lands

### 7. Events page and event-form show write controls to Reader
- **Status:** open (rolls up under #5)
- **Scope:** `features/events/events-page.component`, `features/events/event-form.component`
- **Fix shape:** same as #6

### 8. Marker types and taxonomies show write controls to Reader
- **Status:** open (rolls up under #5)
- **Scope:** `features/manage/marker-types/`, `features/manage/taxonomies/`
- **Fix shape:** same as #6

### 9. Cross-surface "this lives elsewhere" hints (agency-managed tenant branding, and other split-ownership surfaces)
- **Status:** open
- **Scope:** `features/tenant-settings/tenant-settings.component.ts` is the immediate offender; pattern likely applies elsewhere
- **Symptom:** when a tenant owner opens tenant settings on an agency-managed tenant (`tenants.agency_id IS NOT NULL`), tenant branding fields are not rendered. The runbook says they should be replaced by "a read-only identity card and a hint pointing to the agency" but no such surface exists today, leaving the user wondering whether branding doesn't exist or whether they're looking in the wrong place.
- **General principle:** if a surface deliberately hides an action because it lives elsewhere, the page should at minimum say so and link there. Applies to agency-managed branding (link to `<agency>.clintapp.com/admin/tenants/<id>`), space-level access settings vs tenant-level access settings, and probably other split-ownership boundaries we'll find as the matrix gets walked.
- **Fix shape (immediate, scoped to tenant branding):** in tenant-settings, when `tenant.agency_id IS NOT NULL`, render a read-only card showing the current logo, name, and primary color, with copy like "Branding for this workspace is managed by {agency.name}. To request changes, contact your agency or open the agency portal." Link to the agency portal if the user has agency-membership; otherwise show only the contact prompt.
- **Estimate:** 1-2 hours including the cross-surface link audit
- **Surfaced:** 2026-05-01 access-model test pass, Phase 4 (Tenant Owner) check 5 by `aadimadala`

## Done

(none yet for this session)

## How to use this doc

When closing the access-model test pass, re-read this list. Decide which items block production whitelabel rollout (almost certainly #5 + everything that rolls up under it; everything else is cosmetic). For items chosen, file as separate branches or PRs and update status to `in-progress`. When merged, move to `## Done` with the commit SHA.

For Claude sessions resuming this work: do not start fresh with "what should we fix?" Read this list, pick an item, follow its `Fix shape`, and update status when done.
