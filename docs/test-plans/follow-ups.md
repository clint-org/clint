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

### 11. Agency-member-add UI requires existing user; missing the held-invite branch
- **Status:** open
- **Scope:** `features/agency/agency-members.component.ts`, plus an RPC counterpart if one is needed (parallel to `add_tenant_owner` / `invite_to_space`)
- **Symptom:** the "Add agency member" dialog on the agency portal rejects unknown emails with `No user found with that email. Send them an invite to join first.` — i.e. the user must already exist in `auth.users`. Tenant invites (`add_tenant_owner`) and space invites (`invite_to_space`) both gracefully handle the unknown-email case by writing to `tenant_invites` / `space_invites` and surfacing a held code. Agency add-member doesn't.
- **Why this is asymmetric:** migration 69 introduced `agency_invites` + the `handle_new_user` trigger that auto-promotes pending agency invites on first sign-in. That mechanism was wired up for the `provision_agency` flow (super-admin creating a brand-new agency for an owner who hasn't signed in yet) but NOT for the "add a member to an EXISTING agency" flow. Operationally this means an agency owner cannot pre-invite a colleague who hasn't yet signed up; they have to send the colleague a sign-in link out of band first, then add them.
- **Fix shape:** mirror `add_tenant_owner`'s shape. Either (a) extend the existing add-member RPC to write to `agency_invites` when the email isn't in `auth.users`, then surface a held invite code in the toast just like the tenant flow; or (b) split into `add_agency_member` + `invite_agency_member` RPCs. The `handle_new_user` trigger already consumes pending `agency_invites` rows on first sign-in, so the auto-claim half is already done; only the write-into-agency_invites half is missing.
- **Estimate:** 2-3 hours
- **Surfaced:** 2026-05-01 access-model test pass, Phase 5 (Agency Owner) setup, while attempting to add `madaladodbele@gmail.com` to Stout

### 10. Tenant settings shows "Remove owner" against agency-backed members; misleading UX and an open design question
- **Status:** open (design question, not just UX)
- **Scope:** `features/tenant-settings/tenant-settings.component.ts` members table, plus a possible RPC enforcement layer
- **Symptom:** as `aadimadala` (Pfizer tenant owner only), the row-actions menu on `aadi529` (also a tenant owner of Pfizer, but reaches the tenant via her agency-owner role on Stout) shows "Remove owner." The button works at the row level: deleting the `tenant_members` row succeeds because the self-protection trigger only blocks self-removal and last-owner removal. But `is_tenant_member` has three disjuncts (explicit row OR agency owner of parent OR platform admin), so deleting the explicit row does not actually evict aadi529. She remains a tenant member via the agency disjunct. Net effect: tenant client believes they removed the agency from their tenant; the agency stayed in.
- **Design question first:** should a tenant client be able to evict their parent agency from their own tenant?
  - Argument for yes (current behavior): the tenant is "their tenant"; if they want to fire the agency mid-engagement, they should be able to. But the current model only lets them remove the explicit row, leaving the parenthood disjunct intact, so this isn't really happening today.
  - Argument for no: the agency provisioned the tenant for them; removing the agency mid-engagement is a contractual matter that shouldn't be self-serve from the tenant settings UI. Eviction would be done at the agency level (transferring the tenant to a different agency, or platform admin re-parenting).
- **Fix shape options (after the design question is settled):**
  - (A) Hide row actions for any tenant member whose access has an agency-owner disjunct backing it. Show only "Last signed in" or similar passive metadata.
  - (B) Rename to "Remove explicit access" and add a tooltip describing the parenthood disjunct.
  - (C) Block removal of agency-backed members at the RPC layer. Self-protection trigger gets a third clause: if `target_user` has an `agency_members` row for the tenant's parent agency with role `owner`, only a platform admin can remove them.
- **Surfaced:** 2026-05-01 access-model test pass, Phase 4 (Tenant Owner) by `aadimadala` reviewing tenant settings on Pfizer

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
