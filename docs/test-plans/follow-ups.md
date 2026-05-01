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

### 15. Tenants RLS too strict for space-only members; tenant dropdown empty
- **Status:** open
- **Scope:** RLS policy on `tenants` SELECT, plus the topbar tenant-dropdown query in `core/layout/contextual-topbar.component.ts` (uses `tenantService.listMyTenants` which does `select * from tenants`)
- **Symptom:** a pure space-only member (e.g. `madala.dodbele` as Reader of SGLT2 Pipeline, no `tenant_members` row anywhere) sees an empty topbar tenant dropdown when she's inside her space. RLS on `tenants` SELECT currently allows: `is_tenant_member(id)` OR `is_agency_member(agency_id)` OR `is_platform_admin()`. None of those fire for a space-only member, so the tenant row gets filtered out. Verified via curl: `GET /rest/v1/tenants` returned `[]` for her, even though she has full access to SGLT2 inside Pfizer.
- **Why this matters:** the user sees the space content but the tenant context (name, dropdown for switching) is missing or blank. Mirrors the same conceptual gap as follow-up #14 / the `has_tenant_access` issue, but at the data layer.
- **Fix shape:** extend the `tenants` SELECT policy to include "user has a `space_members` row for any space whose `tenant_id` matches this row." A clean way: define `has_tenant_access(p_tenant_id)` (already shipped in migration 84) and inline its predicate into the SELECT policy. Roughly: `is_tenant_member(id) OR is_agency_member(agency_id) OR is_platform_admin() OR exists(select 1 from space_members sm join spaces s on s.id = sm.space_id where s.tenant_id = tenants.id and sm.user_id = auth.uid())`.
- **Caveat:** broaden carefully. The tenants row exposes `name`, `subdomain`, `app_display_name`, `primary_color`, etc. None of those are sensitive to a space-only member (they already see the brand because they're inside the tenant), so the broadening is fine. But audit any other tenant-row column for sensitivity before shipping.
- **Estimate:** 30 minutes for the policy migration, plus a quick scan of other places that read `tenants` to make sure the broader visibility doesn't surprise.
- **Surfaced:** 2026-05-01 access-model test pass, Phase 6 (Reader) when madala.dodbele's tenant dropdown rendered blank inside SGLT2 Pipeline

### 14. Tenant settings chrome reachable to space-only members but inert
- **Status:** open
- **Scope:** `features/tenant-settings/tenant-settings.component.ts`
- **Symptom:** since the `has_tenant_access` fix on 2026-05-01 (migration 84), space-only members (e.g. a Reader who joined via space-invite code without becoming a tenant owner) pass `tenantGuard` and can reach `/t/<tenant-id>/settings`. The page renders, but RLS hides the members list (empty table), and every mutation (Add owner, save branding) is rejected by the strict `is_tenant_member` gate inside the RPCs. The user is left staring at an empty, non-functional surface with no explanation.
- **Why this happened:** the route guard had to be loosened so space members could reach their space at `/t/<id>/s/<space-id>/...`. The `/t/<id>/settings` route inherits the same parent guard, so it activates too. There is no route-level discriminator between "tenant-scoped settings" and "any descendant of /t/:tenantId."
- **Fix shape options:**
  1. **Strict tenantGuard for `/settings` specifically.** Wrap `/t/:tenantId/settings` in a child route with a stricter guard that calls `is_tenant_member` (not `has_tenant_access`). Mirror the pattern for any other tenant-scoped admin route. Cleanest.
  2. **In-page empty state.** When `tenant-settings.component` loads and detects the user has no `tenant_members` row, render a polite "you don't have access to manage this tenant; ask a tenant owner" page instead of the empty form. Cheaper but doesn't prevent the failed-fetch round trip.
  3. **Hide the link to `/settings`** from any nav surface where the user is space-only. Prevents the user from clicking in but doesn't stop direct URL navigation.
- **Recommended:** option 1, applied at the route level. Solves the issue at the cause and matches the pattern we used for `agencyGuard` vs the looser brand-kind check.
- **Estimate:** 30 minutes
- **Surfaced:** 2026-05-01 access-model test pass, immediately after the `has_tenant_access` fix landed for Phase 6

### 13. Gmail dot canonicalization across invite and lookup paths
- **Status:** open
- **Scope:** server-side normalization in `add_tenant_owner`, `invite_to_space`, `add_agency_member`, `accept_invite`, `accept_space_invite`, `lookup_user_by_email`, and the `handle_new_user` trigger; same canonicalization client-side as a UX hint
- **Symptom:** for `@gmail.com` and `@googlemail.com`, periods in the local part are ignored by Google. `madaladodbele@gmail.com` and `madala.dodbele@gmail.com` route to the same Google account. Surfaced 2026-05-01: an admin typed the dotless form into the agency-member-add dialog; Google's account picker returned the dotted form; `auth.users.email` was stored with dots; the trigger lookup against the dotless `agency_invites.email` did not match; auto-claim silently failed.
- **Industry practice:** for the two Gmail domains, canonicalize by lowercasing, stripping all dots from the local part, and stripping the `+tag` suffix. Slack, Linear, Notion, GitHub, and Stripe all follow this pattern. Other domains: lowercase only (no safe canonicalization without knowing the provider).
- **Fix shape:**
  1. Add a `public.canonicalize_email(text) returns text` SQL function. Body: lowercase, then if the domain is `gmail.com` or `googlemail.com`, strip dots from the local part and truncate at the first `+`.
  2. Apply at every email-store and email-lookup site in the schema: invite-write RPCs canonicalize `p_email` before INSERT; trigger and lookup paths canonicalize before SELECT against `auth.users.email`.
  3. Optionally store both forms: `email_canonical` column on `agency_invites` / `tenant_invites` / `space_invites` for indexing, alongside the user-typed `email` for display. (Or just canonicalize on the fly; existing volumes are tiny.)
  4. Client-side: when the input loses focus on an invite dialog, show the canonical form below the field as a hint ("This will reach the same Google account as `name@gmail.com`"). Optional, but reduces user surprise.
- **Estimate:** 3-4 hours including the cross-RPC sweep
- **Surfaced:** 2026-05-01 access-model test pass, Phase 5 (Agency Owner) setup, when madaladodbele could not be auto-claimed because the typed and stored email differed by a single period

### 12. Onboarding page has no sign-out option
- **Status:** open
- **Scope:** `src/client/src/app/features/onboarding/onboarding.component.ts`
- **Symptom:** a signed-in user with no roles lands on `/onboarding` (the join-with-code form). There is no sign-out affordance on this page. If the user signed in with the wrong Google account, or just wants to switch accounts mid-flow, the only escapes are clearing cookies, closing the tab, or navigating to a URL the marketing-landing-guard handles. None of those are obvious.
- **Why it matters:** especially relevant for the multi-account test pass, where signing in `madaladodbele` to create her `auth.users` row leaves her stuck on onboarding with no way out short of dev-tools intervention. A real new user who picked the wrong Google identity has the same problem.
- **Fix shape:** add a small "Sign out" link or button at the bottom of the onboarding card (below the "Don't have an invite?" hint). Calls `supabaseService.signOut()` and routes to `/login`. Mirror the styling of the existing tertiary text in that area; small, low-emphasis, but discoverable.
- **Estimate:** 15 minutes
- **Surfaced:** 2026-05-01 access-model test pass, Phase 5 (Agency Owner) setup with `madaladodbele`

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

### 11. Agency-member-add UI requires existing user; missing the held-invite branch
- **Status:** done (commit pending in this change set)
- **Fix:** symmetric with `add_tenant_owner`. New `add_agency_member(p_agency_id, p_email, p_role)` SECURITY DEFINER RPC in migration 83 (`20260501030000_add_agency_member_held_invite.sql`). Existing-user branch inserts directly into `agency_members` with `on conflict do nothing`. Unknown-email branch writes to `agency_invites`; the `handle_new_user` trigger from migration 69 already auto-promotes those on first sign-in. Idempotent dedup matching the tenant pattern. Agency members component rewritten to call the new RPC in a single step: dropped the lookup-then-add two-step, dropped the "user must already have signed in" copy, surfaces a held-invite confirmation message inline like the tenant Add-owner flow does. The pre-existing `addAgencyMember(userId, role)` and `lookupUserByEmail` are kept for other surfaces (notably agency-tenant-new first-user-email).
- **Original entry:** the agency members dialog rejected unknown emails with `No user found with that email. Send them an invite to join first.`, while tenant and space add-member surfaces handle the unknown-email case gracefully. Asymmetric and operationally backwards (an invite is precisely for someone who has not yet signed up).

## How to use this doc

When closing the access-model test pass, re-read this list. Decide which items block production whitelabel rollout (almost certainly #5 + everything that rolls up under it; everything else is cosmetic). For items chosen, file as separate branches or PRs and update status to `in-progress`. When merged, move to `## Done` with the commit SHA.

For Claude sessions resuming this work: do not start fresh with "what should we fix?" Read this list, pick an item, follow its `Fix shape`, and update status when done.
