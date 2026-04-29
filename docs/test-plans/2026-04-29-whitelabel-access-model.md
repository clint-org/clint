# Test Plan: Whitelabel Access Model (Apr 29, 2026)

A resumable QA pass over what landed in this session. Check each box as you verify; commit between sessions so a new Claude session sees current state. Order matters within a section -- earlier steps create state used by later ones.

## Context for a future session

What was shipped (commits on `main`, latest `ab070f8`):
- Migration 75 (`20260429010000_owner_only_explicit_space_access.sql`) -- collapsed access model. `agency_members.role` and `tenant_members.role` are now `owner`-only. New `agencies.email_domain` optional lock. New `space_invites` table. New RPCs: `add_tenant_owner`, `invite_to_space`, `accept_space_invite`. `provision_tenant` auto-adds caller as tenant + space owner. `has_space_access` rewritten -- only explicit `space_members` rows grant data access; no implicit cascade from tenant or agency level. Migration applied to **both local and prod** Supabase.
- Migration 74 (`20260429000000_remove_accent_color.sql`) -- dropped unused accent_color column. Applied prod.
- Member self-protection guards (migration 73) -- can't self-remove or remove the last owner.
- Cross-host tenant switching (commit `01f97e3`).
- Brand-color isolation: super-admin and agency portals locked to platform teal regardless of host brand seed (commit `88dd157`).
- Mobile fixes: catalysts vertical scroll on iOS, sidebar full-height on mobile, topbar dropdowns no longer clipped, all PrimeNG overlays portaled to `body`.
- "Org" -> "Tenant" rename across the codebase (commit `ab070f8`).

Prod state at start of test pass:
- Apex: `clintapp.com` (default brand, marketing landing).
- Super-admin: `admin.clintapp.com`.
- Agency: **Stout** at `stout.clintapp.com`. Owner: `aadi529@gmail.com`. After migration 75 the `email_domain` was backfilled to `gmail.com`.
- Tenant under Stout: **Pfizer** at `pfizer.clintapp.com`. Owner: same user (auto-added by migration backfill). One default space `Workspace` with seeded catalysts data; user is also auto-added as space owner.

Every step below should be performed against **prod** unless otherwise noted.

---

## Section 0: Pre-flight

- [ ] Sign in to `admin.clintapp.com` as `aadi529@gmail.com` (super-admin). Confirm Stout agency and Pfizer tenant are both listed and active (not suspended).
- [ ] Sign in to `stout.clintapp.com/admin` as the same user. Confirm Stout's agency portal renders with the platform teal accent (not whatever color Stout's brand seed is set to). Save buttons and active nav items should be teal-600.
- [ ] Sign in to `pfizer.clintapp.com` as the same user. Confirm catalysts page loads and shows seeded data (catalysts table, not "no data").

If any of the above fails, fix before proceeding -- the rest of the plan assumes this baseline.

---

## Section 1: Email-domain lock

The Stout agency was backfilled with `email_domain = 'gmail.com'`. Decide what you want it to be before testing tenant-owner adds.

- [ ] On `stout.clintapp.com/admin/branding`, scroll to "Member email domain (lock)". Confirm it's pre-populated with `gmail.com`.
- [ ] **Pick one path:**
   - Path A (keep gmail.com lock): all later "add tenant owner" and "add agency member" tests will need gmail.com emails. Easiest with multiple personal Gmail accounts.
   - Path B (blank it out): clears the lock; any email is allowed. Use this if you only have one Gmail and want to test cross-domain adds.
   - Path C (set to a real test domain, e.g. one you own): closest to real enterprise use.
- [ ] Save and verify "Agency branding updated" toast appears.

---

## Section 2: Add a tenant owner (positive path)

Goal: prove `add_tenant_owner` works and the UI surfaces both the "user already exists" and "invite held" branches.

Setup: pick a second email matching whatever lock you set in Section 1.

- [ ] On `stout.clintapp.com/admin/tenants`, click into Pfizer.
- [ ] Click "Add owner". Enter the second email.
- [ ] If that email already has an auth.users row → expect green message "<email> added as tenant owner."
- [ ] If that email is brand new → expect green message "Invite held for <email>. Code: <32-char hex>".
- [ ] Members table refreshes and shows the new owner (or doesn't, if invite-held; that's expected).
- [ ] **Negative test (only if you have a non-matching domain available):** Try to add an email on a domain that doesn't match the lock. Expect a red error like "Email domain (xxx.com) does not match agency domain (yyy.com)".

---

## Section 3: Firewall verification (the big one)

This is the architectural test that justifies migration 75. Tenant ownership must NOT grant space data access.

- [ ] Sign out as `aadi529@gmail.com`.
- [ ] Sign in as the second user (the one you just added in Section 2). If they were invite-held, paste the invite code at `stout.clintapp.com/onboarding?tab=join` (or any host's `/onboarding`) after signing in.
- [ ] Navigate (or be auto-redirected) to `pfizer.clintapp.com`. Confirm the user lands on the spaces list.
- [ ] Click into the Workspace space.
- [ ] **Expected:** the catalysts/landscape pages load but show NO data, OR a permission error. The user is a tenant owner but NOT a space member, so `has_space_access` returns false.
- [ ] Open `pfizer.clintapp.com/t/<id>/settings` (tenant settings) -- expected: works (they're a tenant owner). Members table should show both owners.

If the second user CAN see catalysts data, the migration's authority cascade did not get fully removed. Check `supabase/migrations/20260429010000_owner_only_explicit_space_access.sql` step 5 (`has_space_access` body) and verify it ran on prod (`select prosrc from pg_proc where proname = 'has_space_access';` via Supabase SQL editor).

---

## Section 4: Space invite (existing user, Contributor role)

Goal: prove `invite_to_space` adds an existing user directly and they can edit data.

- [ ] Sign back in as `aadi529@gmail.com` (the original owner with space access).
- [ ] Navigate to `pfizer.clintapp.com/t/<id>/s/<workspaceId>/settings/members` (or open the space, then Settings -> Members).
- [ ] Click "Invite to space". Enter the second user's email, role = Contributor. Submit.
- [ ] Expected: green message "<email> added to space."
- [ ] Sign out, sign in as the second user, return to Pfizer Workspace.
- [ ] Catalysts data is now visible.
- [ ] As the second user, edit a catalyst (change status or add a marker) -- expected: write succeeds (Contributor role allows writes).

---

## Section 5: Space invite (new user, Reader role, any domain)

Goal: prove invites hold for unknown emails AND that spaces accept any email domain (no enforcement at space level).

- [ ] As `aadi529@gmail.com`, on Workspace's space-members page, click "Invite to space".
- [ ] Enter an email on a non-gmail domain (e.g. a `+something@gmail.com` alias counts; or use a temp-mail address). Role = Reader.
- [ ] Expected: green message "Invite held for <email>. Code: <hex>." Copy the code.
- [ ] Sign out. Sign up as the new email (Google/Microsoft OAuth). After landing, go to `/onboarding?tab=join` and paste the code.
- [ ] Expected: redirected to `pfizer.clintapp.com/t/<id>/s/<workspaceId>` and catalysts data is visible (read-only).
- [ ] As the Reader, try to edit a catalyst -- expected: edit fails (Reader is view-only).

---

## Section 6: Cross-host session persistence

Goal: prove the apex cookie + cross-host redirect work end-to-end.

- [ ] Sign in fresh on `stout.clintapp.com` as `aadi529@gmail.com`.
- [ ] In the topbar, open the tenant dropdown and pick Pfizer. Expect a full-page navigation to `pfizer.clintapp.com/t/<pfizer-id>/spaces` AND that you stay signed in (no re-login, no redirect to /login).
- [ ] Bonus: open dev tools, Application tab, Cookies, confirm a cookie with `Domain = .clintapp.com` and a Supabase session token.

If the user is bounced to /login on the new host, the apex cookie isn't being set or read correctly. Check `environment.apexDomain` and the `cookie-storage` chunking fix (commit `6130b6c`).

---

## Section 7: Member self-protection

Goal: prove migration 73 still works under the new owner-only model.

- [ ] On `pfizer.clintapp.com/t/<id>/settings`, with two tenant owners present, find your own row -- expected: no row-actions menu (you can't remove yourself).
- [ ] Open the row-actions for the OTHER owner -- "Remove owner" should be available.
- [ ] **Don't actually remove them yet.** Try a SQL-level removal of your own row through the Supabase dashboard SQL editor: `delete from tenant_members where tenant_id = '<pfizer-id>' and user_id = '<your-uid>';` Expected: error `42501 You cannot remove yourself from this tenant. Ask another owner to remove you.`
- [ ] Then have the OTHER owner sign in and try to remove themselves -- expected: same self-removal block from the UI side.

---

## Section 8: Mobile UI sanity (iOS Safari)

Quick visual pass. On a phone:

- [ ] `pfizer.clintapp.com` catalysts page: vertical scroll works past the first viewport (the late-April fix that motivated half this session).
- [ ] Catalysts page: horizontal scroll on the table still works (swipe sideways shows more columns).
- [ ] Topbar tenant/space dropdown opens and is fully visible (not clipped, not hidden behind page content).
- [ ] Tenant settings or space-members page: tap a `p-select` (e.g. role dropdown) -- panel renders and is fully visible (PrimeNG overlay portaled to body).
- [ ] Sidebar: dark icon rail spans the full page height, not just the content card.

---

## Section 9: Brand-color isolation

- [ ] On `admin.clintapp.com/super-admin`: every primary button, active nav item, and accent should be platform teal-600 (#0d9488).
- [ ] On `stout.clintapp.com/admin`: same -- platform teal regardless of Stout's `primary_color`.
- [ ] On `pfizer.clintapp.com` (any tenant page): primary color reflects Pfizer's `tenants.primary_color` (or default teal if not customized). The tenant-facing surface IS the whitelabel surface.

---

## Section 10: Negative -- cascading parent delete still works

The member-guard triggers should NOT block a legit tenant deletion (cascade flag).

- [ ] On `admin.clintapp.com/super-admin/tenants`, create a throwaway tenant under Stout (or any agency). Note its id.
- [ ] On the same page, delete the throwaway tenant. Expected: succeeds. The `tenant_members` cascade should not be blocked by the self-removal guard.
- [ ] Confirm the tenant is gone from the list AND the subdomain is in `retired_hostnames` (visible from the super-admin domains page if surfaced; otherwise via SQL).

---

## Section 11: Cleanup

After QA:

- [ ] Decide what to do with the test users created during Sections 2-5. If you don't want them lying around in prod auth.users, delete them via Supabase dashboard -> Authentication -> Users.
- [ ] If you used a throwaway tenant in Section 10, decide whether to release its subdomain via the super-admin domains page.

---

## Failure-triage cheat sheet

| Symptom | Likely cause | First place to look |
|---|---|---|
| Tenant owner sees catalysts data without being added to the space | `has_space_access` cascade not removed on prod | SQL: `select prosrc from pg_proc where proname = 'has_space_access'` |
| `add_tenant_owner` succeeds for any email | `email_domain` is null on agency, or platform admin bypass triggered | `select email_domain from agencies where id = '<id>'`; check whether you're calling as super-admin |
| Cross-host nav bounces to /login | Apex cookie not set | dev tools cookies, check Domain=.clintapp.com; `environment.apexDomain` setting |
| Self-removal blocked from UI but allowed via SQL | `tenant_members_self_protection` trigger not present | `select tgname from pg_trigger where tgrelid = 'tenant_members'::regclass` |
| Mobile dropdown clipped | `:host` z-index lost in `contextual-topbar.component.ts` | Inspect `.topbar` in dev tools |
| Admin chrome shows agency's pale brand color | `.admin-brand-scope` class missing on shell wrapper | Inspect `<div class="agency-shell ...">` and `<div class="sa-shell ...">` |
