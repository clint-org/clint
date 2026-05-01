# Follow-ups

[Back to test plan](2026-04-29-whitelabel-access-model.md), [matrix](ui-editability-matrix.md), [checker](role-access-checker.md).

---

Tracker for issues surfaced during the access-model test pass that were intentionally deferred: bugs to fix later, refactors that would shrink several bugs into one, and UX inconsistencies. Each entry has a status, scope, suggested fix, and origin so a future session can pick any item up cold.

Statuses: `open` (not started), `in-progress` (work begun in a branch but not landed), `done` (shipped).

## Open

### 18. NCT sync from CT.gov not working
- **Status:** open
- **Scope:** `src/client/src/app/core/services/ctgov-sync.service.ts` and the trial-form Sync-from-CT.gov button in `trial-form.component.html`
- **Symptom:** clicking "Sync from CT.gov" inside the trial form does nothing observable -- no fields populated, no error surfaced. Suspected causes: CT.gov v2 API may have changed shape, our fetch mapping may be stale, or the request may be erroring silently in a catch that doesn't surface to the user.
- **Surfaced:** 2026-05-01 retest of follow-up #5; novaelevatellc tried it while filling out a new trial and reported "nct sync isn't working at all".
- **Fix shape:** open DevTools network tab, hit Sync, see what request fires (if any), what response comes back, and whether the response is being parsed correctly. Likely either an API-shape change or a silent exception in the parser.
- **Estimate:** 30-90 min depending on root cause.

### 17. Form validation: required fields not enforced; submit allowed with empty NOT NULL columns; generic error
- **Status:** open
- **Scope:** `src/client/src/app/features/manage/trials/trial-form.component.ts`, `marker-form.component.ts`, and likely the same pattern across product-form, note-form, others
- **Symptom:** forms inconsistently mark required fields. Trial form has Name with a red asterisk but Product and Therapeutic Area (both DB-required `NOT NULL` FKs) without any visual indicator. Marker form has the same shape: some fields marked required, some not, no client-side blocking. Save submits anyway, the database raises a NOT NULL or FK violation, and the catch block renders a generic "Could not save..." banner -- pointing at the wrong cause and not the missing fields.
- **Surfaced:** 2026-05-01 retest of follow-up #5. novaelevatellc tried to add a trial as a Contributor; save failed because Product and Therapeutic Area were empty, not because of any role issue. Confirmed by retrying with the dropdowns selected -- save succeeded. Then noted the same pattern on marker-form.
- **Fix shape:**
  1. For each form, list every field that maps to a NOT NULL or FK-required column. Add `required` + `aria-required` markers.
  2. Block `Save` until all required fields are populated (mirror the existing `!hasChanges()` disable pattern for completeness).
  3. On NOT NULL or FK constraint violation, surface the specific field name rather than the generic "check your connection" copy.
  4. Cross-form audit: product-form should mark `company_id` required, marker-form should mark category/title/at-least-one-trial required, etc.
- **Estimate:** 2-3 hours including the cross-form audit.

### 16. Cold direct deep-link into space-scoped routes redirects to `/spaces`; affects ALL users (not just space-only members)
- **Status:** done (resolved 2026-05-01 by spaceGuard, commit f85ae3f). Verified with madala (Reader) -- direct deep-link to `/t/<tenant>/s/<space>/settings/general` now loads the page cleanly without redirect. Root cause was likely a downstream race the spaceGuard's explicit `has_space_access` RPC call short-circuited.
- **Scope:** route guards/resolvers on `s/:spaceId` and any descendants; `features/spaces/space-list.component.ts` for the related empty-state symptom; `core/services/space.service.ts:20-28` (the underlying query is correct).
- **Investigation log (2026-05-01):** searched all `router.navigate(['/t', _, 'spaces'])` and `createUrlTree(['/t', _, 'spaces'])` sites. None auto-fire on cold deep-link. The marketingLandingGuard is only on `path: ''` (apex). The wildcard route is `redirectTo: ''`. Angular Router *should* backtrack sibling routes when a parent's children fail (so `s/:spaceId/settings/general` should match the explicit `'settings/general'` sibling even though `path: ''` is the first child of `s/:spaceId`). Yet the user reproduces the redirect cleanly across three accounts (madala Reader, novaelevatellc Contributor, aadi529 Owner-of-everything). Strong residual hypothesis: a component-level ngOnInit or effect inside one of the deep-link target components (space-general, space-members, tenant-settings) is racing against an unset signal and triggering an early navigation. Needs DevTools Network+Console capture during reproduction.
- **Defense-in-depth added 2026-05-01:** `spaceGuard` on `s/:spaceId` (commit f85ae3f) calls `has_space_access` directly. If the previous redirect was caused by a signal-race in a downstream component, having the guard make its own RPC call gates the route correctly regardless of signal state. This may incidentally resolve #16 if the race was in a guard chain that depended on AppShell's loaded-spaces signal; if the race was in a leaf component, this guard does not address it.
- **Symptom:** a pure space-only member (madala.dodbele as Reader of SGLT2 Pipeline) navigating to `pfizer.clintapp.com/t/<pfizer-id>/spaces` sees the empty-state ("No spaces yet") instead of her one space. Direct navigation to the space URL (`/t/<pfizer-id>/s/<sglt2-id>/catalysts`) works, so she has full data access. The empty-state CTA also renders a "Create space" button for her, which is a write affordance she does not have (`create_space` RPC rejects; cosmetic UX leak).
- **Confirmed root cause is NOT RLS:** verified 2026-05-01 by reproducing the exact client query via curl with her JWT: `GET /rest/v1/spaces?tenant_id=eq.<pfizer-id>&select=*&order=created_at` returns SGLT2 correctly (one row, full payload). So the `spaces` SELECT policy (`has_space_access(id) OR is_tenant_member(tenant_id)`) is firing correctly for her. The bug is somewhere between the page activating and the response rendering.
- **The deep-link redirect affects EVERY user, not just space-only members.** First seen with madala (Reader) and novaelevatellc (Contributor) -- assumed to be a space-only-member symptom. Then 2026-05-01 Phase 8 confirmed that aadi529 -- who is Space Owner AND Tenant Owner AND Agency Owner of the parent agency -- *also* gets redirected from a cold direct deep-link to `/t/<tenant>/s/<space>/settings/members` to `/t/<tenant>/spaces`, identical pathology. He has every access disjunct there is. So this is a 100%-of-users guard/resolver race: any cold deep-link into `s/:spaceId` or descendants redirects to the spaces list. After selecting the space via the topbar (which presumably sets a signal/observable somewhere), the same direct URL works fine. Production-blocker UX bug. Likely root cause: a `canActivate` or `resolve` on the `s/:spaceId` route reading a `currentSpace` (or similar) signal/observable that is empty until the topbar selects the space. The guard treats "empty" as "no access" and redirects.
- **Likely client-side causes to investigate (in order):**
  1. Auth race: the page query fires before the Supabase client has the JWT attached on `pfizer.clintapp.com` (the cross-subdomain cookie story for the apex). If the request goes out as anon, `has_space_access` returns false, the policy filters everything out, and the page caches an empty array.
  2. Guard short-circuit: a guard upstream of `space-list.component` (tenantGuard? brand-context bootstrap?) clears or replaces the data when the user is not a `tenant_members` row holder. Worth grepping `space-list.component.ts` and the route configuration for any `tenantGuard`-like pre-resolve.
  3. Component-side filter: confirm `space-list.component.ts` is not filtering the result client-side (e.g., on `is_tenant_member` info from a separate query).
- **Why this matters:** a space-only member has no UI breadcrumb back to her own space from the tenant root. She has to know the direct URL.
- **Fix shape:**
  1. Reproduce in DevTools: open the spaces-list page as madala, watch the Network tab for the `spaces` request, compare its response to the curl-confirmed shape.
  2. Once root cause is isolated, fix in the component / guard / session-attach path.
  3. Separately, hide the "Create space" empty-state CTA when the user is not a tenant member -- rolls under #5 if the role-aware UI gating sweep covers spaces-list.
- **Estimate:** 1 hour for diagnosis once you can put eyes on Network tab; sized on root cause.
- **Surfaced:** 2026-05-01 access-model test pass, Phase 6 (Reader) scenario 1; data-layer ruled out via curl during scenario 6.

### 1. Toast vs banner inconsistency for transient action feedback
- **Status:** done (commit 1ac3fef). trial-detail marker/note delete, space-general save/delete, space-members role-update/remove/revoke all now route transient action errors to toast. Vestigial banner templates removed. Banners reserved for persistent context (in-dialog validation, page-load failures).
- **Scope:** trial-detail.component, plus any other manage page that uses both patterns
- **Symptom:** save success uses `messageService.add({severity:'success',...})` toast, save error uses `error.set(msg)` rendering a `<p-message severity="error">` banner at the top. Same component, two different patterns for the same kind of action. Violates the "transient action gives me transient feedback" mental model the rest of the app sets.
- **Fix shape:** grep `error.set(` vs `messageService.add({severity:'error'`) across `src/client/src/app/features/`. For transient action errors (save, delete, add), normalize to toast. Reserve banners for persistent context (suspended tenant, session expiring, access-revoked-mid-session).
- **Estimate:** ~1 hour sweep
- **Surfaced:** 2026-05-01 access-model test pass, Phase 2 (Platform Admin) UI check 4, when the expected save denial rendered as a banner instead of a toast

### 2. Event-form fails to populate when editing an existing event (data-integrity risk)
- **Status:** done (resolved 2026-05-01 by signals + reset-on-eventId-change, commit 4f10352). Verified with novaelevatellc (Contributor): added a new event, then opened an existing event for edit -- form populated with the existing event's actual values (not the previous form's payload). Re-opening "+ New event" rendered an empty form. Both stale-state cases eliminated.
- **Scope:** `src/client/src/app/features/events/event-form.component.ts`
- **Symptom:** Clicking edit on an existing event opens the dialog WITHOUT the existing event's values. Worse, if the user has already added or edited an event in this session, the dialog opens populated with the *previous* form's values (stale binding state retained from the last dialog session). Verified twice: 2026-05-01 by `aadimadala` (Phase 4) and `novaelevatellc` (Phase 7), each saw the prior new-event payload when opening an existing event for edit. New-event form works correctly.
- **Why this matters (worse than originally noted):** if a user opens edit, sees the stale data and assumes it's the existing event's data, then clicks Save -- they overwrite the existing event with the previous form's payload. Server-side RLS lets editors and owners write to `events`, so the bad row goes through. This is a silent data-integrity risk, not just a UX leak. Until fixed, contributors should be warned not to use the edit-event flow.
- **Suspected root cause:** form fields (title, description, eventDateValue, categoryId, priority, tags, sources, threadId, linkedEventIds at lines 302-314) are plain class properties bound via `[(ngModel)]`, not signals. `loadExisting()` writes to them after `getEventDetail` resolves, but the dialog has already rendered with the previous values (empty on first open, stale on subsequent opens). Change detection doesn't refresh the bindings when `loadExisting` resolves later.
- **Fix shape:** convert the form fields to signals; bind via `[ngModel]="title()" (ngModelChange)="title.set($event)"`. Reset all signals to empty in the dialog `onShow` lifecycle to clear stale state. Mirrors the pattern memory-rule "ANY plain prop bound via `[(ngModel)]` that participates in a computed() MUST be a signal."
- **Estimate:** 30 minutes
- **Surfaced:** 2026-05-01 access-model test pass; first as `aadimadala` (Section 4), confirmed and worsened by `novaelevatellc` Phase 7 scenario 3.

### 3. Space settings danger zone visible to all space members
- **Status:** done (resolved by #5 umbrella, commit f861f79). Save and Delete on space-general only render for owners; description and name fields go readonly for non-owners. The false-success-delete navigation path is no longer reachable through the UI for non-owners.
- **Scope:** `src/client/src/app/features/space-settings/space-general.component.ts`
- **Symptom:** Description textarea, Save button, AND the Danger Zone "Delete space" button render for any space member regardless of role. Server-side enforcement holds (RLS rejects updates and deletes for non-owners), so no data corruption, but the UI is a footgun. A Contributor or Reader sees a Delete button that is wired up and confirmation-gated. Save errors render as a top-of-page banner (interaction with #1). Delete is *worse* than originally noted: clicking through the confirm dialog **navigates away as if delete succeeded** (likely lands on `/spaces`, which renders empty for a space-only member per #16) even though the space still exists. The component is firing the navigation without awaiting the delete result, or swallowing the rejection. Verified 2026-05-01 by madala.dodbele on SGLT2.
- **Fix shape:** part of the broader role-gating sweep (#5). Expose `currentUserRole` via the new `SpaceRoleService`, then `@if (canEdit())` around the form fields and `@if (isOwner())` around the danger zone.
- **Surfaced:** 2026-05-01 access-model test pass, while exercising Section 4 Contributor as `aadimadala`

### 4. No `spaceGuard` on `/t/:tenantId/s/:spaceId/*`
- **Status:** done (commit f85ae3f). New `core/guards/space.guard.ts` walks the route tree for both ids, calls `has_space_access`, redirects to `/t/:tenantId/spaces` on failure. Wired into `app.routes.ts`. Also incidentally resolved follow-up #16 (the cold-deep-link redirect bug).
- **Scope:** new file `src/client/src/app/core/guards/space.guard.ts`, plus a one-line addition to the route in `app.routes.ts`
- **Symptom:** A tenant member who is not a space member can navigate to a space URL and see the chrome (catalysts page renders empty since RLS hides every row). UI cosmetic only; data is protected by `has_space_access` and per-table RLS.
- **Fix shape:** mirror the `tenantGuard` shape. Read `:spaceId` from route params, call `has_space_access(p_space_id)` (or directly check `space_members` membership), redirect to `/t/:tenantId/spaces` on failure. Add `spaceGuard` to the canActivate of the `s/:spaceId` block.
- **Estimate:** 30 minutes
- **Surfaced:** 2026-04-30, noted in `08-authentication-security.md` as the next guard gap after `tenantGuard` shipped

### 5. Role-aware UI gating sweep (umbrella refactor)
- **Status:** done (commit f861f79). Closes #3, #6, #7, #8.

New `SpaceRoleService` in `core/services/space-role.service.ts` watches NavigationEnd, extracts `:spaceId` from the URL, and queries `space_members` once per space change. Exposes `isOwner`, `canEdit` (owner or editor), `canRead` signals.

Sweep: space-general (Save/Delete owner-only, fields readonly), space-members (Invite topbar, role dropdown, overflow menu, pending-invites table all owner-only), companies/products/trials lists (Add topbar gated, row Edit/Delete dropped for readers), trial-detail (Edit-trial topbar, inline Add-marker/Add-note buttons, marker/note row menus), events page (New-event + edit pen on detail panel), marker-types/MoA/RoA/therapeutic-areas/taxonomies-page (Add + row menus). Sub-form components unchanged -- their dialogs are no longer reachable from the UI for readers.
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
- **Status:** done (resolved by #5, commit f861f79).
- **Scope:** `features/catalysts/`, `features/manage/companies/`, `features/manage/products/`, `features/manage/trials/`
- **Fix shape:** template `@if (canEdit())` once `SpaceRoleService` lands

### 7. Events page and event-form show write controls to Reader
- **Status:** done (resolved by #5, commit f861f79).
- **Scope:** `features/events/events-page.component`, `features/events/event-form.component`
- **Fix shape:** same as #6

### 8. Marker types and taxonomies show write controls to Reader
- **Status:** done (resolved by #5, commit f861f79).
- **Scope:** `features/manage/marker-types/`, `features/manage/taxonomies/`
- **Fix shape:** same as #6

### 15. Tenants RLS too strict for space-only members; tenant dropdown empty
- **Status:** done (resolved 2026-05-01 by migration 20260501050000, commit b733be9). Verified with madala (Reader): topbar now renders the Pfizer logo + name + dropdown showing the tenant; SGLT2 Pipeline visible in the spaces list inside the tenant.
- **Scope:** RLS policy on `tenants` SELECT, plus the topbar tenant-dropdown query in `core/layout/contextual-topbar.component.ts` (uses `tenantService.listMyTenants` which does `select * from tenants`)
- **Symptom:** a pure space-only member (e.g. `madala.dodbele` as Reader of SGLT2 Pipeline, no `tenant_members` row anywhere) sees an empty topbar tenant dropdown when she's inside her space. RLS on `tenants` SELECT currently allows: `is_tenant_member(id)` OR `is_agency_member(agency_id)` OR `is_platform_admin()`. None of those fire for a space-only member, so the tenant row gets filtered out. Verified via curl: `GET /rest/v1/tenants` returned `[]` for her, even though she has full access to SGLT2 inside Pfizer.
- **Why this matters:** the user sees the space content but the tenant context (name, dropdown for switching) is missing or blank. Mirrors the same conceptual gap as follow-up #14 / the `has_tenant_access` issue, but at the data layer.
- **Fix shape:** extend the `tenants` SELECT policy to include "user has a `space_members` row for any space whose `tenant_id` matches this row." A clean way: define `has_tenant_access(p_tenant_id)` (already shipped in migration 84) and inline its predicate into the SELECT policy. Roughly: `is_tenant_member(id) OR is_agency_member(agency_id) OR is_platform_admin() OR exists(select 1 from space_members sm join spaces s on s.id = sm.space_id where s.tenant_id = tenants.id and sm.user_id = auth.uid())`.
- **Caveat:** broaden carefully. The tenants row exposes `name`, `subdomain`, `app_display_name`, `primary_color`, etc. None of those are sensitive to a space-only member (they already see the brand because they're inside the tenant), so the broadening is fine. But audit any other tenant-row column for sensitivity before shipping.
- **Estimate:** 30 minutes for the policy migration, plus a quick scan of other places that read `tenants` to make sure the broader visibility doesn't surprise.
- **Surfaced:** 2026-05-01 access-model test pass, Phase 6 (Reader) when madala.dodbele's tenant dropdown rendered blank inside SGLT2 Pipeline

### 14. Tenant settings chrome reachable to space-only members but inert
- **Status:** done (resolved 2026-05-01 by tenantSettingsGuard, commit 6988211). Verified with madala (Reader): direct navigation to `/t/<pfizer>/settings` now redirects to `/t/<pfizer>/spaces` instead of rendering the empty/inert tenant settings page.
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
- **Status:** done (commit 167a8de, migration 20260501060000). New `public.canonicalize_email(text)` function. Every email-storing and email-looking-up site (add_tenant_owner, invite_to_space, add_agency_member, lookup_user_by_email, provision_agency, accept_invite, accept_space_invite, handle_new_user trigger) canonicalizes both sides of every comparison. Verified live 2026-05-01 via curl: `canonicalize_email` reduced `madala.dodbele@gmail.com`, `madaladodbele@gmail.com`, and `madala.dodbele+phase8@gmail.com` all to `madaladodbele@gmail.com`; `lookup_user_by_email` resolved all three to the same `user_id`.
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
- **Status:** done (resolved 2026-05-01 by commit c0f3a87). Verified with novaepicestates (no memberships): "Wrong account? Sign out" link visible below the join-code form; click signs the user out and routes to `/login`.
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
- **Status:** done (commit 67ebb0c, scoped to tenant-settings branding card). Read-only branding card now names the parent agency via brand context, displays the active primary color as a swatch + hex, and conditionally surfaces a cross-host link to the agency portal when the current user is a member of the parent agency.
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
